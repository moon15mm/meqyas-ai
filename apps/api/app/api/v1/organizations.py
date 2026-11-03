from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from ...core.errors import NotFound
from ...core.rate_limit import enforce
from ...schemas.common import OkOut
from ...schemas.organization import (
    MemberAdd,
    MemberAddOut,
    MemberOut,
    MemberUpdate,
    OrganizationOut,
    OrganizationUpdate,
)
from ...schemas.subscription import AccountMessageOut, SendEmailIn
from ...services import organizations as org_service
from ..deps import DB, Ctx, CurrentUser

router = APIRouter(prefix="/organizations", tags=["organizations"])


def _check_path(ctx_org_id: uuid.UUID, path_id: uuid.UUID) -> None:
    # The path id must match the active organization header (no cross-tenant tricks).
    if ctx_org_id != path_id:
        raise NotFound("Organization not found")


@router.get("", response_model=list[OrganizationOut])
async def list_my_organizations(user: CurrentUser, session: DB) -> list[OrganizationOut]:
    return await org_service.list_organizations(session, user)


@router.get("/{organization_id}", response_model=OrganizationOut)
async def get_organization(organization_id: uuid.UUID, ctx: Ctx) -> OrganizationOut:
    _check_path(ctx.organization_id, organization_id)
    return OrganizationOut.model_validate(ctx.organization).model_copy(update={"role": ctx.role})


@router.patch("/{organization_id}", response_model=OrganizationOut)
async def update_organization(
    organization_id: uuid.UUID, data: OrganizationUpdate, ctx: Ctx, session: DB
) -> OrganizationOut:
    _check_path(ctx.organization_id, organization_id)
    org = await org_service.update_organization(session, ctx, data)
    return OrganizationOut.model_validate(org).model_copy(update={"role": ctx.role})


@router.get("/{organization_id}/members", response_model=list[MemberOut])
async def list_members(organization_id: uuid.UUID, ctx: Ctx, session: DB) -> list[MemberOut]:
    _check_path(ctx.organization_id, organization_id)
    return await org_service.list_members(session, ctx)


@router.post(
    "/{organization_id}/members",
    response_model=MemberAddOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a person (a new account gets an invitation with a one-time activation link)",
)
async def add_member(organization_id: uuid.UUID, data: MemberAdd, ctx: Ctx, session: DB) -> MemberAddOut:
    _check_path(ctx.organization_id, organization_id)
    await enforce(f"member-add:{ctx.user_id}", limit=30, window_s=60)
    return await org_service.add_member(session, ctx, data)


@router.post(
    "/{organization_id}/members/{member_id}/access-link",
    response_model=AccountMessageOut,
    summary="A new activation link or a password recovery link (accounts of this workspace only)",
)
async def member_access_link(
    organization_id: uuid.UUID, member_id: uuid.UUID, data: SendEmailIn, ctx: Ctx, session: DB
) -> AccountMessageOut:
    _check_path(ctx.organization_id, organization_id)
    await enforce(f"member-link:{ctx.user_id}", limit=20, window_s=60)
    return await org_service.member_access_link(session, ctx, member_id, send=data.send_email)


@router.patch("/{organization_id}/members/{member_id}", response_model=MemberOut)
async def update_member(
    organization_id: uuid.UUID, member_id: uuid.UUID, data: MemberUpdate, ctx: Ctx, session: DB
) -> MemberOut:
    _check_path(ctx.organization_id, organization_id)
    return await org_service.update_member_role(session, ctx, member_id, data.role)


@router.delete("/{organization_id}/members/{member_id}", response_model=OkOut)
async def remove_member(organization_id: uuid.UUID, member_id: uuid.UUID, ctx: Ctx, session: DB) -> OkOut:
    _check_path(ctx.organization_id, organization_id)
    await org_service.remove_member(session, ctx, member_id)
    return OkOut()
