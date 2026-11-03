"""Gifts (GIFTS.md): trial accounts prepared by platform administrators.

An administrator fills a short form. The platform creates the recipient's account (without a
usable password — unless the address already has an account) and a workspace on the trial plan
with its own number of published surveys (SUBSCRIPTIONS.md), then composes a message with the sign-in e-mail, a one-time activation link
where the recipient chooses their own password, and a three-step guide. The message is e-mailed
when SMTP is configured and always returned, so it can also be shared by WhatsApp or any channel.
No password ever travels in a message, and the activation link is never stored or shown again.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.errors import Conflict, NotFound, Unprocessable
from ..core.security import hash_password, hash_token, new_opaque_token, validate_password_strength
from ..domain.enums import GiftStatus
from ..models import Gift, Organization, OrganizationMember, Subscription, User
from ..schemas.gift import GiftIn, GiftMessageOut, GiftOut, GiftPreviewOut
from . import subscriptions
from .accounts import find_user_by_email, require_platform_admin
from .audit import audit
from .auth import IssuedSession, start_session
from .email import send_email
from .organizations import create_organization
from .wording import date_text, days_ar, surveys_ar

logger = logging.getLogger("meqyas.gifts")


def _now() -> datetime:
    return datetime.now(UTC)


# ------------------------------------------------------------------ message
@dataclass(slots=True)
class GiftMessage:
    subject: str
    body: str
    link: str


def compose_message(
    gift: Gift,
    *,
    organization_name: str,
    token: str | None,
    base_url: str | None = None,
) -> GiftMessage:
    """The recipient's message: what they got, how to sign in, and how to start."""
    s = get_settings()
    web = (base_url or s.web_base_url).rstrip("/")
    ar = gift.locale != "en"
    link = f"{web}/gift/{token}" if token else f"{web}/login"
    n = gift.survey_limit
    lines: list[str] = []
    if ar:
        subject = "هدية لك: حساب تجريبي في مِقياس AI"
        lines += [f"مرحبًا {gift.recipient_name}،", ""]
        if gift.note.strip():
            lines += [gift.note.strip(), ""]
        lines += [
            "يسعدنا أن نهديك حسابًا في «مِقياس AI» — منصة عربية لقياس الأثر ورضا العملاء بالذكاء الاصطناعي.",
            "",
            "هديتك:",
            f"• مساحة عمل باسم «{organization_name}»",
            f"• {surveys_ar(n)} يمكنك نشرها وجمع الإجابات عليها",
        ]
        if gift.trial_days:
            start = "من تفعيل الحساب" if token else "تبدأ من اليوم"
            lines.append(f"• مدة التجربة {days_ar(gift.trial_days)} {start}")
        lines += ["", "تفاصيل حسابك:", f"• البريد الإلكتروني للدخول: {gift.recipient_email}"]
        if token:
            assert gift.token_expires_at is not None
            lines += [
                f"• فعّل حسابك واختر كلمة المرور من هذا الرابط (صالح حتى {date_text(gift.token_expires_at, 'ar')}):",
                link,
            ]
        else:
            lines += [
                "• لديك حساب بهذا البريد: سجّل الدخول بكلمة مرورك المعتادة، وستجد المساحة الجديدة في قائمة المؤسسات:",
                link,
            ]
        lines += [
            "",
            "كيف تبدأ في ثلاث خطوات:",
            "1. من الصفحة الرئيسية صف ما تريد قياسه بجملة واحدة (مثل: «أريد قياس رضا عملاء متجري»)، "
            "فيقترح عليك المساعد خطة القياس والاستبيان — أو اختر قالبًا جاهزًا من «قوالب القياس».",
            "2. راجع الاستبيان ثم انشره، وشارك رابطه أو رمز QR مع جمهورك.",
            "3. تابع الإجابات والتحليلات والتوصيات أولًا بأول من صفحة المشروع.",
            "",
            "نتمنى لك تجربة مفيدة،",
            "فريق مِقياس AI",
        ]
    else:
        subject = "A gift for you: a MEQYAS AI trial account"
        lines += [f"Hello {gift.recipient_name},", ""]
        if gift.note.strip():
            lines += [gift.note.strip(), ""]
        lines += [
            "We are pleased to give you an account on MEQYAS AI — an Arabic-first platform for measuring impact "
            "and customer satisfaction with AI.",
            "",
            "Your gift:",
            f"• A workspace called “{organization_name}”",
            f"• {n} survey{'s' if n != 1 else ''} you can publish and collect answers for",
        ]
        if gift.trial_days:
            start = "starting when you activate the account" if token else "starting today"
            lines.append(f"• A {gift.trial_days}-day trial, {start}")
        lines += ["", "Your account:", f"• Sign-in e-mail: {gift.recipient_email}"]
        if token:
            assert gift.token_expires_at is not None
            lines += [
                f"• Activate it and choose your password here (valid until {date_text(gift.token_expires_at, 'en')}):",
                link,
            ]
        else:
            lines += [
                "• You already have an account with this e-mail: sign in with your usual password and switch to "
                "the new workspace:",
                link,
            ]
        lines += [
            "",
            "Get started in three steps:",
            "1. On the home page, describe what you want to measure in one sentence (e.g. “I want to measure my "
            "store's customer satisfaction”) and the assistant proposes the plan and survey — or pick a "
            "ready-made template.",
            "2. Review the survey, publish it and share its link or QR code with your audience.",
            "3. Follow the answers, analytics and recommendations from the project page.",
            "",
            "Enjoy the trial,",
            "The MEQYAS AI team",
        ]
    return GiftMessage(subject=subject, body="\n".join(lines), link=link)


