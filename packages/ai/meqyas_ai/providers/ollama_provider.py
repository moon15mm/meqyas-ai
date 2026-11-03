"""Ollama provider — local/private LLMs. Respondent data never leaves the
organization's infrastructure when this provider is used."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from ..errors import (
    AIBadRequestError,
    AIError,
    AIProviderUnavailableError,
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


class OllamaProvider(AIProvider):
    name = "ollama"
    capabilities = ProviderCapabilities(native_json_schema=True, json_mode=True, streaming=True, embeddings=True)

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:11434",
        timeout_s: float = 180.0,
        keep_alive: str = "10m",
        num_ctx: int | None = 8192,
        think: bool | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._keep_alive = keep_alive
        self._num_ctx = num_ctx
        self._think = think
        self._client = client or httpx.AsyncClient(base_url=self._base_url, timeout=timeout_s)

    def _payload(self, messages: Sequence[Message], options: GenerationOptions, **extra: Any) -> dict[str, Any]:
        opts: dict[str, Any] = {}
        if options.temperature is not None:
            opts["temperature"] = options.temperature
        if options.max_tokens:
            opts["num_predict"] = options.max_tokens
        if self._num_ctx:
            opts["num_ctx"] = self._num_ctx
        payload: dict[str, Any] = {
            "model": options.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "options": opts,
            "keep_alive": self._keep_alive,
            **extra,
        }
        if self._think is not None:
            payload["think"] = self._think
        return payload

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = await self._client.post(path, json=payload)
        except httpx.TimeoutException as exc:
            raise AITimeoutError("ollama: request timed out (is the model loaded?)") from exc
        except httpx.HTTPError as exc:
            raise AIProviderUnavailableError(f"ollama: cannot reach {self._base_url} — is Ollama running?") from exc
        if resp.status_code == 404:
            raise AIBadRequestError(
                f"ollama: model '{payload.get('model')}' not found — run `ollama pull {payload.get('model')}`"
            )
        if resp.status_code >= 400:
            raise AIBadRequestError(f"ollama: error {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    def _result(self, data: dict[str, Any], started: float, model: str) -> GenerationResult:
        return GenerationResult(
            text=(data.get("message") or {}).get("content", ""),
            model=data.get("model", model),
            provider=self.name,
            usage=Usage(
                prompt_tokens=int(data.get("prompt_eval_count") or 0),
                completion_tokens=int(data.get("eval_count") or 0),
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=data.get("done_reason"),
        )

    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult:
        started = time.perf_counter()
        data = await self._post("/api/chat", self._payload(messages, options, stream=False))
        return self._result(data, started, options.model)

    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult:
        started = time.perf_counter()
        data = await self._post("/api/chat", self._payload(messages, options, stream=False, format=json_schema))
        return self._result(data, started, options.model)

    async def stream(self, messages: Sequence[Message], options: GenerationOptions) -> AsyncIterator[str]:
        payload = self._payload(messages, options, stream=True)
        try:
            async with self._client.stream("POST", "/api/chat", json=payload) as resp:
                if resp.status_code >= 400:
                    raise AIBadRequestError(f"ollama: error {resp.status_code}")
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    content = (chunk.get("message") or {}).get("content")
                    if content:
                        yield content
                    if chunk.get("done"):
                        break
        except AIError:
            raise
        except httpx.HTTPError as exc:
            raise AIProviderUnavailableError("ollama: stream interrupted") from exc

    async def embed(self, texts: Sequence[str], *, model: str) -> EmbeddingResult:
        data = await self._post("/api/embed", {"model": model, "input": list(texts)})
        return EmbeddingResult(
            vectors=data.get("embeddings", []),
            model=model,
            usage=Usage(prompt_tokens=int(data.get("prompt_eval_count") or 0)),
        )

    async def health(self) -> ProviderHealth:
        try:
            resp = await self._client.get("/api/tags", timeout=5.0)
            resp.raise_for_status()
            models = tuple(m.get("name", "") for m in resp.json().get("models", []))
            return ProviderHealth(ok=True, provider=self.name, models=models)
        except Exception:
            return ProviderHealth(ok=False, provider=self.name, detail=f"Ollama not reachable at {self._base_url}")

    async def aclose(self) -> None:
        await self._client.aclose()
