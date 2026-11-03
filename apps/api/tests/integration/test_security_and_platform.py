from __future__ import annotations

import asyncpg
from helpers import TEST_DB, run_alembic


async def test_security_headers_and_request_id(client) -> None:
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert res.headers.get("x-request-id")


async def test_api_responses_are_not_cached(client, register) -> None:
    owner = await register()
    res = await client.get("/api/v1/projects", headers=owner["headers"])
    assert res.headers["cache-control"] == "no-store"


async def test_payload_too_large(client, register) -> None:
    owner = await register()
    big = "x" * (2 * 1024 * 1024 + 10)
    res = await client.post(
        "/api/v1/projects",
        headers={**owner["headers"], "Content-Type": "application/json"},
        content=f'{{"title": "{big}", "measurement_type": "SATISFACTION"}}',
    )
    assert res.status_code == 413


async def test_rate_limit_on_login(client, monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    codes = []
    for _ in range(7):
        res = await client.post("/api/v1/auth/login", json={"email": "rl@school.example", "password": "whatever-123"})
        codes.append(res.status_code)
    assert 429 in codes
    limited = next(c for c in codes if c == 429)
    assert limited == 429


async def test_missing_org_header(client, register) -> None:
    owner = await register()
    res = await client.get("/api/v1/projects", headers={"Authorization": owner["headers"]["Authorization"]})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "organization_required"


async def test_project_types_catalog(client, register) -> None:
    owner = await register()
    res = await client.get("/api/v1/project-types", headers=owner["headers"])
    codes = [t["code"] for t in res.json()]
    assert len(codes) == 18 and codes[0] == "SATISFACTION" and "IMPACT" in codes


async def test_openapi_is_published(client) -> None:
    res = await client.get("/api/openapi.json")
    paths = res.json()["paths"]
    for path in (
        "/api/v1/auth/login",
        "/api/v1/projects",
        "/api/v1/ai/measurement-architect",
        "/api/v1/measurement-plans/{plan_id}/accept",
    ):
        assert path in paths


async def test_migrations_downgrade_and_upgrade_cleanly() -> None:
    """Runs against a throw-away database so the shared test DB is untouched."""
    base, _, _ = TEST_DB.rpartition("/")
    admin_dsn = base.replace("postgresql+asyncpg", "postgresql") + "/postgres"
    conn = await asyncpg.connect(admin_dsn)
    try:
        await conn.execute("DROP DATABASE IF EXISTS meqyas_migcheck")
        await conn.execute("CREATE DATABASE meqyas_migcheck")
    finally:
        await conn.close()
    url = f"{base}/meqyas_migcheck"
    for step in (("upgrade", "head"), ("downgrade", "base"), ("upgrade", "head"), ("check",)):
        result = run_alembic(url, *step)
        assert result.returncode == 0, ("alembic", step, result.stdout, result.stderr)
