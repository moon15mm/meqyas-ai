"""AI integration for the API: provider registry with automatic failover, per-org
policy (cloud vs local), daily token budgets, caching and persistence of every run in
ai_runs."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar
from urllib.parse import urlparse

from meqyas_ai.agents.base import Agent
from meqyas_ai.errors import (
    AIAuthError,
    AIBudgetExceededError,
    AIError,
    AINotConfiguredError,
    AIProviderUnavailableError,
    AIRateLimitedError,
    AITimeoutError,
)
from meqyas_ai.providers import AIProvider, ModelTiers, ProviderConfig, build_ollama, build_provider
from meqyas_ai.runtime import AgentResult, AgentRunner, RunRecord
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.cache import Cache, get_cache
from ..core.config import Settings, get_settings
from ..db.session import get_sessionmaker, release_connection
from ..domain.enums import AIRunStatus
from ..models import AIRun, Organization
from . import subscriptions

logger = logging.getLogger("meqyas.ai")
FinalT = TypeVar("FinalT", bound=BaseModel)


@dataclass(slots=True)
class ProviderSlot:
    provider: AIProvider | None
    tiers: ModelTiers | None
    reason: str | None = None
    #: "primary", "fallback" or "local" — the key of its cool-down.
    name: str = "primary"

    @property
    def ready(self) -> bool:
        return self.provider is not None and self.tiers is not None


#: Errors meaning "this provider cannot serve right now", not "this request is wrong": the same
#: request may succeed on another provider. Budget, bad-request and invalid-output errors never
#: fail over (they would fail the same way elsewhere).
FAILOVER_ERRORS: tuple[type[AIError], ...] = (
    AIRateLimitedError,
    AIProviderUnavailableError,
    AITimeoutError,
    AIAuthError,
)
#: How long a failing provider is skipped (it is still tried last if nothing else is ready).
COOLDOWN_S: tuple[tuple[type[AIError], float], ...] = ((AIRateLimitedError, 30.0), (AIAuthError, 300.0))
DEFAULT_COOLDOWN_S = 60.0


def _host(url: str | None) -> str:
    return (urlparse(url or "").hostname or "").removeprefix("api.")


class AIRegistry:
    """Built once at startup. Holds the primary provider, an optional fallback provider
    (another company serving equivalent models) and, if enabled, local Ollama.

    Requests go to the first ready provider. One that fails with an availability error
    (rate limit, outage, rejected key, retired model) is skipped for a short cool-down, so an
    outage costs one slower request instead of slowing every request.
    """

    def __init__(
        self,
        *,
        primary: ProviderSlot,
        fallback: ProviderSlot | None = None,
        local: ProviderSlot | None = None,
    ) -> None:
        self.primary = primary
        self.fallback = fallback or ProviderSlot(
            None, None, "No fallback provider (AI_FALLBACK_PROVIDER=none)", name="fallback"
        )
        self.local = local or ProviderSlot(None, None, "Local AI disabled (OLLAMA_ENABLED=false)", name="local")
        self._cooldown_until: dict[str, float] = {}

    @classmethod
    def from_settings(cls, settings: Settings) -> AIRegistry:
        has_fallback = settings.ai_fallback_provider != "none"
        cfg = ProviderConfig(
            provider=settings.ai_provider,
            model_fast=settings.ai_model_fast,
            model_smart=settings.ai_model_smart,
            timeout_s=settings.ai_request_timeout_s,
            # With a fallback, fail over after one SDK retry instead of three attempts.
            max_retries=1 if has_fallback else 2,
            openai_api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
            openai_base_url=settings.openai_base_url,
            openai_structured_mode=settings.openai_structured_mode,
            ollama_base_url=settings.ollama_base_url,
            ollama_model_fast=settings.ollama_model_fast,
            ollama_model_smart=settings.ollama_model_smart,
            anthropic_api_key=settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None,
        )
        try:
            provider, tiers = build_provider(cfg)
            primary = ProviderSlot(provider, tiers, name="primary")
        except AINotConfiguredError as exc:
            primary = ProviderSlot(None, None, exc.message, name="primary")

        fallback: ProviderSlot | None = None
        if has_fallback:
            key = settings.ai_fallback_api_key.get_secret_value() if settings.ai_fallback_api_key else None
            kind = settings.ai_fallback_provider
            fallback_cfg = ProviderConfig(
                provider=kind,
                model_fast=settings.ai_fallback_model_fast,
                model_smart=settings.ai_fallback_model_smart,
                timeout_s=settings.ai_request_timeout_s,
                openai_api_key=key if kind != "anthropic" else None,
                openai_base_url=settings.ai_fallback_base_url,
                openai_structured_mode=settings.ai_fallback_structured_mode,
                anthropic_api_key=key if kind == "anthropic" else None,
                name=f"fallback:{_host(settings.ai_fallback_base_url) or kind}"[:40],
            )
            try:
                provider, tiers = build_provider(fallback_cfg)
                fallback = ProviderSlot(provider, tiers, name="fallback")
            except AINotConfiguredError as exc:
                fallback = ProviderSlot(None, None, exc.message, name="fallback")

        local: ProviderSlot | None = None
        if cfg.provider == "ollama":
            local = ProviderSlot(primary.provider, primary.tiers, primary.reason, name="local")
        elif settings.ollama_enabled:
            provider, tiers = build_ollama(cfg)
            local = ProviderSlot(provider, tiers, name="local")
        return cls(primary=primary, fallback=fallback, local=local)

    def candidates(self, *, allow_cloud: bool) -> list[ProviderSlot]:
        """Providers to try, in order: ready ones first, cooling-down ones last."""
        if not allow_cloud:
            if not self.local.ready:
                raise AINotConfiguredError(
                    "This organization requires local AI, but Ollama is not enabled (OLLAMA_ENABLED=true)."
                )
            return [self.local]
        slots: list[ProviderSlot] = []
        for slot in (self.primary, self.fallback, self.local):
            if slot.ready and all(slot.provider is not other.provider for other in slots):
                slots.append(slot)
        if not slots:
            raise AINotConfiguredError(self.primary.reason or "No AI provider configured")
        now = time.monotonic()
        ready = [slot for slot in slots if self._cooldown_until.get(slot.name, 0.0) <= now]
        return ready + [slot for slot in slots if all(slot is not r for r in ready)]

    def select(self, *, allow_cloud: bool) -> tuple[AIProvider, ModelTiers]:
        slot = self.candidates(allow_cloud=allow_cloud)[0]
        assert slot.provider is not None and slot.tiers is not None
        return slot.provider, slot.tiers

    def mark_failed(self, slot: ProviderSlot, exc: AIError) -> None:
        seconds = next((s for kind, s in COOLDOWN_S if isinstance(exc, kind)), DEFAULT_COOLDOWN_S)
        self._cooldown_until[slot.name] = time.monotonic() + seconds

    def mark_ok(self, slot: ProviderSlot) -> None:
        self._cooldown_until.pop(slot.name, None)

    async def aclose(self) -> None:
        seen: set[int] = set()
        for slot in (self.primary, self.fallback, self.local):
            if slot.provider is not None and id(slot.provider) not in seen:
                seen.add(id(slot.provider))
                try:
                    await slot.provider.aclose()
                except Exception:  # pragma: no cover
                    logger.debug("provider close failed", exc_info=True)


_registry: AIRegistry | None = None


def get_ai_registry() -> AIRegistry:
    global _registry
    if _registry is None:
        _registry = AIRegistry.from_settings(get_settings())
    return _registry


def set_ai_registry(registry: AIRegistry | None) -> None:
    """Used by tests to inject a scripted provider."""
    global _registry
    _registry = registry


async def close_ai_registry() -> None:
    global _registry
    if _registry is not None:
        await _registry.aclose()
    _registry = None


class _CacheAdapter:
    def __init__(self, cache: Cache) -> None:
        self._cache = cache

    async def get(self, key: str) -> str | None:
        return await self._cache.get(key)

    async def set(self, key: str, value: str, ttl_s: int) -> None:
        await self._cache.set(key, value, ttl_s)


def _allow_cloud(org: Organization) -> bool:
    return bool(((org.settings or {}).get("ai") or {}).get("allow_cloud_ai", True))


async def tokens_used_today(session: AsyncSession, organization_id: uuid.UUID) -> tuple[int, int]:
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    row = (
        await session.execute(
            select(func.coalesce(func.sum(AIRun.total_tokens), 0), func.count())
            .select_from(AIRun)
            .where(AIRun.organization_id == organization_id, AIRun.created_at >= start)
        )
    ).one()
    return int(row[0]), int(row[1])


def _persist(
    session: AsyncSession,
    record: RunRecord,
    *,
    organization_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    entity_type: str | None,
    entity_id: uuid.UUID | None,
) -> AIRun:
    run = AIRun(
        organization_id=organization_id,
        user_id=user_id,
        agent=record.agent,
        provider=record.provider,
        model=record.model,
        prompt_version=record.prompt_version,
        input_hash=record.input_hash,
        status=AIRunStatus(record.status),
        attempts=record.attempts,
        prompt_tokens=record.prompt_tokens,
        completion_tokens=record.completion_tokens,
        total_tokens=record.total_tokens,
        latency_ms=record.latency_ms,
        error_code=record.error_code,
        error_message=record.error_message,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    session.add(run)
    return run


async def _record_run(
    record: RunRecord,
    *,
    organization_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    entity_type: str | None,
    entity_id: uuid.UUID | None,
) -> AIRun:
    """Usage is recorded in its own transaction: it must count against the budget even
    when the caller's business transaction later fails or never commits."""
    async with get_sessionmaker()() as own:
        run = _persist(
            own, record, organization_id=organization_id, user_id=user_id, entity_type=entity_type, entity_id=entity_id
        )
        await own.commit()
        own.expunge(run)
    return run


