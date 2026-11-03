"""Theory of Change, logic model and impact evidence (Phase 8, MEASUREMENT_ENGINE.md §7).

The theory of change is the program's hypothesis (inputs → activities → outputs →
outcomes → impact). Each outcome links to the project's indicators, whose persisted values
show how far the measured data supports it — evidence, not proof: the evidence level of
the design says what may be concluded. The logic model (nodes and edges) is derived from
the theory on every save.
"""

from __future__ import annotations

import uuid
from itertools import pairwise
from typing import Any

from meqyas_ai.agents import TheoryOfChangeAgent
from meqyas_ai.domain.causality import result_caveat
from meqyas_ai.domain.enums import EvidenceLevel as AIEvidenceLevel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Unprocessable
from ..domain.permissions import Permission
from ..models import (
    Dimension,
    Indicator,
    LogicModel,
    MeasurementPlan,
    MeasurementWave,
    Objective,
    Project,
    TheoryOfChange,
)
from .ai import run_agent
from .audit import audit
from .projects import get_owned

LISTS = ("inputs", "activities", "outputs", "assumptions", "risks")
OUTCOMES = ("short_term_outcomes", "medium_term_outcomes", "long_term_impact")
CHAIN = ("inputs", "activities", "outputs", "short_term_outcomes", "medium_term_outcomes", "long_term_impact")
MAX_ITEMS = 12
MAX_CHARS = 300
_agent = TheoryOfChangeAgent()


async def _context(
    session: AsyncSession, project: Project
) -> tuple[MeasurementPlan | None, list[Indicator], list[Dimension]]:
    plan = await session.scalar(select(MeasurementPlan).where(MeasurementPlan.project_id == project.id))
    indicators = (
        await session.scalars(
            select(Indicator).where(Indicator.project_id == project.id).order_by(Indicator.sort_order)
        )
    ).all()
    dims = (
        await session.scalars(
            select(Dimension).where(Dimension.project_id == project.id).order_by(Dimension.sort_order)
        )
    ).all()
    return plan, list(indicators), list(dims)


