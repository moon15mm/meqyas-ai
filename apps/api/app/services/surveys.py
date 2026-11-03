"""Survey engine use-cases: documents ↔ normalized tables, copy-on-write
versioning, publishing state machine, AI generation and AI review."""

from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.agents import QuestionReviewerAgent, SurveyGeneratorAgent
from meqyas_ai.schemas.survey import GeneratedSurvey, GenLogic, GenQuestion
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Conflict, NotFound, Unprocessable
from ..core.ids import public_id, uuid7
from ..domain.enums import QuestionType, SurveyStatus, VersionStatus, WaveType
from ..domain.permissions import Permission
from ..domain.survey.document import (
    CHOICE_TYPES,
    NUMERIC_TYPES,
    SCALE_TYPES,
    LogicRuleDoc,
    OptionDoc,
    QuestionDoc,
    ScaleDoc,
    SectionDoc,
    SurveyDoc,
    blank_document,
    completeness_issues,
)
from ..domain.survey.logic import condition_questions, validate_logic
from ..domain.survey.quality import DimensionRef, IndicatorRef, quality_report
from ..models import (
    Dimension,
    Indicator,
    LogicRule,
    MeasurementPlan,
    MeasurementWave,
    Project,
    Question,
    QuestionOption,
    Response,
    Survey,
    SurveySection,
    SurveyVersion,
)
from ..schemas.survey import (
    LogicIssueOut,
    ReviewIssue,
    ReviewOut,
    SurveyDetail,
    SurveyMeta,
    VersionMeta,
)
from . import subscriptions
from .ai import run_agent
from .audit import audit
from .projects import get_owned

logger = logging.getLogger("meqyas.surveys")

_generator = SurveyGeneratorAgent()
_reviewer = QuestionReviewerAgent()

_REPEATED_WAVES = {WaveType.POST, WaveType.FOLLOW_UP, WaveType.MIDLINE, WaveType.ROUND}


# ======================================================================
# Persistence: SurveyDoc <-> normalized rows
# ======================================================================
async def load_doc(session: AsyncSession, version: SurveyVersion) -> SurveyDoc:
    sections = (
        await session.scalars(
            select(SurveySection)
            .where(SurveySection.survey_version_id == version.id)
            .order_by(SurveySection.sort_order)
        )
    ).all()
    questions = (
        await session.scalars(
            select(Question).where(Question.survey_version_id == version.id).order_by(Question.sort_order)
        )
    ).all()
    q_ids = [q.id for q in questions]
    options = (
        (
            await session.scalars(
                select(QuestionOption).where(QuestionOption.question_id.in_(q_ids)).order_by(QuestionOption.sort_order)
            )
        ).all()
        if q_ids
        else []
    )
    rules = (
        await session.scalars(
            select(LogicRule).where(LogicRule.survey_version_id == version.id).order_by(LogicRule.sort_order)
        )
    ).all()

    opts: dict[uuid.UUID, list[dict[str, Any]]] = defaultdict(list)
    for o in options:
        opts[o.question_id].append(
            {
                "value": o.value,
                "label": o.label,
                "score": o.score,
                "is_other": o.is_other,
                "is_exclusive": o.is_exclusive,
            }
        )
    by_section: dict[uuid.UUID, list[dict[str, Any]]] = defaultdict(list)
    for q in questions:
        by_section[q.section_id].append(
            {
                "key": q.key,
                "type": q.type,
                "text": q.text,
                "description": q.description,
                "required": q.required,
                "dimension_id": q.dimension_id,
                "indicator_id": q.indicator_id,
                "options": opts.get(q.id, []),
                "scale": q.scale,
                "validation": q.validation or {},
                "settings": q.settings or {},
                "scoring": q.scoring or {},
                "ai_generated": q.ai_generated,
                "lineage_id": q.lineage_id,
            }
        )
    return SurveyDoc.model_validate(
        {
            "title": version.title,
            "introduction": version.introduction,
            "thank_you_message": version.thank_you_message,
            "language": version.language,
            "settings": (version.settings or {}).get("doc_settings", {}),
            "sections": [
                {
                    "key": s.key,
                    "title": s.title,
                    "description": s.description,
                    "randomize_questions": s.randomize_questions,
                    "questions": by_section.get(s.id, []),
                }
                for s in sections
            ],
            "logic": [
                {
                    "id": r.rule_key,
                    "type": r.rule_type,
                    "source_key": r.source_key,
                    "target_key": r.target_key,
                    "condition": r.condition or {},
                    "limit": r.limit,
                    "enabled": r.enabled,
                }
                for r in rules
            ],
        }
    )


