"""Authentication use-cases: login, refresh rotation, logout, the one-time links that set a
password (forgot password, account activation) and changing one's password.

There is no self-registration: accounts are created by platform administrators or by a
workspace's administrators (SUBSCRIPTIONS.md §4)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.errors import Unauthorized, Unprocessable
from ..core.security import (
    burn_password_check,
    create_access_token,
    hash_password,
    hash_token,
    keyed_hash,
    needs_rehash,
    new_opaque_token,
    validate_password_strength,
    verify_password,
)
from ..domain.enums import GiftStatus, TokenPurpose
from ..models import Gift, Organization, OrganizationMember, PasswordResetToken, RefreshToken, User
from ..schemas.auth import ActivationPreviewOut, TokenOut, UserOut
from . import subscriptions
from .accounts import find_user_by_email, issue_password_link, reset_url
from .audit import audit
from .email import send_email
from .organizations import memberships_for

logger = logging.getLogger("meqyas.auth")

#: Concurrent refreshes (two tabs) within this window are not treated as token theft.
REFRESH_REUSE_GRACE = timedelta(seconds=20)


@dataclass(slots=True)
class IssuedSession:
    token: TokenOut
    refresh_token: str
    refresh_max_age: int


def _now() -> datetime:
    return datetime.now(UTC)


async def _issue(
    session: AsyncSession,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    request_meta: dict[str, str | None] | None = None,
) -> tuple[RefreshToken, str]:
    s = get_settings()
    raw = new_opaque_token()
    ip = (request_meta or {}).get("ip")
    row = RefreshToken(
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        token_hash=hash_token(raw),
        expires_at=_now() + timedelta(days=s.refresh_token_ttl_days),
        user_agent=(request_meta or {}).get("user_agent"),
        ip_hash=keyed_hash(ip, purpose="session-ip") if ip else None,
    )
    session.add(row)
    await session.flush()
    return row, raw


async def _session_out(session: AsyncSession, user: User, refresh: RefreshToken, raw: str) -> IssuedSession:
    access, expires_in = create_access_token(user.id, refresh.family_id)
    token = TokenOut(
        access_token=access,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
        memberships=await memberships_for(session, user.id),
    )
    return IssuedSession(token=token, refresh_token=raw, refresh_max_age=get_settings().refresh_token_ttl_days * 86400)


async def start_session(session: AsyncSession, user: User, request_meta: dict[str, str | None]) -> IssuedSession:
    """Sign a user in after an out-of-band proof (an activation or gift link). Commits."""
    await subscriptions.start_pending_for_owner(session, user.id)
    user.last_login_at = _now()
    refresh, raw = await _issue(session, user, request_meta=request_meta)
    await session.commit()
    return await _session_out(session, user, refresh, raw)


async def login(session: AsyncSession, email: str, password: str, request_meta: dict[str, str | None]) -> IssuedSession:
    user = await find_user_by_email(session, email)
    if user is None:
        burn_password_check(password)
        audit(session, action="auth.login_failed", meta={"reason": "unknown_email"}, request_meta=request_meta)
        await session.commit()
        raise Unauthorized("Invalid e-mail or password", code="invalid_credentials")
    if not verify_password(password, user.password_hash) or not user.is_active:
        audit(
            session,
            action="auth.login_failed",
            actor_user_id=user.id,
            meta={"reason": "bad_password" if user.is_active else "inactive"},
            request_meta=request_meta,
        )
        await session.commit()
        raise Unauthorized("Invalid e-mail or password", code="invalid_credentials")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    if user.last_login_at is None:
        # First sign-in (e.g. after «forgot password» instead of the activation link).
        await subscriptions.start_pending_for_owner(session, user.id)
    user.last_login_at = _now()
    refresh, raw = await _issue(session, user, request_meta=request_meta)
    audit(session, action="auth.login", actor_user_id=user.id, request_meta=request_meta)
    await session.commit()
    return await _session_out(session, user, refresh, raw)


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def refresh(session: AsyncSession, raw_token: str | None, request_meta: dict[str, str | None]) -> IssuedSession:
    if not raw_token:
        raise Unauthorized("Missing refresh token", code="no_refresh_token")
    row = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    if row is None:
        raise Unauthorized("Invalid refresh token", code="invalid_refresh_token")
    now = _now()
    if row.revoked_at is not None:
        benign = row.replaced_by_id is not None and now - row.revoked_at <= REFRESH_REUSE_GRACE
        if not benign:
            await _revoke_family(session, row.family_id)
            audit(
                session,
                action="auth.refresh_reuse_detected",
                actor_user_id=row.user_id,
                meta={"family": str(row.family_id)},
                request_meta=request_meta,
            )
            await session.commit()
            logger.warning("refresh token reuse detected; session family revoked")
            raise Unauthorized("Session expired, please sign in again", code="refresh_reuse")
    if row.expires_at <= now:
        raise Unauthorized("Session expired, please sign in again", code="refresh_expired")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("User inactive", code="invalid_refresh_token")
    new_row, raw = await _issue(session, user, family_id=row.family_id, request_meta=request_meta)
    if row.revoked_at is None:
        row.revoked_at = now
        row.replaced_by_id = new_row.id
    await session.commit()
    return await _session_out(session, user, new_row, raw)


async def logout(session: AsyncSession, raw_token: str | None, request_meta: dict[str, str | None]) -> None:
    if not raw_token:
        return
    row = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    if row is not None:
        await _revoke_family(session, row.family_id)
        audit(session, action="auth.logout", actor_user_id=row.user_id, request_meta=request_meta)
        await session.commit()


async def forgot_password(session: AsyncSession, email: str, request_meta: dict[str, str | None]) -> None:
    """Always succeeds from the caller's perspective (no account enumeration)."""
    user = await find_user_by_email(session, email)
    if user is None or not user.is_active:
        return
    s = get_settings()
    raw, _expires = await issue_password_link(
        session, user, TokenPurpose.RESET, ttl=timedelta(minutes=s.password_reset_ttl_minutes)
    )
    audit(session, action="auth.password_reset_requested", actor_user_id=user.id, request_meta=request_meta)
    await session.commit()
    link = reset_url(raw)
    if user.locale == "ar":
        subject = "إعادة تعيين كلمة المرور — مِقياس AI"
        body = f"مرحبًا {user.full_name}،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي (صالح لمدة {s.password_reset_ttl_minutes} دقيقة):\n{link}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة."
    else:
        subject = "Reset your password — MEQYAS AI"
        body = f"Hello {user.full_name},\n\nOpen this link to reset your password (valid {s.password_reset_ttl_minutes} minutes):\n{link}\n\nIf you did not request this, ignore this e-mail."
    await send_email(user.email, subject, body)