# --------------------------------------------------------------- read model
def _state(gift: Gift, now: datetime) -> str:
    if gift.status == GiftStatus.PENDING:
        return "expired" if gift.token_expires_at is not None and gift.token_expires_at <= now else "pending"
    return gift.status.value.lower()


def _gift_out(gift: Gift, org: Organization | None, user: User | None, sub: Subscription | None = None) -> GiftOut:
    return GiftOut(
        id=gift.id,
        recipient_name=gift.recipient_name,
        recipient_email=gift.recipient_email,
        organization_id=gift.organization_id,
        organization_name=org.name if org else None,
        locale=gift.locale,
        note=gift.note,
        survey_limit=gift.survey_limit,
        surveys_published=sub.surveys_used if sub else 0,
        trial_days=gift.trial_days,
        trial_ends_at=sub.period_ends_at if sub else None,
        new_account=gift.new_account,
        status=gift.status,
        state=_state(gift, _now()),  # type: ignore[arg-type]
        token_expires_at=gift.token_expires_at,
        emailed_at=gift.emailed_at,
        activated_at=gift.activated_at,
        last_login_at=user.last_login_at if user else None,
        created_at=gift.created_at,
    )


async def _subscription(session: AsyncSession, org: Organization | None) -> Subscription | None:
    if org is None:
        return None
    return await session.scalar(select(Subscription).where(Subscription.organization_id == org.id))


async def _load(session: AsyncSession, gift_id: uuid.UUID) -> tuple[Gift, Organization | None, User | None]:
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise NotFound("Gift not found")
    org = await session.get(Organization, gift.organization_id) if gift.organization_id else None
    user = await session.get(User, gift.user_id) if gift.user_id else None
    return gift, org, user


async def list_gifts(session: AsyncSession, admin: User) -> list[GiftOut]:
    require_platform_admin(admin)
    rows = (
        await session.execute(
            select(Gift, Organization, User, Subscription)
            .outerjoin(Organization, Organization.id == Gift.organization_id)
            .outerjoin(User, User.id == Gift.user_id)
            .outerjoin(Subscription, Subscription.organization_id == Gift.organization_id)
            .order_by(Gift.created_at.desc())
            .limit(500)
        )
    ).all()
    return [_gift_out(gift, org, user, sub) for gift, org, user, sub in rows]


