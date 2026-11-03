"""Subscribers (SUBSCRIPTIONS.md §5): what platform administrators use to run the platform's
customers — every workspace with its owner, plan, period and usage; creating subscribers one by
one or in bulk; changing plans and limits, renewing, suspending; adding members; preparing
activation or recovery links; and editing the plans themselves.

Every action is audited. Only ``users.is_superuser`` may call any of it (granted from the CLI).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..core.errors import Conflict, NotFound
from ..domain.enums import Role, SubscriptionState
from ..models import (
    AuditLog,
    Organization,
    OrganizationMember,
    RefreshToken,
    Subscription,
    SubscriptionPlan,
    User,
)
from ..schemas.subscription import (
    AccountMessageOut,
    AdminMembersIn,
    BulkCreateIn,
    BulkResultOut,
    OwnerOut,
    PlanIn,
    PlanOut,
    PlanUpdate,
    RenewIn,
    RowResult,
    SubscriberCreatedOut,
    SubscriberCreateIn,
    SubscriberDetail,
    SubscriberEvent,
    SubscriberItem,
    SubscriberMember,
    SubscriberPage,
    SubscriberStats,
    SubscriptionUpdateIn,
)
from . import accounts, subscriptions
from .accounts import require_platform_admin
from .audit import audit
from .organizations import create_organization

logger = logging.getLogger("meqyas.subscribers")

_EMAIL = TypeAdapter(EmailStr)

#: What the administrators see in a subscriber's history.
EVENT_PREFIXES = ("subscriber.", "subscription.", "member.", "gift.", "user.", "auth.activate", "survey.publish")


def _now() -> datetime:
    return datetime.now(UTC)


def _valid_email(value: str) -> str | None:
    try:
        return str(_EMAIL.validate_python(value.strip())).lower()
    except ValidationError:
        return None


# ------------------------------------------------------------------- items
async def _items(session: AsyncSession, orgs: list[Organization]) -> list[SubscriberItem]:
    if not orgs:
        return []
    ids = [org.id for org in orgs]
    plans = await subscriptions.summaries(session, orgs)
    owners: dict[uuid.UUID, User] = {}
    for org_id, user in (
        await session.execute(
            select(OrganizationMember.organization_id, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id.in_(ids), OrganizationMember.role == Role.OWNER)
            .order_by(OrganizationMember.created_at)
        )
    ).all():
        owners.setdefault(org_id, user)
    activity = dict(
        (
            await session.execute(
                select(OrganizationMember.organization_id, func.max(User.last_login_at))
                .join(User, User.id == OrganizationMember.user_id)
                .where(OrganizationMember.organization_id.in_(ids))
                .group_by(OrganizationMember.organization_id)
            )
        ).all()
    )
    return [
        SubscriberItem(
            organization_id=org.id,
            organization_name=org.name,
            sector=org.sector,
            locale=org.locale,
            is_demo=org.is_demo,
            created_at=org.created_at,
            owner=(
                OwnerOut(
                    user_id=owner.id,
                    full_name=owner.full_name,
                    email=owner.email,
                    last_login_at=owner.last_login_at,
                    pending=accounts.is_pending(owner),
                )
                if (owner := owners.get(org.id)) is not None
                else None
            ),
            subscription=plans[org.id],
            last_activity_at=activity.get(org.id),
        )
        for org in orgs
    ]


def _state_expr(now: datetime) -> Any:
    return case(
        (Subscription.suspended_at.is_not(None), SubscriptionState.SUSPENDED.value),
        (Subscription.period_started_at.is_(None), SubscriptionState.PENDING.value),
        (
            and_(Subscription.period_ends_at.is_not(None), Subscription.period_ends_at <= now),
            SubscriptionState.EXPIRED.value,
        ),
        (SubscriptionPlan.is_trial.is_(True), SubscriptionState.TRIAL.value),
        else_=SubscriptionState.ACTIVE.value,
    )


def _ending_soon(now: datetime) -> Any:
    return and_(
        Subscription.suspended_at.is_(None),
        Subscription.period_started_at.is_not(None),
        Subscription.period_ends_at > now,
        Subscription.period_ends_at <= now + subscriptions.ENDING_SOON,
    )


async def list_subscribers(
    session: AsyncSession,
    admin: User,
    *,
    q: str | None,
    state: str | None,
    plan: str | None,
    include_demo: bool,
    sort: str,
    limit: int,
    offset: int,
) -> SubscriberPage:
    require_platform_admin(admin)
    now = _now()
    state_expr = _state_expr(now)
    base = (
        select(Organization)
        .join(Subscription, Subscription.organization_id == Organization.id)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
    )
    scope = [] if include_demo else [Organization.is_demo.is_(False)]
    filters = list(scope)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        member_match = (
            select(OrganizationMember.id)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == Organization.id,
                or_(func.lower(User.email).like(term), func.lower(User.full_name).like(term)),
            )
            .exists()
        )
        filters.append(or_(func.lower(Organization.name).like(term), member_match))
    if state == "ENDING_SOON":
        filters.append(_ending_soon(now))
    elif state:
        filters.append(state_expr == state)
    if plan:
        filters.append(SubscriptionPlan.code == plan)
    order = {
        "name": [Organization.name.asc()],
        "ending": [Subscription.period_ends_at.asc().nulls_last(), Organization.created_at.desc()],
    }.get(sort, [Organization.created_at.desc()])
    total = int(await session.scalar(select(func.count()).select_from(base.where(*filters).subquery())) or 0)
    orgs = list((await session.scalars(base.where(*filters).order_by(*order).limit(limit).offset(offset))).all())

    counts = dict(
        (
            await session.execute(
                select(state_expr, func.count())
                .select_from(Organization)
                .join(Subscription, Subscription.organization_id == Organization.id)
                .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
                .where(*scope)
                .group_by(state_expr)
            )
        ).all()
    )
    ending = int(
        await session.scalar(
            select(func.count())
            .select_from(Organization)
            .join(Subscription, Subscription.organization_id == Organization.id)
            .where(*scope, _ending_soon(now))
        )
        or 0
    )
    return SubscriberPage(
        items=await _items(session, orgs),
        total=total,
        limit=limit,
        offset=offset,
        stats=SubscriberStats(
            total=sum(counts.values()), by_state={str(k): int(v) for k, v in counts.items()}, ending_soon=ending
        ),
    )


async def _org(session: AsyncSession, organization_id: uuid.UUID) -> Organization:
    org = await session.get(Organization, organization_id)
    if org is None:
        raise NotFound("Workspace not found")
    return org


async def get_subscriber(session: AsyncSession, admin: User, organization_id: uuid.UUID) -> SubscriberDetail:
    require_platform_admin(admin)
    org = await _org(session, organization_id)
    (item,) = await _items(session, [org])
    ent = await subscriptions.load(session, org.id)
    rows = (
        await session.execute(
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == org.id)
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
    members = [
        SubscriberMember(
            member_id=m.id,
            user_id=u.id,
            full_name=u.full_name,
            email=u.email,
            role=m.role,
            created_at=m.created_at,
            last_login_at=u.last_login_at,
            pending=accounts.is_pending(u),
            is_active=u.is_active,
            is_platform_admin=u.is_superuser,
            other_workspaces=max(0, int(workspaces.get(u.id, 1)) - 1),
        )
        for m, u in rows
    ]
    actor = aliased(User, name="actor")
    events = [
        SubscriberEvent(action=log.action, created_at=log.created_at, actor_name=actor_name, meta=log.meta or {})
        for log, actor_name in (
            await session.execute(
                select(AuditLog, actor.full_name)
                .outerjoin(actor, actor.id == AuditLog.actor_user_id)
                .where(
                    AuditLog.organization_id == org.id,
                    or_(*[AuditLog.action.startswith(prefix) for prefix in EVENT_PREFIXES]),
                )
                .order_by(AuditLog.created_at.desc())
                .limit(30)
            )
        ).all()
    ]
    sub = ent.subscription
    return SubscriberDetail(
        **item.model_dump(),
        timezone=org.timezone,
        suspended_at=sub.suspended_at,
        suspension_reason=sub.suspension_reason,
        admin_note=sub.admin_note,
        overrides=sub.overrides or {},
        updated_at=sub.updated_at,
        members=members,
        events=events,
    )


# ------------------------------------------------------------------ create
async def _create_one(
    session: AsyncSession,
    admin: User,
    *,
    name: str,
    email: str,
    organization_name: str,
    sector: Any,
    locale: str,
    plan: SubscriptionPlan,
    days: int | None,
    overrides: dict[str, Any] | None,
    admin_note: str,
    request_meta: dict[str, str | None] | None,
) -> tuple[Organization, accounts.Message, accounts.Provided]:
    provided = await accounts.provide_user(session, email=email, full_name=name, locale=locale)
    user = provided.user
    workspace = organization_name.strip() or accounts.default_workspace_name(user.full_name, locale)
    org = await create_organization(session, owner=user, name=workspace, sector=sector, locale=locale)
    await subscriptions.create(
        session,
        org,
        plan,
        days=days,
        start_now=not provided.created,
        overrides=overrides,
        admin_note=admin_note,
        actor_id=admin.id,
    )
    if provided.created:
        link, expires = await accounts.activation_link(session, user, actor_id=admin.id)
    else:
        link, expires = accounts.login_link(), None
    ent = await subscriptions.load(session, org.id)
    message = accounts.subscriber_message(
        locale=locale,
        name=user.full_name,
        email=user.email,
        organization_name=org.name,
        plan=plan,
        limits=ent.limits(),
        days=days,
        link=link,
        expires_at=expires,
    )
    audit(
        session,
        action="subscriber.create",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="organization",
        entity_id=org.id,
        meta={"plan": plan.code, "days": days, "new_account": provided.created},
        request_meta=request_meta,
    )
    return org, message, provided


async def create_subscriber(
    session: AsyncSession, admin: User, data: SubscriberCreateIn, request_meta: dict[str, str | None]
) -> SubscriberCreatedOut:
    require_platform_admin(admin)
    plan = await subscriptions.assignable_plan(session, data.plan_code)
    org, message, provided = await _create_one(
        session,
        admin,
        name=data.owner_name.strip(),
        email=str(data.owner_email),
        organization_name=data.organization_name,
        sector=data.sector,
        locale=data.locale,
        plan=plan,
        days=data.days,
        overrides=data.overrides.model_dump(exclude_unset=True) if data.overrides else None,
        admin_note=data.admin_note.strip(),
        request_meta=request_meta,
    )
    await session.commit()
    user = provided.user
    delivered = await accounts.deliver(
        message, name=user.full_name, email=user.email, locale=data.locale, send=data.send_email
    )
    (item,) = await _items(session, [org])
    return SubscriberCreatedOut(subscriber=item, message=delivered)


async def bulk_create(
    session: AsyncSession, admin: User, data: BulkCreateIn, request_meta: dict[str, str | None]
) -> BulkResultOut:
    """One workspace per row (e.g. the schools of a district), each committed on its own: a bad
    row does not stop the others."""
    require_platform_admin(admin)
    plan = await subscriptions.assignable_plan(session, data.plan_code)
    results: list[RowResult] = []
    seen: set[str] = set()
    for index, row in enumerate(data.rows, start=1):
        name, raw_email = row.name.strip(), row.email.strip()
        email = _valid_email(raw_email)
        if email is None:
            results.append(RowResult(row=index, name=name, email=raw_email, status="error", error_code="invalid_email"))
            continue
        if email in seen:
            results.append(RowResult(row=index, name=name, email=email, status="error", error_code="duplicate_row"))
            continue
        seen.add(email)
        if len(name) < 2:
            name = email.split("@", 1)[0]
        try:
            org, message, provided = await _create_one(
                session,
                admin,
                name=name,
                email=email,
                organization_name=row.organization_name,
                sector=data.sector,
                locale=data.locale,
                plan=plan,
                days=data.days,
                overrides=None,
                admin_note="",
                request_meta=request_meta,
            )
            await session.commit()
        except Conflict as exc:
            await session.rollback()
            results.append(RowResult(row=index, name=name, email=email, status="error", error_code=exc.code))
            continue
        user = provided.user
        delivered = await accounts.deliver(
            message, name=user.full_name, email=user.email, locale=data.locale, send=data.send_email
        )
        results.append(
            RowResult(
                row=index,
                name=user.full_name,
                email=user.email,
                status="created" if provided.created else "added",
                organization_id=org.id,
                message=delivered,
            )
        )
    audit(
        session,
        action="subscriber.bulk_create",
        actor_user_id=admin.id,
        meta={"rows": len(data.rows), "plan": plan.code, "failed": sum(r.status == "error" for r in results)},
        request_meta=request_meta,
    )
    await session.commit()
    return _bulk_out(results)


def _bulk_out(results: list[RowResult]) -> BulkResultOut:
    return BulkResultOut(
        results=results,
        created=sum(r.status == "created" for r in results),
        added=sum(r.status == "added" for r in results),
        failed=sum(r.status == "error" for r in results),
    )


# ------------------------------------------------------------ subscription
async def update_subscription(
    session: AsyncSession,
    admin: User,
    organization_id: uuid.UUID,
    data: SubscriptionUpdateIn,
    request_meta: dict[str, str | None],
) -> SubscriberDetail:
    require_platform_admin(admin)
    org = await _org(session, organization_id)
    ent = await subscriptions.load(session, org.id, lock=True)
    sub = ent.subscription
    sent = data.model_dump(exclude_unset=True)
    changed: dict[str, Any] = {}
    if data.plan_code is not None and data.plan_code != ent.plan.code:
        plan = await subscriptions.assignable_plan(session, data.plan_code)
        changed["plan"] = {"from": ent.plan.code, "to": plan.code}
        sub.plan_id = plan.id
        if "overrides" not in sent:
            sub.overrides = {}  # the workspace's own limits belonged to the previous plan
    if "overrides" in sent:
        sub.overrides = subscriptions.clean_overrides(
            data.overrides.model_dump(exclude_unset=True) if data.overrides is not None else {}
        )
        changed["overrides"] = sub.overrides
    if "period_ends_at" in sent:
        sub.period_ends_at = data.period_ends_at
        if sub.period_started_at is not None and data.period_ends_at is not None:
            sub.notices = {}
        changed["period_ends_at"] = data.period_ends_at.isoformat() if data.period_ends_at else None
    if data.admin_note is not None:
        sub.admin_note = data.admin_note.strip()
        changed["admin_note"] = True
    if data.organization_name is not None:
        org.name = data.organization_name.strip()
        changed["organization_name"] = True
    sub.updated_by_id = admin.id
    audit(
        session,
        action="subscription.update",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="organization",
        entity_id=org.id,
        meta={k: v for k, v in changed.items() if k != "admin_note"}
        | ({"note": True} if "admin_note" in changed else {}),
        request_meta=request_meta,
    )
    await session.commit()
    return await get_subscriber(session, admin, org.id)


async def renew(
    session: AsyncSession, admin: User, organization_id: uuid.UUID, data: RenewIn, request_meta: dict[str, str | None]
) -> SubscriberDetail:
    require_platform_admin(admin)
    org = await _org(session, organization_id)
    ent = await subscriptions.load(session, org.id, lock=True)
    sub = ent.subscription
    meta: dict[str, Any] = {"days": data.days}
    if data.plan_code is not None and data.plan_code != ent.plan.code:
        plan = await subscriptions.assignable_plan(session, data.plan_code)
        meta["plan"] = {"from": ent.plan.code, "to": plan.code}
        sub.plan_id = plan.id
        sub.overrides = {}
    subscriptions.renew(sub, data.days, _now())
    sub.updated_by_id = admin.id
    audit(
        session,
        action="subscription.renew",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="organization",
        entity_id=org.id,
        meta=meta,
        request_meta=request_meta,
    )
    await session.commit()
    return await get_subscriber(session, admin, org.id)


async def set_suspended(
    session: AsyncSession,
    admin: User,
    organization_id: uuid.UUID,
    *,
    suspended: bool,
    reason: str = "",
    request_meta: dict[str, str | None],
) -> SubscriberDetail:
    """Suspension closes the workspace (sign-in still works for other workspaces): its members
    cannot open it, its surveys stop collecting and store orders are ignored. Nothing is deleted;
    reactivating restores everything."""
    require_platform_admin(admin)
    org = await _org(session, organization_id)
    if org.is_demo:
        raise Conflict("The demo workspace cannot be suspended", code="demo_workspace")
    ent = await subscriptions.load(session, org.id, lock=True)
    sub = ent.subscription
    if suspended:
        sub.suspended_at = sub.suspended_at or _now()
        sub.suspension_reason = reason.strip()
    else:
        sub.suspended_at = None
        sub.suspension_reason = ""
    sub.updated_by_id = admin.id
    audit(
        session,
        action="subscription.suspend" if suspended else "subscription.reactivate",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="organization",
        entity_id=org.id,
        request_meta=request_meta,
    )
    await session.commit()
    return await get_subscriber(session, admin, org.id)


# ----------------------------------------------------------------- members
async def add_members(
    session: AsyncSession,
    admin: User,
    organization_id: uuid.UUID,
    data: AdminMembersIn,
    request_meta: dict[str, str | None],
) -> BulkResultOut:
    """Add people to a workspace (creating the accounts they do not have) — within the plan's
    members; each row is committed on its own."""
    require_platform_admin(admin)
    org = await _org(session, organization_id)
    results: list[RowResult] = []
    seen: set[str] = set()
    for index, row in enumerate(data.members, start=1):
        name, raw_email = row.name.strip(), row.email.strip()
        email = _valid_email(raw_email)
        if email is None:
            results.append(RowResult(row=index, name=name, email=raw_email, status="error", error_code="invalid_email"))
            continue
        if email in seen:
            results.append(RowResult(row=index, name=name, email=email, status="error", error_code="duplicate_row"))
            continue
        seen.add(email)
        try:
            existing = await accounts.find_user_by_email(session, email)
            if existing is not None and await session.scalar(
                select(OrganizationMember.id).where(
                    OrganizationMember.organization_id == org.id, OrganizationMember.user_id == existing.id
                )
            ):
                raise Conflict("Already a member", code="already_member")
            await subscriptions.ensure_member_slots(session, org.id)
            provided = await accounts.provide_user(session, email=email, full_name=name, locale=org.locale)
            user = provided.user
            session.add(
                OrganizationMember(organization_id=org.id, user_id=user.id, role=row.role, invited_by_id=admin.id)
            )
            await session.flush()
            if provided.created:
                link, expires = await accounts.activation_link(session, user, actor_id=admin.id)
            else:
                link, expires = accounts.login_link(), None
            message = accounts.invite_message(
                locale=user.locale,
                name=user.full_name,
                email=user.email,
                organization_name=org.name,
                inviter=admin.full_name,
                role=row.role,
                link=link,
                expires_at=expires,
            )
            audit(
                session,
                action="member.add",
                organization_id=org.id,
                actor_user_id=admin.id,
                entity_type="user",
                entity_id=user.id,
                meta={"role": row.role.value, "new_account": provided.created, "by": "platform_admin"},
                request_meta=request_meta,
            )
            await session.commit()
        except Conflict as exc:
            await session.rollback()
            results.append(RowResult(row=index, name=name, email=email, status="error", error_code=exc.code))
            continue
        delivered = await accounts.deliver(
            message, name=user.full_name, email=user.email, locale=user.locale, send=data.send_email
        )
        results.append(
            RowResult(
                row=index,
                name=user.full_name,
                email=user.email,
                status="created" if provided.created else "added",
                organization_id=org.id,
                message=delivered,
            )
        )
    return _bulk_out(results)


async def remove_member(
    session: AsyncSession,
    admin: User,
    organization_id: uuid.UUID,
    member_id: uuid.UUID,
    request_meta: dict[str, str | None],
) -> SubscriberDetail:
    require_platform_admin(admin)
    member = await session.scalar(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id, OrganizationMember.organization_id == organization_id
        )
    )
    if member is None:
        raise NotFound("Member not found")
    if member.role == Role.OWNER:
        owners = await session.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == organization_id, OrganizationMember.role == Role.OWNER)
        )
        if (owners or 0) <= 1:
            raise Conflict("A workspace must keep at least one owner", code="last_owner")
    await session.delete(member)
    audit(
        session,
        action="member.remove",
        organization_id=organization_id,
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=member.user_id,
        meta={"by": "platform_admin"},
        request_meta=request_meta,
    )
    await session.commit()
    return await get_subscriber(session, admin, organization_id)


# ------------------------------------------------------------------- users
async def _user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("Account not found")
    return user


async def access_link(
    session: AsyncSession, admin: User, user_id: uuid.UUID, *, send: bool, request_meta: dict[str, str | None]
) -> AccountMessageOut:
    """A new activation link (never activated) or a recovery link (forgot the password)."""
    require_platform_admin(admin)
    user = await _user(session, user_id)
    if not user.is_active:
        raise Conflict("This account is disabled", code="account_inactive")
    message = await accounts.access_message(session, user, actor_id=admin.id, timezone=None)
    audit(
        session,
        action="user.access_link",
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=user.id,
        meta={"kind": message.kind},
        request_meta=request_meta,
    )
    await session.commit()
    return await accounts.deliver(message, name=user.full_name, email=user.email, locale=user.locale, send=send)


async def set_user_active(
    session: AsyncSession, admin: User, user_id: uuid.UUID, *, active: bool, request_meta: dict[str, str | None]
) -> None:
    """A disabled account cannot sign in anywhere (its sessions end at once); its data stays."""
    require_platform_admin(admin)
    user = await _user(session, user_id)
    if user.id == admin.id:
        raise Conflict("You cannot disable your own account", code="cannot_disable_self")
    if user.is_superuser and not active:
        raise Conflict("Revoke the platform administrator role first (CLI)", code="cannot_disable_platform_admin")
    user.is_active = active
    if not active:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=_now())
        )
    audit(
        session,
        action="user.enable" if active else "user.disable",
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=user.id,
        request_meta=request_meta,
    )
    await session.commit()


# ------------------------------------------------------------------- plans
async def list_plans(session: AsyncSession, admin: User) -> list[PlanOut]:
    require_platform_admin(admin)
    counts = dict(
        (await session.execute(select(Subscription.plan_id, func.count()).group_by(Subscription.plan_id))).all()
    )
    plans = (
        await session.scalars(select(SubscriptionPlan).order_by(SubscriptionPlan.sort_order, SubscriptionPlan.code))
    ).all()
    return [PlanOut.model_validate(p).model_copy(update={"subscribers": int(counts.get(p.id, 0))}) for p in plans]


async def create_plan(session: AsyncSession, admin: User, data: PlanIn, request_meta: dict[str, str | None]) -> PlanOut:
    require_platform_admin(admin)
    if await session.scalar(select(SubscriptionPlan.id).where(SubscriptionPlan.code == data.code)):
        raise Conflict("A plan with this code exists", code="plan_code_taken")
    values = data.model_dump()
    values["features"] = sorted(set(values["features"]))
    plan = SubscriptionPlan(**values)
    session.add(plan)
    await session.flush()
    audit(
        session,
        action="plan.create",
        actor_user_id=admin.id,
        entity_type="subscription_plan",
        entity_id=plan.id,
        meta={"code": plan.code},
        request_meta=request_meta,
    )
    await session.commit()
    return PlanOut.model_validate(plan)


async def update_plan(
    session: AsyncSession, admin: User, plan_id: uuid.UUID, data: PlanUpdate, request_meta: dict[str, str | None]
) -> PlanOut:
    """Changes apply at once to every workspace on the plan (their own limits still win)."""
    require_platform_admin(admin)
    plan = await session.get(SubscriptionPlan, plan_id)
    if plan is None:
        raise NotFound("Plan not found", code="plan_not_found")
    values = data.model_dump(exclude_unset=True)
    for required in ("name_ar", "name_en", "is_trial", "is_archived", "sort_order", "features"):
        if required in values and values[required] is None:
            values.pop(required)
    if "features" in values:
        values["features"] = sorted(set(values["features"]))
    for key, value in values.items():
        setattr(plan, key, value)
    audit(
        session,
        action="plan.update",
        actor_user_id=admin.id,
        entity_type="subscription_plan",
        entity_id=plan.id,
        meta={"code": plan.code, "fields": sorted(values)},
        request_meta=request_meta,
    )
    await session.commit()
    count = await session.scalar(select(func.count()).select_from(Subscription).where(Subscription.plan_id == plan.id))
    return PlanOut.model_validate(plan).model_copy(update={"subscribers": int(count or 0)})
