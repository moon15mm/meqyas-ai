"""Subscription API models (SUBSCRIPTIONS.md): what a workspace sees of its plan, and what
platform administrators use to manage subscribers and plans."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import EmailStr, Field

from ..domain.enums import Role, Sector, SubscriptionState
from .common import APIModel, InputModel

Feature = Literal["cx", "integrations", "exports", "ai_analysis", "ai_followup"]


# ------------------------------------------------------------ workspace view
class Limits(APIModel):
    """Effective limits (plan, or the workspace's own); ``None`` = unlimited."""

    surveys: int | None = None
    responses_per_month: int | None = None
    members: int | None = None
    ai_daily_tokens: int | None = None


class Usage(APIModel):
    #: Surveys published for the first time in the current period.
    surveys: int = 0
    responses_this_month: int = 0
    members: int = 0


class SubscriptionSummary(APIModel):
    plan_code: str
    plan_name_ar: str
    plan_name_en: str
    is_trial: bool
    state: SubscriptionState
    period_started_at: datetime | None
    period_ends_at: datetime | None
    #: Length of the period that starts when the owner activates the account.
    pending_days: int | None = None
    #: Published surveys keep collecting answers until then (period end + grace days).
    collection_ends_at: datetime | None = None
    #: When the monthly response counter starts again (workspace time zone).
    month_resets_at: datetime
    limits: Limits
    usage: Usage
    features: list[str]


# ------------------------------------------------------------------- plans
class PlanOut(APIModel):
    id: uuid.UUID
    code: str
    name_ar: str
    name_en: str
    description_ar: str
    description_en: str
    is_trial: bool
    default_days: int | None
    max_surveys: int | None
    max_responses_per_month: int | None
    max_members: int | None
    ai_daily_tokens: int | None
    features: list[str]
    is_archived: bool
    sort_order: int
    #: Workspaces on this plan.
    subscribers: int = 0


class _PlanFields(InputModel):
    name_ar: str = Field(min_length=1, max_length=80)
    name_en: str = Field(min_length=1, max_length=80)
    description_ar: str = Field(default="", max_length=500)
    description_en: str = Field(default="", max_length=500)
    is_trial: bool = False
    default_days: int | None = Field(default=None, ge=1, le=3650)
    max_surveys: int | None = Field(default=None, ge=0, le=100_000)
    max_responses_per_month: int | None = Field(default=None, ge=0, le=10_000_000)
    max_members: int | None = Field(default=None, ge=1, le=10_000)
    ai_daily_tokens: int | None = Field(default=None, ge=0, le=100_000_000)
    features: list[Feature] = Field(default_factory=list)
    sort_order: int = Field(default=0, ge=0, le=1000)


class PlanIn(_PlanFields):
    code: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,39}$")


class PlanUpdate(InputModel):
    """Only the fields sent change; ``null`` on a limit means unlimited."""

    name_ar: str | None = Field(default=None, min_length=1, max_length=80)
    name_en: str | None = Field(default=None, min_length=1, max_length=80)
    description_ar: str | None = Field(default=None, max_length=500)
    description_en: str | None = Field(default=None, max_length=500)
    is_trial: bool | None = None
    default_days: int | None = Field(default=None, ge=1, le=3650)
    max_surveys: int | None = Field(default=None, ge=0, le=100_000)
    max_responses_per_month: int | None = Field(default=None, ge=0, le=10_000_000)
    max_members: int | None = Field(default=None, ge=1, le=10_000)
    ai_daily_tokens: int | None = Field(default=None, ge=0, le=100_000_000)
    features: list[Feature] | None = None
    is_archived: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)


# -------------------------------------------------------------- subscribers
class LimitOverrides(InputModel):
    """A workspace's own limits. Only the keys sent are overrides; ``null`` = unlimited."""

    surveys: int | None = Field(default=None, ge=0, le=100_000)
    responses_per_month: int | None = Field(default=None, ge=0, le=10_000_000)
    members: int | None = Field(default=None, ge=1, le=10_000)
    ai_daily_tokens: int | None = Field(default=None, ge=0, le=100_000_000)


class OwnerOut(APIModel):
    user_id: uuid.UUID
    full_name: str
    email: str
    last_login_at: datetime | None
    #: Invited but never signed in (the activation link was not used yet).
    pending: bool