async def _check_references(session: AsyncSession, project_id: uuid.UUID, doc: SurveyDoc) -> None:
    """Questions may only link to dimensions/indicators of the same project (tenant safety)."""
    dim_ids = {q.dimension_id for q in doc.questions() if q.dimension_id}
    ind_ids = {q.indicator_id for q in doc.questions() if q.indicator_id}
    if dim_ids:
        found = set(
            (
                await session.scalars(
                    select(Dimension.id).where(Dimension.id.in_(dim_ids), Dimension.project_id == project_id)
                )
            ).all()
        )
        if missing := dim_ids - found:
            raise Unprocessable(
                "Unknown dimension reference", code="invalid_dimension", details={"ids": [str(i) for i in missing]}
            )
    if ind_ids:
        found = set(
            (
                await session.scalars(
                    select(Indicator.id).where(Indicator.id.in_(ind_ids), Indicator.project_id == project_id)
                )
            ).all()
        )
        if missing := ind_ids - found:
            raise Unprocessable(
                "Unknown indicator reference", code="invalid_indicator", details={"ids": [str(i) for i in missing]}
            )


async def write_doc(session: AsyncSession, survey: Survey, version: SurveyVersion, doc: SurveyDoc) -> None:
    await _check_references(session, survey.project_id, doc)
    org = survey.organization_id
    await session.execute(delete(LogicRule).where(LogicRule.survey_version_id == version.id))
    await session.execute(delete(SurveySection).where(SurveySection.survey_version_id == version.id))

    for s_order, section in enumerate(doc.sections):
        sec = SurveySection(
            organization_id=org,
            survey_version_id=version.id,
            key=section.key,
            title=section.title,
            description=section.description,
            sort_order=s_order,
            randomize_questions=section.randomize_questions,
        )
        session.add(sec)
        await session.flush()
        for q_order, q in enumerate(section.questions):
            row = Question(
                organization_id=org,
                survey_version_id=version.id,
                section_id=sec.id,
                key=q.key,
                lineage_id=q.lineage_id or uuid.uuid4(),
                type=q.type,
                text=q.text,
                description=q.description,
                required=q.required,
                dimension_id=q.dimension_id,
                indicator_id=q.indicator_id,
                scale=q.scale.model_dump() if q.scale else None,
                validation=q.validation.model_dump(exclude_none=True),
                settings=q.settings.model_dump(),
                scoring=q.scoring.model_dump(exclude_none=True),
                ai_generated=q.ai_generated,
                sort_order=q_order,
            )
            session.add(row)
            await session.flush()
            for o_order, o in enumerate(q.options):
                session.add(
                    QuestionOption(
                        organization_id=org,
                        question_id=row.id,
                        value=o.value,
                        label=o.label,
                        score=o.score,
                        sort_order=o_order,
                        is_other=o.is_other,
                        is_exclusive=o.is_exclusive,
                    )
                )
    for r_order, rule in enumerate(doc.logic):
        session.add(
            LogicRule(
                organization_id=org,
                survey_version_id=version.id,
                rule_key=rule.id or uuid.uuid4().hex[:12],
                rule_type=rule.type,
                source_key=rule.source_key,
                target_key=rule.target_key,
                condition=rule.condition,
                limit=rule.limit,
                sort_order=r_order,
                enabled=rule.enabled,
            )
        )
    version.title = doc.title
    version.introduction = doc.introduction
    version.thank_you_message = doc.thank_you_message
    version.language = doc.language
    version.settings = {**(version.settings or {}), "doc_settings": doc.settings.model_dump()}
    version.updated_at = datetime.now(UTC)
    if doc.title.strip():  # lists keep the last real title while the draft title is being retyped
        survey.title = doc.title
    survey.language = doc.language
    await session.flush()


# ======================================================================
# Read models
# ======================================================================
async def get_survey(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID) -> Survey:
    ctx.require(Permission.PROJECT_READ)
    return await get_owned(session, Survey, survey_id, ctx)


async def _version(session: AsyncSession, version_id: uuid.UUID | None) -> SurveyVersion | None:
    return await session.get(SurveyVersion, version_id) if version_id else None


async def _question_counts(session: AsyncSession, version_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not version_ids:
        return {}
    rows = await session.execute(
        select(Question.survey_version_id, func.count())
        .where(
            Question.survey_version_id.in_(version_ids),
            Question.type.not_in([QuestionType.INFORMATION, QuestionType.SECTION]),
        )
        .group_by(Question.survey_version_id)
    )
    return {vid: int(n) for vid, n in rows.all()}


async def _response_counts(
    session: AsyncSession, survey_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, datetime | None]]:
    if not survey_ids:
        return {}
    rows = await session.execute(
        select(Response.survey_id, func.count(), func.max(Response.created_at))
        .where(Response.survey_id.in_(survey_ids))
        .group_by(Response.survey_id)
    )
    return {sid: (int(n), last) for sid, n, last in rows.all()}