def _serialize(toc: TheoryOfChange, valid_ids: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {"ai_generated": toc.ai_generated, "updated_at": toc.updated_at}
    for col in LISTS:
        out[col] = list(getattr(toc, col))
    links = toc.indicator_links or {}
    for col in OUTCOMES:
        col_links = links.get(col) or []
        out[col] = [
            {"text": text, "indicator_ids": [i for i in (col_links[k] if k < len(col_links) else []) if i in valid_ids]}
            for k, text in enumerate(getattr(toc, col))
        ]
    return out


async def get_toc(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> dict[str, Any]:
    ctx.require(Permission.PROJECT_READ)
    project = await get_owned(session, Project, project_id, ctx)
    plan, indicators, dims = await _context(session, project)
    toc = await session.scalar(select(TheoryOfChange).where(TheoryOfChange.project_id == project.id))
    level = plan.evidence_level.value if plan else "DESCRIPTIVE"
    lang = plan.language if plan else "ar"
    dim_names = {d.id: d.name for d in dims}
    return {
        "theory": _serialize(toc, {str(i.id) for i in indicators}) if toc else None,
        "indicators": [
            {
                "id": str(i.id),
                "code": i.code,
                "name": i.name,
                "dimension": dim_names.get(i.dimension_id) if i.dimension_id else None,
                "indicator_type": i.indicator_type.value,
                "unit": i.unit,
                "direction": i.direction.value,
                "baseline_value": i.baseline_value,
                "current_value": i.current_value,
                "target_value": i.target_value,
                "target_label": i.target_label,
                "status": i.status.value,
                "last_computed_at": i.last_computed_at,
            }
            for i in indicators
        ],
        "evidence_level": level,
        "caveat": result_caveat(AIEvidenceLevel(level), lang),
    }


def _sync_logic_model(model: LogicModel, toc: TheoryOfChange) -> None:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for col in (*CHAIN, "assumptions", "risks"):
        for k, text in enumerate(getattr(toc, col)):
            nodes.append({"id": f"{col}:{k}", "column": col, "text": text})
    for a, b in pairwise(CHAIN):  # each column leads to the next
        edges.append({"from": a, "to": b, "kind": "leads_to"})
    for col in OUTCOMES:
        for k, ids in enumerate((toc.indicator_links or {}).get(col) or []):
            edges += [{"from": f"{col}:{k}", "to": f"indicator:{i}", "kind": "measured_by"} for i in ids]
    model.nodes, model.edges = nodes, edges


async def _store(
    session: AsyncSession,
    project: Project,
    values: dict[str, Any],
    *,
    ai_generated: bool | None,
) -> TheoryOfChange:
    toc = await session.scalar(select(TheoryOfChange).where(TheoryOfChange.project_id == project.id))
    if toc is None:
        toc = TheoryOfChange(organization_id=project.organization_id, project_id=project.id)
        session.add(toc)
    for col in LISTS:
        setattr(toc, col, values[col])
    links: dict[str, list[list[str]]] = {}
    for col in OUTCOMES:
        setattr(toc, col, [o["text"] for o in values[col]])
        links[col] = [list(o["indicator_ids"]) for o in values[col]]
    toc.indicator_links = links
    if ai_generated is not None:
        toc.ai_generated = ai_generated
    model = await session.scalar(select(LogicModel).where(LogicModel.project_id == project.id))
    if model is None:
        model = LogicModel(organization_id=project.organization_id, project_id=project.id)
        session.add(model)
    _sync_logic_model(model, toc)
    return toc


def _clean_list(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in items:
        text = " ".join((item or "").split())[:MAX_CHARS]
        if text and text not in out:
            out.append(text)
    return out[:MAX_ITEMS]


async def save_toc(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, payload: dict[str, Any]
) -> dict[str, Any]:
    ctx.require(Permission.PROJECT_WRITE)
    project = await get_owned(session, Project, project_id, ctx)
    _, indicators, _ = await _context(session, project)
    valid = {str(i.id) for i in indicators}
    values: dict[str, Any] = {col: _clean_list(payload.get(col) or []) for col in LISTS}
    for col in OUTCOMES:
        cleaned = []
        for o in payload.get(col) or []:
            text = " ".join((o.get("text") or "").split())[:MAX_CHARS]
            if not text:
                continue
            unknown = [i for i in o.get("indicator_ids") or [] if str(i) not in valid]
            if unknown:
                raise Unprocessable("Outcomes can only link to this project's indicators", code="unknown_indicator")
            cleaned.append(
                {"text": text, "indicator_ids": list(dict.fromkeys(str(i) for i in o.get("indicator_ids") or []))}
            )
        values[col] = cleaned[:MAX_ITEMS]
    await _store(session, project, values, ai_generated=None)
    audit(
        session,
        action="toc.save",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="project",
        entity_id=project.id,
    )
    await session.commit()
    return await get_toc(session, ctx, project.id)


async def generate_toc(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, notes: str) -> dict[str, Any]:
    ctx.require(Permission.AI_USE)
    project = await get_owned(session, Project, project_id, ctx)
    plan, indicators, dims = await _context(session, project)
    objectives = (
        await session.scalars(
            select(Objective).where(Objective.project_id == project.id).order_by(Objective.sort_order)
        )
    ).all()
    waves = (
        await session.scalars(
            select(MeasurementWave).where(MeasurementWave.project_id == project.id).order_by(MeasurementWave.sort_order)
        )
    ).all()
    dim_names = {d.id: d.name for d in dims}
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_agent,
        data={
            "language": plan.language if plan else ctx.organization.locale or "ar",
            "project_title": project.title,
            "measurement_type": project.measurement_type.value if project.measurement_type else "",
            "target_population": project.target_population,
            "purpose": plan.purpose if plan else "",
            "description": project.description,
            "objectives": [o.title for o in objectives],
            "dimensions": [f"{d.name} — {d.description}" if d.description else d.name for d in dims],
            "indicators": [
                {
                    "code": i.code,
                    "name": i.name,
                    "dimension": dim_names.get(i.dimension_id, "") if i.dimension_id else "",
                }
                for i in indicators
            ],
            "waves": [w.name for w in waves],
            "notes": (notes or "").strip(),
        },
        entity_type="project",
        entity_id=project.id,
    )
    ids = {i.code: str(i.id) for i in indicators}
    out = result.output
    values: dict[str, Any] = {col: list(getattr(out, col)) for col in LISTS}
    for col in OUTCOMES:
        values[col] = [
            {"text": o.text, "indicator_ids": [ids[c] for c in o.indicator_codes if c in ids]}
            for o in getattr(out, col)
        ]
    await _store(session, project, values, ai_generated=True)
    audit(
        session,
        action="toc.generate",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="project",
        entity_id=project.id,
        meta={"ai_run_id": str(run.id)},
    )
    await session.commit()
    return await get_toc(session, ctx, project.id)