async def run_agent(
    session: AsyncSession,
    *,
    organization: Organization,
    user_id: uuid.UUID | None,
    agent: Agent[Any, Any, FinalT],
    data: BaseModel | dict[str, Any],
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    use_cache: bool = True,
) -> tuple[AgentResult[FinalT], AIRun]:
    """Execute an agent for an organization, always persisting an ai_runs row.
    On failure the run is committed (so usage/errors are visible) and the
    AIError is re-raised for the API error handler."""
    # The subscription decides: active, the agent's module in the plan, and the daily budget.
    limit = await subscriptions.ai_daily_limit(session, organization, agent.name)
    used, _ = await tokens_used_today(session, organization.id)
    if used >= limit:
        raise AIBudgetExceededError("Daily AI token budget for this organization is exhausted")

    registry = get_ai_registry()
    slots = registry.candidates(allow_cloud=_allow_cloud(organization))
    cache = _CacheAdapter(await get_cache())
    # The model takes seconds to answer: hand this request's database connection back to the
    # pool meanwhile (when the transaction has only read), so AI traffic cannot starve the rest.
    await release_connection(session)
    for index, slot in enumerate(slots):
        assert slot.provider is not None and slot.tiers is not None
        runner = AgentRunner(slot.provider, slot.tiers, cache=cache, cache_namespace=str(organization.id))
        try:
            result = await runner.run(agent, data, use_cache=use_cache)
        except AIError as exc:
            if exc.run_record is not None:
                await _record_run(
                    exc.run_record,
                    organization_id=organization.id,
                    user_id=user_id,
                    entity_type=entity_type,
                    entity_id=entity_id,
                )
            if isinstance(exc, FAILOVER_ERRORS):
                registry.mark_failed(slot, exc)
                if index + 1 < len(slots):
                    logger.warning(
                        "agent %s: %s provider unavailable (%s), failing over to %s",
                        agent.name,
                        slot.name,
                        exc.code,
                        slots[index + 1].name,
                    )
                    continue
            logger.warning("agent %s failed: %s", agent.name, exc.code)
            raise
        registry.mark_ok(slot)
        run = await _record_run(
            result.record,
            organization_id=organization.id,
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        return result, run
    raise AINotConfiguredError("No AI provider configured")  # pragma: no cover — candidates() is never empty
