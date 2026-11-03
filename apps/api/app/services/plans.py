"""Measurement plans: AI draft → review/edit → accept (materialize into the
normalized measurement chain of a new project)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.agents import MeasurementArchitectAgent, detect_language
from meqyas_ai.domain.plan_rules import reapply_rules
from meqyas_ai.schemas.plan import ArchitectOutput, MeasurementPlanDraft
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Conflict, NotFound
from ..domain.enums import IndicatorType, PlanStatus, ProjectStatus
from ..domain.library.templates import request_text
from ..domain.permissions import Permission
from ..models import (
    Dimension,
    Goal,
    Indicator,
    MeasurementPlan,
    MeasurementWave,
    Objective,
    Organization,
    Project,
)
from .ai import run_agent
from .audit import audit

_architect = MeasurementArchitectAgent()

_DEFAULT_COMPUTATION: dict[IndicatorType, dict[str, Any]] = {
    IndicatorType.AVERAGE_SCORE: {"method": "mean", "scale_min": 1, "scale_max": 5},
    IndicatorType.PERCENTAGE: {"method": "top_box_pct", "threshold": 4, "scale_max": 5},
    IndicatorType.COUNT: {"method": "count"},
    IndicatorType.RATE: {"method": "rate"},
    IndicatorType.CHANGE: {"method": "change", "base": "mean", "from_wave": "BASELINE", "to_wave": "POST"},
    IndicatorType.DIFFERENCE: {"method": "difference", "base": "mean"},
    IndicatorType.EFFECT_SIZE: {"method": "cohens_d", "from_wave": "BASELINE", "to_wave": "POST"},
    IndicatorType.CUSTOM: {"method": "custom"},
}


def default_computation(indicator_type: IndicatorType) -> dict[str, Any]:
    return dict(_DEFAULT_COMPUTATION.get(indicator_type, {"method": "custom"}))


def _sync_scalars(plan: MeasurementPlan, draft: MeasurementPlanDraft) -> None:
    plan.draft = draft.model_dump(mode="json")
    plan.language = draft.language
    plan.project_title = draft.project_title
    plan.measurement_type = draft.measurement_type
    plan.target_population = draft.target_population
    plan.purpose = draft.purpose
    plan.recommended_design = draft.recommended_design
    plan.design_rationale = draft.design_rationale
    plan.evidence_level = draft.evidence_level
    plan.baseline_required = draft.baseline_required
    plan.post_measurement_required = draft.post_measurement_required
    plan.follow_up_recommended = draft.follow_up_recommended
    plan.follow_up_days = draft.follow_up_days
    plan.recommended_questions_count = draft.recommended_questions_count
    plan.estimated_completion_minutes = draft.estimated_completion_minutes
    plan.methodology_notes = list(draft.methodology_notes)


async def get_plan(session: AsyncSession, ctx: OrgContext, plan_id: uuid.UUID) -> MeasurementPlan:
    plan = await session.scalar(
        select(MeasurementPlan).where(
            MeasurementPlan.id == plan_id, MeasurementPlan.organization_id == ctx.organization_id
        )
    )
    if plan is None:
        raise NotFound("Measurement plan not found")
    return plan


def plan_draft(plan: MeasurementPlan) -> MeasurementPlanDraft:
    return MeasurementPlanDraft.model_validate(plan.draft)


async def create_draft_from_request(
    session: AsyncSession,
    ctx: OrgContext,
    *,
    request: str,
    language: str | None = None,
    audience_hint: str | None = None,
) -> MeasurementPlan:
    ctx.require(Permission.AI_USE)
    lang = language or detect_language(request)
    plan_id = uuid.uuid4()
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_architect,
        data={
            "request": request,
            "language": lang,
            "sector": ctx.organization.sector.value,
            "audience_hint": audience_hint,
        },
        entity_type="measurement_plan",
        entity_id=plan_id,
    )
    draft = result.output
    plan = MeasurementPlan(
        id=plan_id,
        organization_id=ctx.organization_id,
        status=PlanStatus.DRAFT,
        source_prompt=request.strip(),
        ai_output=draft.model_dump(mode="json"),
        ai_run_id=run.id,
        created_by_id=ctx.user_id,
        measurement_type=draft.measurement_type,
        recommended_design=draft.recommended_design,
        evidence_level=draft.evidence_level,
    )
    _sync_scalars(plan, draft)
    session.add(plan)
    audit(
        session,
        action="plan.generate",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="measurement_plan",
        entity_id=plan_id,
        meta={"measurement_type": draft.measurement_type.value, "design": draft.recommended_design.value},
    )
    await session.commit()
    await session.refresh(plan)
    return plan


async def update_draft(
    session: AsyncSession, ctx: OrgContext, plan_id: uuid.UUID, data: ArchitectOutput
) -> MeasurementPlan:
    ctx.require(Permission.PROJECT_WRITE)
    plan = await get_plan(session, ctx, plan_id)
    if plan.status != PlanStatus.DRAFT:
        raise Conflict("This plan was already accepted; edit the project instead", code="plan_accepted")
    current = plan_draft(plan)
    edited = MeasurementPlanDraft.model_validate({**data.model_dump(), "language": current.language})
    _sync_scalars(plan, reapply_rules(edited))
    await session.commit()
    await session.refresh(plan)
    return plan


async def regenerate(session: AsyncSession, ctx: OrgContext, plan_id: uuid.UUID, feedback: str) -> MeasurementPlan:
    ctx.require(Permission.AI_USE)
    plan = await get_plan(session, ctx, plan_id)
    if plan.status != PlanStatus.DRAFT:
        raise Conflict("This plan was already accepted", code="plan_accepted")
    previous = plan_draft(plan)
    prev_payload = previous.model_dump(
        mode="json", exclude={"rules_applied", "warnings", "evidence_level", "outcome_level", "language"}
    )
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_architect,
        data={
            "request": request_text(plan.source_prompt),
            "language": plan.language,
            "sector": ctx.organization.sector.value,
            "feedback": feedback,
            "previous_plan": prev_payload,
        },
        entity_type="measurement_plan",
        entity_id=plan.id,
        use_cache=False,
    )
    _sync_scalars(plan, result.output)
    plan.ai_output = result.output.model_dump(mode="json")
    plan.ai_run_id = run.id
    plan.generation_count += 1
    await session.commit()
    await session.refresh(plan)
    return plan


async def accept(session: AsyncSession, ctx: OrgContext, plan_id: uuid.UUID) -> Project:
    ctx.require(Permission.PROJECT_WRITE)
    plan = await get_plan(session, ctx, plan_id)
    if plan.status != PlanStatus.DRAFT or plan.project_id is not None:
        raise Conflict("This plan was already accepted", code="plan_accepted")
    project = await materialize_plan(session, plan, organization=ctx.organization, user_id=ctx.user_id)
    audit(
        session,
        action="project.create_from_plan",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="project",
        entity_id=project.id,
        meta={"plan_id": str(plan.id)},
    )
    await session.commit()
    await session.refresh(project)
    from .library import create_template_surveys  # local import: the library builds on this module

    await create_template_surveys(session, ctx, plan, project)
    return project


async def materialize_plan(
    session: AsyncSession,
    plan: MeasurementPlan,
    *,
    organization: Organization,
    user_id: uuid.UUID | None,
    is_demo: bool = False,
) -> Project:
    """Create a project and its normalized measurement chain from a plan draft
    (does not commit)."""
    draft = plan_draft(plan)
    org_id = organization.id

    project = Project(
        organization_id=org_id,
        title=draft.project_title,
        description=draft.purpose,
        measurement_type=draft.measurement_type,
        sector=organization.sector,
        target_population=draft.target_population,
        status=ProjectStatus.ACTIVE,
        created_by_id=user_id,
        is_demo=is_demo,
        settings={"secondary_types": [t.value for t in draft.secondary_types]},
    )
    session.add(project)
    await session.flush()

    goal = Goal(
        organization_id=org_id, project_id=project.id, statement=draft.purpose, description=draft.understanding_summary
    )
    session.add(goal)
    await session.flush()

    objective_ids: dict[str, uuid.UUID] = {}
    for i, obj in enumerate(draft.objectives):
        row = Objective(
            organization_id=org_id,
            project_id=project.id,
            goal_id=goal.id,
            key=obj.key,
            title=obj.title,
            description=obj.description,
            sort_order=i,
        )
        session.add(row)
        await session.flush()
        objective_ids[obj.key] = row.id

    dimension_ids: dict[str, uuid.UUID] = {}
    for i, dim in enumerate(draft.dimensions):
        row = Dimension(
            organization_id=org_id,
            project_id=project.id,
            key=dim.key,
            name=dim.name,
            description=dim.description,
            objective_id=objective_ids.get(dim.objective_key or ""),
            sort_order=i,
        )
        session.add(row)
        await session.flush()
        dimension_ids[dim.key] = row.id

    for i, ind in enumerate(draft.indicators):
        session.add(
            Indicator(
                organization_id=org_id,
                project_id=project.id,
                dimension_id=dimension_ids.get(ind.dimension_key),
                code=ind.code,
                name=ind.name,
                description=ind.description,
                measurement_type=draft.measurement_type,
                indicator_type=ind.indicator_type,
                formula=ind.formula,
                computation=default_computation(ind.indicator_type),
                unit=ind.unit,
                direction=ind.direction,
                target_label=ind.target,
                target_value=ind.target_value,
                frequency=ind.frequency,
                sort_order=i,
            )
        )

    for i, wave in enumerate(draft.waves):
        session.add(
            MeasurementWave(
                organization_id=org_id,
                project_id=project.id,
                wave_type=wave.wave_type,
                name=wave.name,
                timing=wave.timing,
                offset_days=wave.offset_days,
                sort_order=i,
            )
        )

    plan.project_id = project.id
    plan.status = PlanStatus.ACCEPTED
    plan.accepted_at = datetime.now(UTC)
    await session.flush()
    return project
