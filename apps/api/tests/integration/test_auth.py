from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from app.db.session import get_sessionmaker
from app.models import AuditLog, RefreshToken
from sqlalchemy import select, update

CSRF = {"X-Requested-With": "meqyas"}


async def test_login_returns_owner_membership_and_refresh_cookie(client, register) -> None:
    owner = await register()
    me = await client.get("/api/v1/auth/me", headers={"Authorization": owner["headers"]["Authorization"]})
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["email"] == "owner@school.example"
    assert body["memberships"][0]["role"] == "OWNER"
    assert body["memberships"][0]["subscription"]["plan_code"] == "enterprise"
    assert "meqyas_rt" in owner["cookies"]


async def test_no_self_registration_and_no_self_service_workspaces(client, register) -> None:
    """Accounts and workspaces are created by administrators only (SUBSCRIPTIONS.md §4)."""
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": "a@school.example", "password": "Str0ng-Passw0rd!", "full_name": "A B"},
    )
    assert res.status_code in (404, 405)
    owner = await register()
    created = await client.post("/api/v1/organizations", headers=owner["headers"], json={"name": "مساحة أخرى"})
    assert created.status_code in (404, 405)


async def test_login_success_and_generic_failure(client, register) -> None:
    await register(email="login@school.example")
    ok = await client.post("/api/v1/auth/login", json={"email": "LOGIN@school.example", "password": "Str0ng-Passw0rd!"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    bad_pw = await client.post("/api/v1/auth/login", json={"email": "login@school.example", "password": "nope-nope-1"})
    unknown = await client.post("/api/v1/auth/login", json={"email": "ghost@school.example", "password": "nope-nope-1"})
    assert bad_pw.status_code == unknown.status_code == 401
    assert bad_pw.json()["error"]["message"] == unknown.json()["error"]["message"]  # no account enumeration


async def test_protected_endpoints_require_valid_token(client) -> None:
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    bad = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


async def test_refresh_requires_csrf_header_and_rotates(client, register) -> None:
    owner = await register()
    client.cookies.set("meqyas_rt", owner["cookies"]["meqyas_rt"], path="/api/v1/auth")
    no_header = await client.post("/api/v1/auth/refresh")
    assert no_header.status_code == 403
    first = await client.post("/api/v1/auth/refresh", headers=CSRF)
    assert first.status_code == 200
    new_cookie = first.cookies.get("meqyas_rt")
    assert new_cookie and new_cookie != owner["cookies"]["meqyas_rt"]


async def test_refresh_token_reuse_revokes_family(client, register) -> None:
    owner = await register()
    old = owner["cookies"]["meqyas_rt"]
    client.cookies.set("meqyas_rt", old, path="/api/v1/auth")
    rotated = await client.post("/api/v1/auth/refresh", headers=CSRF)
    assert rotated.status_code == 200
    newest = rotated.cookies.get("meqyas_rt")

    # Move the old token's revocation outside the concurrency grace window, then replay it.
    async with get_sessionmaker()() as session:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.revoked_at.is_not(None))
            .values(revoked_at=datetime.now(UTC) - timedelta(minutes=5))
        )
        await session.commit()
    client.cookies.clear()
    client.cookies.set("meqyas_rt", old, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh", headers=CSRF)
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "refresh_reuse"

    # The legitimate newest token was revoked with the whole family.
    client.cookies.clear()
    client.cookies.set("meqyas_rt", newest, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", headers=CSRF)).status_code == 401
    async with get_sessionmaker()() as session:
        actions = (await session.scalars(select(AuditLog.action))).all()
    assert "auth.refresh_reuse_detected" in actions


async def test_logout_revokes_session(client, register) -> None:
    owner = await register()
    client.cookies.set("meqyas_rt", owner["cookies"]["meqyas_rt"], path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/logout", headers=CSRF)).status_code == 200
    client.cookies.set("meqyas_rt", owner["cookies"]["meqyas_rt"], path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", headers=CSRF)).status_code == 401


async def test_password_reset_flow(client, register, monkeypatch) -> None:
    await register(email="reset@school.example")
    sent: list[str] = []

    async def fake_send(to: str, subject: str, body: str) -> None:
        sent.append(body)

    monkeypatch.setattr("app.services.auth.send_email", fake_send)
    unknown = await client.post("/api/v1/auth/forgot-password", json={"email": "nobody@school.example"})
    assert unknown.status_code == 202 and sent == []
    res = await client.post("/api/v1/auth/forgot-password", json={"email": "reset@school.example"})
    assert res.status_code == 202 and len(sent) == 1
    token = re.search(r"token=([\w\-]+)", sent[0]).group(1)  # type: ignore[union-attr]

    done = await client.post("/api/v1/auth/reset-password", json={"token": token, "password": "N3w-Str0ng-Pass!"})
    assert done.status_code == 200
    again = await client.post("/api/v1/auth/reset-password", json={"token": token, "password": "N3w-Str0ng-Pass!"})
    assert again.status_code == 422  # single use
    login = await client.post(
        "/api/v1/auth/login", json={"email": "reset@school.example", "password": "N3w-Str0ng-Pass!"}
    )
    assert login.status_code == 200
