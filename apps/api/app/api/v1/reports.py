"""Phase 7 endpoints: reports and their versions.

Reading needs ``reports.read`` (every role); creating, refreshing, editing and deleting
need ``reports.create`` (analysts, editors, admins, owners). Reports contain aggregates
only — never individual answers.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query

from ...core.rate_limit import enforce
from ...models import Report, ReportVersion
from ...schemas.common import OkOut
from ...schemas.report import (
    ReportCreateIn,
    ReportEditIn,
    ReportOut,
    ReportRegenerateIn,
    ReportSummaryOut,
    ReportVersionMetaOut,
)
from ...services import reports as report_svc
from ..deps import DB, Ctx

router = APIRouter(tags=["reports"])


async def _out(session: DB, report: Report, version: ReportVersion) -> dict[str, Any]:
    return {
        **report_svc._summary(report, await report_svc.project_title(session, report)),
        "version": {
            "version_number": version.version_number,
            "reason": version.reason,
            "created_at": version.created_at,
            "content": version.content,
        },
    }


@router.get("/reports", response_model=list[ReportSummaryOut], summary="Reports across the organization")
async def list_all_reports(
    ctx: Ctx, session: DB, project_id: Annotated[uuid.UUID | None, Query()] = None
) -> list[dict[str, Any]]:
    return await report_svc.list_reports(session, ctx, project_id)


@router.get("/projects/{project_id}/reports", response_model=list[ReportSummaryOut])
async def list_project_reports(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[dict[str, Any]]:
    return await report_svc.list_reports(session, ctx, project_id)


@router.post(
    "/projects/{project_id}/reports",
    response_model=ReportOut,
    status_code=201,
    summary="Generate a report: computed sections + AI narrative grounded in the facts",
)
async def create_report(project_id: uuid.UUID, data: ReportCreateIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    report, version = await report_svc.create_report(session, ctx, project_id, data.model_dump())
    return await _out(session, report, version)


@router.get("/reports/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: uuid.UUID, ctx: Ctx, session: DB, version: Annotated[int | None, Query(ge=1)] = None
) -> dict[str, Any]:
    report, row = await report_svc.get_report(session, ctx, report_id, version)
    return await _out(session, report, row)


@router.get("/reports/{report_id}/versions", response_model=list[ReportVersionMetaOut])
async def list_versions(report_id: uuid.UUID, ctx: Ctx, session: DB) -> list[dict[str, Any]]:
    return await report_svc.list_versions(session, ctx, report_id)


@router.post(
    "/reports/{report_id}/regenerate",
    response_model=ReportOut,
    summary="New version from today's data (optionally a new tone or audience)",
)
async def regenerate_report(report_id: uuid.UUID, data: ReportRegenerateIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    report, version = await report_svc.regenerate(session, ctx, report_id, data.model_dump(exclude_unset=True))
    return await _out(session, report, version)


@router.patch("/reports/{report_id}", response_model=ReportOut, summary="Edit text or hide sections (new version)")
async def edit_report(report_id: uuid.UUID, data: ReportEditIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    report, version = await report_svc.edit(session, ctx, report_id, data.model_dump(exclude_unset=True))
    return await _out(session, report, version)


@router.delete("/reports/{report_id}", response_model=OkOut)
async def delete_report(report_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await report_svc.delete_report(session, ctx, report_id)
    return OkOut()
