from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from ...domain.enums import ProjectStatus
from ...schemas.common import OkOut, Page
from ...schemas.project import (
    DimensionIn,
    DimensionOut,
    DimensionPatch,
    IndicatorIn,
    IndicatorOut,
    IndicatorPatch,
    ObjectiveIn,
    ObjectiveOut,
    ObjectivePatch,
    ProjectCreate,
    ProjectOut,
    ProjectOverviewOut,
    ProjectPlanOut,
    ProjectTypeOut,
    ProjectUpdate,
    WaveOut,
    WavePatch,
)
from ...services import projects as svc
from ..deps import DB, Ctx, CurrentUser

router = APIRouter(tags=["projects"])


@router.get("/project-types", response_model=list[ProjectTypeOut])
async def project_types(_: CurrentUser, session: DB) -> list[ProjectTypeOut]:
    return [ProjectTypeOut.model_validate(t) for t in await svc.list_project_types(session)]


@router.get("/projects", response_model=Page[ProjectOut])
async def list_projects(
    ctx: Ctx,
    session: DB,
    status_: Annotated[ProjectStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProjectOut]:
    items, total = await svc.list_projects(session, ctx, status=status_, q=q, limit=limit, offset=offset)
    return Page(items=[ProjectOut.model_validate(p) for p in items], total=total, limit=limit, offset=offset)


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(data: ProjectCreate, ctx: Ctx, session: DB) -> ProjectOut:
    return ProjectOut.model_validate(await svc.create_project(session, ctx, data))


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: uuid.UUID, ctx: Ctx, session: DB) -> ProjectOut:
    return ProjectOut.model_validate(await svc.get_project(session, ctx, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(project_id: uuid.UUID, data: ProjectUpdate, ctx: Ctx, session: DB) -> ProjectOut:
    return ProjectOut.model_validate(await svc.update_project(session, ctx, project_id, data))


@router.delete("/projects/{project_id}", response_model=OkOut)
async def delete_project(project_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await svc.delete_project(session, ctx, project_id)
    return OkOut()


@router.get("/projects/{project_id}/overview", response_model=ProjectOverviewOut)
async def project_overview(project_id: uuid.UUID, ctx: Ctx, session: DB) -> ProjectOverviewOut:
    project = await svc.get_project(session, ctx, project_id)
    return ProjectOverviewOut(
        project=ProjectOut.model_validate(project),
        plan=await svc.project_plan(session, ctx, project),
        counts=await svc.project_counts(session, ctx, project.id),
    )


@router.get("/projects/{project_id}/measurement-plan", response_model=ProjectPlanOut)
async def project_measurement_plan(project_id: uuid.UUID, ctx: Ctx, session: DB) -> ProjectPlanOut:
    project = await svc.get_project(session, ctx, project_id)
    return await svc.project_plan(session, ctx, project)


# ---------------------------------------------------------------- objectives
@router.post("/projects/{project_id}/objectives", response_model=ObjectiveOut, status_code=201)
async def create_objective(project_id: uuid.UUID, data: ObjectiveIn, ctx: Ctx, session: DB) -> ObjectiveOut:
    return await svc.create_objective(session, ctx, project_id, data)


@router.patch("/objectives/{objective_id}", response_model=ObjectiveOut)
async def update_objective(objective_id: uuid.UUID, data: ObjectivePatch, ctx: Ctx, session: DB) -> ObjectiveOut:
    return await svc.update_objective(session, ctx, objective_id, data)


@router.delete("/objectives/{objective_id}", response_model=OkOut)
async def delete_objective(objective_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await svc.delete_objective(session, ctx, objective_id)
    return OkOut()


# ---------------------------------------------------------------- dimensions
@router.post("/projects/{project_id}/dimensions", response_model=DimensionOut, status_code=201)
async def create_dimension(project_id: uuid.UUID, data: DimensionIn, ctx: Ctx, session: DB) -> DimensionOut:
    return await svc.create_dimension(session, ctx, project_id, data)


@router.patch("/dimensions/{dimension_id}", response_model=DimensionOut)
async def update_dimension(dimension_id: uuid.UUID, data: DimensionPatch, ctx: Ctx, session: DB) -> DimensionOut:
    return await svc.update_dimension(session, ctx, dimension_id, data)


@router.delete("/dimensions/{dimension_id}", response_model=OkOut)
async def delete_dimension(dimension_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await svc.delete_dimension(session, ctx, dimension_id)
    return OkOut()


# ---------------------------------------------------------------- indicators
@router.post("/projects/{project_id}/indicators", response_model=IndicatorOut, status_code=201)
async def create_indicator(project_id: uuid.UUID, data: IndicatorIn, ctx: Ctx, session: DB) -> IndicatorOut:
    return await svc.create_indicator(session, ctx, project_id, data)


@router.patch("/indicators/{indicator_id}", response_model=IndicatorOut)
async def update_indicator(indicator_id: uuid.UUID, data: IndicatorPatch, ctx: Ctx, session: DB) -> IndicatorOut:
    return await svc.update_indicator(session, ctx, indicator_id, data)


@router.delete("/indicators/{indicator_id}", response_model=OkOut)
async def delete_indicator(indicator_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await svc.delete_indicator(session, ctx, indicator_id)
    return OkOut()


# ------------------------------------------------------------------- waves
@router.patch("/waves/{wave_id}", response_model=WaveOut)
async def update_wave(wave_id: uuid.UUID, data: WavePatch, ctx: Ctx, session: DB) -> WaveOut:
    return await svc.update_wave(session, ctx, wave_id, data)