async def _metas(session: AsyncSession, surveys: list[Survey]) -> list[SurveyMeta]:
    if not surveys:
        return []
    version_ids = [v for s in surveys for v in (s.current_version_id, s.published_version_id) if v]
    versions = {
        v.id: v for v in (await session.scalars(select(SurveyVersion).where(SurveyVersion.id.in_(version_ids)))).all()
    }
    projects = {
        p.id: p
        for p in (await session.scalars(select(Project).where(Project.id.in_({s.project_id for s in surveys})))).all()
    }
    wave_ids = {s.wave_id for s in surveys if s.wave_id}
    waves = (
        {
            w.id: w
            for w in (await session.scalars(select(MeasurementWave).where(MeasurementWave.id.in_(wave_ids)))).all()
        }
        if wave_ids
        else {}
    )
    counts = await _question_counts(session, [s.current_version_id for s in surveys if s.current_version_id])
    responses = await _response_counts(session, [s.id for s in surveys])
    metas: list[SurveyMeta] = []
    for s in surveys:
        current = versions.get(s.current_version_id) if s.current_version_id else None
        published = versions.get(s.published_version_id) if s.published_version_id else None
        wave = waves.get(s.wave_id) if s.wave_id else None
        project = projects.get(s.project_id)
        metas.append(
            SurveyMeta(
                id=s.id,
                project_id=s.project_id,
                project_title=project.title if project else "",
                wave_id=s.wave_id,
                wave_type=wave.wave_type if wave else None,
                wave_name=wave.name if wave else None,
                title=s.title,
                description=s.description,
                status=s.status,
                public_id=s.public_id,
                language=s.language,
                ai_generated=s.ai_generated,
                is_demo=s.is_demo,
                question_count=counts.get(s.current_version_id, 0) if s.current_version_id else 0,
                current_version=VersionMeta.model_validate(current) if current else None,
                published_version_number=published.version_number if published else None,
                has_unpublished_changes=bool(
                    current and published and current.id != published.id and current.status == VersionStatus.DRAFT
                ),
                response_count=responses.get(s.id, (0, None))[0],
                last_response_at=responses.get(s.id, (0, None))[1],
                opens_at=s.opens_at,
                closes_at=s.closes_at,
                response_limit=s.response_limit,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
        )
    return metas


def _effective_review(version: SurveyVersion, doc: SurveyDoc) -> ReviewOut:
    data = version.review or {}
    texts = {q.key: q.text for q in doc.questions()}
    issues: list[ReviewIssue] = []
    for raw in data.get("issues", []):
        issue = ReviewIssue.model_validate(raw)
        if issue.status == "open" and (
            issue.question_key not in texts
            or (issue.question_text and texts[issue.question_key] != issue.question_text)
        ):
            issue = issue.model_copy(update={"status": "stale"})
        issues.append(issue)
    return ReviewOut(ran_at=data.get("ran_at"), overall_comment=data.get("overall_comment", ""), issues=issues)


async def _plan_refs(
    session: AsyncSession, project_id: uuid.UUID
) -> tuple[list[DimensionRef], list[IndicatorRef], float | None]:
    dims = (
        await session.scalars(
            select(Dimension).where(Dimension.project_id == project_id).order_by(Dimension.sort_order)
        )
    ).all()
    inds = (
        await session.scalars(
            select(Indicator).where(Indicator.project_id == project_id).order_by(Indicator.sort_order)
        )
    ).all()
    minutes = await session.scalar(
        select(MeasurementPlan.estimated_completion_minutes).where(MeasurementPlan.project_id == project_id)
    )
    return (
        [DimensionRef(d.id, d.name) for d in dims],
        [IndicatorRef(i.id, i.name, i.dimension_id) for i in inds],
        float(minutes) if minutes else None,
    )


async def survey_detail(session: AsyncSession, survey: Survey) -> SurveyDetail:
    version = await _version(session, survey.current_version_id)
    if version is None:
        raise NotFound("Survey version not found")
    doc = await load_doc(session, version)
    issues = validate_logic(doc)
    review = _effective_review(version, doc)
    dims, inds, minutes = await _plan_refs(session, survey.project_id)
    report = quality_report(
        doc,
        dimensions=dims,
        indicators=inds,
        recommended_minutes=minutes,
        review_issues=[i.model_dump() for i in review.issues],
        logic_issues=issues,
    )
    meta = (await _metas(session, [survey]))[0]
    return SurveyDetail(
        survey=meta,
        doc=doc,
        logic_issues=[LogicIssueOut(**asdict(i)) for i in issues],
        completeness=completeness_issues(doc),
        quality=report.as_dict(),
        review=review,
    )


async def list_surveys(
    session: AsyncSession,
    ctx: OrgContext,
    *,
    project_id: uuid.UUID | None = None,
    status: SurveyStatus | None = None,
) -> list[SurveyMeta]:
    ctx.require(Permission.PROJECT_READ)
    stmt = select(Survey).where(Survey.organization_id == ctx.organization_id)
    if project_id:
        await get_owned(session, Project, project_id, ctx)
        stmt = stmt.where(Survey.project_id == project_id)
    if status:
        stmt = stmt.where(Survey.status == status)
    else:
        stmt = stmt.where(Survey.status != SurveyStatus.ARCHIVED)
    surveys = list((await session.scalars(stmt.order_by(Survey.updated_at.desc()))).all())
    return await _metas(session, surveys)


# ======================================================================
# Commands
# ======================================================================
async def _unique_public_id(session: AsyncSession) -> str:
    for _ in range(10):
        candidate = public_id(10)
        if not await session.scalar(select(Survey.id).where(Survey.public_id == candidate)):
            return candidate
    raise Conflict("Could not allocate a public id")  # pragma: no cover


async def _check_wave(
    session: AsyncSession, ctx: OrgContext, wave_id: uuid.UUID | None, project_id: uuid.UUID
) -> MeasurementWave | None:
    if wave_id is None:
        return None
    wave = await get_owned(session, MeasurementWave, wave_id, ctx)
    if wave.project_id != project_id:
        raise NotFound("MeasurementWave not found")
    return wave


async def create_survey(
    session: AsyncSession,
    ctx: OrgContext,
    project_id: uuid.UUID,
    *,
    title: str,
    wave_id: uuid.UUID | None = None,
    doc: SurveyDoc | None = None,
    language: str | None = None,
    ai_generated: bool = False,
    settings: dict[str, Any] | None = None,
    survey_id: uuid.UUID | None = None,
) -> Survey:
    ctx.require(Permission.SURVEY_EDIT)
    project = await get_owned(session, Project, project_id, ctx)
    await _check_wave(session, ctx, wave_id, project.id)
    lang = language or (doc.language if doc else ctx.organization.locale) or "ar"
    document = doc or blank_document(title, lang)
    survey = Survey(
        id=survey_id or uuid7(),
        organization_id=ctx.organization_id,
        project_id=project.id,
        wave_id=wave_id,
        title=document.title,
        status=SurveyStatus.DRAFT,
        public_id=await _unique_public_id(session),
        language=document.language,
        ai_generated=ai_generated,
        is_demo=project.is_demo,
        created_by_id=ctx.user_id,
        settings=settings or {},
    )
    session.add(survey)
    await session.flush()
    version = SurveyVersion(
        organization_id=ctx.organization_id,
        survey_id=survey.id,
        version_number=1,
        status=VersionStatus.DRAFT,
        title=document.title,
        language=document.language,
        created_by_id=ctx.user_id,
    )
    session.add(version)
    await session.flush()
    await write_doc(session, survey, version, document)
    survey.current_version_id = version.id
    audit(
        session,
        action="survey.create",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="survey",
        entity_id=survey.id,
        meta={"ai_generated": ai_generated},
    )
    await session.commit()
    await session.refresh(survey)
    return survey


async def _editable_version(session: AsyncSession, ctx: OrgContext, survey: Survey) -> SurveyVersion:
    """Return the draft version, creating one (copy-on-write) if the current version is frozen."""
    if survey.status == SurveyStatus.ARCHIVED:
        raise Conflict("Archived surveys cannot be edited", code="survey_archived")
    current = await _version(session, survey.current_version_id)
    if current is not None and current.status == VersionStatus.DRAFT:
        return current
    last = await session.scalar(
        select(func.max(SurveyVersion.version_number)).where(SurveyVersion.survey_id == survey.id)
    )
    draft = SurveyVersion(
        organization_id=survey.organization_id,
        survey_id=survey.id,
        version_number=int(last or 0) + 1,
        status=VersionStatus.DRAFT,
        title=current.title if current else survey.title,
        language=current.language if current else survey.language,
        settings=dict(current.settings or {}) if current else {},
        review=dict(current.review or {}) if current else {},
        created_by_id=ctx.user_id,
    )
    session.add(draft)
    await session.flush()
    survey.current_version_id = draft.id
    return draft


async def save_draft(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID, doc: SurveyDoc) -> Survey:
    ctx.require(Permission.SURVEY_EDIT)
    survey = await get_owned(session, Survey, survey_id, ctx)
    version = await _editable_version(session, ctx, survey)
    await write_doc(session, survey, version, doc)
    survey.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(survey)
    return survey


async def update_meta(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID, data: dict[str, Any]) -> Survey:
    ctx.require(Permission.SURVEY_EDIT)
    survey = await get_owned(session, Survey, survey_id, ctx)
    if "wave_id" in data:
        await _check_wave(session, ctx, data["wave_id"], survey.project_id)
    for key, value in data.items():
        setattr(survey, key, value)
    await session.commit()
    await session.refresh(survey)
    return survey


_TRANSITIONS: dict[str, tuple[set[SurveyStatus], SurveyStatus]] = {
    "pause": ({SurveyStatus.PUBLISHED}, SurveyStatus.PAUSED),
    "resume": ({SurveyStatus.PAUSED}, SurveyStatus.PUBLISHED),
    "close": ({SurveyStatus.PUBLISHED, SurveyStatus.PAUSED}, SurveyStatus.CLOSED),
    "reopen": ({SurveyStatus.CLOSED}, SurveyStatus.PUBLISHED),
    "archive": ({SurveyStatus.DRAFT, SurveyStatus.CLOSED}, SurveyStatus.ARCHIVED),
}


async def transition(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID, action: str) -> Survey:
    survey = await get_owned(session, Survey, survey_id, ctx)
    now = datetime.now(UTC)

    if action == "publish":
        ctx.require(Permission.SURVEY_PUBLISH)
        current = await _version(session, survey.current_version_id)
        if current is None or current.status != VersionStatus.DRAFT:
            raise Conflict("There are no changes to publish", code="nothing_to_publish")
        if survey.status == SurveyStatus.ARCHIVED:
            raise Conflict("Archived surveys cannot be published", code="survey_archived")
        doc = await load_doc(session, current)
        if not [q for q in doc.questions() if q.answerable]:
            raise Unprocessable("Add at least one question before publishing", code="empty_survey")
        incomplete = completeness_issues(doc)
        if incomplete:
            raise Unprocessable(
                "Complete the highlighted questions before publishing",
                code="incomplete_questions",
                details={"issues": incomplete},
            )
        issues = validate_logic(doc)
        if issues:
            raise Unprocessable(
                "Fix the logic issues before publishing",
                code="logic_issues",
                details={"issues": [asdict(i) for i in issues]},
            )
        if survey.published_version_id is None:
            # A survey's first publication counts against the plan's surveys (SUBSCRIPTIONS.md);
            # new versions of a published survey are free.
            await subscriptions.consume_survey(session, ctx.organization_id)
        previous = await _version(session, survey.published_version_id)
        if previous is not None:
            previous.status = VersionStatus.RETIRED
        current.status = VersionStatus.PUBLISHED
        current.published_at = now
        survey.published_version_id = current.id
        # A new version of a paused/closed survey does not silently reopen collection.
        if survey.status == SurveyStatus.DRAFT:
            survey.status = SurveyStatus.PUBLISHED
        audit(
            session,
            action="survey.publish",
            organization_id=ctx.organization_id,
            actor_user_id=ctx.user_id,
            entity_type="survey",
            entity_id=survey.id,
            meta={"version": current.version_number},
        )
    elif action == "discard_changes":
        ctx.require(Permission.SURVEY_EDIT)
        current = await _version(session, survey.current_version_id)
        if current is None or current.status != VersionStatus.DRAFT or survey.published_version_id is None:
            raise Conflict("There are no unpublished changes to discard", code="nothing_to_discard")
        survey.current_version_id = survey.published_version_id
        await session.flush()
        await session.delete(current)
    elif action in _TRANSITIONS:
        ctx.require(Permission.SURVEY_PUBLISH)
        allowed, target = _TRANSITIONS[action]
        if survey.status not in allowed:
            raise Conflict(f"Cannot {action} a survey that is {survey.status.value}", code="invalid_transition")
        if action == "reopen" and survey.published_version_id is None:
            raise Conflict("This survey was never published", code="invalid_transition")
        survey.status = target
        audit(
            session,
            action=f"survey.{action}",
            organization_id=ctx.organization_id,
            actor_user_id=ctx.user_id,
            entity_type="survey",
            entity_id=survey.id,
        )
    else:  # pragma: no cover - guarded by the API schema
        raise Unprocessable("Unknown action")
    survey.updated_at = now
    await session.commit()
    await session.refresh(survey)
    return survey


async def delete_survey(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID) -> None:
    ctx.require(Permission.SURVEY_EDIT)
    survey = await get_owned(session, Survey, survey_id, ctx)
    if survey.published_version_id is not None:
        raise Conflict("Published surveys keep their data; close and archive them instead", code="survey_published")
    survey.current_version_id = None
    await session.flush()
    await session.delete(survey)
    audit(
        session,
        action="survey.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="survey",
        entity_id=survey_id,
    )
    await session.commit()


# ======================================================================
# AI generation
# ======================================================================
def _num_or_str(value: str, numeric: bool) -> Any:
    if numeric:
        try:
            number = float(value)
            return int(number) if number.is_integer() else number
        except ValueError:
            return value
    return value


def _unique_options(raw: list[tuple[str, str, float | None]]) -> list[OptionDoc]:
    seen: set[str] = set()
    out: list[OptionDoc] = []
    for i, (value, label, score) in enumerate(raw, start=1):
        v = re.sub(r"\s+", "_", (value or "").strip())[:60] or str(i)
        while v in seen:
            v = f"{v}_{i}"[:60]
        seen.add(v)
        out.append(OptionDoc(value=v, label=label or v, score=score))
    return out


def gen_question_to_doc(
    gq: GenQuestion, dims: dict[str, uuid.UUID], inds: dict[str, uuid.UUID], language: str
) -> QuestionDoc:
    qtype = gq.type
    options = _unique_options([(o.value, o.label, o.score) for o in gq.options])
    scale: ScaleDoc | None = None
    if qtype in SCALE_TYPES:
        lo = gq.scale_min if gq.scale_min is not None else 1
        hi = gq.scale_max if gq.scale_max is not None else 5
        if hi <= lo:
            lo, hi = 1, 5
        scale = ScaleDoc(min=lo, max=hi, min_label=gq.min_label, max_label=gq.max_label)
        if qtype == QuestionType.LIKERT:
            points = hi - lo + 1
            if len(options) == points:
                ordered = sorted(options, key=lambda o: o.score if o.score is not None else 0)
                if all(o.score is not None for o in options):
                    options = ordered
                options = [
                    OptionDoc(value=str(lo + i), label=o.label, score=float(lo + i)) for i, o in enumerate(options)
                ]
            else:
                options = []  # SurveyDoc fills the standard agreement labels
        elif qtype != QuestionType.MATRIX:
            options = []
    settings: dict[str, Any] = {"is_profile": gq.is_profile, "ai_followup": gq.ai_followup}
    if qtype == QuestionType.MATRIX:
        settings["rows"] = [
            {"key": re.sub(r"[^a-z0-9_]", "_", r.key.lower())[:60] or f"r{i}", "text": r.text}
            for i, r in enumerate(gq.rows, start=1)
        ]
        keys = [r["key"] for r in settings["rows"]]
        for i, row in enumerate(settings["rows"]):
            if not re.match(r"^[a-z]", row["key"]) or keys.count(row["key"]) > 1:
                row["key"] = f"r{i + 1}"
    scoring: dict[str, Any] = {}
    if gq.correct_value and qtype in CHOICE_TYPES:
        match = next((o.value for o in options if o.value == gq.correct_value or o.label == gq.correct_value), None)
        if match:
            scoring["correct_values"] = [match]
    return QuestionDoc(
        key=gq.key,
        type=qtype,
        text=gq.text,
        description=gq.description,
        required=gq.required and not gq.is_profile and qtype not in (QuestionType.LONG_TEXT, QuestionType.SHORT_TEXT),
        dimension_id=dims.get(gq.dimension_key or ""),
        indicator_id=inds.get(gq.indicator_code or ""),
        options=options,
        scale=scale,
        settings=settings,
        scoring=scoring,
        ai_generated=True,
    )


def _gen_logic(rule: GenLogic, qmap: dict[str, QuestionDoc]) -> LogicRuleDoc:
    question = qmap.get(rule.question_key)
    numeric = bool(question and question.type in NUMERIC_TYPES)
    condition: dict[str, Any] = {"question": rule.question_key, "op": rule.op}
    if rule.op in ("in", "not_in"):
        condition["value"] = [_num_or_str(v, numeric) for v in rule.values]
    elif rule.op not in ("answered", "not_answered") and rule.values:
        condition["value"] = _num_or_str(rule.values[0], numeric)
    return LogicRuleDoc(
        id=uuid.uuid4().hex[:12],
        type=rule.type,
        source_key=rule.source_key if rule.type != "DISPLAY" else None,
        target_key=rule.target_key if rule.type != "END" else None,
        condition=condition,
    )


def generated_to_doc(
    generated: GeneratedSurvey,
    *,
    dims: dict[str, uuid.UUID],
    inds: dict[str, uuid.UUID],
    language: str,
    prefix_sections: list[SectionDoc] | None = None,
) -> SurveyDoc:
    sections: list[SectionDoc] = list(prefix_sections or [])
    used = {s.key for s in sections} | {q.key for s in sections for q in s.questions}
    for gs in generated.sections:
        section_key, n = gs.key, 2
        while section_key in used:
            section_key = f"{gs.key}_{n}"[:60]
            n += 1
        used.add(section_key)
        questions: list[QuestionDoc] = []
        for gq in gs.questions:
            try:
                questions.append(gen_question_to_doc(gq, dims, inds, language))
            except (ValidationError, ValueError) as exc:  # keep the content, simplify the format
                logger.info("generated question %s simplified: %s", gq.key, exc)
                questions.append(
                    QuestionDoc(key=gq.key, type=QuestionType.LONG_TEXT, text=gq.text or gq.key, ai_generated=True)
                )
        if questions:
            sections.append(
                SectionDoc(key=section_key, title=gs.title, description=gs.description, questions=questions)
            )
    base = SurveyDoc(
        title=generated.title,
        introduction=generated.introduction,
        thank_you_message=generated.thank_you_message,
        language="en" if language == "en" else "ar",
        sections=sections or [SectionDoc(key="s1")],
    )
    qmap = base.question_map()
    rules = [_gen_logic(r, qmap) for r in generated.logic if r.question_key in qmap]
    candidate = base.model_copy(update={"logic": rules})
    bad = {i.rule_index for i in validate_logic(candidate)}
    return base.model_copy(update={"logic": [r for i, r in enumerate(rules) if i not in bad]})


async def _baseline_items(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[SectionDoc]:
    """Measure + profile items of the project's baseline survey, copied verbatim
    (same keys) so pre/post comparisons use identical instruments."""
    baseline = await session.scalar(
        select(Survey)
        .join(MeasurementWave, MeasurementWave.id == Survey.wave_id)
        .where(
            Survey.project_id == project_id,
            Survey.organization_id == ctx.organization_id,
            MeasurementWave.wave_type == WaveType.BASELINE,
            Survey.status != SurveyStatus.ARCHIVED,
        )
        .order_by(Survey.created_at.desc())
        .limit(1)
    )
    if baseline is None:
        return []
    version = await _version(session, baseline.published_version_id or baseline.current_version_id)
    if version is None:
        return []
    doc = await load_doc(session, version)
    keep: list[SectionDoc] = []
    for section in doc.sections:
        items = [
            q.model_copy(update={"lineage_id": None})
            for q in section.questions
            if q.answerable and (q.dimension_id or q.settings.is_profile)
        ]
        if items:
            keep.append(section.model_copy(update={"questions": items}))
    return keep


async def generate_survey(
    session: AsyncSession,
    ctx: OrgContext,
    project_id: uuid.UUID,
    *,
    wave_id: uuid.UUID | None,
    question_count: int | None,
    include_open_questions: bool,
    include_profile_questions: bool,
    extra_instructions: str | None,
) -> Survey:
    ctx.require(Permission.AI_USE)
    ctx.require(Permission.SURVEY_EDIT)
    project = await get_owned(session, Project, project_id, ctx)
    wave = await _check_wave(session, ctx, wave_id, project.id)
    plan = await session.scalar(select(MeasurementPlan).where(MeasurementPlan.project_id == project.id))
    dims = (
        await session.scalars(
            select(Dimension).where(Dimension.project_id == project.id).order_by(Dimension.sort_order)
        )
    ).all()
    inds = (
        await session.scalars(
            select(Indicator).where(Indicator.project_id == project.id).order_by(Indicator.sort_order)
        )
    ).all()
    dim_key = {d.id: d.key for d in dims}
    language = (plan.language if plan else None) or ctx.organization.locale or "ar"

    prefix: list[SectionDoc] = []
    if wave is not None and wave.wave_type in _REPEATED_WAVES:
        prefix = await _baseline_items(session, ctx, project.id)
    existing = [{"key": q.key, "type": q.type.value, "text": q.text} for s in prefix for q in s.questions]
    target = question_count or (plan.recommended_questions_count if plan else 12)
    data = {
        "language": language,
        "project_title": project.title,
        "measurement_type": project.measurement_type.value,
        "target_population": project.target_population,
        "purpose": plan.purpose if plan else project.description,
        "design": plan.recommended_design.value if plan else "",
        "wave_type": wave.wave_type.value if wave else "SINGLE",
        "wave_name": wave.name if wave else "",
        "dimensions": [{"key": d.key, "name": d.name, "description": d.description} for d in dims],
        "indicators": [
            {
                "code": i.code,
                "name": i.name,
                "indicator_type": i.indicator_type.value,
                "dimension_key": dim_key.get(i.dimension_id) if i.dimension_id else None,
            }
            for i in inds
        ],
        "question_count": max(3, min(60, target - len(existing) if prefix else target)),
        "include_open_questions": include_open_questions,
        "include_profile_questions": include_profile_questions and not prefix,
        "mode": "addendum" if prefix else "full",
        "existing_items": existing,
        "extra_instructions": extra_instructions,
    }
    survey_id = uuid7()
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_generator,
        data=data,
        entity_type="survey",
        entity_id=survey_id,
        use_cache=False,
    )
    doc = generated_to_doc(
        result.output,
        dims={d.key: d.id for d in dims},
        inds={i.code: i.id for i in inds},
        language=language,
        prefix_sections=prefix,
    )
    if wave is not None and wave.wave_type in (WaveType.BASELINE, *_REPEATED_WAVES):
        # Pre/post pairing: ask for a stable pseudonymous code instead of identity.
        doc = doc.model_copy(
            update={
                "settings": doc.settings.model_copy(
                    update={"anonymity_mode": "PSEUDONYMOUS", "collect_respondent_code": True}
                )
            }
        )
    survey = await create_survey(
        session,
        ctx,
        project.id,
        title=doc.title,
        wave_id=wave.id if wave else None,
        doc=doc,
        ai_generated=True,
        settings={"generation": {"ai_run_id": str(run.id), "mode": data["mode"], "repeated_items": len(existing)}},
        survey_id=survey_id,
    )
    return survey


# ======================================================================
# AI review
# ======================================================================
def _describe_scale(q: QuestionDoc) -> str:
    if q.scale and q.type in SCALE_TYPES:
        ends = " … ".join(x for x in (q.scale.min_label, q.scale.max_label) if x)
        return f"{q.scale.min}–{q.scale.max}" + (f": {ends}" if ends else "")
    return ""


async def review_survey(session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID) -> Survey:
    ctx.require(Permission.AI_USE)
    survey = await get_owned(session, Survey, survey_id, ctx)
    version = await _version(session, survey.current_version_id)
    if version is None:
        raise NotFound("Survey version not found")
    doc = await load_doc(session, version)
    questions = [q for q in doc.questions() if q.answerable]
    if not questions:
        raise Unprocessable("Add questions before requesting a review", code="empty_survey")
    project = await session.get(Project, survey.project_id)
    dims = {
        d.id: d.name
        for d in (await session.scalars(select(Dimension).where(Dimension.project_id == survey.project_id))).all()
    }
    payload = {
        "language": doc.language,
        "target_population": project.target_population if project else "",
        "measurement_type": project.measurement_type.value if project else "",
        "questions": [
            {
                "key": q.key,
                "type": q.type.value,
                "text": q.text,
                "options": [o.label for o in q.options][:20],
                "rows": [r.text for r in q.settings.rows][:20],
                "scale": _describe_scale(q),
                "dimension": dims.get(q.dimension_id) if q.dimension_id else None,
            }
            for q in questions
        ],
    }
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_reviewer,
        data=payload,
        entity_type="survey",
        entity_id=survey.id,
    )
    texts = {q.key: q.text for q in questions}
    version.review = {
        "ran_at": datetime.now(UTC).isoformat(),
        "ai_run_id": str(run.id),
        "overall_comment": result.output.overall_comment,
        "issues": [
            {
                **issue.model_dump(mode="json"),
                "id": uuid.uuid4().hex[:12],
                "status": "open",
                "question_text": texts.get(issue.question_key, ""),
            }
            for issue in result.output.issues
        ],
    }
    await session.commit()
    await session.refresh(survey)
    return survey


