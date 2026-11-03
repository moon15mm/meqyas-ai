from __future__ import annotations

import io
import uuid
from typing import Annotated, Literal

import segno
from fastapi import APIRouter, Query, Response, status

from ...core.config import get_settings
from ...core.rate_limit import enforce
from ...domain.enums import SurveyStatus
from ...schemas.common import OkOut
from ...schemas.survey import (
    DraftIn,
    ReviewAction,
    SurveyAction,
    SurveyCreate,
    SurveyDetail,
    SurveyGenerate,
    SurveyMeta,
    SurveyUpdate,
)
from ...services import surveys as svc
from ..deps import DB, Ctx

router = APIRouter(tags=["surveys"])


@router.get("/surveys", response_model=list[SurveyMeta])
async def list_surveys(
    ctx: Ctx,
    session: DB,
    project_id: Annotated[uuid.UUID | None, Query()] = None,
    status_: Annotated[SurveyStatus | None, Query(alias="status")] = None,
) -> list[SurveyMeta]:
    return await svc.list_surveys(session, ctx, project_id=project_id, status=status_)


@router.get("/projects/{project_id}/surveys", response_model=list[SurveyMeta])
async def project_surveys(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[SurveyMeta]:
    return await svc.list_surveys(session, ctx, project_id=project_id)


@router.post("/projects/{project_id}/surveys", response_model=SurveyDetail, status_code=status.HTTP_201_CREATED)
async def create_survey(project_id: uuid.UUID, data: SurveyCreate, ctx: Ctx, session: DB) -> SurveyDetail:
    survey = await svc.create_survey(
        session, ctx, project_id, title=data.title, wave_id=data.wave_id, language=data.language
    )
    return await svc.survey_detail(session, survey)


@router.post(
    "/projects/{project_id}/surveys/generate",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a survey for a measurement wave with the Survey Generator agent",
)
async def generate_survey(project_id: uuid.UUID, data: SurveyGenerate, ctx: Ctx, session: DB) -> SurveyDetail:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    survey = await svc.generate_survey(
        session,
        ctx,
        project_id,
        wave_id=data.wave_id,
        question_count=data.question_count,
        include_open_questions=data.include_open_questions,
        include_profile_questions=data.include_profile_questions,
        extra_instructions=data.extra_instructions,
    )
    return await svc.survey_detail(session, survey)


@router.get("/surveys/{survey_id}", response_model=SurveyDetail)
async def get_survey(survey_id: uuid.UUID, ctx: Ctx, session: DB) -> SurveyDetail:
    return await svc.survey_detail(session, await svc.get_survey(session, ctx, survey_id))


@router.patch("/surveys/{survey_id}", response_model=SurveyDetail)
async def update_survey(survey_id: uuid.UUID, data: SurveyUpdate, ctx: Ctx, session: DB) -> SurveyDetail:
    survey = await svc.update_meta(session, ctx, survey_id, data.model_dump(exclude_unset=True))
    return await svc.survey_detail(session, survey)


@router.get("/surveys/{survey_id}/qr.{fmt}", summary="QR code of the public survey link (SVG or PNG)")
async def survey_qr(
    survey_id: uuid.UUID,
    fmt: Literal["svg", "png"],
    ctx: Ctx,
    session: DB,
    scale: Annotated[int, Query(ge=2, le=40)] = 10,
    loc: Annotated[str | None, Query(max_length=24, pattern=r"^[A-Za-z0-9_-]+$")] = None,
    kiosk: bool = False,
) -> Response:
    survey = await svc.get_survey(session, ctx, survey_id)
    url = f"{get_settings().web_base_url.rstrip('/')}/s/{survey.public_id}?c=qr"
    if loc:  # a branch's own code: its answers are split by branch (CX.md §2)
        url += f"&loc={loc}" + ("&kiosk=1" if kiosk else "")
    qr = segno.make(url, error="m", micro=False)
    buf = io.BytesIO()
    if fmt == "svg":
        qr.save(buf, kind="svg", scale=scale, border=2, xmldecl=False, svgns=True, title=survey.title[:100])
        media = "image/svg+xml"
    else:
        qr.save(buf, kind="png", scale=scale, border=2)
        media = "image/png"
    headers = {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": f'inline; filename="survey-{survey.public_id}.{fmt}"',
    }
    return Response(content=buf.getvalue(), media_type=media, headers=headers)


@router.put(
    "/surveys/{survey_id}/draft", response_model=SurveyDetail, summary="Save the builder document (copy-on-write)"
)
async def save_draft(survey_id: uuid.UUID, data: DraftIn, ctx: Ctx, session: DB) -> SurveyDetail:
    survey = await svc.save_draft(session, ctx, survey_id, data.doc)
    return await svc.survey_detail(session, survey)


@router.post("/surveys/{survey_id}/review", response_model=SurveyDetail, summary="AI Question Reviewer + quality score")
async def review_survey(survey_id: uuid.UUID, ctx: Ctx, session: DB) -> SurveyDetail:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    survey = await svc.review_survey(session, ctx, survey_id)
    return await svc.survey_detail(session, survey)


@router.post("/surveys/{survey_id}/review/issues/{issue_id}", response_model=SurveyDetail)
async def review_issue_action(
    survey_id: uuid.UUID, issue_id: str, data: ReviewAction, ctx: Ctx, session: DB
) -> SurveyDetail:
    survey = await svc.apply_review_action(session, ctx, survey_id, issue_id, data.action)
    return await svc.survey_detail(session, survey)


@router.post("/surveys/{survey_id}/{action}", response_model=SurveyDetail)
async def survey_action(survey_id: uuid.UUID, action: SurveyAction, ctx: Ctx, session: DB) -> SurveyDetail:
    survey = await svc.transition(session, ctx, survey_id, action)
    return await svc.survey_detail(session, survey)


@router.delete("/surveys/{survey_id}", response_model=OkOut)
async def delete_survey(survey_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await svc.delete_survey(session, ctx, survey_id)
    return OkOut()
