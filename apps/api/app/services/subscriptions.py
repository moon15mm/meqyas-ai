"""Subscriptions (SUBSCRIPTIONS.md): what a workspace may do, and the subscription lifecycle.

Every workspace has one subscription: a plan (limits and modules), optional limits of its own,
and a period. Its state is derived from the dates — trial, active, expired — except suspension,
which a platform administrator decides. The guards below sit where the platform spends something
(publishing, answers, seats, AI); limits are consumed atomically, so concurrent requests cannot
go over them.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from meqyas_ai.errors import AIError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.errors import Conflict, Forbidden, NotFound
from ..core.ids import uuid7
from ..domain.enums import Role, SubscriptionState
from ..domain.subscription import AGENT_FEATURES, DEFAULT_PLANS, LIMIT_KEYS, UNLIMITED_PLAN
from ..models import Organization, OrganizationMember, Subscription, SubscriptionPlan, UsageMonthly
from ..schemas.subscription import Limits, SubscriptionSummary, Usage

if TYPE_CHECKING:
    from ..api.deps import OrgContext

logger = logging.getLogger("meqyas.subscriptions")

#: «Ending soon» in the administrators' list.
ENDING_SOON = timedelta(days=14)


class AISubscriptionInactiveError(AIError):
    """The workspace's subscription ended or was suspended: no new AI work."""

    code = "ai_subscription_inactive"


class AIFeatureNotInPlanError(AIError):
    """The agent belongs to a module the workspace's plan does not include."""

    code = "ai_not_in_plan"


def _now() -> datetime:
    return datetime.now(UTC)


# -------------------------------------------------------------------- state
def state_of(sub: Subscription, plan: SubscriptionPlan, now: datetime) -> SubscriptionState:
    if sub.suspended_at is not None:
        return SubscriptionState.SUSPENDED
    if sub.period_started_at is None:
        return SubscriptionState.PENDING
    if sub.period_ends_at is not None and now >= sub.period_ends_at:
        return SubscriptionState.EXPIRED
    return SubscriptionState.TRIAL if plan.is_trial else SubscriptionState.ACTIVE


_PLAN_FIELD = {
    "surveys": "max_surveys",
    "responses_per_month": "max_responses_per_month",
    "members": "max_members",
    "ai_daily_tokens": "ai_daily_tokens",
}


@dataclass(slots=True)
class Entitlements:
    subscription: Subscription
    plan: SubscriptionPlan
    now: datetime

    @property
    def state(self) -> SubscriptionState:
        return state_of(self.subscription, self.plan, self.now)

    def limit(self, key: str) -> int | None:
        overrides = self.subscription.overrides or {}
        value = overrides[key] if key in overrides else getattr(self.plan, _PLAN_FIELD[key])
        if key == "ai_daily_tokens" and value is None:
            return get_settings().ai_daily_token_limit_per_org  # AI is never unlimited
        return value

    def limits(self) -> Limits:
        return Limits(**{key: self.limit(key) for key in LIMIT_KEYS})

    def has(self, feature: str) -> bool:
        return feature in (self.plan.features or [])

    @property
    def collection_ends_at(self) -> datetime | None:
        ends = self.subscription.period_ends_at
        return ends + timedelta(days=get_settings().subscription_grace_days) if ends else None

    @property
    def can_work(self) -> bool:
        """New work is allowed: publishing, AI, inviting members."""
        return self.state in (SubscriptionState.PENDING, SubscriptionState.TRIAL, SubscriptionState.ACTIVE)

    @property
    def can_collect(self) -> bool:
        """Published surveys accept answers: until the grace days after the period ends."""
        if self.subscription.suspended_at is not None:
            return False
        ends = self.collection_ends_at
        return ends is None or self.now < ends


# --------------------------------------------------------------------- time
def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def month_key(timezone: str | None, now: datetime) -> str:
    """The calendar month of ``now`` in the workspace's time zone: ``YYYY-MM``."""
    return now.astimezone(_zone(timezone)).strftime("%Y-%m")


