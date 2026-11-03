"""API test harness: real PostgreSQL (meqyas_test), migrations applied once,
tables truncated between tests, AI provider replaced by a scripted fake."""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator, Callable, Sequence
from pathlib import Path
from typing import Any

# ---- environment must be set before the app is imported -------------------
sys.path.insert(0, str(Path(__file__).parent))
from helpers import TEST_DB, run_alembic

os.environ.update(
    {
        "DATABASE_URL": TEST_DB,
        "ENVIRONMENT": "test",
        "SEED_DEMO_ON_STARTUP": "false",
        "REDIS_URL": "",
        "RATE_LIMIT_ENABLED": "false",
        "AI_PROVIDER": "none",
        "AI_FALLBACK_PROVIDER": "none",
        "OLLAMA_ENABLED": "false",
        "LOG_LEVEL": "WARNING",
    }
)
for _secret in (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "AI_FALLBACK_API_KEY",
):
    os.environ.pop(_secret, None)  # tests never reach real AI providers

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from meqyas_ai.providers import ModelTiers  # noqa: E402
from meqyas_ai.testing import ScriptedProvider  # noqa: E402
from sqlalchemy import text  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    result = run_alembic(TEST_DB, "upgrade", "head")
    assert result.returncode == 0, result.stderr


@pytest.fixture(scope="session")
async def app(migrated_database: None) -> AsyncIterator[Any]:
    from app.main import create_app, lifespan

    application = create_app()
    async with lifespan(application):
        yield application


@pytest.fixture(autouse=True)
async def clean_tables(app: Any) -> AsyncIterator[None]:
    from app.core.cache import reset_memory_cache
    from app.core.rate_limit import reset_memory_limits
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        tables = (
            (
                await session.execute(
                    text(
                        "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                        "AND tablename NOT IN ('alembic_version','project_types')"
                    )
                )
            )
            .scalars()
            .all()
        )
        if tables:
            await session.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " CASCADE"))
            await session.commit()
        # Fresh default subscription plans for every test (some tests edit plans).
        from app.services.subscriptions import ensure_default_plans

        await ensure_default_plans(session)
        await session.commit()
    reset_memory_limits()
    reset_memory_cache()
    yield


@pytest.fixture
async def client(app: Any) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c:
        yield c


# ------------------------------------------------------------------ AI fake
TEST_TIERS = ModelTiers(fast="test-fast", smart="test-smart")


def scripted_registry(primary: Any, fallback: Any | None = None) -> Any:
    """The real registry (failover, cool-downs) around scripted providers."""
    from app.services.ai import AIRegistry, ProviderSlot

    return AIRegistry(
        primary=ProviderSlot(primary, TEST_TIERS, name="primary"),
        fallback=ProviderSlot(fallback, TEST_TIERS, name="fallback") if fallback is not None else None,
    )


@pytest.fixture
def scripted_ai() -> Any:
    from app.services.ai import set_ai_registry

    def _install(outputs: Sequence[Any]) -> ScriptedProvider:
        provider = ScriptedProvider(outputs)
        set_ai_registry(scripted_registry(provider))
        return provider

    yield _install
    set_ai_registry(None)


# ------------------------------------------------------------------ helpers
Register = Callable[..., Any]


@pytest.fixture
def register(client: AsyncClient) -> Register:
    """An account with its own workspace — as a platform administrator would create it (there is
    no self-registration) — signed in. ``plan``: the workspace's subscription plan."""

    async def _register(
        email: str = "owner@school.example",
        password: str = "Str0ng-Passw0rd!",
        org: str = "مدرسة الاختبار",
        name: str = "مالك الاختبار",
        plan: str = "enterprise",
    ) -> dict[str, Any]:
        from app.core.security import hash_password
        from app.db.session import get_sessionmaker
        from app.models import User
        from app.services import subscriptions
        from app.services.organizations import create_organization

        async with get_sessionmaker()() as session:
            user = User(email=email.strip().lower(), password_hash=hash_password(password), full_name=name, locale="ar")
            session.add(user)
            await session.flush()
            workspace = await create_organization(session, owner=user, name=org)
            await subscriptions.create(
                session, workspace, await subscriptions.get_plan(session, plan), days=None, start_now=True
            )
            await session.commit()
        res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert res.status_code == 200, res.text
        body = res.json()
        org_id = body["memberships"][0]["organization_id"]
        return {
            "token": body["access_token"],
            "org_id": org_id,
            "user_id": body["user"]["id"],
            "headers": {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id},
            "cookies": res.cookies,
        }

    return _register
