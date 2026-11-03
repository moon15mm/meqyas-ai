"""OpenAI provider — also serves every OpenAI-compatible API (OpenRouter, Groq,
vLLM, LM Studio, Azure OpenAI gateway…) through ``base_url``."""

from __future__ import annotations

import re
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any, Literal

import openai
from openai import AsyncOpenAI

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
    EmbeddingResult,
    GenerationOptions,
    GenerationResult,
    Message,
    ProviderCapabilities,
    ProviderHealth,
    Usage,
)

StructuredMode = Literal["json_schema", "json_object", "none"]

# Reasoning-family models reject `temperature` and use `max_completion_tokens`.
_REASONING_MODEL = re.compile(r"^(o\d|gpt-5)", re.IGNORECASE)
# The provider no longer serves the model (retired, renamed, not enabled for this key): an
# availability problem, not a bad request — another provider may still serve it.
_MODEL_GONE_CODES = {"model_not_found", "model_decommissioned", "model_not_active"}
_MODEL_GONE = re.compile(
    r"model\b.{0,80}\b(decommissioned|deprecated|not found|does not exist|no longer|not available|unavailable)",
    re.IGNORECASE,
)


def model_unavailable(exc: Exception) -> bool:
    texts = [_short(exc)]
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error") if isinstance(body.get("error"), dict) else body
        if error.get("code") in _MODEL_GONE_CODES:
            return True
        texts.append(str(error.get("message") or "")[:300])
    return any(_MODEL_GONE.search(text) for text in texts)