def next_month_start(timezone: str | None, now: datetime) -> datetime:
    local = now.astimezone(_zone(timezone))
    year, month = (local.year + 1, 1) if local.month == 12 else (local.year, local.month + 1)
    return local.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)


# ------------------------------------------------------------------ loading
async def get_plan(session: AsyncSession, code: str) -> SubscriptionPlan:
    plan = await session.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == code))
    if plan is None:
        raise NotFound("Plan not found", code="plan_not_found")
    return plan


async def assignable_plan(session: AsyncSession, code: str) -> SubscriptionPlan:
    plan = await get_plan(session, code)
    if plan.is_archived:
        raise Conflict("This plan is archived and cannot be assigned", code="plan_archived")
    return plan


async def load(session: AsyncSession, organization_id: uuid.UUID, *, lock: bool = False) -> Entitlements:
    stmt = (
        select(Subscription, SubscriptionPlan)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
        .where(Subscription.organization_id == organization_id)
    )
    if lock:
        stmt = stmt.with_for_update(of=Subscription)
    row = (await session.execute(stmt)).first()
    if row is None:
        # Every workspace gets its subscription when it is created (and 0010 backfilled the
        # existing ones): this only repairs a workspace created outside the services.
        logger.warning("workspace %s had no subscription: the unlimited plan was assigned", organization_id)
        plan = await get_plan(session, UNLIMITED_PLAN)
        sub = Subscription(organization_id=organization_id, plan_id=plan.id, period_started_at=_now())
        session.add(sub)
        await session.flush()
        return Entitlements(sub, plan, _now())
    sub, plan = row
    return Entitlements(sub, plan, _now())


async def for_context(session: AsyncSession, ctx: OrgContext) -> Entitlements:
    """The request's entitlements (loaded with the tenant context, or now)."""
    if ctx.entitlements is None:
        ctx.entitlements = await load(session, ctx.organization_id)
    return ctx.entitlements


# ------------------------------------------------------------------- guards
def require_active(ent: Entitlements) -> None:
    state = ent.state
    if state == SubscriptionState.SUSPENDED:
        raise Forbidden("This workspace is suspended", code="organization_suspended")
    if state == SubscriptionState.EXPIRED:
        ends = ent.subscription.period_ends_at
        raise Conflict(
            "The subscription of this workspace has ended",
            code="subscription_ended",
            details={"ended_at": ends.isoformat() if ends else None},
        )


def require_feature(ent: Entitlements, feature: str) -> None:
    if not ent.has(feature):
        raise Forbidden(
            "This feature is not included in the workspace's plan",
            code="feature_not_in_plan",
            details={"feature": feature},
        )


async def consume_survey(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """A survey's first publication (new versions are free). Atomic: two simultaneous publishes
    cannot both take the last slot; rolled back with the publication if anything later fails."""
    ent = await load(session, organization_id)
    require_active(ent)
    limit = ent.limit("surveys")
    stmt = update(Subscription).where(Subscription.id == ent.subscription.id)
    if limit is not None:
        stmt = stmt.where(Subscription.surveys_used < limit)
    used = await session.scalar(
        stmt.values(surveys_used=Subscription.surveys_used + 1).returning(Subscription.surveys_used)
    )
    if used is None:
        raise Conflict(
            "This workspace has published all the surveys its plan includes",
            code="survey_limit_reached",
            details={"limit": limit},
        )


async def responses_this_month(session: AsyncSession, organization: Organization, now: datetime) -> int:
    value = await session.scalar(
        select(UsageMonthly.responses).where(
            UsageMonthly.organization_id == organization.id,
            UsageMonthly.month == month_key(organization.timezone, now),
        )
    )
    return int(value or 0)


async def accepting_responses(session: AsyncSession, organization: Organization) -> bool:
    """The workspace's published surveys accept answers: not suspended, within the period (plus
    the grace days) and under the monthly response limit."""
    ent = await load(session, organization.id)
    if not ent.can_collect:
        return False
    limit = ent.limit("responses_per_month")
    return limit is None or await responses_this_month(session, organization, ent.now) < limit


async def consume_response(session: AsyncSession, organization: Organization) -> None:
    """Count one answer against the month, atomically (part of the submission's transaction)."""
    ent = await load(session, organization.id)
    limit = ent.limit("responses_per_month")
    if not ent.can_collect or (limit is not None and limit <= 0):
        raise Conflict("This survey is not accepting responses", code="survey_closed")
    stmt = pg_insert(UsageMonthly).values(
        organization_id=organization.id, month=month_key(organization.timezone, ent.now), responses=1
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[UsageMonthly.organization_id, UsageMonthly.month],
        set_={"responses": UsageMonthly.responses + 1},
        where=(UsageMonthly.responses < limit) if limit is not None else None,
    )
    if await session.scalar(stmt.returning(UsageMonthly.responses)) is None:
        raise Conflict("This survey is not accepting responses", code="survey_closed")


async def member_count(session: AsyncSession, organization_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == organization_id)
        )
        or 0
    )