# ------------------------------------------------------------------- create
async def _deliver(
    session: AsyncSession,
    gift: Gift,
    org: Organization,
    user: User | None,
    *,
    token: str | None,
    send: bool,
    base_url: str | None = None,
) -> GiftMessageOut:
    message = compose_message(gift, organization_name=org.name, token=token, base_url=base_url)
    available = bool(get_settings().smtp_url)
    emailed = False
    if send and available:
        try:
            await send_email(gift.recipient_email, message.subject, message.body)
        except Exception:  # the message is still returned for sharing by hand
            logger.warning("gift e-mail to the recipient failed", exc_info=True)
        else:
            gift.emailed_at = _now()
            await session.commit()
            emailed = True
    return GiftMessageOut(
        gift=_gift_out(gift, org, user, await _subscription(session, org)),
        subject=message.subject,
        body=message.body,
        link=message.link,
        emailed=emailed,
        email_available=available,
    )


def _new_token(gift: Gift) -> str:
    token = new_opaque_token()
    gift.token_hash = hash_token(token)
    gift.token_expires_at = _now() + timedelta(days=get_settings().gift_link_ttl_days)
    return token


async def create_gift(
    session: AsyncSession, admin: User, data: GiftIn, request_meta: dict[str, str | None]
) -> GiftMessageOut:
    require_platform_admin(admin)
    settings = get_settings()
    plan = await subscriptions.get_plan(session, settings.gift_plan)
    email = str(data.recipient_email).strip().lower()
    name = data.recipient_name.strip()
    user = await find_user_by_email(session, email)
    if user is not None and not user.is_active:
        raise Conflict("This e-mail belongs to a disabled account", code="gift_account_inactive")
    new_account = user is None
    if user is None:
        # No usable password until the recipient activates the account from the link.
        user = User(
            email=email, password_hash=hash_password(secrets.token_urlsafe(32)), full_name=name, locale=data.locale
        )
        session.add(user)
        await session.flush()
    org_name = data.organization_name.strip() or (f"مساحة {name}" if data.locale == "ar" else f"{name}'s workspace")
    org = await create_organization(session, owner=user, name=org_name, sector=data.sector, locale=data.locale)
    # The trial plan with the gift's own number of surveys; a new account's trial starts when the
    # recipient activates it, an existing account's starts now.
    await subscriptions.create(
        session,
        org,
        plan,
        days=data.trial_days,
        start_now=not new_account,
        overrides={"surveys": data.survey_limit},
        actor_id=admin.id,
    )
    now = _now()
    gift = Gift(
        created_by_id=admin.id,
        organization_id=org.id,
        user_id=user.id,
        recipient_name=name,
        recipient_email=email,
        note=data.note.strip(),
        locale=data.locale,
        survey_limit=data.survey_limit,
        trial_days=data.trial_days,
        new_account=new_account,
        status=GiftStatus.PENDING if new_account else GiftStatus.ACTIVE,
    )
    token: str | None = None
    if new_account:
        token = _new_token(gift)
    else:
        # An existing account gets the workspace at once (its trial started above).
        gift.activated_at = now
    session.add(gift)
    await session.flush()
    audit(
        session,
        action="gift.create",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="gift",
        entity_id=gift.id,
        meta={"survey_limit": data.survey_limit, "trial_days": data.trial_days, "new_account": new_account},
        request_meta=request_meta,
    )
    await session.commit()
    return await _deliver(
        session, gift, org, user, token=token, send=data.send_email, base_url=request_meta.get("base_url")
    )


async def resend_gift(
    session: AsyncSession, admin: User, gift_id: uuid.UUID, *, send: bool, request_meta: dict[str, str | None]
) -> GiftMessageOut:
    """A fresh message: a new activation link for a pending gift (the old link stops working), or the
    sign-in variant once the account is active."""
    require_platform_admin(admin)
    gift, org, user = await _load(session, gift_id)
    if gift.status == GiftStatus.REVOKED or org is None:
        raise Conflict("This gift was revoked", code="gift_revoked")
    token = _new_token(gift) if gift.status == GiftStatus.PENDING else None
    audit(
        session,
        action="gift.resend",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_type="gift",
        entity_id=gift.id,
        request_meta=request_meta,
    )
    await session.commit()
    return await _deliver(session, gift, org, user, token=token, send=send, base_url=request_meta.get("base_url"))


