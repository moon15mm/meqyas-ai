"""Shared helpers for API tests."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from httpx import AsyncClient

API_DIR = Path(__file__).resolve().parents[1]
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://meqyas:meqyas@localhost:5432/meqyas_test")


def run_alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": database_url}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


async def add_member(
    client: AsyncClient, owner: dict[str, Any], email: str, role: str, register: Any
) -> dict[str, Any]:
    """Register a second user (own org) and add them to ``owner``'s org with ``role``."""
    other = await register(email=email, org=f"org of {email}")
    res = await client.post(
        f"/api/v1/organizations/{owner['org_id']}/members",
        headers=owner["headers"],
        json={"email": email, "role": role},
    )
    assert res.status_code == 201, res.text
    headers = {"Authorization": other["headers"]["Authorization"], "X-Organization-Id": owner["org_id"]}
    return {**other, "member_id": res.json()["member"]["id"], "headers_in_owner_org": headers}


async def demo_project(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    """The education demo project: the demo organization also holds the customer-experience demo (CX.md §8)."""
    from app.seed.demo_cx import TITLE as CX_DEMO_TITLE

    items = (await client.get("/api/v1/projects", headers=headers)).json()["items"]
    return next(p for p in items if p["title"] != CX_DEMO_TITLE)