async def ensure_member_slots(session: AsyncSession, organization_id: uuid.UUID, adding: int = 1) -> None:
    """Room for ``adding`` more members (the subscription row is locked: concurrent invitations
    are counted one after the other)."""
    ent = await load(session, organization_id, lock=True)
    require_active(ent)
    limit = ent.limit("members")
    if limit is not None and await member_count(session, organization_id) + adding > limit:
        raise Conflict(
            "This workspace has all the members its plan includes",
            code="member_limit_reached",
            details={"limit": limit},
        )


async def ai_daily_limit(session: AsyncSession, organization: Organization, agent_name: str) -> int:
    """The workspace may run this agent now: its daily token budget (raises otherwise)."""
    ent = await load(session, organization.id)
    if not ent.can_work:
        raise AISubscriptionInactiveError("The subscription of this workspace is not active")
    feature = AGENT_FEATURES.get(agent_name)
    if feature is not None and not ent.has(feature):
        raise AIFeatureNotInPlanError(
            "This AI feature is not included in the workspace's plan", details={"feature": feature}
        )
    return ent.limit("ai_daily_tokens") or 0


async def feature_available(session: AsyncSession, organization_id: uuid.UUID, feature: str) -> bool:
    ent = await load(session, organization_id)
    return ent.can_work and ent.has(feature)


# ---------------------------------------------------------------- lifecycle
def clean_overrides(data: dict[str, Any] | None) -> dict[str, Any]:
    return {key: value for key, value in (data or {}).items() if key in LIMIT_KEYS}


def _start(sub: Subscription, now: datetime, days: int | None) -> None:
    sub.period_started_at = now
    sub.period_ends_at = now + timedelta(days=days) if days else None
    sub.pending_days = None


async def create(
    session: AsyncSession,
    organization: Organization,
    plan: SubscriptionPlan,
    *,
    days: int | None,
    start_now: bool,
    overrides: dict[str, Any] | None = None,
    admin_note: str = "",
    actor_id: uuid.UUID | None = None,
) -> Subscription:
    """The subscription of a new workspace. A new account's period waits for its activation."""
    sub = Subscription(
        organization_id=organization.id,
        plan_id=plan.id,
        overrides=clean_overrides(overrides),
        admin_note=admin_note,
        updated_by_id=actor_id,
    )
    if start_now:
        _start(sub, _now(), days)
    else:
        sub.pending_days = days
    session.add(sub)
    await session.flush()
    return sub


async def start_pending_for_owner(session: AsyncSession, user_id: uuid.UUID) -> None:
    """The owner signs in for the first time: periods waiting for the activation start now."""
    owned = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == user_id, OrganizationMember.role == Role.OWNER
    )
    subs = (
        await session.scalars(
            select(Subscription)
            .where(Subscription.organization_id.in_(owned), Subscription.period_started_at.is_(None))
            .with_for_update()
        )
    ).all()
    now = _now()
    for sub in subs:
        _start(sub, now, sub.pending_days)


