"""Subscription reminders (SUBSCRIPTIONS.md §6), e-mailed once a day by the worker to the owners
and administrators of a workspace: the period ends in 7 days / tomorrow, it ended, or the month's
responses reached 80% / 100% of the limit.

Each reminder is sent once (``subscriptions.notices`` keeps what was sent for this period or
month). Without SMTP nothing is sent — the banner inside the app says the same thing.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..domain.enums import Role
from ..models import Organization, OrganizationMember, Subscription, SubscriptionPlan, User
from .email import send_email
from .subscriptions import Entitlements, month_key, next_month_start, responses_this_month
from .wording import date_text, days_ar

logger = logging.getLogger("meqyas.subscriptions")


def _due(ent: Entitlements, now: datetime, used: int | None, month: str) -> list[tuple[str, str]]:
    sub = ent.subscription
    due: list[tuple[str, str]] = []
    ends = sub.period_ends_at
    if ends is not None:
        key = ends.date().isoformat()
        left = ends - now
        if timedelta(0) < left <= timedelta(days=1):
            due.append(("ends_1d", key))
        elif timedelta(days=1) < left <= timedelta(days=7):
            due.append(("ends_7d", key))
        elif left <= timedelta(0) and now - ends <= timedelta(days=2):
            due.append(("ended", key))
    limit = ent.limit("responses_per_month")
    if limit and used is not None:
        if used >= limit:
            due.append(("responses_100", month))
        elif used >= 0.8 * limit:
            due.append(("responses_80", month))
    sent = sub.notices or {}
    return [(kind, value) for kind, value in due if sent.get(kind) != value]


def _text(kind: str, org: Organization, ent: Entitlements, used: int, now: datetime) -> tuple[str, str]:
    ar = org.locale != "en"
    plan = ent.plan.name_ar if ar else ent.plan.name_en
    ends = ent.subscription.period_ends_at
    grace = get_settings().subscription_grace_days
    limit = ent.limit("responses_per_month") or 0
    reset = next_month_start(org.timezone, now)
    login = f"{get_settings().web_base_url.rstrip('/')}/login"
    if ar:
        stop = (
            "بعد انتهائه لا يمكن نشر استبانات جديدة ولا استخدام الذكاء الاصطناعي، "
            f"وتتوقف الاستبيانات المنشورة عن استقبال الردود بعد {days_ar(grace)}. نتائجك وبياناتك تبقى كما هي."
        )
        texts = {
            "ends_7d": (
                f"ينتهي اشتراك «{org.name}» خلال أسبوع",
                f"ينتهي اشتراك مساحة «{org.name}» في مِقياس AI (باقة {plan}) يوم {date_text(ends, 'ar') if ends else ''}. {stop}",
            ),
            "ends_1d": (
                f"ينتهي اشتراك «{org.name}» غدًا",
                f"ينتهي اشتراك مساحة «{org.name}» في مِقياس AI (باقة {plan}) يوم {date_text(ends, 'ar') if ends else ''}. {stop}",
            ),
            "ended": (
                f"انتهى اشتراك «{org.name}»",
                f"انتهى اشتراك مساحة «{org.name}» في مِقياس AI. لا يمكن الآن نشر استبانات جديدة ولا استخدام الذكاء "
                f"الاصطناعي، وتتوقف الاستبيانات المنشورة عن استقبال الردود بعد {days_ar(grace)}. نتائجك وبياناتك تبقى كما هي.",
            ),
            "responses_80": (
                f"اقتربت «{org.name}» من حد الردود لهذا الشهر",
                f"استقبلت مساحة «{org.name}» {used:,} من {limit:,} ردًا هذا الشهر. عند بلوغ الحد تتوقف الاستبيانات عن "
                f"استقبال الردود حتى {date_text(reset, 'ar')}.",
            ),
            "responses_100": (
                f"بلغت «{org.name}» حد الردود لهذا الشهر",
                f"استقبلت مساحة «{org.name}» {limit:,} ردًا هذا الشهر — الحد الذي تتضمنه باقتها. الاستبيانات لا تستقبل ردودًا "
                f"جديدة حتى {date_text(reset, 'ar')}.",
            ),
        }
        subject, body = texts[kind]
        return subject, "\n".join(
            ["مرحبًا،", "", body, "", "للتجديد أو رفع الحدود تواصل مع إدارة المنصة.", login, "", "فريق مِقياس AI"]
        )
    stop = (
        "After it ends, no new survey can be published and AI features stop; published surveys stop "
        f"collecting answers {grace} days later. Your results and data stay as they are."
    )
    texts = {
        "ends_7d": (
            f"The subscription of “{org.name}” ends in a week",
            f"The subscription of the “{org.name}” workspace ({plan} plan) ends on "
            f"{date_text(ends, 'en') if ends else ''}. {stop}",
        ),
        "ends_1d": (
            f"The subscription of “{org.name}” ends tomorrow",
            f"The subscription of the “{org.name}” workspace ({plan} plan) ends on "
            f"{date_text(ends, 'en') if ends else ''}. {stop}",
        ),
        "ended": (
            f"The subscription of “{org.name}” has ended",
            f"The subscription of the “{org.name}” workspace has ended. No new survey can be published and AI features "
            f"are stopped; published surveys stop collecting answers {grace} days later. Your results and data stay.",
        ),
        "responses_80": (
            f"“{org.name}” is close to this month's response limit",
            f"The “{org.name}” workspace received {used:,} of {limit:,} responses this month. At the limit, surveys "
            f"stop collecting answers until {date_text(reset, 'en')}.",
        ),
        "responses_100": (
            f"“{org.name}” reached this month's response limit",
            f"The “{org.name}” workspace received the {limit:,} responses its plan includes this month. Surveys "
            f"accept no new answers until {date_text(reset, 'en')}.",
        ),
    }
    subject, body = texts[kind]
    return subject, "\n".join(
        ["Hello,", "", body, "", "To renew or raise the limits, contact the platform team.", login, "", "MEQYAS AI"]
    )


async def send_notices(session: AsyncSession, now: datetime | None = None) -> int:
    """Send the reminders that are due; returns how many reminders went out."""
    if not get_settings().smtp_url:
        return 0
    now = now or datetime.now(UTC)
    rows = (
        await session.execute(
            select(Subscription, SubscriptionPlan, Organization)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .join(Organization, Organization.id == Subscription.organization_id)
            .where(
                Subscription.suspended_at.is_(None),
                Subscription.period_started_at.is_not(None),
                Organization.is_demo.is_(False),
            )
        )
    ).all()
    sent = 0
    for sub, plan, org in rows:
        ent = Entitlements(sub, plan, now)
        month = month_key(org.timezone, now)
        used = await responses_this_month(session, org, now) if ent.limit("responses_per_month") else None
        due = _due(ent, now, used, month)
        if not due:
            continue
        recipients = (
            await session.scalars(
                select(User)
                .join(OrganizationMember, OrganizationMember.user_id == User.id)
                .where(
                    OrganizationMember.organization_id == org.id,
                    OrganizationMember.role.in_([Role.OWNER, Role.ADMIN]),
                    User.is_active.is_(True),
                    User.last_login_at.is_not(None),
                )
            )
        ).all()
        notices = dict(sub.notices or {})
        for kind, value in due:
            subject, body = _text(kind, org, ent, used or 0, now)
            for user in recipients:
                try:
                    await send_email(user.email, subject, body)
                except Exception:
                    logger.warning("subscription reminder e-mail failed", exc_info=True)
            notices[kind] = value
            sent += 1
        sub.notices = notices
        await session.commit()
    return sent