class OpenAIProvider(AIProvider):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str | None = None,
        name: str = "openai",
        structured_mode: StructuredMode = "json_schema",
        timeout_s: float = 90.0,
        max_retries: int = 2,
        default_headers: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        self._is_official = base_url is None or "api.openai.com" in (base_url or "")
        self._structured_mode: StructuredMode = structured_mode
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout_s,
            max_retries=max_retries,
            default_headers=default_headers,
        )
        self._no_temperature_models: set[str] = set()

    @property
    def capabilities(self) -> ProviderCapabilities:  # type: ignore[override]
        return ProviderCapabilities(
            native_json_schema=self._structured_mode == "json_schema",
            json_mode=self._structured_mode in ("json_schema", "json_object"),
            streaming=True,
            embeddings=True,
        )

    # ------------------------------------------------------------------ helpers
    def _params(self, options: GenerationOptions) -> dict[str, Any]:
        params: dict[str, Any] = {"model": options.model}
        reasoning = bool(_REASONING_MODEL.match(options.model))
        if options.temperature is not None and not reasoning and options.model not in self._no_temperature_models:
            params["temperature"] = options.temperature
        if options.max_tokens:
            if self._is_official:
                params["max_completion_tokens"] = options.max_tokens
            else:
                params["max_tokens"] = options.max_tokens
        return params

    @staticmethod
    def _messages(messages: Sequence[Message]) -> list[dict[str, str]]:
        return [{"role": m.role, "content": m.content} for m in messages]

    def _map_error(self, exc: Exception) -> AIError:
        if isinstance(exc, openai.AuthenticationError | openai.PermissionDeniedError):
            return AIAuthError(f"{self.name}: authentication failed — check the API key")
        if isinstance(exc, openai.RateLimitError):
            return AIRateLimitedError(f"{self.name}: rate limit or quota exceeded")
        if isinstance(exc, openai.APITimeoutError):
            return AITimeoutError(f"{self.name}: request timed out")
        if isinstance(exc, openai.APIConnectionError):
            return AIProviderUnavailableError(f"{self.name}: cannot reach the API")
        if isinstance(exc, openai.BadRequestError | openai.NotFoundError | openai.UnprocessableEntityError):
            if model_unavailable(exc):
                return AIProviderUnavailableError(f"{self.name}: model unavailable ({_short(exc)})")
            return AIBadRequestError(f"{self.name}: request rejected ({_short(exc)})")
        if isinstance(exc, openai.APIStatusError):
            return AIProviderUnavailableError(f"{self.name}: upstream error {exc.status_code}")
        return AIProviderUnavailableError(f"{self.name}: unexpected error ({type(exc).__name__})")

    async def _create(self, **kwargs: Any) -> Any:
        """Call chat.completions with automatic downgrades for compatible APIs:
        drop `temperature` if refused, fall back from json_schema to json_object."""
        try:
            return await self._client.chat.completions.create(**kwargs)
        except openai.BadRequestError as exc:
            text = _short(exc).lower()
            if "temperature" in text and "temperature" in kwargs:
                self._no_temperature_models.add(kwargs["model"])
                kwargs.pop("temperature")
                return await self._create(**kwargs)
            rf = kwargs.get("response_format") or {}
            if rf.get("type") == "json_schema" and ("response_format" in text or "json_schema" in text):
                self._structured_mode = "json_object"
                kwargs["response_format"] = {"type": "json_object"}
                return await self._create(**kwargs)
            raise

    def _result(self, resp: Any, started: float) -> GenerationResult:
        choice = resp.choices[0]
        usage = getattr(resp, "usage", None)
        return GenerationResult(
            text=(choice.message.content or ""),
            model=getattr(resp, "model", "") or "",
            provider=self.name,
            usage=Usage(
                prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=choice.finish_reason,
        )

    # --------------------------------------------------------------- interface
    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult:
        started = time.perf_counter()
        try:
            resp = await self._create(messages=self._messages(messages), **self._params(options))
        except Exception as exc:
            raise self._map_error(exc) from exc
        return self._result(resp, started)

    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult:
        started = time.perf_counter()
        params = self._params(options)
        if self._structured_mode == "json_schema":
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name[:64], "schema": json_schema, "strict": True},
            }
        elif self._structured_mode == "json_object":
            params["response_format"] = {"type": "json_object"}
        try:
            resp = await self._create(messages=self._messages(messages), **params)
        except openai.BadRequestError as exc:
            # Some compatible APIs (e.g. Groq) validate the schema server-side and reject
            # the generation instead of returning it. Hand the rejected text to the
            # structured-output engine so Pydantic validation + repair can fix it.
            failed = _failed_generation(exc)
            if failed is None:
                raise self._map_error(exc) from exc
            # Usage is not reported for rejected generations: estimate it so budgets stay honest.
            prompt_chars = sum(len(m.content) for m in messages)
            return GenerationResult(
                text=failed,
                model=options.model,
                provider=self.name,
                usage=Usage(prompt_tokens=prompt_chars // 3, completion_tokens=len(failed) // 3),
                latency_ms=int((time.perf_counter() - started) * 1000),
                finish_reason="schema_validation_failed",
            )
        except Exception as exc:
            raise self._map_error(exc) from exc
        return self._result(resp, started)

    async def stream(self, messages: Sequence[Message], options: GenerationOptions) -> AsyncIterator[str]:
        try:
            resp = await self._create(messages=self._messages(messages), stream=True, **self._params(options))
            async for chunk in resp:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except AIError:
            raise
        except Exception as exc:
            raise self._map_error(exc) from exc

    async def embed(self, texts: Sequence[str], *, model: str) -> EmbeddingResult:
        try:
            resp = await self._client.embeddings.create(model=model, input=list(texts))
        except Exception as exc:
            raise self._map_error(exc) from exc
        usage = getattr(resp, "usage", None)
        return EmbeddingResult(
            vectors=[d.embedding for d in resp.data],
            model=model,
            usage=Usage(prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0),
        )

    async def health(self) -> ProviderHealth:
        try:
            page = await self._client.models.list()
            ids = tuple(m.id for m in page.data[:50])
            return ProviderHealth(ok=True, provider=self.name, models=ids)
        except Exception as exc:
            return ProviderHealth(ok=False, provider=self.name, detail=self._map_error(exc).message)

    async def aclose(self) -> None:
        await self._client.close()


def _short(exc: Exception) -> str:
    msg = getattr(exc, "message", None) or str(exc)
    return msg[:300]


def _failed_generation(exc: openai.BadRequestError) -> str | None:
    """Extract the rejected output of a server-side schema validation failure, if any."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error", body)
        if isinstance(error, dict) and error.get("code") == "json_validate_failed":
            failed = error.get("failed_generation")
            if isinstance(failed, str) and failed.strip():
                return failed
    return None
