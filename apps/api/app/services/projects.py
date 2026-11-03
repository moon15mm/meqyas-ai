"""Projects and the editable measurement chain (objectives, dimensions,
indicators, waves). Every query is scoped to the caller's organization."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any, TypeVar

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Conflict, NotFound
from ..domain.enums import ProjectStatus
from ..domain.library.templates import source_label
from ..domain.permissions import Permission
from ..models import (
    Dimension,
    Goal,
    Indicator,
    MeasurementPlan,
    MeasurementWave,
    Objective,
    Project,
    ProjectType,
    Survey,
)
from ..schemas.project import (
    DimensionIn,
    DimensionOut,
    DimensionPatch,
    GoalOut,
    IndicatorIn,
    IndicatorOut,
    IndicatorPatch,
    ObjectiveIn,
    ObjectiveOut,
    ObjectivePatch,
    ProjectCreate,
    ProjectPlanOut,
    ProjectUpdate,
    WaveOut,
    WavePatch,
)
from .audit import audit
from .plans import default_computation

M = TypeVar("M")


async def get_owned(session: AsyncSession, model: type[M], obj_id: uuid.UUID, ctx: OrgContext) -> M:
    """Fetch a tenant-owned row or raise NotFound (also for other tenants' ids)."""
    obj = await session.scalar(
        select(model).where(model.id == obj_id, model.organization_id == ctx.organization_id)  # type: ignore[attr-defined]
    )
    if obj is None:
        raise NotFound(f"{model.__name__} not found")
    return obj


async def list_project_types(session: AsyncSession) -> list[ProjectType]:
    return list((await session.scalars(select(ProjectType).order_by(ProjectType.sort_order))).all())


async def list_projects(
    session: AsyncSession,
    ctx: OrgContext,
    *,
    status: ProjectStatus | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Project], int]:
    ctx.require(Permission.PROJECT_READ)
    stmt = select(Project).where(Project.organization_id == ctx.organization_id)
    if status:
        stmt = stmt.where(Project.status == status)
    else:
        stmt = stmt.where(Project.status != ProjectStatus.ARCHIVED)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Project.title.ilike(like), Project.description.ilike(like)))
    total = int(await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = await session.scalars(
        stmt.order_by(Project.is_demo.asc(), Project.updated_at.desc()).limit(limit).offset(offset)
    )
    return list(rows.all()), total


async def create_project(session: AsyncSession, ctx: OrgContext, data: ProjectCreate) -> Project:
    ctx.require(Permission.PROJECT_WRITE)
    project = Project(
        organization_id=ctx.organization_id,
        created_by_id=ctx.user_id,
        sector=ctx.organization.sector,
        status=ProjectStatus.ACTIVE,
        **data.model_dump(),
    )
    session.add(project)
    await session.flush()
    audit(
        session,
        action="project.create",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="project",
        entity_id=project.id,
    )
    await session.commit()
    await session.refresh(project)
    return project


async def get_project(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> Project:
    ctx.require(Permission.PROJECT_READ)
    return await get_owned(session, Project, project_id, ctx)


async def update_project(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: ProjectUpdate) -> Project:
    ctx.require(Permission.PROJECT_WRITE)
    project = await get_owned(session, Project, project_id, ctx)
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(project, key, value)
    if payload.get("status") == ProjectStatus.ARCHIVED:
        project.archived_at = datetime.now(UTC)
    elif "status" in payload:
        project.archived_at = None
    await session.commit()
    await session.refresh(project)
    return project


async def delete_project(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> None:
    ctx.require(Permission.PROJECT_DELETE)
    project = await get_owned(session, Project, project_id, ctx)
    await session.delete(project)
    audit(
        session,
        action="project.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="project",
        entity_id=project_id,
        meta={"title_len": len(project.title)},
    )
    await session.commit()


# ------------------------------------------------------------ plan read model
async def project_plan(session: AsyncSession, ctx: OrgContext, project: Project) -> ProjectPlanOut:
    pid = project.id
    org = ctx.organization_id
    plan = await session.scalar(
        select(MeasurementPlan).where(MeasurementPlan.project_id == pid, MeasurementPlan.organization_id == org)
    )
    goal = await session.scalar(
        select(Goal).where(Goal.project_id == pid, Goal.organization_id == org).order_by(Goal.sort_order)
    )

    async def _all(model: Any) -> list[Any]:
        rows = await session.scalars(
            select(model).where(model.project_id == pid, model.organization_id == org).order_by(model.sort_order)
        )
        return list(rows.all())

    draft: dict[str, Any] = (plan.draft if plan else {}) or {}
    return ProjectPlanOut(
        plan_id=plan.id if plan else None,
        status=plan.status if plan else None,
        measurement_type=project.measurement_type,
        recommended_design=plan.recommended_design if plan else None,
        design_rationale=plan.design_rationale if plan else "",
        evidence_level=plan.evidence_level if plan else None,
        purpose=plan.purpose if plan else project.description,
        target_population=project.target_population,
        baseline_required=plan.baseline_required if plan else False,
        post_measurement_required=plan.post_measurement_required if plan else False,
        follow_up_recommended=plan.follow_up_recommended if plan else False,
        follow_up_days=plan.follow_up_days if plan else None,
        recommended_questions_count=plan.recommended_questions_count if plan else None,
        estimated_completion_minutes=plan.estimated_completion_minutes if plan else None,
        methodology_notes=list(plan.methodology_notes) if plan else [],
        understanding_summary=str(draft.get("understanding_summary", "")),
        measurement_type_rationale=str(draft.get("measurement_type_rationale", "")),
        source_prompt=source_label(plan.source_prompt, plan.language) if plan else "",
        goal=GoalOut.model_validate(goal) if goal else None,
        objectives=[ObjectiveOut.model_validate(o) for o in await _all(Objective)],
        dimensions=[DimensionOut.model_validate(d) for d in await _all(Dimension)],
        indicators=[IndicatorOut.model_validate(i) for i in await _all(Indicator)],
        waves=[WaveOut.model_validate(w) for w in await _all(MeasurementWave)],
    )


async def project_counts(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> dict[str, int]:
    async def _count(model: Any) -> int:
        return int(
            await session.scalar(
                select(func.count())
                .select_from(model)
                .where(model.project_id == project_id, model.organization_id == ctx.organization_id)
            )
            or 0
        )

    return {
        "objectives": await _count(Objective),
        "dimensions": await _count(Dimension),
        "indicators": await _count(Indicator),
        "waves": await _count(MeasurementWave),
        "surveys": await _count(Survey),
        "published_surveys": int(
            await session.scalar(
                select(func.count())
                .select_from(Survey)
                .where(
                    Survey.project_id == project_id,
                    Survey.organization_id == ctx.organization_id,
                    Survey.published_version_id.is_not(None),
                )
            )
            or 0
        ),
    }


# ------------------------------------------------------------ chain CRUD
async def _ensure_project(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> Project:
    ctx.require(Permission.PROJECT_WRITE)
    return await get_owned(session, Project, project_id, ctx)


async def _next_order(session: AsyncSession, model: Any, project_id: uuid.UUID) -> int:
    value = await session.scalar(select(func.max(model.sort_order)).where(model.project_id == project_id))
    return int(value) + 1 if value is not None else 0


async def _ensure_in_project(
    session: AsyncSession, ctx: OrgContext, model: Any, obj_id: uuid.UUID | None, project_id: uuid.UUID
) -> None:
    if obj_id is None:
        return
    obj = await get_owned(session, model, obj_id, ctx)
    if obj.project_id != project_id:
        raise NotFound(f"{model.__name__} not found")


async def create_objective(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: ObjectiveIn
) -> ObjectiveOut:
    await _ensure_project(session, ctx, project_id)
    count = await _next_order(session, Objective, project_id)
    goal_id = await session.scalar(select(Goal.id).where(Goal.project_id == project_id).limit(1))
    row = Objective(
        organization_id=ctx.organization_id,
        project_id=project_id,
        goal_id=goal_id,
        key=f"o{count + 1}",
        sort_order=count,
        **data.model_dump(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return ObjectiveOut.model_validate(row)


async def update_objective(
    session: AsyncSession, ctx: OrgContext, objective_id: uuid.UUID, data: ObjectivePatch
) -> ObjectiveOut:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Objective, objective_id, ctx)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return ObjectiveOut.model_validate(row)


async def delete_objective(session: AsyncSession, ctx: OrgContext, objective_id: uuid.UUID) -> None:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Objective, objective_id, ctx)
    await session.delete(row)
    await session.commit()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:40]


async def create_dimension(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: DimensionIn
) -> DimensionOut:
    await _ensure_project(session, ctx, project_id)
    await _ensure_in_project(session, ctx, Objective, data.objective_id, project_id)
    order = await _next_order(session, Dimension, project_id)
    key = data.key or _slug(data.name) or f"d{order + 1}"
    exists = await session.scalar(select(Dimension.id).where(Dimension.project_id == project_id, Dimension.key == key))
    if exists:
        key = f"{key[:34]}_{order + 1}"
    row = Dimension(
        organization_id=ctx.organization_id,
        project_id=project_id,
        key=key,
        name=data.name,
        description=data.description,
        objective_id=data.objective_id,
        sort_order=order,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return DimensionOut.model_validate(row)


async def update_dimension(
    session: AsyncSession, ctx: OrgContext, dimension_id: uuid.UUID, data: DimensionPatch
) -> DimensionOut:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Dimension, dimension_id, ctx)
    payload = data.model_dump(exclude_unset=True)
    if "objective_id" in payload:
        await _ensure_in_project(session, ctx, Objective, payload["objective_id"], row.project_id)
    for key, value in payload.items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return DimensionOut.model_validate(row)


async def delete_dimension(session: AsyncSession, ctx: OrgContext, dimension_id: uuid.UUID) -> None:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Dimension, dimension_id, ctx)
    await session.delete(row)
    await session.commit()


async def create_indicator(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: IndicatorIn
) -> IndicatorOut:
    project = await _ensure_project(session, ctx, project_id)
    await _ensure_in_project(session, ctx, Dimension, data.dimension_id, project_id)
    order = await _next_order(session, Indicator, project_id)
    codes = set((await session.scalars(select(Indicator.code).where(Indicator.project_id == project_id))).all())
    n = order + 1
    while f"IND-{n:02d}" in codes:
        n += 1
    row = Indicator(
        organization_id=ctx.organization_id,
        project_id=project_id,
        code=f"IND-{n:02d}",
        measurement_type=project.measurement_type,
        computation=default_computation(data.indicator_type),
        sort_order=order,
        **data.model_dump(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return IndicatorOut.model_validate(row)


async def update_indicator(
    session: AsyncSession, ctx: OrgContext, indicator_id: uuid.UUID, data: IndicatorPatch
) -> IndicatorOut:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Indicator, indicator_id, ctx)
    payload = data.model_dump(exclude_unset=True)
    if "dimension_id" in payload:
        await _ensure_in_project(session, ctx, Dimension, payload["dimension_id"], row.project_id)
    if "indicator_type" in payload and payload["indicator_type"] != row.indicator_type:
        row.computation = default_computation(payload["indicator_type"])
    for key, value in payload.items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return IndicatorOut.model_validate(row)


async def delete_indicator(session: AsyncSession, ctx: OrgContext, indicator_id: uuid.UUID) -> None:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, Indicator, indicator_id, ctx)
    await session.delete(row)
    await session.commit()


async def update_wave(session: AsyncSession, ctx: OrgContext, wave_id: uuid.UUID, data: WavePatch) -> WaveOut:
    ctx.require(Permission.PROJECT_WRITE)
    row = await get_owned(session, MeasurementWave, wave_id, ctx)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return WaveOut.model_validate(row)


def ensure_unique_or_conflict(exists: bool, message: str) -> None:
    if exists:
        raise Conflict(message)
