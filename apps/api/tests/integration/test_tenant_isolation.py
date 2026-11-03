"""Explicit tenant-isolation tests (SECURITY.md §5): a user of organization A
must never read or modify anything belonging to organization B."""

from __future__ import annotations

from plan_fixtures import impact_plan


async def _org_with_project(client, register, scripted_ai, email: str) -> dict:
    tenant = await register(email=email, org=f"org {email}")
    scripted_ai([impact_plan()])
    plan = await client.post(
        "/api/v1/ai/measurement-architect", headers=tenant["headers"], json={"request": "أريد قياس أثر برنامج تدريبي"}
    )
    assert plan.status_code == 201, plan.text
    project = await client.post(f"/api/v1/measurement-plans/{plan.json()['id']}/accept", headers=tenant["headers"])
    assert project.status_code == 201, project.text
    overview = (await client.get(f"/api/v1/projects/{project.json()['id']}/overview", headers=tenant["headers"])).json()
    return {
        **tenant,
        "plan_id": plan.json()["id"],
        "project_id": project.json()["id"],
        "indicator_id": overview["plan"]["indicators"][0]["id"],
        "dimension_id": overview["plan"]["dimensions"][0]["id"],
        "objective_id": overview["plan"]["objectives"][0]["id"],
        "wave_id": overview["plan"]["waves"][0]["id"],
    }


async def test_cannot_switch_into_foreign_organization(client, register, scripted_ai) -> None:
    a = await register(email="a@a.example", org="Org A")
    b = await register(email="b@b.example", org="Org B")
    forged = {"Authorization": a["headers"]["Authorization"], "X-Organization-Id": b["org_id"]}
    assert (await client.get("/api/v1/projects", headers=forged)).status_code == 404
    assert (await client.get(f"/api/v1/organizations/{b['org_id']}", headers=forged)).status_code == 404
    assert (await client.get(f"/api/v1/organizations/{b['org_id']}/members", headers=forged)).status_code == 404
    # path/header mismatch is rejected too
    assert (await client.get(f"/api/v1/organizations/{b['org_id']}", headers=a["headers"])).status_code == 404


async def test_foreign_ids_are_invisible(client, register, scripted_ai) -> None:
    a = await _org_with_project(client, register, scripted_ai, "a@a.example")
    b = await _org_with_project(client, register, scripted_ai, "b@b.example")
    h = a["headers"]

    listed = (await client.get("/api/v1/projects", headers=h)).json()
    assert [p["id"] for p in listed["items"]] == [a["project_id"]]

    checks = [
        ("GET", f"/api/v1/projects/{b['project_id']}", None),
        ("GET", f"/api/v1/projects/{b['project_id']}/overview", None),
        ("GET", f"/api/v1/projects/{b['project_id']}/measurement-plan", None),
        ("PATCH", f"/api/v1/projects/{b['project_id']}", {"title": "pwned"}),
        ("DELETE", f"/api/v1/projects/{b['project_id']}", None),
        ("GET", f"/api/v1/measurement-plans/{b['plan_id']}", None),
        ("POST", f"/api/v1/measurement-plans/{b['plan_id']}/accept", None),
        ("PATCH", f"/api/v1/indicators/{b['indicator_id']}", {"name": "pwned"}),
        ("DELETE", f"/api/v1/indicators/{b['indicator_id']}", None),
        ("PATCH", f"/api/v1/dimensions/{b['dimension_id']}", {"name": "pwned"}),
        ("PATCH", f"/api/v1/objectives/{b['objective_id']}", {"title": "pwned"}),
        ("PATCH", f"/api/v1/waves/{b['wave_id']}", {"name": "pwned"}),
        ("POST", f"/api/v1/projects/{b['project_id']}/indicators", {"name": "pwned indicator"}),
        ("POST", f"/api/v1/projects/{b['project_id']}/dimensions", {"name": "pwned dimension"}),
    ]
    for method, url, body in checks:
        res = await client.request(method, url, headers=h, json=body)
        assert res.status_code == 404, f"{method} {url} → {res.status_code}"

    # cross-linking: attach B's dimension to A's indicator
    res = await client.patch(
        f"/api/v1/indicators/{a['indicator_id']}", headers=h, json={"dimension_id": b["dimension_id"]}
    )
    assert res.status_code == 404

    # B's data is untouched
    b_project = await client.get(f"/api/v1/projects/{b['project_id']}", headers=b["headers"])
    assert b_project.status_code == 200 and b_project.json()["title"] != "pwned"
