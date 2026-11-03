"""Anthropic provider. Structured output is obtained by forcing a single tool
call whose ``input_schema`` is the target JSON schema."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any

import anthropic

from ..errors import (
    AIAuthError,
    AIBadRequestError,
    AIError,
    AIProviderUnavailableError,
    AIRateLimitedError,
    AITimeoutError,
)
from .base import (
    AIProvider,
    GenerationOptions,
    GenerationResult,
    Message,
    ProviderCapabilities,
    ProviderHealth,
    Usage,
    split_system,
)

_DEFAULT_MAX_TOKENS = 4096


class AnthropicProvider(AIProvider):
    name = "anthropic"
    capabilities = ProviderCapabilities(native_json_schema=True, json_mode=True, streaming=True, embeddings=False)

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str | None = None,
        timeout_s: float = 90.0,
        max_retries: int = 2,
        name: str = "anthropic",
    ) -> None:
        self.name = name
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=max_retries
        )

    def _map_error(self, exc: Exception) -> AIError:
        if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
            return AIAuthError("anthropic: authentication failed — check the API key")
        if isinstance(exc, anthropic.RateLimitError):
            return AIRateLimitedError("anthropic: rate limit exceeded")
        if isinstance(exc, anthropic.APITimeoutError):
            return AITimeoutError("anthropic: request timed out")
        if isinstance(exc, anthropic.APIConnectionError):
            return AIProviderUnavailableError("anthropic: cannot reach the API")
        if isinstance(exc, anthropic.NotFoundError) and "model" in str(exc).lower():
            return AIProviderUnavailableError(f"anthropic: model unavailable ({str(exc)[:200]})")
        if isinstance(exc, anthropic.BadRequestError | anthropic.NotFoundError):
            return AIBadRequestError(f"anthropic: request rejected ({str(exc)[:200]})")
        return AIProviderUnavailableError(f"anthropic: unexpected error ({type(exc).__name__})")

    def _params(self, messages: Sequence[Message], options: GenerationOptions) -> dict[str, Any]:
        system, rest = split_system(messages)
        params: dict[str, Any] = {
            "model": options.model,
            "max_tokens": options.max_tokens or _DEFAULT_MAX_TOKENS,
            "messages": [{"role": m.role, "content": m.content} for m in rest],
        }
        if system:
            params["system"] = system
        if options.temperature is not None:
            params["temperature"] = options.temperature
        return params

    @staticmethod
    def _usage(resp: Any) -> Usage:
        u = getattr(resp, "usage", None)
        return Usage(
            prompt_tokens=getattr(u, "input_tokens", 0) or 0,
            completion_tokens=getattr(u, "output_tokens", 0) or 0,
        )

    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult:
        started = time.perf_counter()
        try:
            resp = await self._client.messages.create(**self._params(messages, options))
        except Exception as exc:
            raise self._map_error(exc) from exc
        text = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
        return GenerationResult(
            text=text,
            model=resp.model,
            provider=self.name,
            usage=self._usage(resp),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=resp.stop_reason,
        )

    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult:
        started = time.perf_counter()
        tool_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in schema_name)[:64] or "output"
        params = self._params(messages, options)
        params["tools"] = [
            {
                "name": tool_name,
                "description": "Return the final answer as structured data matching this schema.",
                "input_schema": json_schema,
            }
        ]
        params["tool_choice"] = {"type": "tool", "name": tool_name}
        try:
            resp = await self._client.messages.create(**params)
        except Exception as exc:
            raise self._map_error(exc) from exc
        payload: Any = None
        for block in resp.content:
            if getattr(block, "type", "") == "tool_use":
                payload = block.input
                break
        text = json.dumps(payload, ensure_ascii=False) if payload is not None else ""
        return GenerationResult(
            text=text,
            model=resp.model,
            provider=self.name,
            usage=self._usage(resp),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=resp.stop_reason,
        )

    async def stream(self, messages: Sequence[Message], options: GenerationOptions) -> AsyncIterator[str]:
        try:
            async with self._client.messages.stream(**self._params(messages, options)) as s:
                async for text in s.text_stream:
                    yield text
        except AIError:
            raise
        except Exception as exc:
            raise self._map_error(exc) from exc

    async def health(self) -> ProviderHealth:
        try:
            page = await self._client.models.list(limit=20)
            return ProviderHealth(ok=True, provider=self.name, models=tuple(m.id for m in page.data))
        except Exception as exc:
            return ProviderHealth(ok=False, provider=self.name, detail=self._map_error(exc).message)

    async def aclose(self) -> None:
        await self._client.close()
