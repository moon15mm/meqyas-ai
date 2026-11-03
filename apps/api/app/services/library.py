"""Templates library and question bank (Phase 8, docs/LIBRARY.md).

System templates and system question-bank items are defined in code
(``app/domain/library``); organizations add their own questions to the bank. Using a
template creates a plan draft (no AI) that goes through the usual review → accept flow;
accepting it also creates the template's questionnaires as draft surveys.
"""

from __future__ import annotations

import uuid
from typing import Any

from meqyas_ai.domain.plan_rules import apply_rules
from meqyas_ai.schemas.plan import ArchitectOutput
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import NotFound, Unprocessable
from ..domain.enums import PlanStatus, QuestionType
from ..domain.library.templates import TEMPLATE_PREFIX, TEMPLATES, Q, Template
from ..domain.permissions import Permission
from ..domain.survey.document import QuestionDoc, SurveyDoc
from ..domain.text import normalize_ar
from ..models import Dimension, Indicator, MeasurementPlan, MeasurementWave, Project, QuestionBankItem, Survey
from . import surveys as survey_svc
from .audit import audit
from .plans import _sync_scalars
from .projects import get_owned


# ------------------------------------------------------------------ templates
def _pick(pair: tuple[str, str], lang: str) -> str:
    return pair[0] if lang == "ar" else pair[1]


def template_summary(t: Template, lang: str) -> dict[str, Any]:
    plan = t.plan
    return {
        "code": t.code,
        "category": t.category,
        "sector": t.sector,
        "icon": t.icon,
        "name": _pick(t.name, lang),
        "description": _pick(t.description, lang),
        "language": "ar",
        "measurement_type": plan["measurement_type"],
        "design": plan["recommended_design"],
        "waves": [w["name"] for w in plan["waves"]],
        "dimensions": [d["name"] for d in plan["dimensions"]],
        "indicators": len(plan["indicators"]),
        "questions": len(t.questions()),
        "minutes": plan["estimated_completion_minutes"],
    }


def list_templates(lang: str) -> list[dict[str, Any]]:
    return [template_summary(t, lang) for t in TEMPLATES.values()]


def _template(code: str) -> Template:
    t = TEMPLATES.get(code)
    if t is None:
        raise NotFound("Template not found")
    return t


def template_detail(code: str, lang: str) -> dict[str, Any]:
    t = _template(code)
    plan = t.plan
    wave_names = {w["wave_type"]: w["name"] for w in plan["waves"]}
    return {
        **template_summary(t, lang),
        "purpose": plan["purpose"],
        "target_population": plan["target_population"],
        "objectives": [o["title"] for o in plan["objectives"]],
        "dimension_details": [{"name": d["name"], "description": d.get("description", "")} for d in plan["dimensions"]],
        "indicator_details": [
            {"code": i["code"], "name": i["name"], "target": i.get("target", "")} for i in plan["indicators"]
        ],
        "surveys": [
            {
                "wave_type": wave,
                "wave_name": wave_names.get(wave, wave),
                "title": spec.title,
                "sections": [
                    {"title": s.title, "questions": [{"text": q.text, "type": q.type} for q in s.questions]}
                    for s in spec.sections
                ],
            }
            for wave, spec in t.surveys.items()
        ],
    }


async def use_template(session: AsyncSession, ctx: OrgContext, code: str) -> MeasurementPlan:
    """A plan draft from a template — the same methodology rules as an AI plan, no model call."""
    ctx.require(Permission.PROJECT_WRITE)
    t = _template(code)
    draft = apply_rules(ArchitectOutput.model_validate(t.plan), language="ar", signals=None)
    plan = MeasurementPlan(
        id=uuid.uuid4(),
        organization_id=ctx.organization_id,
        status=PlanStatus.DRAFT,
        source_prompt=f"{TEMPLATE_PREFIX}{t.code}",
        ai_output=draft.model_dump(mode="json"),
        created_by_id=ctx.user_id,
        measurement_type=draft.measurement_type,
        recommended_design=draft.recommended_design,
        evidence_level=draft.evidence_level,
    )
    _sync_scalars(plan, draft)
    session.add(plan)
    audit(
        session,
        action="plan.from_template",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="measurement_plan",
        entity_id=plan.id,
        meta={"template": t.code},
    )
    await session.commit()
    await session.refresh(plan)
    return plan


def _question_doc(q: Q, *, dimension_id: uuid.UUID | None, indicator_id: uuid.UUID | None) -> dict[str, Any]:
    doc = q.doc()
    doc["dimension_id"] = str(dimension_id) if dimension_id else None
    doc["indicator_id"] = str(indicator_id) if indicator_id else None
    return doc


