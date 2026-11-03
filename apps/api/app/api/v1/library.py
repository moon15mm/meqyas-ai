"""Phase 8 endpoints: indicator values, Theory of Change, survey copy, templates, question bank."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, status

from ...core.rate_limit import enforce
from ...schemas.common import OkOut
from ...schemas.library import BankItemIn, BankItemOut, IndicatorValueOut, SurveyCopyIn, TocGenerateIn, TocIn
from ...schemas.plan import MeasurementPlanOut
from ...schemas.project import IndicatorOut
from ...schemas.survey import SurveyDetail
from ...services import indicators as indicator_svc
from ...services import library as library_svc
from ...services import surveys as survey_svc
from ...services import toc as toc_svc
from ..deps import DB, Ctx
from .plans import _out as plan_out

router = APIRouter(tags=["impact & library"])
Lang = Annotated[Literal["ar", "en"], Query()]


# ---------------------------------------------------------------- indicators
@router.post(
    "/projects/{project_id}/indicators/recompute",
    response_model=list[IndicatorOut],
    summary="Recompute indicator values from the accepted responses and store them",
)
async def recompute_indicators(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[Any]:
    await enforce(f"insights:{ctx.user_id}", limit=20, window_s=60)
    return await indicator_svc.recompute(session, ctx, project_id)


@router.get("/projects/{project_id}/indicators/values", response_model=list[IndicatorValueOut])
async def indicator_values(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[dict[str, Any]]:
    return await indicator_svc.wave_values(session, ctx, project_id)


# ----------------------------------------------------------- theory of change
@router.get("/projects/{project_id}/theory-of-change")
async def get_theory(project_id: uuid.UUID, ctx: Ctx, session: DB) -> dict[str, Any]:
    return await toc_svc.get_toc(session, ctx, project_id)


@router.put("/projects/{project_id}/theory-of-change")
async def save_theory(project_id: uuid.UUID, data: TocIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    return await toc_svc.save_toc(session, ctx, project_id, data.model_dump(mode="json"))


@router.post(
    "/projects/{project_id}/theory-of-change/generate",
    summary="Draft the Theory of Change from the measurement plan (AI); outcomes link to real indicators",
)
async def generate_theory(project_id: uuid.UUID, data: TocGenerateIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    return await toc_svc.generate_toc(session, ctx, project_id, data.notes)


# ----------------------------------------------------------------- surveys
@router.post(
    "/surveys/{survey_id}/copies",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Copy a survey to another wave (same question keys, so waves can be compared)",
)
async def copy_survey(survey_id: uuid.UUID, data: SurveyCopyIn, ctx: Ctx, session: DB) -> SurveyDetail:
    survey = await survey_svc.copy_to_wave(session, ctx, survey_id, wave_id=data.wave_id, title=data.title)
    return await survey_svc.survey_detail(session, survey)


# ---------------------------------------------------------------- templates
@router.get("/templates", summary="Measurement templates shipped with the platform")
async def list_templates(ctx: Ctx, lang: Lang = "ar") -> list[dict[str, Any]]:
    return library_svc.list_templates(lang)


@router.get("/templates/{code}")
async def get_template(code: str, ctx: Ctx, lang: Lang = "ar") -> dict[str, Any]:
    return library_svc.template_detail(code, lang)


@router.post(
    "/templates/{code}/use",
    response_model=MeasurementPlanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a plan draft from a template (review and accept it like an AI plan)",
)
async def use_template(code: str, ctx: Ctx, session: DB) -> MeasurementPlanOut:
    return plan_out(await library_svc.use_template(session, ctx, code))


# ------------------------------------------------------------ question bank
@router.get("/question-bank", response_model=list[BankItemOut])
async def list_bank(
    ctx: Ctx,
    session: DB,
    q: Annotated[str | None, Query(max_length=120)] = None,
    question_type: Annotated[str | None, Query(alias="type", max_length=24)] = None,
    scope: Annotated[Literal["all", "system", "organization"], Query()] = "all",
) -> list[dict[str, Any]]:
    return await library_svc.list_bank(session, ctx, q=q, question_type=question_type, scope=scope)


@router.post("/question-bank", response_model=BankItemOut, status_code=status.HTTP_201_CREATED)
async def save_bank_item(data: BankItemIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    return await library_svc.save_to_bank(session, ctx, data.model_dump())


@router.delete("/question-bank/{item_id}", response_model=OkOut)
async def delete_bank_item(item_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await library_svc.delete_from_bank(session, ctx, item_id)
    return OkOut()
