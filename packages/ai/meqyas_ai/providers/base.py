"""The AIProvider contract.

The rest of the platform only depends on this module. Adding a provider
(Gemini, OpenRouter-native, llama.cpp…) means implementing ``AIProvider``
and registering it in ``factory.py`` — nothing else changes.
"""

from __future__ import annotations

import abc
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class Message:
    role: Role
    content: str


@dataclass(slots=True)
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: Usage) -> Usage:
        return Usage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
        )


@dataclass(slots=True)
class GenerationResult:
    text: str
    model: str
    provider: str
    usage: Usage = field(default_factory=Usage)
    latency_ms: int = 0
    finish_reason: str | None = None


@dataclass(slots=True)
class EmbeddingResult:
    vectors: list[list[float]]
    model: str
    usage: Usage = field(default_factory=Usage)


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    #: Provider enforces a JSON schema natively (OpenAI json_schema, Ollama format, Anthropic tools).
    native_json_schema: bool = False
    #: Provider can force syntactically valid JSON (json_object mode).
    json_mode: bool = False
    streaming: bool = True
    embeddings: bool = False


@dataclass(frozen=True, slots=True)
class GenerationOptions:
    model: str
    temperature: float | None = None
    max_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class ProviderHealth:
    ok: bool
    provider: str
    detail: str = ""
    models: tuple[str, ...] = ()


class AIProvider(abc.ABC):
    """Uniform interface over LLM vendors.

    ``generate_structured`` returns the raw JSON *text* produced under the
    provider's strongest available constraint; validation and repair are the
    job of :mod:`meqyas_ai.structured` so behaviour is identical across vendors.
    """

    name: str = "abstract"
    capabilities: ProviderCapabilities = ProviderCapabilities()

    @abc.abstractmethod
    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult: ...

    @abc.abstractmethod
    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult: ...

    @abc.abstractmethod
    def stream(self, messages: Sequence[Message], options: GenerationOptions) -> AsyncIterator[str]: ...

    async def embed(self, texts: Sequence[str], *, model: str) -> EmbeddingResult:
        from ..errors import AIUnsupportedOperationError

        raise AIUnsupportedOperationError(f"Provider '{self.name}' does not support embeddings")

    async def health(self) -> ProviderHealth:
        return ProviderHealth(ok=True, provider=self.name)

    async def aclose(self) -> None:  # pragma: no cover - default no-op
        return None


def split_system(messages: Sequence[Message]) -> tuple[str, list[Message]]:
    """Separate system messages (joined) from the conversation — used by vendors
    whose API takes the system prompt as a dedicated field."""
    system_parts = [m.content for m in messages if m.role == "system"]
    rest = [m for m in messages if m.role != "system"]
    return "\n\n".join(system_parts), rest
