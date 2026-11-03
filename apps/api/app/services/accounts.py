"""Accounts (SUBSCRIPTIONS.md §4): people get an account from a platform administrator (a new
subscriber, a member added to a workspace, a gift) or from a workspace's administrators (an
invitation) — there is no self-registration.

A new account has no usable password: the person chooses one from a one-time activation link.
The messages prepared here carry the link and are returned once (shown to whoever prepared them,
to share by WhatsApp or any channel) and e-mailed when SMTP is configured. No password ever
travels in a message, and links are stored only as hashes.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.errors import Conflict, Forbidden
from ..core.security import hash_password, hash_token, new_opaque_token
from ..domain.enums import Role, TokenPurpose
from ..models import Organization, OrganizationMember, PasswordResetToken, SubscriptionPlan, User
from ..schemas.subscription import AccountMessageOut, Limits
from .email import send_email
from .wording import (
    START_STEPS_AR,
    START_STEPS_EN,
    date_text,
    datetime_text,
    days_ar,
    members_ar,
    plural_en,
    responses_ar,
    surveys_ar,
)

logger = logging.getLogger("meqyas.accounts")

ROLE_AR = {Role.OWNER: "مالك", Role.ADMIN: "مدير", Role.EDITOR: "محرر", Role.ANALYST: "محلل", Role.VIEWER: "مشاهد"}
ROLE_EN = {
    Role.OWNER: "Owner",
    Role.ADMIN: "Admin",
    Role.EDITOR: "Editor",
    Role.ANALYST: "Analyst",
    Role.VIEWER: "Viewer",
}
SIGNATURE_AR = ["مع التحية،", "فريق مِقياس AI"]
SIGNATURE_EN = ["Best regards,", "The MEQYAS AI team"]


async def find_user_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


async def issue_password_link(
    session: AsyncSession,
    user: User,
    purpose: TokenPurpose,
    *,
    ttl: timedelta,
    actor_id: uuid.UUID | None = None,
) -> tuple[str, datetime]:
    """A one-time link token (only its hash is stored). Earlier unused links of the same purpose
    stop working: there is never more than one valid link per person and purpose."""
    now = datetime.now(UTC)
    await session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.purpose == purpose,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    raw = new_opaque_token()
    expires = now + ttl
    session.add(
        PasswordResetToken(
            user_id=user.id, token_hash=hash_token(raw), expires_at=expires, purpose=purpose, created_by_id=actor_id
        )
    )
    return raw, expires


def reset_url(raw: str) -> str:
    return f"{get_settings().web_base_url.rstrip('/')}/reset-password?token={raw}"


def activation_url(raw: str) -> str:
    return f"{get_settings().web_base_url.rstrip('/')}/activate/{raw}"


def require_platform_admin(user: User) -> None:
    if not user.is_superuser:
        raise Forbidden("Only platform administrators can do this", code="platform_admin_only")


def is_pending(user: User) -> bool:
    """Created for the person, who has not signed in yet (the activation link is unused)."""
    return user.last_login_at is None


def default_workspace_name(name: str, locale: str) -> str:
    return f"مساحة {name}" if locale == "ar" else f"{name}'s workspace"


# ----------------------------------------------------------------- accounts
@dataclass(slots=True)
class Provided:
    user: User
    #: A new account (it gets an activation link) — otherwise the person already had one.
    created: bool


async def provide_user(session: AsyncSession, *, email: str, full_name: str, locale: str) -> Provided:
    """The account of this e-mail: the existing one, or a new one without a usable password."""
    email = email.strip().lower()
    user = await find_user_by_email(session, email)
    if user is not None:
        if not user.is_active:
            raise Conflict("This e-mail belongs to a disabled account", code="account_inactive")
        return Provided(user, False)
    name = (full_name.strip() or email.split("@", 1)[0])[:200]
    user = User(email=email, password_hash=hash_password(secrets.token_urlsafe(32)), full_name=name, locale=locale)
    session.add(user)
    await session.flush()
    return Provided(user, True)


async def activation_link(
    session: AsyncSession, user: User, *, actor_id: uuid.UUID | None = None
) -> tuple[str, datetime]:
    raw, expires = await issue_password_link(
        session,
        user,
        TokenPurpose.ACTIVATE,
        ttl=timedelta(days=get_settings().activation_link_ttl_days),
        actor_id=actor_id,
    )
    return activation_url(raw), expires


async def recovery_link(
    session: AsyncSession, user: User, *, actor_id: uuid.UUID | None = None
) -> tuple[str, datetime]:
    raw, expires = await issue_password_link(
        session,
        user,
        TokenPurpose.RESET,
        ttl=timedelta(hours=get_settings().admin_reset_link_ttl_hours),
        actor_id=actor_id,
    )
    return reset_url(raw), expires


def login_link() -> str:
    return f"{get_settings().web_base_url.rstrip('/')}/login"


async def workspaces_of(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(OrganizationMember).where(OrganizationMember.user_id == user_id)
        )
        or 0
    )


async def latest_workspace_name(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    return await session.scalar(
        select(Organization.name)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user_id)
        .order_by(OrganizationMember.created_at.desc())
        .limit(1)
    )


# ----------------------------------------------------------------- messages
@dataclass(slots=True)
class Message:
    kind: str  # activation | reset | sign_in
    subject: str
    body: str
    link: str
    expires_at: datetime | None


def _account_lines(ar: bool, email: str, link: str, expires_at: datetime | None) -> list[str]:
    """The sign-in e-mail and either the activation link or the sign-in page."""
    if ar:
        lines = ["تفاصيل حسابك:", f"• البريد الإلكتروني للدخول: {email}"]
        if expires_at is not None:
            return [
                *lines,
                f"• فعّل حسابك واختر كلمة المرور من هذا الرابط (صالح حتى {date_text(expires_at, 'ar')}):",
                link,
            ]
        return [*lines, "• لديك حساب بهذا البريد: سجّل الدخول بكلمة مرورك المعتادة:", link]
    lines = ["Your account:", f"• Sign-in e-mail: {email}"]
    if expires_at is not None:
        return [
            *lines,
            f"• Activate it and choose your password here (valid until {date_text(expires_at, 'en')}):",
            link,
        ]
    return [*lines, "• You already have an account with this e-mail: sign in with your usual password:", link]


def _plan_lines(
    ar: bool, plan: SubscriptionPlan, limits: Limits, days: int | None, starts_on_activation: bool
) -> list[str]:
    name = plan.name_ar if ar else plan.name_en
    if ar:
        start = "تبدأ من تفعيل الحساب" if starts_on_activation else "تبدأ من اليوم"
        lines = [
            f"• الباقة: {name}",
            f"• المدة: {days_ar(days)} {start}" if days else "• المدة: مفتوحة بلا تاريخ انتهاء",
        ]
        lines.append(
            f"• {surveys_ar(limits.surveys)} في فترة الاشتراك" if limits.surveys is not None else "• استبانات بلا حد"
        )
        if limits.responses_per_month is not None:
            lines.append(f"• حتى {responses_ar(limits.responses_per_month)} كل شهر")
        if limits.members is not None:
            lines.append(f"• فريق حتى {members_ar(limits.members)}")
        return lines
    start = "starting when you activate the account" if starts_on_activation else "starting today"
    lines = [f"• Plan: {name}", f"• Length: {days} days, {start}" if days else "• Length: open-ended"]
    lines.append(
        f"• {plural_en(limits.surveys, 'survey')} per period" if limits.surveys is not None else "• Unlimited surveys"
    )
    if limits.responses_per_month is not None:
        lines.append(f"• Up to {plural_en(limits.responses_per_month, 'response')} a month")
    if limits.members is not None:
        lines.append(f"• A team of up to {plural_en(limits.members, 'member')}")
    return lines


def subscriber_message(
    *,
    locale: str,
    name: str,
    email: str,
    organization_name: str,
    plan: SubscriptionPlan,
    limits: Limits,
    days: int | None,
    link: str,
    expires_at: datetime | None,
) -> Message:
    """A new subscriber: the workspace, the plan, the account and how to start."""
    ar = locale != "en"
    new_account = expires_at is not None
    if ar:
        subject = "حسابك في مِقياس AI جاهز"
        lines = [
            f"مرحبًا {name}،",
            "",
            "أُنشئ لك اشتراك في «مِقياس AI» — منصة عربية لقياس الأثر ورضا العملاء بالذكاء الاصطناعي.",
            "",
            "اشتراكك:",
            f"• مساحة العمل: «{organization_name}»",
            *_plan_lines(True, plan, limits, days, new_account),
            "",
            *_account_lines(True, email, link, expires_at),
            "",
            *START_STEPS_AR,
            "",
            "إذا نسيت كلمة المرور لاحقًا فاختر «نسيت كلمة المرور؟» في صفحة الدخول.",
            "",
            *SIGNATURE_AR,
        ]
    else:
        subject = "Your MEQYAS AI account is ready"
        lines = [
            f"Hello {name},",
            "",
            "A subscription to MEQYAS AI — an Arabic-first platform for measuring impact and customer "
            "satisfaction with AI — was created for you.",
            "",
            "Your subscription:",
            f"• Workspace: “{organization_name}”",
            *_plan_lines(False, plan, limits, days, new_account),
            "",
            *_account_lines(False, email, link, expires_at),
            "",
            *START_STEPS_EN,
            "",
            "If you forget your password later, choose “Forgot your password?” on the sign-in page.",
            "",
            *SIGNATURE_EN,
        ]
    return Message("activation" if new_account else "sign_in", subject, "\n".join(lines), link, expires_at)


def invite_message(
    *,
    locale: str,
    name: str,
    email: str,
    organization_name: str,
    inviter: str,
    role: Role,
    link: str,
    expires_at: datetime | None,
) -> Message:
    """A member added to a workspace (a new account gets its activation link)."""
    ar = locale != "en"
    if ar:
        subject = f"دعوة للانضمام إلى «{organization_name}» في مِقياس AI"
        lines = [
            f"مرحبًا {name}،",
            "",
            f"أضافك {inviter} إلى «{organization_name}» في «مِقياس AI» بدور «{ROLE_AR[role]}».",
            "",
            *_account_lines(True, email, link, expires_at),
            "",
            *SIGNATURE_AR,
        ]
    else:
        subject = f"You were added to “{organization_name}” on MEQYAS AI"
        lines = [
            f"Hello {name},",
            "",
            f"{inviter} added you to the “{organization_name}” workspace on MEQYAS AI as {ROLE_EN[role]}.",
            "",
            *_account_lines(False, email, link, expires_at),
            "",
            *SIGNATURE_EN,
        ]
    return Message("activation" if expires_at is not None else "sign_in", subject, "\n".join(lines), link, expires_at)


def activation_reminder(
    *, locale: str, name: str, email: str, organization_name: str | None, link: str, expires_at: datetime
) -> Message:
    """A new activation link for an account that was never activated (earlier links stop working)."""
    if locale != "en":
        workspace = f" — مساحة العمل: «{organization_name}»" if organization_name else ""
        lines = [
            f"مرحبًا {name}،",
            "",
            f"هذا رابط جديد لتفعيل حسابك في «مِقياس AI»{workspace}.",
            "",
            *_account_lines(True, email, link, expires_at),
            "",
            "الروابط السابقة لم تعد تعمل.",
            "",
            *SIGNATURE_AR,
        ]
        return Message("activation", "رابط تفعيل حسابك في مِقياس AI", "\n".join(lines), link, expires_at)
    workspace = f" — workspace: “{organization_name}”" if organization_name else ""
    lines = [
        f"Hello {name},",
        "",
        f"Here is a new link to activate your MEQYAS AI account{workspace}.",
        "",
        *_account_lines(False, email, link, expires_at),
        "",
        "Earlier links no longer work.",
        "",
        *SIGNATURE_EN,
    ]
    return Message("activation", "Activate your MEQYAS AI account", "\n".join(lines), link, expires_at)


def recovery_message(
    *, locale: str, name: str, email: str, link: str, expires_at: datetime, timezone: str | None
) -> Message:
    """A password recovery link prepared by an administrator."""
    if locale != "en":
        lines = [
            f"مرحبًا {name}،",
            "",
            f"هذا رابط لاختيار كلمة مرور جديدة لحسابك في «مِقياس AI» ({email}).",
            f"افتحه واختر كلمة المرور (صالح لمرة واحدة حتى {datetime_text(expires_at, 'ar', timezone)}):",
            link,
            "",
            "بعد تغييرها سيُطلب تسجيل الدخول من جديد على أجهزتك الأخرى.",
            "إذا لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك الحالية تبقى كما هي.",
            "",
            *SIGNATURE_AR,
        ]
        return Message("reset", "استعادة كلمة المرور — مِقياس AI", "\n".join(lines), link, expires_at)
    lines = [
        f"Hello {name},",
        "",
        f"Here is a link to choose a new password for your MEQYAS AI account ({email}).",
        f"Open it and choose your password (single use, valid until {datetime_text(expires_at, 'en', timezone)}):",
        link,
        "",
        "Your other devices will be asked to sign in again.",
        "If you did not ask for this, ignore this message: your current password stays as it is.",
        "",
        *SIGNATURE_EN,
    ]
    return Message("reset", "Recover your password — MEQYAS AI", "\n".join(lines), link, expires_at)


async def deliver(message: Message, *, name: str, email: str, locale: str, send: bool) -> AccountMessageOut:
    """E-mail the message when asked and possible; always return it (shown once, to share by hand)."""
    available = bool(get_settings().smtp_url)
    emailed = False
    if send and available:
        try:
            await send_email(email, message.subject, message.body)
        except Exception:  # the message is still returned for sharing by hand
            logger.warning("account e-mail to a person failed", exc_info=True)
        else:
            emailed = True
    return AccountMessageOut(
        recipient_name=name,
        recipient_email=email,
        locale=locale,
        kind=message.kind,  # type: ignore[arg-type]
        subject=message.subject,
        body=message.body,
        link=message.link,
        expires_at=message.expires_at,
        emailed=emailed,
        email_available=available,
    )


async def access_message(
    session: AsyncSession, user: User, *, actor_id: uuid.UUID | None, timezone: str | None
) -> Message:
    """What a person who cannot sign in needs: a new activation link if the account was never
    activated, otherwise a recovery link. Earlier links of the same kind stop working."""
    if is_pending(user):
        link, expires = await activation_link(session, user, actor_id=actor_id)
        return activation_reminder(
            locale=user.locale,
            name=user.full_name,
            email=user.email,
            organization_name=await latest_workspace_name(session, user.id),
            link=link,
            expires_at=expires,
        )
    link, expires = await recovery_link(session, user, actor_id=actor_id)
    return recovery_message(
        locale=user.locale, name=user.full_name, email=user.email, link=link, expires_at=expires, timezone=timezone
    )
