"""Agent contract (AI_ARCHITECTURE.md §4).

An agent is pure configuration + prompt construction + deterministic
post-processing. Execution (provider call, validation, repair, caching, run
records) is centralized in :class:`meqyas_ai.runtime.AgentRunner`.
"""

from __future__ import annotations

import abc
from typing import Any, ClassVar, Generic, TypeVar

from pydantic import BaseModel

from ..providers.base import Message
from ..providers.factory import Tier

InT = TypeVar("InT", bound=BaseModel)
OutT = TypeVar("OutT", bound=BaseModel)
FinalT = TypeVar("FinalT", bound=BaseModel)


class Agent(abc.ABC, Generic[InT, OutT, FinalT]):
    #: Stable identifier, stored in ai_runs.agent
    name: ClassVar[str]
    #: Bump when the prompt changes materially (invalidates cache)
    prompt_version: ClassVar[str] = "1"
    input_model: ClassVar[type[BaseModel]]
    #: What the LLM must return (validated + repaired)
    output_model: ClassVar[type[BaseModel]]
    #: What the agent returns after post-processing (defaults to output_model)
    final_model: ClassVar[type[BaseModel] | None] = None
    tier: ClassVar[Tier] = "smart"
    temperature: ClassVar[float] = 0.3
    max_output_tokens: ClassVar[int] = 4000
    max_repairs: ClassVar[int] = 2
    cache_ttl_s: ClassVar[int] = 0

    @abc.abstractmethod
    def build_messages(self, data: InT) -> list[Message]:
        """Return [system, (developer as system), user-data] messages."""

    def semantic_issues(self, data: InT, output: OutT) -> list[str]:
        """Issues that should trigger a repair round even though the schema is valid."""
        return []

    def post_process(self, data: InT, output: OutT) -> FinalT:
        return output  # type: ignore[return-value]

    def output_budget(self, data: InT) -> int:
        """Max output tokens for this request. Providers such as Groq count the requested budget
        against per-request limits, so agents with variable output size request only what they need."""
        return self.max_output_tokens

    def cache_payload(self, data: InT) -> Any:
        return data.model_dump(mode="json")

    @classmethod
    def result_model(cls) -> type[BaseModel]:
        return cls.final_model or cls.output_model