async def revoke_gift(
    session: AsyncSession, admin: User, gift_id: uuid.UUID, request_meta: dict[str, str | None]
) -> GiftOut:
    """Cancel a gift that was not activated yet: its workspace — and the account, if the gift created
    it and it was never used — are removed. Active gifts are managed like any organization."""
    require_platform_admin(admin)
    gift, org, user = await _load(session, gift_id)
    if gift.status != GiftStatus.PENDING:
        raise Conflict("Only gifts that were not activated can be revoked", code="gift_not_pending")
    if org is not None:
        await session.execute(delete(Organization).where(Organization.id == org.id))
    if gift.new_account and user is not None and user.last_login_at is None:
        others = await session.scalar(
            select(func.count()).select_from(OrganizationMember).where(OrganizationMember.user_id == user.id)
        )
        if not others:
            await session.execute(delete(User).where(User.id == user.id))
            user = None
    gift.status = GiftStatus.REVOKED
    gift.organization_id = None
    gift.token_expires_at = _now()
    audit(
        session,
        action="gift.revoke",
        actor_user_id=admin.id,
        entity_type="gift",
        entity_id=gift.id,
        request_meta=request_meta,
    )
    await session.commit()
    return _gift_out(gift, None, user)


# ---------------------------------------------------------------- recipient
async def _by_token(session: AsyncSession, token: str, *, lock: bool = False) -> Gift | None:
    stmt = select(Gift).where(Gift.token_hash == hash_token(token))
    if lock:
        stmt = stmt.with_for_update()
    return await session.scalar(stmt)


async def preview(session: AsyncSession, token: str) -> GiftPreviewOut:
    gift = await _by_token(session, token)
    if gift is None:  # unknown, or replaced by a newer link
        return GiftPreviewOut(state="invalid")
    state = _state(gift, _now())
    if state != "pending":
        return GiftPreviewOut(state={"active": "used"}.get(state, state))  # type: ignore[arg-type]
    org = await session.get(Organization, gift.organization_id) if gift.organization_id else None
    return GiftPreviewOut(
        state="valid",
        recipient_name=gift.recipient_name,
        email=gift.recipient_email,
        organization_name=org.name if org else None,
        survey_limit=gift.survey_limit,
        trial_days=gift.trial_days,
        note=gift.note or None,
        locale=gift.locale,
    )


async def claim(
    session: AsyncSession,
    token: str,
    password: str,
    full_name: str | None,
    request_meta: dict[str, str | None],
) -> IssuedSession:
    """The recipient chooses a password: the account is activated, the trial starts (the waiting
    subscription period, in ``start_session``), and they are signed in."""
    problems = validate_password_strength(password)
    if problems:
        raise Unprocessable("Password does not meet requirements", code="weak_password", details={"problems": problems})
    gift = await _by_token(session, token, lock=True)
    now = _now()
    if gift is None or gift.status != GiftStatus.PENDING or gift.user_id is None:
        raise Unprocessable("This gift link is no longer valid", code="gift_invalid")
    if gift.token_expires_at is not None and gift.token_expires_at <= now:
        raise Unprocessable("This gift link has expired", code="gift_expired")
    user = await session.get(User, gift.user_id)
    org = await session.get(Organization, gift.organization_id) if gift.organization_id else None
    if user is None or org is None or not user.is_active:
        raise Unprocessable("This gift link is no longer valid", code="gift_invalid")
    user.password_hash = hash_password(password)
    if full_name and full_name.strip():
        user.full_name = full_name.strip()
    user.email_verified_at = user.email_verified_at or now
    gift.status = GiftStatus.ACTIVE
    gift.activated_at = now
    audit(
        session,
        action="gift.activate",
        organization_id=org.id,
        actor_user_id=user.id,
        entity_type="gift",
        entity_id=gift.id,
        request_meta=request_meta,
    )
    return await start_session(session, user, request_meta)