async def _link_row(
    session: AsyncSession, token: str, purpose: TokenPurpose, *, lock: bool = False
) -> PasswordResetToken | None:
    stmt = select(PasswordResetToken).where(
        PasswordResetToken.token_hash == hash_token(token), PasswordResetToken.purpose == purpose
    )
    if lock:
        stmt = stmt.with_for_update()
    return await session.scalar(stmt)


async def _revoke_sessions(session: AsyncSession, user_id: uuid.UUID, *, keep_family: uuid.UUID | None = None) -> None:
    stmt = update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
    if keep_family is not None:
        stmt = stmt.where(RefreshToken.family_id != keep_family)
    await session.execute(stmt.values(revoked_at=_now()))


async def reset_password(session: AsyncSession, token: str, password: str, request_meta: dict[str, str | None]) -> None:
    problems = validate_password_strength(password)
    if problems:
        raise Unprocessable("Password does not meet requirements", code="weak_password", details={"problems": problems})
    row = await _link_row(session, token, TokenPurpose.RESET, lock=True)
    now = _now()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise Unprocessable("This reset link is invalid or has expired", code="invalid_reset_token")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unprocessable("This reset link is invalid or has expired", code="invalid_reset_token")
    user.password_hash = hash_password(password)
    row.used_at = now
    await _revoke_sessions(session, user.id)
    audit(session, action="auth.password_reset", actor_user_id=user.id, request_meta=request_meta)
    await session.commit()


async def activation_preview(session: AsyncSession, token: str) -> ActivationPreviewOut:
    """What an activation link opens (public): the person and the workspace they join."""
    row = await _link_row(session, token, TokenPurpose.ACTIVATE)
    if row is None:
        return ActivationPreviewOut(state="invalid")
    if row.used_at is not None:
        return ActivationPreviewOut(state="used")
    if row.expires_at <= _now():
        return ActivationPreviewOut(state="expired")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        return ActivationPreviewOut(state="invalid")
    organization = await session.scalar(
        select(Organization.name)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id)
        .order_by(OrganizationMember.created_at.desc())
        .limit(1)
    )
    return ActivationPreviewOut(
        state="valid",
        full_name=user.full_name,
        email=user.email,
        organization_name=organization,
        locale=user.locale,
        expires_at=row.expires_at,
    )


async def activate(
    session: AsyncSession,
    token: str,
    password: str,
    full_name: str | None,
    request_meta: dict[str, str | None],
) -> IssuedSession:
    """A new account chooses its password from its activation link and is signed in; the
    subscription periods waiting for this owner start now."""
    problems = validate_password_strength(password)
    if problems:
        raise Unprocessable("Password does not meet requirements", code="weak_password", details={"problems": problems})
    row = await _link_row(session, token, TokenPurpose.ACTIVATE, lock=True)
    now = _now()
    if row is None or row.used_at is not None:
        raise Unprocessable("This activation link is no longer valid", code="activation_invalid")
    if row.expires_at <= now:
        raise Unprocessable("This activation link has expired", code="activation_expired")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unprocessable("This activation link is no longer valid", code="activation_invalid")
    user.password_hash = hash_password(password)
    if full_name and full_name.strip():
        user.full_name = full_name.strip()
    user.email_verified_at = user.email_verified_at or now
    row.used_at = now
    # A gift prepared for this account counts as activated too (GIFTS.md), whichever link was used.
    await session.execute(
        update(Gift)
        .where(Gift.user_id == user.id, Gift.status == GiftStatus.PENDING)
        .values(status=GiftStatus.ACTIVE, activated_at=now, token_expires_at=now)
    )
    audit(session, action="auth.activate", actor_user_id=user.id, request_meta=request_meta)
    return await start_session(session, user, request_meta)


async def change_password(
    session: AsyncSession,
    user: User,
    current_password: str,
    new_password: str,
    *,
    keep_family: uuid.UUID | None,
    request_meta: dict[str, str | None],
) -> None:
    """Signed in: the current password proves it is the owner; every other session is signed out."""
    if not verify_password(current_password, user.password_hash):
        audit(session, action="auth.password_change_failed", actor_user_id=user.id, request_meta=request_meta)
        await session.commit()
        raise Unprocessable("The current password is not correct", code="invalid_current_password")
    problems = validate_password_strength(new_password)
    if problems:
        raise Unprocessable("Password does not meet requirements", code="weak_password", details={"problems": problems})
    user.password_hash = hash_password(new_password)
    await _revoke_sessions(session, user.id, keep_family=keep_family)
    audit(session, action="auth.password_change", actor_user_id=user.id, request_meta=request_meta)
    await session.commit()
