"""Subscriptions (SUBSCRIPTIONS.md): plans, the subscription of each workspace, and monthly usage.

The limits and the commercial state of a workspace live here, not on ``organizations``: a plan
sets the limits and the modules, a subscription may override limits, and its dates decide the
state (trial, active, expired) — except suspension, which is an administrator's decision.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, Timestamped, UUIDPk


class SubscriptionPlan(UUIDPk, Timestamped, Base):
    """A package (باقة). No foreign keys on purpose: plans are reference data."""

    __tablename__ = "subscription_plans"

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name_ar: Mapped[str] = mapped_column(String(80), nullable=False)
    name_en: Mapped[str] = mapped_column(String(80), nullable=False)
    description_ar: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    description_en: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    #: Trial workspaces are labelled as such (banner, list).
    is_trial: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    #: Suggested length when the plan is assigned; ``None`` = no end date.
    default_days: Mapped[int | None] = mapped_column(Integer)
    #: Surveys published (first publication) per subscription period; ``None`` = unlimited.
    max_surveys: Mapped[int | None] = mapped_column(Integer)
    max_responses_per_month: Mapped[int | None] = mapped_column(Integer)
    max_members: Mapped[int | None] = mapped_column(Integer)
    #: Daily AI token budget; ``None`` = the platform default (AI_DAILY_TOKEN_LIMIT_PER_ORG).
    ai_daily_tokens: Mapped[int | None] = mapped_column(Integer)
    #: Modules included (``domain.subscription.FEATURES``).
    features: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=text("'[]'::jsonb"))
    #: Archived plans keep their subscribers but cannot be assigned any more.
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class Subscription(UUIDPk, Timestamped, Base):
    __tablename__ = "subscriptions"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: ``None`` while the owner has not activated the account: the period starts on activation.
    period_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: ``None`` = no end date.
    period_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Length of the period that starts on activation (``None`` = no end date).
    pending_days: Mapped[int | None] = mapped_column(Integer)
    #: Surveys published for the first time in the current period (a renewal resets it).
    surveys_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    #: Limits that replace the plan's for this workspace: ``{"surveys": 5}``; ``null`` = unlimited.
    overrides: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspension_reason: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    #: Internal note for platform administrators (contract, contact person…).
    admin_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    #: Reminders already e-mailed for the current period / month (never twice).
    notices: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class UsageMonthly(Base):
    """Responses received by a workspace per calendar month (in its own time zone). An atomic
    counter, so the monthly limit holds under concurrent submissions."""

    __tablename__ = "usage_monthly"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    #: ``YYYY-MM``
    month: Mapped[str] = mapped_column(String(7), primary_key=True)
    responses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
