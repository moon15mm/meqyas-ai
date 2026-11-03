"""Fixed-window rate limiting backed by Redis (or memory in development)."""

from __future__ import annotations

import asyncio
import time

from fastapi import Request

from .cache import get_redis
from .config import get_settings
from .errors import RateLimited

_memory: dict[str, tuple[int, float]] = {}
_lock = asyncio.Lock()


async def hit(key: str, *, limit: int, window_s: int) -> tuple[bool, int]:
    """Count one hit for ``key``. Returns (allowed, retry_after_seconds)."""
    window = int(time.time() // window_s)
    bucket = f"rl:{key}:{window}"
    retry_after = window_s - int(time.time() % window_s)
    client = await get_redis()
    if client is not None:
        async with client.pipeline(transaction=True) as pipe:
            pipe.incr(bucket)
            pipe.expire(bucket, window_s + 1)
            count, _ = await pipe.execute()
        return int(count) <= limit, retry_after
    async with _lock:
        count, expires = _memory.get(bucket, (0, time.time() + window_s))
        count += 1
        _memory[bucket] = (count, expires)
        if len(_memory) > 10_000:
            now = time.time()
            for k in [k for k, (_, exp) in _memory.items() if exp < now]:
                _memory.pop(k, None)
    return count <= limit, retry_after


async def enforce(key: str, *, limit: int, window_s: int = 60) -> None:
    if not get_settings().rate_limit_enabled:
        return
    allowed, retry_after = await hit(key, limit=limit, window_s=window_s)
    if not allowed:
        raise RateLimited("Too many requests, please try again later", details={"retry_after": retry_after})


def client_ip(request: Request) -> str:
    """The caller's IP. X-Forwarded-For is client-controlled except for the entries
    appended by *our* proxies, so only the right-most ``trusted_proxy_hops`` entries are
    trusted (SECURITY.md §7). With 0 hops the header is ignored entirely."""
    peer = request.client.host if request.client else "unknown"
    hops = get_settings().trusted_proxy_hops
    if hops <= 0:
        return peer
    chain = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    return chain[-hops] if len(chain) >= hops else peer


def reset_memory_limits() -> None:
    """Test helper."""
    _memory.clear()
