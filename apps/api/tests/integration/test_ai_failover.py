"""AI resilience (AI_ARCHITECTURE.md §11): a second provider takes over when the primary cannot
serve, failing providers cool down, and no database connection is held while a model thinks."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.db.session import get_engine, get_sessionmaker, release_connection
from app.models import AIRun, AuditLog
from app.services.ai import get_ai_registry, set_ai_registry
from conftest import scripted_registry
from meqyas_ai.errors import AIBadRequestError, AIRateLimitedError
from meqyas_ai.providers.base import GenerationOptions, GenerationResult, Message
from meqyas_ai.testing import ScriptedProvider
from plan_fixtures import impact_plan
from sqlalchemy import select, text

REQUEST = "أريد قياس أثر برنامج تدريبي للمعلمين على استخدام أدوات الذكاء الاصطناعي في التعليم."


class FailingProvider(ScriptedProvider):
    """Always fails with the given error (a rate-limited, down or misconfigured provider)."""

    def __init__(self, error: Exception, name: str = "primary-test") -> None:
        super().__init__([])
        self.error = error
        self.name = name

    async def generate(self, messages: Sequence[Message], options: GenerationOptions) -> GenerationResult:
        self.calls.append({"kind": "generate"})
        raise self.error

    async def generate_structured(
        self,
        messages: Sequence[Message],
        options: GenerationOptions,
        *,
        schema_name: str,
        json_schema: dict[str, Any],
    ) -> GenerationResult:
        self.calls.append({"kind": "structured"})
        raise self.error


async def _architect(client, owner, n: int = 1):  # type: ignore[no-untyped-def]
    # A different request each time: identical ones are served from the AI cache, without any provider.
    body = {"request": f"{REQUEST} (المجموعة {n})"}
    return await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json=body)


async def _runs() -> list[AIRun]:
    async with get_sessionmaker()() as session:
        return list((await session.scalars(select(AIRun).order_by(AIRun.created_at))).all())


async def test_fallback_takes_over_and_the_failing_provider_cools_down(client, register) -> None:
    owner = await register()
    primary = FailingProvider(AIRateLimitedError("groq: rate limit or quota exceeded"))
    fallback = ScriptedProvider([impact_plan(), impact_plan(), impact_plan()])
    fallback.name = "fallback:openrouter.ai"
    set_ai_registry(scripted_registry(primary, fallback))
    try:
        first = await _architect(client, owner)
        assert first.status_code == 201, first.text
        runs = await _runs()
        assert [(r.provider, r.status.value, r.error_code) for r in runs] == [
            ("primary-test", "FAILED", "ai_rate_limited"),  # the failed attempt is recorded (and budgeted)
            ("fallback:openrouter.ai", "SUCCESS", None),
        ]
        plan = first.json()
        async with get_sessionmaker()() as session:
            assert await session.scalar(select(AuditLog.id).where(AuditLog.entity_id == plan["id"]))

        # While the primary cools down it is not even tried: no extra latency for anyone.
        second = await _architect(client, owner, 2)
        assert second.status_code == 201 and len(primary.calls) == 1

        # After the cool-down it is tried again first (and fails over again).
        get_ai_registry()._cooldown_until.clear()  # type: ignore[attr-defined]
        third = await _architect(client, owner, 3)
        assert third.status_code == 201 and len(primary.calls) == 2
        assert len(await _runs()) == 5
    finally:
        set_ai_registry(None)


async def test_only_availability_errors_fail_over(client, register) -> None:
    owner = await register()
    primary = FailingProvider(AIBadRequestError("primary-test: request rejected (context too long)"))
    fallback = ScriptedProvider([impact_plan()])
    set_ai_registry(scripted_registry(primary, fallback))
    try:
        res = await _architect(client, owner)
        assert res.status_code >= 400 and res.json()["error"]["code"] == "ai_bad_request"
        assert fallback.calls == []  # a request that is itself wrong would fail anywhere
    finally:
        set_ai_registry(None)


async def test_without_a_fallback_the_error_reaches_the_user(client, register) -> None:
    owner = await register()
    set_ai_registry(scripted_registry(FailingProvider(AIRateLimitedError("groq: rate limit"))))
    try:
        res = await _architect(client, owner)
        assert res.status_code == 429 or res.json()["error"]["code"] == "ai_rate_limited"
    finally:
        set_ai_registry(None)


async def test_no_database_connection_is_held_while_the_model_thinks(client, register) -> None:
    owner = await register()
    seen: list[int] = []

    def plan_after_checking(_messages: Any, _schema: Any) -> dict[str, Any]:
        seen.append(get_engine().pool.checkedout())
        return impact_plan()

    set_ai_registry(scripted_registry(ScriptedProvider([plan_after_checking])))
    try:
        res = await _architect(client, owner)
        assert res.status_code == 201, res.text
        assert seen == [0]  # the request's connection went back to the pool during the AI call
    finally:
        set_ai_registry(None)


async def test_release_connection_keeps_transactions_that_wrote() -> None:
    async with get_sessionmaker()() as session:
        await session.execute(text("SELECT 1"))
        await release_connection(session)
        assert not session.in_transaction()  # a read-only transaction ends

        await session.execute(text("CREATE TEMP TABLE IF NOT EXISTS release_probe (n int)"))
        session.add(AIRun(agent="probe", provider="p", model="m", input_hash="h", status="SUCCESS"))
        await session.flush()
        await release_connection(session)
        assert session.in_transaction()  # flushed writes stay in their transaction
        await session.rollback()
        assert not session.in_transaction()
        await session.execute(text("SELECT 1"))
        await release_connection(session)
        assert not session.in_transaction()  # the write marker was cleared by the rollback
