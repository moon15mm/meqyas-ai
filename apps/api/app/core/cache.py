"""Cache + Redis connection. Redis when REDIS_URL is set; otherwise an
in-process TTL cache (development only — production requires Redis)."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Protocol

from redis.asyncio import Redis

from .config import get_settings

logger = logging.getLogger("meqyas.cache")

_redis: Redis | None = None
_redis_checked = False


async def get_redis() -> Redis | None:
    """Shared Redis client or None if not configured/unreachable (dev fallback)."""
    global _redis, _redis_checked
    if _redis is not None or _redis_checked:
        return _redis
    _redis_checked = True
    url = get_settings().redis_url
    if not url:
        return None
    client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
    try:
        await client.ping()
    except Exception:
        if get_settings().is_production:
            raise
        logger.warning("Redis at %s unreachable — using in-memory fallbacks", url)
        await client.aclose()
        return None
    _redis = client
    return _redis


async def close_redis() -> None:
    global _redis, _redis_checked
    if _redis is not None:
        await _redis.aclose()
    _redis = None
    _redis_checked = False


class Cache(Protocol):
    async def get(self, key: str) -> str | None: ...

    async def set(self, key: str, value: str, ttl_s: int) -> None: ...

    async def delete(self, key: str) -> None: ...


class MemoryTTLCache:
    def __init__(self, max_items: int = 2000) -> None:
        self._data: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._max = max_items
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> str | None:
        async with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expires, value = item
            if expires < time.monotonic():
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    async def set(self, key: str, value: str, ttl_s: int) -> None:
        async with self._lock:
            self._data[key] = (time.monotonic() + ttl_s, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._data.pop(key, None)


class RedisCache:
    def __init__(self, client: Redis, prefix: str = "meqyas:") -> None:
        self._r = client
        self._p = prefix

    async def get(self, key: str) -> str | None:
        return await self._r.get(self._p + key)

    async def set(self, key: str, value: str, ttl_s: int) -> None:
        await self._r.set(self._p + key, value, ex=max(1, ttl_s))

    async def delete(self, key: str) -> None:
        await self._r.delete(self._p + key)


_memory_cache = MemoryTTLCache()


async def get_cache() -> Cache:
    client = await get_redis()
    return RedisCache(client) if client is not None else _memory_cache


def reset_memory_cache() -> None:
    """Test helper."""
    _memory_cache._data.clear()
