"""Organizations and memberships."""

from __future__ import annotations

import copy
import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Conflict, Forbidden, NotFound
from ..core.ids import public_id
from ..domain.enums import Role, Sector
from ..domain.permissions import Permission, can_assign_role, can_manage_member
from ..models import Organization, OrganizationMember, User
from ..schemas.auth import MembershipOut
from ..schemas.organization import MemberAdd, MemberAddOut, MemberOut, OrganizationOut, OrganizationUpdate
from ..schemas.subscription import AccountMessageOut
from . import accounts, subscriptions
from .audit import audit

DEFAULT_ORG_SETTINGS: dict[str, Any] = {"ai": {"allow_cloud_ai": True, "followup_limit": 2}}


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:50]


async def unique_slug(session: AsyncSession, name: str) -> str:
    base = _slugify(name) or "org"
    for _ in range(20):
        candidate = f"{base}-{public_id(5)}"
        exists = await session.scalar(
            select(func.count()).select_from(Organization).where(Organization.slug == candidate)
        )
        if not exists:
            return candidate
    return f"org-{uuid.uuid4().hex[:12]}"


async def create_organization(
    session: AsyncSession,
    *,
    owner: User,
    name: str,
    sector: Sector = Sector.EDUCATION,
    locale: str = "ar",
    timezone: str = "Asia/Riyadh",
    is_demo: bool = False,
) -> Organization:
    org = Organization(
        name=name.strip(),
        slug=await unique_slug(session, name),
        sector=sector,
        locale=locale,
        timezone=timezone,
        settings=copy.deepcopy(DEFAULT_ORG_SETTINGS),
        is_demo=is_demo,
    )
    session.add(org)
    await session.flush()
    session.add(OrganizationMember(organization_id=org.id, user_id=owner.id, role=Role.OWNER))
    await session.flush()
    return org


async def memberships_for(session: AsyncSession, user_id: uuid.UUID) -> list[MembershipOut]:
    rows = (
        await session.execute(
            select(OrganizationMember.role, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == user_id)
            .order_by(Organization.is_demo.asc(), Organization.created_at.asc())
        )
    ).all()
    plans = await subscriptions.summaries(session, [org for _role, org in rows])
    return [
        MembershipOut(
            organization_id=org.id,
            organization_name=org.name,
            organization_slug=org.slug,
            role=role,
            is_demo=org.is_demo,
            subscription=plans.get(org.id),
        )
        for role, org in rows
    ]


async def list_organizations(session: AsyncSession, user: User) -> list[OrganizationOut]:
    rows = (
        await session.execute(
            select(Organization, OrganizationMember.role)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(OrganizationMember.user_id == user.id)
            .order_by(Organization.created_at)
        )
    ).all()
    return [OrganizationOut.model_validate(org).model_copy(update={"role": role}) for org, role in rows]


async def update_organization(session: AsyncSession, ctx: OrgContext, data: OrganizationUpdate) -> Organization:
    ctx.require(Permission.ORG_MANAGE)
    org = ctx.organization
    payload = data.model_dump(exclude_unset=True, exclude={"settings"})
    for key, value in payload.items():
        setattr(org, key, value)
    if data.settings is not None:
        settings = dict(org.settings or {})
        if data.settings.ai is not None:
            ai = dict(settings.get("ai", {}))
            ai.update(data.settings.ai.model_dump(exclude_none=True))
            settings["ai"] = ai
        org.settings = settings
    audit(
        session,
        action="organization.update",
        organization_id=org.id,
        actor_user_id=ctx.user_id,
        entity_type="organization",
        entity_id=org.id,
        meta={"fields": sorted(payload.keys())},
    )
    await session.commit()
    await session.refresh(org)
    return org


# ------------------------------------------------------------- members
def _member_out(ctx: OrgContext, member: OrganizationMember, user: User, *, workspaces: int) -> MemberOut:
    return MemberOut(
        id=member.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=member.role,
        created_at=member.created_at,
        last_login_at=user.last_login_at,
        pending=accounts.is_pending(user),
        links_allowed=(
            ctx.can(Permission.MEMBERS_MANAGE)
            and user.id != ctx.user_id
            and workspaces <= 1
            and user.is_active
            and not user.is_superuser
            and can_manage_member(ctx.role, member.role)
        ),
    )


async def list_members(session: AsyncSession, ctx: OrgContext) -> list[MemberOut]:
    ctx.require(Permission.MEMBERS_READ)
    rows = (
        await session.execute(
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == ctx.organization_id)
            .order_by(OrganizationMember.created_at)
        )
    ).all()
    workspaces = dict(
        (
            await session.execute(
                select(OrganizationMember.user_id, func.count())
                .where(OrganizationMember.user_id.in_([u.id for _m, u in rows]))
                .group_by(OrganizationMember.user_id)
            )
        ).all()
    )
    return [_member_out(ctx, m, u, workspaces=int(workspaces.get(u.id, 1))) for m, u in rows]


