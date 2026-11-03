from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from meqyas_ai.schemas.plan import ArchitectOutput

from ...core.rate_limit import enforce
from ...domain.library.templates import source_label
from ...schemas.plan import ArchitectRequestIn, MeasurementPlanOut, RegenerateIn
from ...schemas.project import ProjectOut
from ...services import plans as svc
from ..deps import DB, Ctx

router = APIRouter(tags=["measurement-plans"])


def _out(plan) -> MeasurementPlanOut:  # type: ignore[no-untyped-def]
    return MeasurementPlanOut.model_validate(
        {
            "id": plan.id,
            "status": plan.status,
            "project_id": plan.project_id,
            "source_prompt": source_label(plan.source_prompt, plan.language),
            "language": plan.language,
            "generation_count": plan.generation_count,
            "draft": plan.draft,
            "ai_run_id": plan.ai_run_id,
            "created_at": plan.created_at,
            "updated_at": plan.updated_at,
            "accepted_at": plan.accepted_at,
        }
    )


@router.post(
    "/ai/measurement-architect",
    response_model=MeasurementPlanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a measurement plan from a natural-language request (Measurement Architect agent)",
)
async def measurement_architect(data: ArchitectRequestIn, ctx: Ctx, session: DB) -> MeasurementPlanOut:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    plan = await svc.create_draft_from_request(
        session, ctx, request=data.request, language=data.language, audience_hint=data.audience_hint
    )
    return _out(plan)


@router.get("/measurement-plans/{plan_id}", response_model=MeasurementPlanOut)
async def get_plan(plan_id: uuid.UUID, ctx: Ctx, session: DB) -> MeasurementPlanOut:
    return _out(await svc.get_plan(session, ctx, plan_id))


@router.patch("/measurement-plans/{plan_id}", response_model=MeasurementPlanOut)
async def update_plan(plan_id: uuid.UUID, data: ArchitectOutput, ctx: Ctx, session: DB) -> MeasurementPlanOut:
    return _out(await svc.update_draft(session, ctx, plan_id, data))


@router.post("/measurement-plans/{plan_id}/regenerate", response_model=MeasurementPlanOut)
async def regenerate_plan(plan_id: uuid.UUID, data: RegenerateIn, ctx: Ctx, session: DB) -> MeasurementPlanOut:
    await enforce(f"ai-user:{ctx.user_id}", limit=20, window_s=60)
    return _out(await svc.regenerate(session, ctx, plan_id, data.feedback))


@router.post("/measurement-plans/{plan_id}/accept", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def accept_plan(plan_id: uuid.UUID, ctx: Ctx, session: DB) -> ProjectOut:
    return ProjectOut.model_validate(await svc.accept(session, ctx, plan_id))
