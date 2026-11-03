from __future__ import annotations

from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Query
from sqlalchemy import select

from ...core.config import get_settings
from ...domain.permissions import Permission
from ...models import AIRun
from ...schemas.ai import AIRunOut, AIStatusOut, AIUsageOut
from ...services import subscriptions
from ...services.ai import get_ai_registry, tokens_used_today
from ..deps import DB, Ctx, CurrentUser

router = APIRouter(prefix="/ai", tags=["ai"])

_KNOWN_HOSTS = {
    "api.groq.com": "Groq",
    "openrouter.ai": "OpenRouter",
    "api.together.xyz": "Together AI",
    "api.deepseek.com": "DeepSeek",
    "api.mistral.ai": "Mistral",
    "api.openai.com": "OpenAI",
}


def provider_label(provider: str | None) -> str | None:
    """Human-friendly provider name for the UI (never exposes keys or full URLs)."""
    if provider is None:
        return None
    if provider == "openai":
        return "OpenAI"
    if provider == "anthropic":
        return "Anthropic"
    if provider == "ollama":
        return "Ollama (local)"
    if provider == "openai_compatible":
        return _host_label(get_settings().openai_base_url)
    if provider.startswith("fallback:"):
        settings = get_settings()
        if settings.ai_fallback_provider == "anthropic":
            return "Anthropic"
        if settings.ai_fallback_provider == "openai" and not settings.ai_fallback_base_url:
            return "OpenAI"
        return _host_label(settings.ai_fallback_base_url)
    return provider


def _host_label(url: str | None) -> str:
    host = urlparse(url or "").hostname or ""
    if host in ("localhost", "127.0.0.1"):
        return "Local OpenAI-compatible server"
    return _KNOWN_HOSTS.get(host, host or "OpenAI-compatible")


@router.get("/status", response_model=AIStatusOut)
async def ai_status(_: CurrentUser, check: Annotated[bool, Query()] = False) -> AIStatusOut:
    reg = get_ai_registry()
    primary = reg.primary
    configured_slot = primary if primary.provider is not None else reg.local
    out = AIStatusOut(
        configured=configured_slot.provider is not None,
        provider=configured_slot.provider.name if configured_slot.provider else get_settings().ai_provider,
        provider_label=provider_label(configured_slot.provider.name) if configured_slot.provider else None,
        model_fast=configured_slot.tiers.fast if configured_slot.tiers else None,
        model_smart=configured_slot.tiers.smart if configured_slot.tiers else None,
        local_enabled=reg.local.provider is not None,
        local_provider_models=(
            {"fast": reg.local.tiers.fast, "smart": reg.local.tiers.smart} if reg.local.tiers else None
        ),
        reason=None if configured_slot.provider is not None else primary.reason,
    )
    fallback = reg.fallback
    if fallback.provider is not None and fallback.tiers is not None:
        out.fallback_configured = True
        out.fallback_provider_label = provider_label(fallback.provider.name)
        out.fallback_model_fast = fallback.tiers.fast
        out.fallback_model_smart = fallback.tiers.smart
    elif get_settings().ai_fallback_provider != "none":
        out.fallback_reason = fallback.reason  # configured but unusable (e.g. a missing key)
    if check and configured_slot.provider is not None:
        health = await configured_slot.provider.health()
        out.healthy = health.ok
        out.health_detail = health.detail or None
    if check and fallback.provider is not None:
        health = await fallback.provider.health()
        out.fallback_healthy = health.ok
        out.fallback_health_detail = health.detail or None
    return out


@router.get("/usage", response_model=AIUsageOut)
async def ai_usage(ctx: Ctx, session: DB) -> AIUsageOut:
    tokens, runs = await tokens_used_today(session, ctx.organization_id)
    limit = (await subscriptions.for_context(session, ctx)).limit("ai_daily_tokens") or 0
    return AIUsageOut(today_tokens=tokens, daily_limit=limit, runs_today=runs)


@router.get("/runs", response_model=list[AIRunOut])
async def ai_runs(
    ctx: Ctx,
    session: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AIRunOut]:
    ctx.require(Permission.AI_USAGE_READ)
    rows = await session.scalars(
        select(AIRun).where(AIRun.organization_id == ctx.organization_id).order_by(AIRun.created_at.desc()).limit(limit)
    )
    return [AIRunOut.model_validate(r) for r in rows.all()]
