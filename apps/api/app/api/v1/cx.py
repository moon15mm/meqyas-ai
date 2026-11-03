"""Customer experience endpoints (CX.md): locations, the CX dashboard and follow-up cases.

Locations are managed by editors and above (``project.write``); the dashboard needs
``analytics.read``; acting on cases and revealing a customer's contact (audited) need
``responses.read_raw`` — the same people who may read individual answers. The module must be
part of the workspace's plan (SUBSCRIPTIONS.md §3).
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status

from ...schemas.common import OkOut
from ...schemas.cx import CaseFilter, CaseOut, CasePatch, LocationIn, LocationOut, LocationPatch
from meqyas_ai.schemas.retention import RetentionAnalysisIn, RetentionAnalysisOut
from ...services import cx as cx_svc
from ...services import locations as location_svc
from ..deps import DB, Ctx, feature

router = APIRouter(tags=["customer experience"], dependencies=[Depends(feature("cx"))])


@router.get("/projects/{project_id}/locations", response_model=list[LocationOut])
async def list_locations(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[Any]:
    return await location_svc.list_locations(session, ctx, project_id)


@router.post("/projects/{project_id}/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
async def create_location(project_id: uuid.UUID, data: LocationIn, ctx: Ctx, session: DB) -> Any:
    return await location_svc.create_location(session, ctx, project_id, data.model_dump())


@router.patch("/locations/{location_id}", response_model=LocationOut)
async def update_location(location_id: uuid.UUID, data: LocationPatch, ctx: Ctx, session: DB) -> Any:
    return await location_svc.update_location(session, ctx, location_id, data.model_dump(exclude_unset=True))


@router.delete("/locations/{location_id}", response_model=OkOut)
async def delete_location(location_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await location_svc.delete_location(session, ctx, location_id)
    return OkOut()


@router.get(
    "/projects/{project_id}/cx",
    summary="CX dashboard: NPS/CSAT/CES overall, by branch and week, key drivers, closed-loop status",
)
async def cx_dashboard(project_id: uuid.UUID, ctx: Ctx, session: DB) -> dict[str, Any]:
    return await cx_svc.dashboard(session, ctx, project_id)


@router.get("/projects/{project_id}/cx/cases", response_model=list[CaseOut])
async def list_cases(
    project_id: uuid.UUID, ctx: Ctx, session: DB, state: Annotated[CaseFilter, Query(alias="status")] = "open"
) -> list[dict[str, Any]]:
    return await cx_svc.list_cases(session, ctx, project_id, status=None if state == "all" else state)


@router.patch("/cx/cases/{case_id}", response_model=CaseOut)
async def update_case(case_id: uuid.UUID, data: CasePatch, ctx: Ctx, session: DB) -> dict[str, Any]:
    return await cx_svc.update_case(session, ctx, case_id, data.model_dump(exclude_unset=True))


@router.post("/cx/cases/{case_id}/contact", summary="Reveal the customer's contact details (audited)")
async def reveal_contact(case_id: uuid.UUID, ctx: Ctx, session: DB) -> dict[str, str]:
    return await cx_svc.reveal_contact(session, ctx, case_id)


@router.post(
    "/cx/retention-analysis",
    summary="Analyze customer feedback and formulate autonomous retention remediation (Meta Llama 3)",
)
async def analyze_retention(data: RetentionAnalysisIn, ctx: Ctx, session: DB) -> RetentionAnalysisOut:
    return await cx_svc.analyze_retention(session, ctx, data)

