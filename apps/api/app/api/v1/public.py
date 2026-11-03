"""Public survey endpoints (no authentication). Rate limits per client IP and
per survey protect against spam and cost abuse (SECURITY.md §7)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Path, Query, Request, status

from ...core.rate_limit import client_ip, enforce
from ...schemas.common import OkOut
from ...schemas.response import FollowupIn, FollowupOut, PublicSurveyOut, SubmissionIn, SubmissionOut
from ...services import public as svc
from ..deps import DB

router = APIRouter(prefix="/public", tags=["public"])

PublicId = Annotated[str, Path(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")]
InvitationToken = Annotated[str, Query(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
InvitationPath = Annotated[str, Path(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
LocationCode = Annotated[str, Query(min_length=1, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")]


@router.get("/surveys/{public_id}", response_model=PublicSurveyOut, summary="Published survey for respondents")
async def get_public_survey(
    public_id: PublicId,
    request: Request,
    session: DB,
    inv: InvitationToken | None = None,
    loc: LocationCode | None = None,
) -> PublicSurveyOut:
    await enforce(f"pub-open:{client_ip(request)}", limit=240, window_s=60)
    return await svc.get_public_survey(session, public_id, invitation=inv, location=loc)


@router.post(
    "/surveys/{public_id}/invitations/{token}/opt-out",
    response_model=OkOut,
    summary="Stop rating requests from this store for the invited customer",
)
async def opt_out(public_id: PublicId, token: InvitationPath, request: Request, session: DB) -> OkOut:
    await enforce(f"pub-optout:{client_ip(request)}", limit=30, window_s=60)
    await svc.opt_out(session, public_id, token)
    return OkOut()


@router.post(
    "/surveys/{public_id}/responses",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a completed response (validated server-side)",
)
async def submit_response(
    public_id: PublicId,
    data: SubmissionIn,
    request: Request,
    session: DB,
    user_agent: Annotated[str | None, Header()] = None,
) -> SubmissionOut:
    # A whole class behind one school NAT may submit within a minute: generous per IP,
    # bounded per survey.
    await enforce(f"pub-submit:{public_id}:{client_ip(request)}", limit=120, window_s=60)
    await enforce(f"pub-submit:{public_id}", limit=1200, window_s=60)
    response = await svc.submit_response(session, public_id, data, user_agent=user_agent)
    return SubmissionOut(response_id=response.id)


@router.post(
    "/surveys/{public_id}/followup",
    response_model=FollowupOut,
    summary="Bounded AI follow-up question for one answer (never blocks submission)",
)
async def followup(public_id: PublicId, data: FollowupIn, request: Request, session: DB) -> FollowupOut:
    await enforce(f"pub-followup:{client_ip(request)}", limit=20, window_s=60)
    return await svc.ai_followup(session, public_id, data)
