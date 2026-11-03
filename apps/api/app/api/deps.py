"""Request dependencies: DB session, authentication, tenant context and RBAC."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.errors import Forbidden, NotFound, Unauthorized
from ..core.security import decode_access_token
from ..db.session import get_session
from ..domain.enums import Role
from ..domain.permissions import Permission, has_permission
from ..models import Organization, OrganizationMember, Subscription, SubscriptionPlan, User
from ..services import subscriptions

DB = Annotated[AsyncSession, Depends(get_session)]

_bearer = HTTPBearer(auto_error=False, description="Access token from /auth/login or /auth/refresh")


@dataclass(slots=True)
class OrgContext:
    user: User
    organization: Organization
    role: Role
    #: The workspace's plan and subscription (loaded with the context; SUBSCRIPTIONS.md).
    entitlements: subscriptions.Entitlements | None = None

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def organization_id(self) -> uuid.UUID:
        return self.organization.id

    def can(self, permission: Permission) -> bool:
        return has_permission(self.role, permission)

    def require(self, permission: Permission) -> None:
        if not self.can(permission):
            raise Forbidden(f"Your role ({self.role.value}) does not allow '{permission.value}'")


async def get_current_user(
    session: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise Unauthorized("Missing bearer token")
    claims = decode_access_token(credentials.credentials)
    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise Unauthorized("Invalid token subject") from exc
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise Unauthorized("User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def current_session_family(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> uuid.UUID | None:
    """The sign-in session (refresh-token family) of this access token."""
    if credentials is None:
        return None
    try:
        return uuid.UUID(str(decode_access_token(credentials.credentials).get("sid", "")))
    except (ValueError, Unauthorized):
        return None


SessionFamily = Annotated[uuid.UUID | None, Depends(current_session_family)]


async def get_org_context(
    session: DB,
    user: CurrentUser,
    x_organization_id: Annotated[str | None, Header(alias="X-Organization-Id")] = None,
) -> OrgContext:
    if not x_organization_id:
        raise Forbidden("X-Organization-Id header is required", code="organization_required")
    try:
        org_id = uuid.UUID(x_organization_id)
    except ValueError as exc:
        raise NotFound("Organization not found") from exc
    row = (
        await session.execute(
            select(OrganizationMember, Organization, Subscription, SubscriptionPlan)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .outerjoin(Subscription, Subscription.organization_id == Organization.id)
            .outerjoin(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .where(OrganizationMember.organization_id == org_id, OrganizationMember.user_id == user.id)
        )
    ).first()
    if row is None:
        # Non-members cannot learn whether the organization exists.
        raise NotFound("Organization not found")
    member, org, sub, plan = row
    if sub is not None and plan is not None:
        entitlements = subscriptions.Entitlements(sub, plan, datetime.now(UTC))
    else:
        entitlements = await subscriptions.load(session, org.id)
    if entitlements.subscription.suspended_at is not None:
        raise Forbidden("This workspace is suspended", code="organization_suspended")
    return OrgContext(user=user, organization=org, role=member.role, entitlements=entitlements)


Ctx = Annotated[OrgContext, Depends(get_org_context)]


def feature(name: str) -> Callable[..., Coroutine[Any, Any, OrgContext]]:
    """Endpoints of a module the workspace's plan must include (SUBSCRIPTIONS.md §3)."""

    async def _dep(ctx: Ctx, session: DB) -> OrgContext:
        subscriptions.require_feature(await subscriptions.for_context(session, ctx), name)
        return ctx

    return _dep


def require(permission: Permission) -> Callable[..., Coroutine[Any, Any, OrgContext]]:
    async def _dep(ctx: Ctx) -> OrgContext:
        ctx.require(permission)
        return ctx

    return _dep


def request_meta(request: Request) -> dict[str, str | None]:
    from ..core.rate_limit import client_ip

    origin = request.headers.get("origin")
    if not origin:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
        if host:
            origin = f"{proto}://{host}"

    return {
        "ip": client_ip(request),
        "user_agent": (request.headers.get("user-agent") or "")[:300],
        "base_url": origin,
    }
