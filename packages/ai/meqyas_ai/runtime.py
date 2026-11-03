"""AgentRunner — executes agents with caching, structured output, repair and
run records. Framework-agnostic: the API persists ``RunRecord``s to ai_runs."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, Protocol, TypeVar

from pydantic import BaseModel

from .agents.base import Agent
from .errors import AIError
from .providers.base import AIProvider, GenerationOptions
from .providers.factory import ModelTiers
from .structured import StructuredOutputEngine

FinalT = TypeVar("FinalT", bound=BaseModel)
RunStatus = Literal["SUCCESS", "REPAIRED", "CACHED", "FAILED"]


class AICache(Protocol):
    async def get(self, key: str) -> str | None: ...

    async def set(self, key: str, value: str, ttl_s: int) -> None: ...


@dataclass(slots=True)
class RunRecord:
    agent: str
    provider: str
    model: str
    input_hash: str
    prompt_version: str
    status: RunStatus
    attempts: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    error_code: str | None = None
    error_message: str | None = None

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(slots=True)
class AgentResult(Generic[FinalT]):
    output: FinalT
    record: RunRecord
    semantic_issues: list[str] = field(default_factory=list)


def canonical_hash(payload: Any) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class AgentRunner:
    def __init__(
        self,
        provider: AIProvider,
        tiers: ModelTiers,
        *,
        cache: AICache | None = None,
        engine: StructuredOutputEngine | None = None,
        cache_namespace: str = "global",
    ) -> None:
        self.provider = provider
        self.tiers = tiers
        self.cache = cache
        self.engine = engine or StructuredOutputEngine()
        #: Cache entries are isolated per namespace (the API uses the organization id).
        self.cache_namespace = cache_namespace

    def model_for(self, agent: Agent[Any, Any, Any]) -> str:
        return self.tiers.for_tier(agent.tier)

    async def run(
        self,
        agent: Agent[Any, Any, FinalT],
        data: BaseModel | dict[str, Any],
        *,
        use_cache: bool = True,
    ) -> AgentResult[FinalT]:
        parsed = agent.input_model.model_validate(data if isinstance(data, dict) else data.model_dump())
        model = self.model_for(agent)
        input_hash = canonical_hash(
            {"agent": agent.name, "v": agent.prompt_version, "model": model, "input": agent.cache_payload(parsed)}
        )
        cache_key = f"ai:{self.cache_namespace}:{agent.name}:{input_hash}"
        result_model = agent.result_model()

        if use_cache and self.cache is not None and agent.cache_ttl_s > 0:
            cached = await self.cache.get(cache_key)
            if cached:
                try:
                    output = result_model.model_validate_json(cached)
                except ValueError:
                    output = None
                if output is not None:
                    record = RunRecord(
                        agent=agent.name,
                        provider=self.provider.name,
                        model=model,
                        input_hash=input_hash,
                        prompt_version=agent.prompt_version,
                        status="CACHED",
                    )
                    return AgentResult(output=output, record=record)  # type: ignore[arg-type]

        started = time.perf_counter()
        options = GenerationOptions(model=model, temperature=agent.temperature, max_tokens=agent.output_budget(parsed))
        try:
            structured = await self.engine.run(
                self.provider,
                agent.build_messages(parsed),
                agent.output_model,
                options,
                schema_name=agent.name,
                max_repairs=agent.max_repairs,
                semantic_validator=lambda out: agent.semantic_issues(parsed, out),
            )
            final = agent.post_process(parsed, structured.value)
        except AIError as exc:
            usage = exc.details.get("usage", {}) if isinstance(exc.details, dict) else {}
            # Field paths + messages only (never model output) so failures stay diagnosable.
            problems = exc.details.get("problems") if isinstance(exc.details, dict) else None
            summary = f"{exc.message} {' '.join(problems[:2])}" if problems else exc.message
            exc.run_record = RunRecord(
                agent=agent.name,
                provider=self.provider.name,
                model=model,
                input_hash=input_hash,
                prompt_version=agent.prompt_version,
                status="FAILED",
                attempts=int(exc.details.get("attempts", 1)) if isinstance(exc.details, dict) else 1,
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=exc.code,
                error_message=summary[:300],
            )
            raise

        record = RunRecord(
            agent=agent.name,
            provider=structured.provider,
            model=structured.model or model,
            input_hash=input_hash,
            prompt_version=agent.prompt_version,
            status="REPAIRED" if structured.attempts > 1 else "SUCCESS",
            attempts=structured.attempts,
            prompt_tokens=structured.usage.prompt_tokens,
            completion_tokens=structured.usage.completion_tokens,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        if self.cache is not None and agent.cache_ttl_s > 0:
            await self.cache.set(cache_key, final.model_dump_json(), agent.cache_ttl_s)
        return AgentResult(output=final, record=record, semantic_issues=structured.semantic_issues)