async def create_template_surveys(
    session: AsyncSession, ctx: OrgContext, plan: MeasurementPlan, project: Project
) -> list[Survey]:
    """After a template plan is accepted: one draft survey per wave type, linked to the
    project's dimensions and indicators. Indicators the template does not measure explicitly
    (added by the methodology rules) are linked to their dimension's questions."""
    if not plan.source_prompt.startswith(TEMPLATE_PREFIX):
        return []
    t = TEMPLATES.get(plan.source_prompt.removeprefix(TEMPLATE_PREFIX))
    if t is None:
        return []
    dims = (await session.scalars(select(Dimension).where(Dimension.project_id == project.id))).all()
    dim_ids = {d.key: d.id for d in dims}
    dim_keys = {d.id: d.key for d in dims}
    inds = (await session.scalars(select(Indicator).where(Indicator.project_id == project.id))).all()
    ind_ids = {i.code: i.id for i in inds}
    explicit = {q.indicator for q in t.questions() if q.indicator}
    by_dimension: dict[str, uuid.UUID] = {}
    for ind in inds:
        if ind.code not in explicit and ind.dimension_id in dim_keys:
            by_dimension.setdefault(dim_keys[ind.dimension_id], ind.id)
    waves = (
        await session.scalars(
            select(MeasurementWave).where(MeasurementWave.project_id == project.id).order_by(MeasurementWave.sort_order)
        )
    ).all()
    created: list[Survey] = []
    done: set[str] = set()
    for wave in waves:
        spec = t.surveys.get(wave.wave_type.value)
        if spec is None or wave.wave_type.value in done:  # later rounds: copy the survey to the next wave
            continue
        done.add(wave.wave_type.value)
        doc = SurveyDoc.model_validate(
            {
                "title": spec.title,
                "introduction": spec.introduction,
                "thank_you_message": spec.thank_you,
                "language": "ar",
                "sections": [
                    {
                        "key": s.key,
                        "title": s.title,
                        "questions": [
                            _question_doc(
                                q,
                                dimension_id=dim_ids.get(q.dimension or ""),
                                indicator_id=ind_ids.get(q.indicator or "")
                                or (by_dimension.get(q.dimension) if q.dimension and not q.profile else None),
                            )
                            for q in s.questions
                        ],
                    }
                    for s in spec.sections
                ],
            }
        )
        created.append(
            await survey_svc.create_survey(
                session, ctx, project.id, title=spec.title, wave_id=wave.id, doc=doc, language="ar"
            )
        )
    return created


# ------------------------------------------------------------- question bank
def _system_items() -> list[dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for t in TEMPLATES.values():
        dims = {d["key"]: d["name"] for d in t.plan["dimensions"]}
        for q in t.questions():
            if q.text in items:
                items[q.text]["tags"] = sorted({*items[q.text]["tags"], t.category})
                continue
            doc = q.doc()
            doc.pop("key", None)
            items[q.text] = {
                "id": f"sys-{t.code}-{q.key}",
                "source": "system",
                "question_type": q.type,
                "text": q.text,
                "topic": dims.get(q.dimension or "", "معلومات المستجيب" if q.profile else ""),
                "language": "ar",
                "tags": [t.category],
                "question": doc,
                "template": _pick(t.name, "ar"),
            }
    return list(items.values())


SYSTEM_ITEMS = _system_items()


def _bank_out(row: QuestionBankItem) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "source": "organization",
        "question_type": row.question_type.value,
        "text": row.text,
        "topic": row.construct,
        "language": row.language,
        "tags": row.tags,
        "question": row.question,
        "template": None,
        "created_at": row.created_at,
    }


async def list_bank(
    session: AsyncSession, ctx: OrgContext, *, q: str | None, question_type: str | None, scope: str
) -> list[dict[str, Any]]:
    ctx.require(Permission.PROJECT_READ)
    items: list[dict[str, Any]] = []
    if scope in ("all", "organization"):
        rows = (
            await session.scalars(
                select(QuestionBankItem)
                .where(QuestionBankItem.organization_id == ctx.organization_id)
                .order_by(QuestionBankItem.created_at.desc())
            )
        ).all()
        items += [_bank_out(r) for r in rows]
    if scope in ("all", "system"):
        items += SYSTEM_ITEMS
    if question_type:
        items = [i for i in items if i["question_type"] == question_type]
    if q and q.strip():
        needle = normalize_ar(q.strip()).lower()
        items = [i for i in items if needle in normalize_ar(f"{i['text']} {i['topic']} {' '.join(i['tags'])}").lower()]
    return items


async def save_to_bank(session: AsyncSession, ctx: OrgContext, payload: dict[str, Any]) -> dict[str, Any]:
    ctx.require(Permission.SURVEY_EDIT)
    raw = dict(payload["question"])
    for k in ("key", "lineage_id", "dimension_id", "indicator_id", "ai_generated"):
        raw.pop(k, None)
    try:
        doc = QuestionDoc.model_validate({**raw, "key": "bank_item"})
    except ValueError as exc:
        raise Unprocessable("This question cannot be saved to the bank", code="invalid_question") from exc
    if doc.type in (QuestionType.SECTION, QuestionType.INFORMATION, QuestionType.FILE) or not doc.text.strip():
        raise Unprocessable("Only answerable questions with text can be saved", code="invalid_question")
    question = doc.model_dump(
        mode="json", exclude={"key", "lineage_id", "dimension_id", "indicator_id", "ai_generated"}
    )
    row = QuestionBankItem(
        organization_id=ctx.organization_id,
        question_type=doc.type,
        text=doc.text.strip()[:1000],
        construct=(payload.get("topic") or "").strip()[:120],
        language=payload.get("language") or "ar",
        tags=[t.strip()[:40] for t in payload.get("tags") or [] if t.strip()][:8],
        question=question,
        created_by_id=ctx.user_id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _bank_out(row)


async def delete_from_bank(session: AsyncSession, ctx: OrgContext, item_id: uuid.UUID) -> None:
    ctx.require(Permission.SURVEY_EDIT)
    row = await get_owned(session, QuestionBankItem, item_id, ctx)
    await session.delete(row)
    await session.commit()
