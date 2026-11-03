"""Password hashing (Argon2id), JWT access tokens and opaque refresh tokens."""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import get_settings
from .errors import Unauthorized
from .ids import token_urlsafe

# OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1)
_hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16)

_COMMON_PASSWORDS = frozenset(
    {
        "password",
        "password1",
        "password123",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty123",
        "qwertyuiop",
        "11111111",
        "iloveyou1",
        "admin12345",
        "welcome123",
        "abc12345678",
        "00000000",
    }
)


def validate_password_strength(password: str) -> list[str]:
    problems: list[str] = []
    if len(password) < 10:
        problems.append("password_too_short")
    if len(password) > 256:
        problems.append("password_too_long")
    if password.lower() in _COMMON_PASSWORDS:
        problems.append("password_too_common")
    if password.isdigit() or password.isalpha():
        problems.append("password_needs_mix")
    return problems


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# A constant dummy hash so login timing does not reveal whether an email exists.
_DUMMY_HASH = _hasher.hash("timing-equalizer-not-a-real-password")


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


# ---------------------------------------------------------------------- JWT
def create_access_token(user_id: uuid.UUID, session_family: uuid.UUID) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(UTC)
    ttl = timedelta(minutes=s.access_token_ttl_minutes)
    claims = {
        "sub": str(user_id),
        "sid": str(session_family),
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": token_urlsafe(12),
    }
    token = jwt.encode(claims, s.jwt_secret.get_secret_value(), algorithm=s.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> dict[str, Any]:
    s = get_settings()
    last_error: Exception | None = None
    for secret in s.jwt_verification_secrets:
        try:
            claims = jwt.decode(
                token,
                secret,
                algorithms=[s.jwt_algorithm],
                options={"require": ["sub", "exp", "iat", "typ"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise Unauthorized("Access token expired", code="token_expired") from exc
        except jwt.InvalidTokenError as exc:
            last_error = exc
            continue
        if claims.get("typ") != "access":
            raise Unauthorized("Invalid token type")
        return claims
    raise Unauthorized("Invalid access token") from last_error


# ----------------------------------------------------------- opaque tokens
def new_opaque_token() -> str:
    return token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def keyed_hash(value: str, *, purpose: str) -> str:
    """Non-reversible, secret-keyed hash (e.g. IPs in audit logs, dedupe fingerprints)."""
    key = (get_settings().jwt_secret.get_secret_value() + ":" + purpose).encode()
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


# ------------------------------------------------------- survey sessions
SURVEY_SESSION_TTL = timedelta(hours=24)


def create_survey_session(survey_id: uuid.UUID, version_id: uuid.UUID) -> str:
    """Signed token issued when a respondent opens a public survey. It pins the
    version they saw, gives a server-side start time and makes submit idempotent."""
    s = get_settings()
    now = datetime.now(UTC)
    claims = {
        "typ": "survey_session",
        "srv": str(survey_id),
        "ver": str(version_id),
        "iat": int(now.timestamp()),
        "exp": int((now + SURVEY_SESSION_TTL).timestamp()),
        "jti": token_urlsafe(16),
    }
    return jwt.encode(claims, s.jwt_secret.get_secret_value(), algorithm=s.jwt_algorithm)


def decode_survey_session(token: str) -> dict[str, Any] | None:
    """Claims of a valid survey session token, or None (expired / forged / wrong type)."""
    s = get_settings()
    for secret in s.jwt_verification_secrets:
        try:
            claims = jwt.decode(
                token, secret, algorithms=[s.jwt_algorithm], options={"require": ["srv", "ver", "iat", "exp", "jti"]}
            )
        except jwt.InvalidTokenError:
            continue
        return claims if claims.get("typ") == "survey_session" else None
    return None
