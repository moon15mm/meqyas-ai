"""Builds providers from plain configuration (no dependency on the web app)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..errors import AINotConfiguredError
from .base import AIProvider

ProviderName = Literal["openai", "openai_compatible", "ollama", "meta_llama", "anthropic", "none"]
Tier = Literal["fast", "smart"]

#: Sensible defaults per provider: (fast/cheap model, smart/powerful model).
#: All of them are overridable with AI_MODEL_FAST / AI_MODEL_SMART.
DEFAULT_MODELS: dict[str, tuple[str, str]] = {
    "openai": ("gpt-4.1-mini", "gpt-4.1"),
    "ollama": ("llama3.2:3b", "llama3.3:70b"),
    "meta_llama": ("meta-llama/Llama-3.2-3B-Instruct", "meta-llama/Llama-3.3-70B-Instruct"),
    "anthropic": ("claude-haiku-5-5", "claude-sonnet-5-5"),
}


@dataclass(frozen=True, slots=True)
class ModelTiers:
    fast: str
    smart: str

    def for_tier(self, tier: Tier) -> str:
        return self.smart if tier == "smart" else self.fast


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    provider: ProviderName = "none"
    model_fast: str | None = None
    model_smart: str | None = None
    timeout_s: float = 90.0
    #: SDK-level retries on 429/5xx/timeouts. Lower when a fallback provider exists, so an
    #: outage reaches the fallback in seconds instead of minutes.
    max_retries: int = 2
    #: Name recorded in ai_runs and shown in settings (defaults to the provider kind).
    name: str | None = None
    # OpenAI & compatible
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_structured_mode: Literal["json_schema", "json_object", "none"] = "json_schema"
    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model_fast: str | None = None
    ollama_model_smart: str | None = None
    # Anthropic
    anthropic_api_key: str | None = None


def _tiers(provider: str, fast: str | None, smart: str | None) -> ModelTiers:
    default_fast, default_smart = DEFAULT_MODELS.get(provider, (None, None))  # type: ignore[assignment]
    fast = fast or default_fast or smart
    smart = smart or default_smart or fast
    if not fast or not smart:
        raise AINotConfiguredError(
            f"No model configured for provider '{provider}'. Set AI_MODEL_FAST and AI_MODEL_SMART."
        )
    return ModelTiers(fast=fast, smart=smart)


def build_provider(cfg: ProviderConfig) -> tuple[AIProvider, ModelTiers]:
    """Return a ready provider and its model tiers, or raise AINotConfiguredError
    with an actionable message."""
    name = cfg.provider
    if name == "openai":
        if not cfg.openai_api_key:
            raise AINotConfiguredError("AI_PROVIDER=openai but OPENAI_API_KEY is not set.")
        from .openai_provider import OpenAIProvider

        provider: AIProvider = OpenAIProvider(
            api_key=cfg.openai_api_key,
            base_url=cfg.openai_base_url,
            name=cfg.name or "openai",
            structured_mode=cfg.openai_structured_mode,
            timeout_s=cfg.timeout_s,
            max_retries=cfg.max_retries,
        )
        return provider, _tiers("openai", cfg.model_fast, cfg.model_smart)

    if name == "meta_llama":
        from .openai_provider import OpenAIProvider

        # Default to Groq or custom vLLM/OpenAI-compatible inference gateway for Meta Llama
        base_url = cfg.openai_base_url or "https://api.groq.com/openai/v1"
        provider = OpenAIProvider(
            api_key=cfg.openai_api_key or "not-needed",
            base_url=base_url,
            name=cfg.name or "meta_llama",
            structured_mode=cfg.openai_structured_mode,
            timeout_s=cfg.timeout_s,
            max_retries=cfg.max_retries,
        )
        fast = cfg.model_fast
        smart = cfg.model_smart
        # Use Groq native model IDs if targeting Groq without explicit model overrides
        if "groq.com" in base_url.lower():
            fast = fast or "llama-3.1-8b-instant"
            smart = smart or "llama-3.3-70b-versatile"
        return provider, _tiers("meta_llama", fast, smart)

    if name == "openai_compatible":
        if not cfg.openai_base_url:
            raise AINotConfiguredError("AI_PROVIDER=openai_compatible requires OPENAI_BASE_URL.")
        from .openai_provider import OpenAIProvider

        provider = OpenAIProvider(
            api_key=cfg.openai_api_key or "not-needed",
            base_url=cfg.openai_base_url,
            name=cfg.name or "openai_compatible",
            structured_mode=cfg.openai_structured_mode,
            timeout_s=cfg.timeout_s,
            max_retries=cfg.max_retries,
        )
        return provider, _tiers("openai_compatible", cfg.model_fast, cfg.model_smart)

    if name == "ollama":
        return build_ollama(cfg)

    if name == "anthropic":
        if not cfg.anthropic_api_key:
            raise AINotConfiguredError("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.")
        from .anthropic_provider import AnthropicProvider

        provider = AnthropicProvider(
            api_key=cfg.anthropic_api_key,
            timeout_s=cfg.timeout_s,
            max_retries=cfg.max_retries,
            name=cfg.name or "anthropic",
        )
        return provider, _tiers("anthropic", cfg.model_fast, cfg.model_smart)

    raise AINotConfiguredError(
        "No AI provider configured. Set AI_PROVIDER (meta_llama | openai | openai_compatible | ollama | anthropic)."
    )


def build_ollama(cfg: ProviderConfig) -> tuple[AIProvider, ModelTiers]:
    from .ollama_provider import OllamaProvider

    provider = OllamaProvider(base_url=cfg.ollama_base_url, timeout_s=max(cfg.timeout_s, 180.0))
    fast = cfg.ollama_model_fast or (cfg.model_fast if cfg.provider == "ollama" else None)
    smart = cfg.ollama_model_smart or (cfg.model_smart if cfg.provider == "ollama" else None)
    return provider, _tiers("ollama", fast, smart)
