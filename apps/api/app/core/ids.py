"""Identifier helpers: UUIDv7 primary keys and URL-safe public ids."""

from __future__ import annotations

import os
import secrets
import time
import uuid

_PUBLIC_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # no 0/1/i/l/o — easy to read and type


def uuid7() -> uuid.UUID:
    """RFC 9562 UUIDv7: 48-bit unix ms timestamp + random bits (time-ordered)."""
    ts_ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ts_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76  # version
    value |= ((rand >> 62) & 0xFFF) << 64  # rand_a (12 bits)
    value |= 0b10 << 62  # variant
    value |= rand & ((1 << 62) - 1)  # rand_b
    return uuid.UUID(int=value)


def public_id(length: int = 10) -> str:
    return "".join(secrets.choice(_PUBLIC_ALPHABET) for _ in range(length))


def token_urlsafe(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)
