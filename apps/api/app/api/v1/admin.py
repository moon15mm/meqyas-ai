"""Platform administration (SUBSCRIPTIONS.md §5): subscribers, plans and accounts.

Platform administrators only (``users.is_superuser``, granted from the CLI — there is no way to
become one from the app). Every service call checks it and every change is audited.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from ...core.rate_limit import enforce
from ...schemas.common import OkOut
from ...schemas.subscription import (
    AccountMessageOut,
    AdminMembersIn,
    BulkCreateIn,
    BulkResultOut,
    PlanIn,
    PlanOut,
    PlanUpdate,
    RenewIn,
    SendEmailIn,
    SubscriberCreatedOut,
    SubscriberCreateIn,
    SubscriberDetail,
    SubscriberPage,
    SubscriptionUpdateIn,
    SuspendIn,
)
from ...services import subscribers as svc
from ..deps import DB, CurrentUser, request_meta

router = APIRouter(prefix="/admin", tags=["platform admin"])
Meta = Annotated[dict[str, str | None], Depends(request_meta)]
StateFilter = Literal["PENDING", "TRIAL", "ACTIVE", "EXPIRED", "SUSPENDED", "ENDING_SOON"]


# -------------------------------------------------------------- subscribers
@router.get("/subscribers", response_model=SubscriberPage, summary="Every workspace with its plan and usage")
async def list_subscribers(
    user: CurrentUser,
    session: DB,
    q: Annotated[str | None, Query(max_length=200)] = None,
    state: StateFilter | None = None,
    plan: Annotated[str | None, Query(max_length=40)] = None,
    include_demo: bool = False,
    sort: Literal["created", "ending", "name"] = "created",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SubscriberPage:
    return await svc.list_subscribers(
        session, user, q=q, state=state, plan=plan, include_demo=include_demo, sort=sort, limit=limit, offset=offset
    )


@router.post(
    "/subscribers",
    response_model=SubscriberCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="A new subscriber: account, workspace, subscription and the activation message (shown once)",
)
async def create_subscriber(
    data: SubscriberCreateIn, user: CurrentUser, session: DB, meta: Meta
) -> SubscriberCreatedOut:
    await enforce(f"admin-create:{user.id}", limit=60, window_s=60)
    return await svc.create_subscriber(session, user, data, meta)


@router.post("/subscribers/bulk", response_model=BulkResultOut, summary="One workspace per row (up to 200)")
async def bulk_create(data: BulkCreateIn, user: CurrentUser, session: DB, meta: Meta) -> BulkResultOut:
    await enforce(f"admin-bulk:{user.id}", limit=10, window_s=60)
    return await svc.bulk_create(session, user, data, meta)


@router.get("/subscribers/{organization_id}", response_model=SubscriberDetail)
async def get_subscriber(organization_id: uuid.UUID, user: CurrentUser, session: DB) -> SubscriberDetail:
    return await svc.get_subscriber(session, user, organization_id)


@router.patch(
    "/subscribers/{organization_id}",
    response_model=SubscriberDetail,
    summary="Plan, the workspace's own limits, end date, internal note, name",
)
async def update_subscription(
    organization_id: uuid.UUID, data: SubscriptionUpdateIn, user: CurrentUser, session: DB, meta: Meta
) -> SubscriberDetail:
    return await svc.update_subscription(session, user, organization_id, data, meta)


@router.post(
    "/subscribers/{organization_id}/renew",
    response_model=SubscriberDetail,
    summary="A new period (days added to what is left; the survey counter starts again)",
)
async def renew(
    organization_id: uuid.UUID, data: RenewIn, user: CurrentUser, session: DB, meta: Meta
) -> SubscriberDetail:
    return await svc.renew(session, user, organization_id, data, meta)


@router.post("/subscribers/{organization_id}/suspend", response_model=SubscriberDetail)
async def suspend(
    organization_id: uuid.UUID, data: SuspendIn, user: CurrentUser, session: DB, meta: Meta
) -> SubscriberDetail:
    return await svc.set_suspended(
        session, user, organization_id, suspended=True, reason=data.reason, request_meta=meta
    )


@router.post("/subscribers/{organization_id}/reactivate", response_model=SubscriberDetail)
async def reactivate(organization_id: uuid.UUID, user: CurrentUser, session: DB, meta: Meta) -> SubscriberDetail:
    return await svc.set_suspended(session, user, organization_id, suspended=False, request_meta=meta)


@router.post(
    "/subscribers/{organization_id}/members",
    response_model=BulkResultOut,
    summary="Add people to the workspace (new accounts get an activation message)",
)
async def add_members(
    organization_id: uuid.UUID, data: AdminMembersIn, user: CurrentUser, session: DB, meta: Meta
) -> BulkResultOut:
    await enforce(f"admin-bulk:{user.id}", limit=10, window_s=60)
    return await svc.add_members(session, user, organization_id, data, meta)


@router.delete("/subscribers/{organization_id}/members/{member_id}", response_model=SubscriberDetail)
async def remove_member(
    organization_id: uuid.UUID, member_id: uuid.UUID, user: CurrentUser, session: DB, meta: Meta
) -> SubscriberDetail:
    return await svc.remove_member(session, user, organization_id, member_id, meta)


# ----------------------------------------------------------------- accounts
@router.post(
    "/users/{user_id}/access-link",
    response_model=AccountMessageOut,
    summary="A new activation link (never activated) or a password recovery link — shown once",
)
async def access_link(
    user_id: uuid.UUID, data: SendEmailIn, user: CurrentUser, session: DB, meta: Meta
) -> AccountMessageOut:
    await enforce(f"admin-link:{user.id}", limit=30, window_s=60)
    return await svc.access_link(session, user, user_id, send=data.send_email, request_meta=meta)


@router.post("/users/{user_id}/disable", response_model=OkOut, summary="The account can no longer sign in")
async def disable_user(user_id: uuid.UUID, user: CurrentUser, session: DB, meta: Meta) -> OkOut:
    await svc.set_user_active(session, user, user_id, active=False, request_meta=meta)
    return OkOut()


@router.post("/users/{user_id}/enable", response_model=OkOut)
async def enable_user(user_id: uuid.UUID, user: CurrentUser, session: DB, meta: Meta) -> OkOut:
    await svc.set_user_active(session, user, user_id, active=True, request_meta=meta)
    return OkOut()


# -------------------------------------------------------------------- plans
@router.get("/plans", response_model=list[PlanOut])
async def list_plans(user: CurrentUser, session: DB) -> list[PlanOut]:
    return await svc.list_plans(session, user)


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
async def create_plan(data: PlanIn, user: CurrentUser, session: DB, meta: Meta) -> PlanOut:
    return await svc.create_plan(session, user, data, meta)


@router.patch(
    "/plans/{plan_id}",
    response_model=PlanOut,
    summary="Applies at once to every workspace on the plan (their own limits still win)",
)
async def update_plan(plan_id: uuid.UUID, data: PlanUpdate, user: CurrentUser, session: DB, meta: Meta) -> PlanOut:
    return await svc.update_plan(session, user, plan_id, data, meta)