async def apply_review_action(
    session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID, issue_id: str, action: str
) -> Survey:
    ctx.require(Permission.SURVEY_EDIT)
    survey = await get_owned(session, Survey, survey_id, ctx)
    current = await _version(session, survey.current_version_id)
    if current is None:
        raise NotFound("Survey version not found")
    review = dict(current.review or {})
    issues = [dict(i) for i in review.get("issues", [])]
    issue = next((i for i in issues if i.get("id") == issue_id), None)
    if issue is None:
        raise NotFound("Review issue not found")

    if action == "reject":
        issue["status"] = "rejected"
        current.review = {**review, "issues": issues}
        await session.commit()
        await session.refresh(survey)
        return survey

    doc = await load_doc(session, current)
    target: QuestionDoc | None = doc.question_map().get(issue["question_key"])
    if target is None:
        raise Conflict("The question no longer exists", code="question_missing")
    fix = issue.get("fix") or "REWRITE"  # reviews stored before fixes were typed were rewrites
    if fix == "NONE":
        raise Conflict("This note has no automatic fix; edit the question instead", code="no_automatic_fix")

    if fix == "REMOVE":
        sections = [
            s.model_copy(update={"questions": [q for q in s.questions if q.key != target.key]}) for s in doc.sections
        ]
        logic = [
            rule
            for rule in doc.logic
            if target.key not in (rule.source_key, rule.target_key)
            and target.key not in condition_questions(rule.condition)
        ]
        new_doc = doc.model_copy(update={"sections": sections, "logic": logic})
    else:
        updates: dict[str, Any] = {}
        if issue.get("suggestion"):
            updates["text"] = issue["suggestion"]
        suggested = issue.get("suggested_options") or []
        if suggested and target.type in (*CHOICE_TYPES, QuestionType.RANKING):
            updates["options"] = _unique_options([(str(i), label, None) for i, label in enumerate(suggested, start=1)])
        if not updates:
            raise Conflict("This note has no automatic fix; edit the question instead", code="no_automatic_fix")
        new_question = target.model_copy(update=updates)
        sections = [
            s.model_copy(update={"questions": [new_question if q.key == target.key else q for q in s.questions]})
            for s in doc.sections
        ]
        new_doc = doc.model_copy(update={"sections": sections})
        issue["question_text"] = new_question.text
    version = await _editable_version(session, ctx, survey)
    await write_doc(session, survey, version, new_doc)
    issue["status"] = "accepted"
    version.review = {**review, "issues": issues}
    await session.commit()
    await session.refresh(survey)
    return survey


async def copy_to_wave(
    session: AsyncSession, ctx: OrgContext, survey_id: uuid.UUID, *, wave_id: uuid.UUID | None, title: str | None
) -> Survey:
    """A draft copy of a survey for another wave. Question keys and lineage stay the same, so
    the analytics engine matches items and respondents across waves (pre/post/follow-up)."""
    ctx.require(Permission.SURVEY_EDIT)
    source = await get_owned(session, Survey, survey_id, ctx)
    wave = await _check_wave(session, ctx, wave_id, source.project_id)
    version = await _version(session, source.current_version_id)
    if version is None:
        raise NotFound("Survey version not found")
    doc = await load_doc(session, version)
    new_title = ((title or "").strip() or (f"{doc.title} — {wave.name}" if wave else doc.title))[:300]
    copy = doc.model_copy(update={"title": new_title})
    survey = await create_survey(
        session, ctx, source.project_id, title=new_title, wave_id=wave_id, doc=copy, language=doc.language
    )
    audit(
        session,
        action="survey.copy",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="survey",
        entity_id=survey.id,
        meta={"source": str(source.id)},
    )
    await session.commit()
    return survey
