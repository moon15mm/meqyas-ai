"""Phase 6 endpoints: open-answer analysis, insights, recommendations and the AI analyst.

Reading needs ``analytics.read`` (every role); anything that writes results or calls a
model needs ``ai.analyze`` (analysts, editors, admins, owners). Raw answer samples in
theme results need ``responses.read_raw``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query

from ...core.rate_limit import enforce
from ...domain.permissions import Permission
from ...schemas.common import OkOut
from ...schemas.intelligence import (
    AnalyzeIn,
    ChatIn,
    ChatOut,
    InsightOut,
    InsightStatusIn,
    RecommendationIn,
    RecommendationOut,
    RecommendationPatch,
)
from ...services import insights as insight_svc
from ...services import pack as pack_svc
from ...services import textanalysis as text_svc
from ..deps import DB, Ctx

router = APIRouter(tags=["intelligence"])
QuestionKey = Annotated[str, Query(min_length=1, max_length=60)]


# ------------------------------------------------------------- text analysis
@router.get("/projects/{project_id}/text-analysis", summary="Open questions with their latest analysis")
async def list_text_analysis(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[dict[str, Any]]:
    ctx.require(Permission.ANALYTICS_READ)
    return await text_svc.project_text_questions(session, ctx, project_id, raw=ctx.can(Permission.RESPONSES_READ_RAW))


@router.post("/projects/{project_id}/text-analysis/{question_key}", summary="Analyze one open question")
async def analyze_text(
    project_id: uuid.UUID, question_key: str, data: AnalyzeIn, ctx: Ctx, session: DB
) -> dict[str, Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    return await text_svc.analyze_question(session, ctx, project_id, question_key, use_ai=data.use_ai)


# ----------------------------------------------------------------- insights
@router.get("/projects/{project_id}/insights", response_model=list[InsightOut])
async def list_insights(
    project_id: uuid.UUID, ctx: Ctx, session: DB, include_dismissed: Annotated[bool, Query()] = False
) -> list[Any]:
    return await insight_svc.list_insights(session, ctx, project_id, include_dismissed=include_dismissed)


@router.post(
    "/projects/{project_id}/insights/generate",
    response_model=list[InsightOut],
    summary="Recompute evidence-linked insights from the current data (deterministic rules)",
)
async def generate_insights(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[Any]:
    await enforce(f"insights:{ctx.user_id}", limit=20, window_s=60)
    return await insight_svc.generate_insights(session, ctx, project_id)


@router.patch("/insights/{insight_id}", response_model=InsightOut)
async def update_insight(insight_id: uuid.UUID, data: InsightStatusIn, ctx: Ctx, session: DB) -> Any:
    return await insight_svc.set_insight_status(session, ctx, insight_id, data.status)


# ---------------------------------------------------------- recommendations
@router.get("/projects/{project_id}/recommendations", response_model=list[RecommendationOut])
async def list_recommendations(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[Any]:
    return await insight_svc.list_recommendations(session, ctx, project_id)


@router.post(
    "/projects/{project_id}/recommendations/generate",
    response_model=list[RecommendationOut],
    summary="Propose recommendations from current insights (AI)",
)
async def generate_recommendations(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    return await insight_svc.generate_recommendations(session, ctx, project_id)


@router.post("/projects/{project_id}/recommendations", response_model=RecommendationOut, status_code=201)
async def create_recommendation(project_id: uuid.UUID, data: RecommendationIn, ctx: Ctx, session: DB) -> Any:
    values = data.model_dump()
    values["insight_ids"] = [str(i) for i in data.insight_ids]
    return await insight_svc.create_recommendation(session, ctx, project_id, values)


@router.patch("/recommendations/{rec_id}", response_model=RecommendationOut)
async def update_recommendation(rec_id: uuid.UUID, data: RecommendationPatch, ctx: Ctx, session: DB) -> Any:
    return await insight_svc.update_recommendation(session, ctx, rec_id, data.model_dump(exclude_unset=True))


@router.delete("/recommendations/{rec_id}", response_model=OkOut)
async def delete_recommendation(rec_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    await insight_svc.delete_recommendation(session, ctx, rec_id)
    return OkOut()


# ------------------------------------------------------------- AI analyst
@router.post(
    "/projects/{project_id}/analyst/chat",
    response_model=ChatOut,
    summary="Ask the AI data analyst (answers cite computed facts only)",
)
async def analyst_chat(project_id: uuid.UUID, data: ChatIn, ctx: Ctx, session: DB) -> dict[str, Any]:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    return await pack_svc.chat(session, ctx, project_id, data.message, [t.model_dump() for t in data.history])


@router.get("/projects/{project_id}/analytics/pack", summary="The facts the AI may cite (for transparency)")
async def analytics_pack(project_id: uuid.UUID, ctx: Ctx, session: DB) -> dict[str, Any]:
    ctx.require(Permission.ANALYTICS_READ)
    pack = await pack_svc.build_pack(session, ctx, project_id)
    return {
        "language": pack.language,
        "evidence_level": pack.evidence_level,
        "caveat": pack.caveat,
        "facts": pack.facts,
    }
