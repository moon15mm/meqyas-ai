"""Response management for survey owners: list, inspect, review (keep/exclude), delete.

Raw responses need RESPONSES_READ_RAW (analyst and above); viewers only see
aggregates (Phase 5). Identified respondents' names/emails are decrypted only
in the detail view, never in lists or logs.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.crypto import decrypt
from ..core.errors import NotFound
from ..domain.enums import QualityStatus, ReviewStatus
from ..domain.permissions import Permission
from ..domain.survey.document import SurveyDoc
from ..domain.survey.logic import display_value
from ..models import Answer, MeasurementWave, Project, Respondent, Response, Survey, SurveyVersion
from ..schemas.response import AnswerOut, ResponseCounts, ResponseDetail, ResponsePage, ResponseSummary
from .audit import audit
from .projects import get_owned
from .surveys import load_doc


def _filtered(
    query: Select[Any],
    ctx: OrgContext,
    *,
    project_id: uuid.UUID | None,
    survey_id: uuid.UUID | None,
    quality: QualityStatus | None = None,
    review: ReviewStatus | None = None,
) -> Select[Any]:
    query = query.where(Response.organization_id == ctx.organization_id)
    if project_id is not None:
        query = query.where(Response.project_id == project_id)
    if survey_id is not None:
        query = query.where(Response.survey_id == survey_id)
    if quality is not None:
        query = query.where(Response.quality_status == quality)
    if review is not None:
        query = query.where(Response.review_status == review)
    return query


async def _summaries(session: AsyncSession, rows: list[Response]) -> list[ResponseSummary]:
    if not rows:
        return []
    surveys = {
        s.id: s for s in (await session.scalars(select(Survey).where(Survey.id.in_({r.survey_id for r in rows})))).all()
    }
    versions = {
        v.id: v
        for v in (
            await session.scalars(
                select(SurveyVersion).where(SurveyVersion.id.in_({r.survey_version_id for r in rows}))
            )
        ).all()
    }
    wave_ids = {r.wave_id for r in rows if r.wave_id}
    waves = (
        {
            w.id: w
            for w in (await session.scalars(select(MeasurementWave).where(MeasurementWave.id.in_(wave_ids)))).all()
        }
        if wave_ids
        else {}
    )
    respondent_ids = {r.respondent_id for r in rows if r.respondent_id}
    labels = (
        dict(
            (
                await session.execute(select(Respondent.id, Respondent.label).where(Respondent.id.in_(respondent_ids)))
            ).all()
        )
        if respondent_ids
        else {}
    )
    out: list[ResponseSummary] = []
    for r in rows:
        survey = surveys.get(r.survey_id)
        version = versions.get(r.survey_version_id)
        wave = waves.get(r.wave_id) if r.wave_id else None
        out.append(
            ResponseSummary(
                id=r.id,
                survey_id=r.survey_id,
                survey_title=survey.title if survey else "",
                version_number=version.version_number if version else 0,
                wave_type=wave.wave_type if wave else None,
                respondent_label=labels.get(r.respondent_id) if r.respondent_id else None,
                completed_at=r.completed_at,
                duration_seconds=r.duration_seconds,
                channel=r.channel,
                device=r.device,
                locale=r.locale,
                answered_count=r.answered_count,
                quality_score=r.quality_score,
                quality_status=r.quality_status,
                quality_flags=list(r.quality_flags or []),
                review_status=r.review_status,
                is_demo=r.is_demo,
                created_at=r.created_at,
            )
        )
    return out


async def counts(
    session: AsyncSession, ctx: OrgContext, *, project_id: uuid.UUID | None, survey_id: uuid.UUID | None
) -> ResponseCounts:
    query = _filtered(
        select(
            func.count(),
            func.count().filter(Response.quality_status == QualityStatus.VALID),
            func.count().filter(Response.quality_status == QualityStatus.SUSPICIOUS),
            func.count().filter(Response.quality_status == QualityStatus.LOW_QUALITY),
            func.count().filter(Response.review_status == ReviewStatus.EXCLUDE),
            func.count().filter(Response.review_status == ReviewStatus.KEEP),
        ).select_from(Response),
        ctx,
        project_id=project_id,
        survey_id=survey_id,
    )
    total, valid, suspicious, low, excluded, kept = (await session.execute(query)).one()
    return ResponseCounts(
        total=total, valid=valid, suspicious=suspicious, low_quality=low, excluded=excluded, kept=kept
    )


async def list_responses(
    session: AsyncSession,
    ctx: OrgContext,
    *,
    project_id: uuid.UUID | None = None,
    survey_id: uuid.UUID | None = None,
    quality: QualityStatus | None = None,
    review: ReviewStatus | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ResponsePage:
    ctx.require(Permission.RESPONSES_READ_RAW)
    if project_id is not None:
        await get_owned(session, Project, project_id, ctx)
    if survey_id is not None:
        await get_owned(session, Survey, survey_id, ctx)
    base = _filtered(select(Response), ctx, project_id=project_id, survey_id=survey_id, quality=quality, review=review)
    total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
    # Needs-attention first: low quality, then suspicious, then newest.
    severity = case(
        (Response.quality_status == QualityStatus.LOW_QUALITY, 0),
        (Response.quality_status == QualityStatus.SUSPICIOUS, 1),
        else_=2,
    )
    order = (Response.created_at.desc(),) if quality is not None else (severity, Response.created_at.desc())
    rows = (await session.scalars(base.order_by(*order).limit(limit).offset(offset))).all()
    return ResponsePage(
        items=await _summaries(session, list(rows)),
        total=total,
        limit=limit,
        offset=offset,
        counts=await counts(session, ctx, project_id=project_id, survey_id=survey_id),
    )


def _answers_out(doc: SurveyDoc, answers: list[Answer]) -> list[AnswerOut]:
    qmap = doc.question_map()
    section_of = {q.key: s.title for s in doc.sections for q in s.questions}
    position = {key: i for i, (_, key) in enumerate(doc.order())}
    row_position = {(q.key, r.key): i for q in doc.questions() for i, r in enumerate(q.settings.rows)}
    out: list[AnswerOut] = []
    for a in sorted(
        answers,
        key=lambda a: (
            position.get(a.question_key, 10_000),
            a.is_followup,
            row_position.get((a.question_key, a.row_key or ""), 0),
        ),
    ):
        q = qmap.get(a.question_key)
        row_text = None
        if q is not None and a.row_key:
            row_text = next((r.text for r in q.settings.rows if r.key == a.row_key), a.row_key)
        if a.is_followup:
            display = str(a.value)
        elif q is not None and a.row_key:
            display = display_value(q, a.value, doc.language)
        else:
            display = display_value(q, a.value, doc.language) if q is not None else str(a.value)
        is_other_choice = bool(
            q is not None
            and not a.is_followup
            and a.text_value
            and q.type.value in ("SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN")
        )
        out.append(
            AnswerOut(
                question_key=a.question_key,
                question_text=q.text if q else a.question_key,
                question_type=q.type.value if q else "",
                section_title=section_of.get(a.question_key, ""),
                row_key=a.row_key,
                row_text=row_text,
                value=a.value,
                display=display,
                other_text=a.text_value if is_other_choice else None,
                is_followup=a.is_followup,
                followup_prompt=a.followup_prompt,
            )
        )
    return out


async def _owned_response(session: AsyncSession, ctx: OrgContext, response_id: uuid.UUID) -> Response:
    response = await session.get(Response, response_id)
    if response is None or response.organization_id != ctx.organization_id:
        raise NotFound("Response not found")
    return response


async def get_response(session: AsyncSession, ctx: OrgContext, response_id: uuid.UUID) -> ResponseDetail:
    ctx.require(Permission.RESPONSES_READ_RAW)
    response = await _owned_response(session, ctx, response_id)
    summary = (await _summaries(session, [response]))[0]
    version = await session.get(SurveyVersion, response.survey_version_id)
    doc = await load_doc(session, version) if version else None
    answers = (await session.scalars(select(Answer).where(Answer.response_id == response.id))).all()
    name = email = None
    if response.respondent_id:
        respondent = await session.get(Respondent, response.respondent_id)
        if respondent is not None:
            name, email = decrypt(respondent.name_encrypted), decrypt(respondent.email_encrypted)
    return ResponseDetail(
        **summary.model_dump(),
        answers=_answers_out(doc, list(answers)) if doc else [],
        respondent_name=name,
        respondent_email=email,
    )


async def review_response(
    session: AsyncSession, ctx: OrgContext, response_id: uuid.UUID, status: ReviewStatus
) -> ResponseDetail:
    ctx.require(Permission.RESPONSES_READ_RAW)
    response = await _owned_response(session, ctx, response_id)
    response.review_status = status
    response.reviewed_by_id = ctx.user_id if status != ReviewStatus.NONE else None
    response.reviewed_at = datetime.now(UTC) if status != ReviewStatus.NONE else None
    await session.commit()
    return await get_response(session, ctx, response_id)


async def delete_response(
    session: AsyncSession, ctx: OrgContext, response_id: uuid.UUID, *, request_meta: dict[str, str | None]
) -> None:
    ctx.require(Permission.RESPONSES_DELETE)
    response = await _owned_response(session, ctx, response_id)
    audit(
        session,
        action="response.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="response",
        entity_id=response.id,
        meta={"survey_id": str(response.survey_id)},
        request_meta=request_meta,
    )
    await session.delete(response)
    await session.commit()
