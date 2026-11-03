"""Field-level encryption (Fernet) for PII and secrets at rest."""

from __future__ import annotations

import base64
import hashlib
import hmac
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


@lru_cache
def _fernet() -> Fernet:
    s = get_settings()
    if s.encryption_key is not None:
        key = s.encryption_key.get_secret_value().encode()
        try:
            return Fernet(key)
        except ValueError:
            # Accept any passphrase by deriving a proper 32-byte key from it.
            return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key).digest()))
    # Development fallback: derived from JWT secret (production requires ENCRYPTION_KEY).
    derived = hashlib.sha256(("enc:" + s.jwt_secret.get_secret_value()).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


@lru_cache
def _stable_key() -> bytes:
    s = get_settings()
    material = (
        s.encryption_key.get_secret_value()
        if s.encryption_key is not None
        else "enc:" + s.jwt_secret.get_secret_value()
    )
    return hashlib.sha256(("stable-hash:" + material).encode()).digest()


def stable_hash(value: str, *, purpose: str) -> str:
    """Keyed, non-reversible hash that must stay stable for years (pseudonymous respondent
    codes link pre/post waves). Keyed with ENCRYPTION_KEY, which never rotates silently —
    unlike JWT secrets."""
    return hmac.new(_stable_key(), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()
