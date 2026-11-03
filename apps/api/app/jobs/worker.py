"""Background worker (arq + Redis).

Run: ``arq app.jobs.worker.WorkerSettings`` (docker-compose service ``worker``).
Housekeeping, store-invitation e-mails (every minute) and their expiry, and the daily
subscription reminders (SUBSCRIPTIONS.md §6); later phases add text analysis, alerts and
outgoing webhooks.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import delete, or_

from ..core.config import get_settings
from ..core.logging import configure_logging
from ..db.session import dispose_engine, get_sessionmaker
from ..domain.enums import PlanStatus
from ..models import MeasurementPlan, PasswordResetToken, RefreshToken
from ..services import stores, subscription_notices

logger = logging.getLogger("meqyas.worker")

STALE_DRAFT_DAYS = 30


async def cleanup_expired_tokens(ctx: dict[str, Any]) -> dict[str, int]:
    """Delete expired/revoked refresh tokens and used/expired reset tokens."""
    now = datetime.now(UTC)
    async with get_sessionmaker()() as session:
        refresh = await session.execute(
            delete(RefreshToken).where(
                or_(RefreshToken.expires_at < now, RefreshToken.revoked_at < now - timedelta(days=7))
            )
        )
        resets = await session.execute(
            delete(PasswordResetToken).where(
                or_(PasswordResetToken.expires_at < now, PasswordResetToken.used_at.is_not(None))
            )
        )
        await session.commit()
    result = {"refresh_tokens": refresh.rowcount or 0, "reset_tokens": resets.rowcount or 0}
    logger.info("cleanup_expired_tokens %s", result)
    return result


async def cleanup_stale_plan_drafts(ctx: dict[str, Any]) -> int:
    """Draft plans never accepted for 30 days are removed (privacy: minimal retention)."""
    cutoff = datetime.now(UTC) - timedelta(days=STALE_DRAFT_DAYS)
    async with get_sessionmaker()() as session:
        res = await session.execute(
            delete(MeasurementPlan).where(
                MeasurementPlan.status == PlanStatus.DRAFT,
                MeasurementPlan.project_id.is_(None),
                MeasurementPlan.updated_at < cutoff,
            )
        )
        await session.commit()
    logger.info("cleanup_stale_plan_drafts removed=%s", res.rowcount)
    return res.rowcount or 0


async def send_store_invitations(ctx: dict[str, Any]) -> int:
    """E-mail store invitations whose send time has come (then erase the address)."""
    async with get_sessionmaker()() as session:
        sent = await stores.send_due_invitations(session)
    if sent:
        logger.info("send_store_invitations sent=%s", sent)
    return sent


async def expire_store_invitations(ctx: dict[str, Any]) -> int:
    async with get_sessionmaker()() as session:
        changed = await stores.expire_invitations(session)
    logger.info("expire_store_invitations changed=%s", changed)
    return changed


async def send_subscription_notices(ctx: dict[str, Any]) -> int:
    """Ends in 7 days / tomorrow, ended, 80% / 100% of the month's responses — each once."""
    async with get_sessionmaker()() as session:
        sent = await subscription_notices.send_notices(session)
    logger.info("send_subscription_notices sent=%s", sent)
    return sent


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging(get_settings().log_level, json_logs=get_settings().is_production)
    logger.info("worker started")


async def shutdown(ctx: dict[str, Any]) -> None:
    await dispose_engine()


def _redis_settings() -> RedisSettings:
    url = get_settings().redis_url or "redis://localhost:6379/0"
    return RedisSettings.from_dsn(url)


class WorkerSettings:
    functions = [
        cleanup_expired_tokens,
        cleanup_stale_plan_drafts,
        send_store_invitations,
        expire_store_invitations,
        send_subscription_notices,
    ]
    cron_jobs = [
        cron(cleanup_expired_tokens, hour={3}, minute={15}),
        cron(cleanup_stale_plan_drafts, hour={3}, minute={30}),
        cron(send_store_invitations, second={0}),  # every minute
        cron(expire_store_invitations, hour={3}, minute={45}),
        cron(send_subscription_notices, hour={6}, minute={0}),  # 09:00 in Riyadh
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = _redis_settings()
    max_jobs = 10
    job_timeout = 600