def renew(sub: Subscription, days: int | None, now: datetime) -> None:
    """A new period: the days are added to what is left, and the survey counter starts again.
    A subscription still waiting for its owner's activation just gets the new length."""
    if sub.period_started_at is None:
        sub.pending_days = days
        sub.surveys_used = 0
        return
    running = sub.period_ends_at is not None and now < sub.period_ends_at
    base = sub.period_ends_at if running and sub.period_ends_at is not None else now
    sub.period_started_at = now
    sub.period_ends_at = base + timedelta(days=days) if days else None
    sub.surveys_used = 0
    sub.notices = {}


# ------------------------------------------------------------------ summary
def summary(ent: Entitlements, *, timezone: str, usage: Usage) -> SubscriptionSummary:
    sub, plan = ent.subscription, ent.plan
    return SubscriptionSummary(
        plan_code=plan.code,
        plan_name_ar=plan.name_ar,
        plan_name_en=plan.name_en,
        is_trial=plan.is_trial,
        state=ent.state,
        period_started_at=sub.period_started_at,
        period_ends_at=sub.period_ends_at,
        pending_days=sub.pending_days,
        collection_ends_at=ent.collection_ends_at,
        month_resets_at=next_month_start(timezone, ent.now),
        limits=ent.limits(),
        usage=usage,
        features=sorted(plan.features or []),
    )


async def summaries(session: AsyncSession, organizations: list[Organization]) -> dict[uuid.UUID, SubscriptionSummary]:
    """Summaries of many workspaces in a fixed number of queries (memberships, admin lists)."""
    if not organizations:
        return {}
    ids = [org.id for org in organizations]
    now = _now()
    pairs = {
        sub.organization_id: (sub, plan)
        for sub, plan in (
            await session.execute(
                select(Subscription, SubscriptionPlan)
                .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
                .where(Subscription.organization_id.in_(ids))
            )
        ).all()
    }
    members = {
        org_id: int(n)
        for org_id, n in (
            await session.execute(
                select(OrganizationMember.organization_id, func.count())
                .where(OrganizationMember.organization_id.in_(ids))
                .group_by(OrganizationMember.organization_id)
            )
        ).all()
    }
    months = {org.id: month_key(org.timezone, now) for org in organizations}
    responses = {
        org_id: int(n)
        for org_id, month, n in (
            await session.execute(
                select(UsageMonthly.organization_id, UsageMonthly.month, UsageMonthly.responses).where(
                    UsageMonthly.organization_id.in_(ids), UsageMonthly.month.in_(set(months.values()))
                )
            )
        ).all()
        if months.get(org_id) == month
    }
    out: dict[uuid.UUID, SubscriptionSummary] = {}
    for org in organizations:
        pair = pairs.get(org.id)
        ent = Entitlements(pair[0], pair[1], now) if pair else await load(session, org.id)
        out[org.id] = summary(
            ent,
            timezone=org.timezone,
            usage=Usage(
                surveys=ent.subscription.surveys_used,
                responses_this_month=responses.get(org.id, 0),
                members=members.get(org.id, 0),
            ),
        )
    return out


# -------------------------------------------------------------------- plans
async def ensure_default_plans(session: AsyncSession) -> None:
    """Insert the default plans that do not exist (never overwrites an administrator's edits)."""
    rows = [
        {
            "id": uuid7(),
            "code": p.code,
            "name_ar": p.name_ar,
            "name_en": p.name_en,
            "description_ar": p.description_ar,
            "description_en": p.description_en,
            "is_trial": p.is_trial,
            "default_days": p.default_days,
            "max_surveys": p.max_surveys,
            "max_responses_per_month": p.max_responses_per_month,
            "max_members": p.max_members,
            "ai_daily_tokens": p.ai_daily_tokens,
            "features": list(p.features),
            "sort_order": p.sort_order,
        }
        for p in DEFAULT_PLANS
    ]
    await session.execute(pg_insert(SubscriptionPlan).values(rows).on_conflict_do_nothing(index_elements=["code"]))
