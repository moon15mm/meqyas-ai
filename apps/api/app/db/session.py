"""Async engine and session factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, SessionTransaction

from ..core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        s = get_settings()
        _engine = create_async_engine(
            s.database_url,
            echo=s.database_echo,
            pool_size=s.database_pool_size,
            max_overflow=s.database_pool_size,
            pool_pre_ping=True,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


_WRITES = "meqyas_writes_pending"


@event.listens_for(Session, "after_flush")
def _remember_writes(session: Session, _context: Any) -> None:
    session.info[_WRITES] = True


@event.listens_for(Session, "after_transaction_end")
def _forget_writes(session: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is None:  # the outermost transaction committed or rolled back
        session.info.pop(_WRITES, None)


async def release_connection(session: AsyncSession) -> None:
    """Give the session's pooled connection back before a long wait (an AI call takes
    seconds), so a burst of AI work cannot starve every other request of connections.

    Only a transaction that has merely read is ended: with ``expire_on_commit=False``
    everything loaded stays usable and the next query opens a new transaction. A
    transaction that has written keeps its connection, so its writes stay atomic."""
    if not session.in_transaction():
        return
    if session.new or session.dirty or session.deleted or session.info.get(_WRITES):
        return
    await session.commit()


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request; services commit explicitly."""
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
