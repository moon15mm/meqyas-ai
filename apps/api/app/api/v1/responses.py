from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ...domain.enums import QualityStatus, ReviewStatus
from ...schemas.common import OkOut
from ...schemas.response import ResponseDetail, ResponsePage, ResponseReviewIn
from ...services import responses as svc
from ..deps import DB, Ctx, request_meta

router = APIRouter(tags=["responses"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/projects/{project_id}/responses", response_model=ResponsePage)
async def project_responses(
    project_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    survey_id: Annotated[uuid.UUID | None, Query()] = None,
    quality: Annotated[QualityStatus | None, Query()] = None,
    review: Annotated[ReviewStatus | None, Query()] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> ResponsePage:
    return await svc.list_responses(
        session,
        ctx,
        project_id=project_id,
        survey_id=survey_id,
        quality=quality,
        review=review,
        limit=limit,
        offset=offset,
    )


@router.get("/surveys/{survey_id}/responses", response_model=ResponsePage)
async def survey_responses(
    survey_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    quality: Annotated[QualityStatus | None, Query()] = None,
    review: Annotated[ReviewStatus | None, Query()] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> ResponsePage:
    return await svc.list_responses(
        session, ctx, survey_id=survey_id, quality=quality, review=review, limit=limit, offset=offset
    )


@router.get("/responses/{response_id}", response_model=ResponseDetail)
async def get_response(response_id: uuid.UUID, ctx: Ctx, session: DB) -> ResponseDetail:
    return await svc.get_response(session, ctx, response_id)


@router.patch("/responses/{response_id}", response_model=ResponseDetail)
async def review_response(response_id: uuid.UUID, data: ResponseReviewIn, ctx: Ctx, session: DB) -> ResponseDetail:
    return await svc.review_response(session, ctx, response_id, data.review_status)


@router.delete("/responses/{response_id}", response_model=OkOut)
async def delete_response(
    response_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    meta: Annotated[dict[str, str | None], Depends(request_meta)],
) -> OkOut:
    await svc.delete_response(session, ctx, response_id, request_meta=meta)
    return OkOut()
