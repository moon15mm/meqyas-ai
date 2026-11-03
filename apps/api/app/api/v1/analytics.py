"""Analytics endpoints. Aggregates only (ANALYTICS_READ, all roles); raw text
samples require RESPONSES_READ_RAW; exports require RESPONSES_EXPORT."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response

from ...core.errors import NotFound, Unprocessable
from ...domain.enums import WaveType
from ...domain.permissions import Permission
from ...services import analytics as svc
from ...services.exports import export_responses
from ..deps import DB, Ctx, feature, request_meta

router = APIRouter(tags=["analytics"])

IncludeFlagged = Annotated[bool, Query(description="Include LOW_QUALITY responses (EXCLUDE is never included)")]


def _filter_wave(ds: svc.Dataset, wave: WaveType | None) -> None:
    if wave is not None:
        ds.rows = [r for r in ds.rows if r.wave == wave.value]


@router.get("/analytics/projects", summary="Collection status of every project (results hub)")
async def analytics_portfolio(ctx: Ctx, session: DB) -> dict[str, Any]:
    return {"items": await svc.portfolio(session, ctx)}


@router.get("/projects/{project_id}/analytics/summary", summary="KPIs, dimension scores and indicators per wave")
async def analytics_summary(
    project_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    survey_id: uuid.UUID | None = None,
    include_flagged: IncludeFlagged = False,
) -> dict[str, Any]:
    ds = await svc.load_dataset(session, ctx, project_id, survey_id=survey_id, include_flagged=include_flagged)
    dims, inds = await svc.plan_refs(session, project_id)
    return svc.summary(ds, dims, inds)


@router.get("/projects/{project_id}/analytics/questions", summary="Statistics for every question")
async def analytics_questions(
    project_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    survey_id: uuid.UUID | None = None,
    wave: WaveType | None = None,
    segment: Annotated[
        str | None, Query(max_length=60, description="Break every question down by this variable")
    ] = None,
    include_flagged: IncludeFlagged = False,
) -> dict[str, Any]:
    ds = await svc.load_dataset(session, ctx, project_id, survey_id=survey_id, include_flagged=include_flagged)
    _filter_wave(ds, wave)
    raw_text = ctx.can(Permission.RESPONSES_READ_RAW)
    if segment:
        svc.segment_values(ds, segment)  # 422 invalid_segment before any work
    questions = []
    for q in ds.questions.values():
        if not q.answerable:
            continue
        result = svc.question_stats(ds, q, ds.rows, raw_text=raw_text)
        if segment and q.key != segment and q.type not in svc.TEXT_TYPES:
            result["segment"] = segment
            result["segments"] = svc.segmented_stats(ds, q, segment)
        questions.append(result)
    return {"n": len(ds.rows), "segment": segment, "questions": questions}


@router.get("/projects/{project_id}/analytics/questions/{key}", summary="One question, optionally by segment")
async def analytics_question(
    project_id: uuid.UUID,
    key: str,
    ctx: Ctx,
    session: DB,
    segment: str | None = None,
    survey_id: uuid.UUID | None = None,
    wave: WaveType | None = None,
    include_flagged: IncludeFlagged = False,
) -> dict[str, Any]:
    ds = await svc.load_dataset(session, ctx, project_id, survey_id=survey_id, include_flagged=include_flagged)
    _filter_wave(ds, wave)
    q = ds.questions.get(key)
    if q is None or not q.answerable:
        raise NotFound("Question not found in the published surveys of this project")
    result = svc.question_stats(ds, q, ds.rows, raw_text=ctx.can(Permission.RESPONSES_READ_RAW))
    if segment:
        result["segment"] = segment
        result["segments"] = svc.segmented_stats(ds, q, segment)
    return result


@router.get("/projects/{project_id}/analytics/compare", summary="Wave comparison (paired when codes match)")
async def analytics_compare(
    project_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    from_wave: WaveType = WaveType.BASELINE,
    to_wave: WaveType = WaveType.POST,
    include_flagged: IncludeFlagged = False,
) -> dict[str, Any]:
    if from_wave == to_wave:
        raise Unprocessable("Choose two different waves", code="same_wave")
    ds = await svc.load_dataset(session, ctx, project_id, include_flagged=include_flagged)
    dims, _ = await svc.plan_refs(session, project_id)
    result = svc.wave_comparison(ds, dims, from_wave.value, to_wave.value)
    level = ds.plan.evidence_level if ds.plan else None
    result["evidence_level"] = level.value if level else None
    result["causality"] = svc.CAUSAL_NOTES.get(level) if level else "descriptive_only"
    return result


@router.get("/projects/{project_id}/analytics/crosstab", summary="Cross-tabulation of two categorical variables")
async def analytics_crosstab(
    project_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    row: Annotated[str, Query(min_length=1, max_length=60)],
    col: Annotated[str, Query(min_length=1, max_length=60)],
    wave: WaveType | None = None,
    include_flagged: IncludeFlagged = False,
) -> dict[str, Any]:
    if row == col:
        raise Unprocessable("Choose two different variables", code="same_variable")
    ds = await svc.load_dataset(session, ctx, project_id, include_flagged=include_flagged)
    _filter_wave(ds, wave)
    return svc.crosstab(ds, row, col)


@router.get(
    "/surveys/{survey_id}/responses/export.{fmt}",
    summary="Export responses (CSV or Excel)",
    dependencies=[Depends(feature("exports"))],
)
async def export_survey_responses(
    survey_id: uuid.UUID,
    fmt: Literal["csv", "xlsx"],
    ctx: Ctx,
    session: DB,
    meta: Annotated[dict[str, str | None], Depends(request_meta)],
    include_flagged: IncludeFlagged = False,
) -> Response:
    content, media, filename = await export_responses(
        session, ctx, survey_id, fmt=fmt, include_flagged=include_flagged, request_meta=meta
    )
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )
