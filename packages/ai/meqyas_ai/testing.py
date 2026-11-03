"""Deterministic provider for automated tests ONLY.

It replays scripted outputs so agent pipelines (validation, repair, caching,
post-processing) can be tested without network access. It is never wired into
the application's provider factory.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Sequence
from typing import Any

from .providers.base import (
    AIProvider,
    GenerationOptions,
    GenerationResult,
    Message,
    ProviderCapabilities,
    Usage,
)

Script = str | dict[str, Any] | Callable[[Sequence[Message], dict[str, Any] | None], str | dict[str, Any]]


class ScriptedProvider(AIProvider):
    name = "scripted"

    def __init__(self, outputs: Sequence[Script], *, native_json_schema: bool = True) -> None:
        self._outputs = list(outputs)
        self.calls: list[dict[str, Any]] = []
        self.capabilities = ProviderCapabilities(
            native_json_schema=native_json_schema, json_mode=True, streaming=True, embeddings=False
        )

    def _next(self, messages: Sequence[Message], schema: dict[str, Any] | None) -> str:
        if not self._outputs:
            raise AssertionError("ScriptedProvider ran out of scripted outputs")
        item = self._outputs.pop(0)
        if callable(item):
            item = item(messages, schema)
        return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)

    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult:
        self.calls.append({"kind": "generate", "messages": list(messages), "options": options})
        return GenerationResult(
            text=self._next(messages, None), model=options.model, provider=self.name, usage=Usage(10, 20)
        )

    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult:
        self.calls.append({"kind": "structured", "messages": list(messages), "options": options, "schema": json_schema})
        return GenerationResult(
            text=self._next(messages, json_schema), model=options.model, provider=self.name, usage=Usage(100, 200)
        )

    async def stream(self, messages: Sequence[Message], options: GenerationOptions) -> AsyncIterator[str]:
        text = self._next(messages, None)
        for i in range(0, len(text), 8):
            yield text[i : i + 8]


class MemoryCache:
    """Simple async cache used by tests (and as the API's no-Redis fallback shape)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ttl_s: int) -> None:
        self.store[key] = value
