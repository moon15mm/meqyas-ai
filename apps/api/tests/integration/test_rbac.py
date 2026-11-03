from __future__ import annotations

from itertools import pairwise

import pytest
from app.domain.enums import Role
from app.domain.permissions import ROLE_PERMISSIONS, Permission, can_assign_role, has_permission
from helpers import add_member
from plan_fixtures import impact_plan

PROJECT = {"title": "مشروع", "measurement_type": "SATISFACTION"}


def test_permission_matrix_is_monotonic() -> None:
    order = [Role.VIEWER, Role.ANALYST, Role.ADMIN, Role.OWNER]
    for lower, higher in pairwise(order):
        assert ROLE_PERMISSIONS[lower] <= ROLE_PERMISSIONS[higher]
    assert not has_permission(Role.EDITOR, Permission.RESPONSES_EXPORT)
    assert has_permission(Role.ANALYST, Permission.RESPONSES_EXPORT)
    assert not can_assign_role(Role.ADMIN, Role.OWNER)


@pytest.mark.parametrize(
    ("role", "can_create", "can_use_ai"),
    [("VIEWER", False, False), ("ANALYST", False, False), ("EDITOR", True, True), ("ADMIN", True, True)],
)
async def test_role_enforcement_on_projects_and_ai(client, register, scripted_ai, role, can_create, can_use_ai) -> None:
    owner = await register()
    member = await add_member(client, owner, f"{role.lower()}@school.example", role, register)
    h = member["headers_in_owner_org"]

    listed = await client.get("/api/v1/projects", headers=h)
    assert listed.status_code == 200  # every role can read

    created = await client.post("/api/v1/projects", headers=h, json=PROJECT)
    assert created.status_code == (201 if can_create else 403)

    scripted_ai([impact_plan()])
    ai = await client.post(
        "/api/v1/ai/measurement-architect", headers=h, json={"request": "أريد قياس أثر برنامج تدريبي"}
    )
    assert ai.status_code == (201 if can_use_ai else 403)


async def test_admin_cannot_grant_owner_and_last_owner_is_protected(client, register) -> None:
    owner = await register()
    admin = await add_member(client, owner, "admin@school.example", "ADMIN", register)
    viewer = await add_member(client, owner, "viewer@school.example", "VIEWER", register)

    grant_owner = await client.patch(
        f"/api/v1/organizations/{owner['org_id']}/members/{viewer['member_id']}",
        headers=admin["headers_in_owner_org"],
        json={"role": "OWNER"},
    )
    assert grant_owner.status_code == 403

    members = (await client.get(f"/api/v1/organizations/{owner['org_id']}/members", headers=owner["headers"])).json()
    owner_member = next(m for m in members if m["role"] == "OWNER")
    demote = await client.patch(
        f"/api/v1/organizations/{owner['org_id']}/members/{owner_member['id']}",
        headers=owner["headers"],
        json={"role": "VIEWER"},
    )
    assert demote.status_code == 409


async def test_viewer_cannot_manage_members_or_settings(client, register) -> None:
    owner = await register()
    viewer = await add_member(client, owner, "v@school.example", "VIEWER", register)
    h = viewer["headers_in_owner_org"]
    add = await client.post(
        f"/api/v1/organizations/{owner['org_id']}/members", headers=h, json={"email": "x@school.example"}
    )
    assert add.status_code == 403
    patch = await client.patch(f"/api/v1/organizations/{owner['org_id']}", headers=h, json={"name": "Hacked"})
    assert patch.status_code == 403
    runs = await client.get("/api/v1/ai/runs", headers=h)
    assert runs.status_code == 403