class SubscriberItem(APIModel):
    organization_id: uuid.UUID
    organization_name: str
    sector: Sector
    locale: str
    is_demo: bool
    created_at: datetime
    owner: OwnerOut | None
    subscription: SubscriptionSummary
    #: The latest sign-in of any member.
    last_activity_at: datetime | None


class SubscriberStats(APIModel):
    total: int
    by_state: dict[str, int]
    #: Active or trial subscriptions that end within 14 days.
    ending_soon: int


class SubscriberPage(APIModel):
    items: list[SubscriberItem]
    total: int
    limit: int
    offset: int
    stats: SubscriberStats


class SubscriberMember(APIModel):
    member_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    email: str
    role: Role
    created_at: datetime
    last_login_at: datetime | None
    pending: bool
    is_active: bool
    is_platform_admin: bool
    #: Other workspaces this account belongs to.
    other_workspaces: int


class SubscriberEvent(APIModel):
    action: str
    created_at: datetime
    actor_name: str | None
    meta: dict[str, Any]


class SubscriberDetail(SubscriberItem):
    timezone: str
    suspended_at: datetime | None
    suspension_reason: str
    admin_note: str
    overrides: dict[str, Any]
    updated_at: datetime
    members: list[SubscriberMember]
    events: list[SubscriberEvent]


class AccountMessageOut(APIModel):
    """A message for one person, shown once: an activation link (new account), a recovery link,
    or a sign-in link (an account that already exists). The link is never stored or shown again."""

    recipient_name: str
    recipient_email: str
    locale: str
    kind: Literal["activation", "reset", "sign_in"]
    subject: str
    body: str
    link: str
    expires_at: datetime | None
    emailed: bool
    #: E-mail is configured on the server (otherwise the message must be shared by hand).
    email_available: bool


class SubscriberCreateIn(InputModel):
    owner_name: str = Field(min_length=2, max_length=200)
    owner_email: EmailStr
    #: Defaults to «مساحة <name>».
    organization_name: str = Field(default="", max_length=200)
    sector: Sector = Sector.OTHER
    locale: Literal["ar", "en"] = "ar"
    plan_code: str = Field(min_length=2, max_length=40)
    #: Length of the subscription (from activation for new accounts); ``null`` = no end date.
    days: int | None = Field(ge=1, le=3650)
    overrides: LimitOverrides | None = None
    admin_note: str = Field(default="", max_length=2000)
    send_email: bool = True


class SubscriberCreatedOut(APIModel):
    subscriber: SubscriberItem
    message: AccountMessageOut


class BulkRowIn(InputModel):
    name: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    organization_name: str = Field(default="", max_length=200)


class BulkCreateIn(InputModel):
    rows: list[BulkRowIn] = Field(min_length=1, max_length=200)
    plan_code: str = Field(min_length=2, max_length=40)
    days: int | None = Field(ge=1, le=3650)
    sector: Sector = Sector.OTHER
    locale: Literal["ar", "en"] = "ar"
    send_email: bool = True


RowStatus = Literal["created", "added", "error"]


class RowResult(APIModel):
    row: int
    name: str
    email: str
    #: created = new account · added = the person already had an account · error
    status: RowStatus
    error_code: str | None = None
    organization_id: uuid.UUID | None = None
    message: AccountMessageOut | None = None


class BulkResultOut(APIModel):
    results: list[RowResult]
    created: int
    added: int
    failed: int


class SubscriptionUpdateIn(InputModel):
    """Only the fields sent change. ``overrides`` replaces the workspace's own limits (``{}`` clears
    them); changing the plan clears them unless new ones are sent. ``period_ends_at: null`` = no end."""

    plan_code: str | None = Field(default=None, min_length=2, max_length=40)
    overrides: LimitOverrides | None = None
    period_ends_at: datetime | None = None
    admin_note: str | None = Field(default=None, max_length=2000)
    organization_name: str | None = Field(default=None, min_length=2, max_length=200)


class RenewIn(InputModel):
    #: A new period of this many days (added to what is left); ``null`` = no end date.
    days: int | None = Field(ge=1, le=3650)
    plan_code: str | None = Field(default=None, min_length=2, max_length=40)


class SuspendIn(InputModel):
    reason: str = Field(default="", max_length=300)


class AdminMemberRow(InputModel):
    name: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    role: Role = Role.VIEWER


class AdminMembersIn(InputModel):
    members: list[AdminMemberRow] = Field(min_length=1, max_length=200)
    send_email: bool = True


class SendEmailIn(InputModel):
    send_email: bool = False