async def add_member(session: AsyncSession, ctx: OrgContext, data: MemberAdd) -> MemberAddOut:
    """Add a person to the workspace — creating their account if they have none (an invitation
    with a one-time activation link). Counts against the plan's members (SUBSCRIPTIONS.md §4)."""
    ctx.require(Permission.MEMBERS_MANAGE)
    if not can_assign_role(ctx.role, data.role):
        raise Forbidden("You cannot assign this role")
    email = str(data.email).strip().lower()
    existing_user = await accounts.find_user_by_email(session, email)
    if existing_user is not None:
        already = await session.scalar(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == ctx.organization_id,
                OrganizationMember.user_id == existing_user.id,
            )
        )
        if already is not None:
            raise Conflict("User is already a member", code="already_member")
    await subscriptions.ensure_member_slots(session, ctx.organization_id)
    provided = await accounts.provide_user(
        session, email=email, full_name=data.full_name, locale=ctx.organization.locale
    )
    user = provided.user
    member = OrganizationMember(
        organization_id=ctx.organization_id, user_id=user.id, role=data.role, invited_by_id=ctx.user_id
    )
    session.add(member)
    await session.flush()
    if provided.created:
        link, expires = await accounts.activation_link(session, user, actor_id=ctx.user_id)
    else:
        link, expires = accounts.login_link(), None
    message = accounts.invite_message(
        locale=user.locale,
        name=user.full_name,
        email=user.email,
        organization_name=ctx.organization.name,
        inviter=ctx.user.full_name,
        role=data.role,
        link=link,
        expires_at=expires,
    )
    audit(
        session,
        action="member.add",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="user",
        entity_id=user.id,
        meta={"role": data.role.value, "new_account": provided.created},
    )
    await session.commit()
    await session.refresh(member)
    delivered = await accounts.deliver(
        message, name=user.full_name, email=user.email, locale=user.locale, send=data.send_email
    )
    workspaces = await accounts.workspaces_of(session, user.id)
    return MemberAddOut(member=_member_out(ctx, member, user, workspaces=workspaces), message=delivered)


async def member_access_link(
    session: AsyncSession, ctx: OrgContext, member_id: uuid.UUID, *, send: bool
) -> AccountMessageOut:
    """A new activation link (never activated) or a recovery link (forgot the password) for a
    member — only for accounts that belong to this workspace alone; anything else is for the
    platform administrators, so no workspace can take over an account another one relies on."""
    ctx.require(Permission.MEMBERS_MANAGE)
    member = await _get_member(session, ctx, member_id)
    user = await session.get(User, member.user_id)
    assert user is not None
    if user.id == ctx.user_id:
        raise Conflict("Change your own password from your profile", code="cannot_link_self")
    if not can_manage_member(ctx.role, member.role) or user.is_superuser:
        raise Forbidden("You cannot manage this member")
    if not user.is_active:
        raise Conflict("This account is disabled", code="account_inactive")
    if await accounts.workspaces_of(session, user.id) > 1:
        raise Conflict(
            "This person also belongs to other workspaces: ask the platform administrators",
            code="member_in_other_workspaces",
        )
    message = await accounts.access_message(session, user, actor_id=ctx.user_id, timezone=ctx.organization.timezone)
    audit(
        session,
        action="member.access_link",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="user",
        entity_id=user.id,
        meta={"kind": message.kind},
    )
    await session.commit()
    return await accounts.deliver(message, name=user.full_name, email=user.email, locale=user.locale, send=send)


async def _get_member(session: AsyncSession, ctx: OrgContext, member_id: uuid.UUID) -> OrganizationMember:
    member = await session.scalar(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id, OrganizationMember.organization_id == ctx.organization_id
        )
    )
    if member is None:
        raise NotFound("Member not found")
    return member


async def _owner_count(session: AsyncSession, org_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == org_id, OrganizationMember.role == Role.OWNER)
        )
        or 0
    )


async def update_member_role(session: AsyncSession, ctx: OrgContext, member_id: uuid.UUID, role: Role) -> MemberOut:
    ctx.require(Permission.MEMBERS_MANAGE)
    member = await _get_member(session, ctx, member_id)
    if not can_manage_member(ctx.role, member.role) or not can_assign_role(ctx.role, role):
        raise Forbidden("You cannot change this member's role")
    if member.role == Role.OWNER and role != Role.OWNER and await _owner_count(session, ctx.organization_id) <= 1:
        raise Conflict("An organization must keep at least one owner", code="last_owner")
    old = member.role
    member.role = role
    audit(
        session,
        action="member.role_change",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="user",
        entity_id=member.user_id,
        meta={"from": old.value, "to": role.value},
    )
    await session.commit()
    user = await session.get(User, member.user_id)
    assert user is not None
    return _member_out(ctx, member, user, workspaces=await accounts.workspaces_of(session, user.id))


async def remove_member(session: AsyncSession, ctx: OrgContext, member_id: uuid.UUID) -> None:
    member = await _get_member(session, ctx, member_id)
    is_self = member.user_id == ctx.user_id
    if not is_self:
        ctx.require(Permission.MEMBERS_MANAGE)
        if not can_manage_member(ctx.role, member.role):
            raise Forbidden("You cannot remove this member")
    if member.role == Role.OWNER and await _owner_count(session, ctx.organization_id) <= 1:
        raise Conflict("An organization must keep at least one owner", code="last_owner")
    await session.delete(member)
    audit(
        session,
        action="member.remove",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="user",
        entity_id=member.user_id,
    )
    await session.commit()
