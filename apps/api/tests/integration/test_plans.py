from __future__ import annotations

from app.db.session import get_sessionmaker
from app.models import AIRun
from plan_fixtures import impact_plan, satisfaction_plan
from sqlalchemy import select

REQUEST = "أريد قياس أثر برنامج تدريبي لطالبات المرحلة الثانوية في استخدام أدوات الذكاء الاصطناعي في التعلم."


async def test_architect_creates_draft_plan_and_logs_run(client, register, scripted_ai) -> None:
    owner = await register()
    provider = scripted_ai([impact_plan()])
    res = await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    assert res.status_code == 201, res.text
    plan = res.json()
    assert plan["status"] == "DRAFT" and plan["project_id"] is None
    draft = plan["draft"]
    assert draft["measurement_type"] == "IMPACT"
    assert [w["wave_type"] for w in draft["waves"]] == ["BASELINE", "POST", "FOLLOW_UP"]
    assert draft["evidence_level"] == "CHANGE_PERSISTENCE"
    assert any("لا يثبت" in n for n in draft["methodology_notes"])
    # the model received the request inside a data envelope, with the org sector
    user_msg = provider.calls[0]["messages"][1].content
    assert "<user_request>" in user_msg and "EDUCATION" in user_msg

    async with get_sessionmaker()() as session:
        runs = (await session.scalars(select(AIRun))).all()
    assert len(runs) == 1
    run = runs[0]
    assert run.agent == "measurement_architect" and run.status.value == "SUCCESS"
    assert run.total_tokens == 300 and str(run.entity_id) == plan["id"]
    assert len(run.input_hash) == 64  # hash only — the prompt itself is never stored


async def test_satisfaction_request_is_not_turned_into_impact(client, register, scripted_ai) -> None:
    owner = await register()
    # The model first over-claims (IMPACT); the semantic guard forces a repair.
    scripted_ai([impact_plan(), satisfaction_plan()])
    res = await client.post(
        "/api/v1/ai/measurement-architect",
        headers=owner["headers"],
        json={"request": "أريد قياس رضا الطالبات عن برنامج تدريبي"},
    )
    assert res.status_code == 201, res.text
    draft = res.json()["draft"]
    assert draft["measurement_type"] == "SATISFACTION"
    assert draft["recommended_design"] == "POST_ONLY"
    assert draft["baseline_required"] is False


async def test_edit_draft_reapplies_rules_then_accept(client, register, scripted_ai) -> None:
    owner = await register()
    scripted_ai([impact_plan()])
    plan = (
        await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    ).json()

    edited = dict(plan["draft"])
    edited["project_title"] = "عنوان معدل"
    edited["recommended_design"] = "PRE_POST"  # user removes follow-up
    patched = await client.patch(f"/api/v1/measurement-plans/{plan['id']}", headers=owner["headers"], json=edited)
    assert patched.status_code == 200, patched.text
    pd = patched.json()["draft"]
    assert pd["project_title"] == "عنوان معدل"
    assert [w["wave_type"] for w in pd["waves"]] == ["BASELINE", "POST"]
    assert pd["follow_up_recommended"] is False

    accepted = await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=owner["headers"])
    assert accepted.status_code == 201
    project = accepted.json()
    assert project["title"] == "عنوان معدل" and project["measurement_type"] == "IMPACT"

    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=owner["headers"])).json()
    assert overview["counts"] == {
        "objectives": 1,
        "dimensions": 3,
        "indicators": 3,
        "waves": 2,
        "surveys": 0,
        "published_surveys": 0,
    }
    dims = {d["key"]: d["id"] for d in overview["plan"]["dimensions"]}
    assert all(i["dimension_id"] in dims.values() for i in overview["plan"]["indicators"])
    assert overview["plan"]["goal"]["statement"]
    assert overview["plan"]["status"] == "ACCEPTED"

    again = await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=owner["headers"])
    assert again.status_code == 409
    locked = await client.patch(f"/api/v1/measurement-plans/{plan['id']}", headers=owner["headers"], json=edited)
    assert locked.status_code == 409


async def test_regenerate_with_feedback(client, register, scripted_ai) -> None:
    owner = await register()
    provider = scripted_ai([impact_plan(), impact_plan(project_title="خطة محسنة")])
    plan = (
        await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    ).json()
    res = await client.post(
        f"/api/v1/measurement-plans/{plan['id']}/regenerate",
        headers=owner["headers"],
        json={"feedback": "أضف بعدًا عن التفكير الناقد"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["draft"]["project_title"] == "خطة محسنة"
    assert res.json()["generation_count"] == 2
    assert "<user_feedback>" in provider.calls[1]["messages"][1].content


async def test_indicator_crud_on_accepted_project(client, register, scripted_ai) -> None:
    owner = await register()
    scripted_ai([impact_plan()])
    plan = (
        await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    ).json()
    project = (await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=owner["headers"])).json()
    created = await client.post(
        f"/api/v1/projects/{project['id']}/indicators",
        headers=owner["headers"],
        json={"name": "مؤشر جديد", "indicator_type": "COUNT"},
    )
    assert created.status_code == 201
    ind = created.json()
    assert ind["code"].startswith("IND-") and ind["computation"]["method"] == "count"
    patched = await client.patch(
        f"/api/v1/indicators/{ind['id']}",
        headers=owner["headers"],
        json={"indicator_type": "PERCENTAGE", "target_value": 70},
    )
    assert patched.json()["computation"]["method"] == "top_box_pct" and patched.json()["target_value"] == 70
    assert (await client.delete(f"/api/v1/indicators/{ind['id']}", headers=owner["headers"])).status_code == 200


async def test_ai_not_configured_returns_503(client, register) -> None:
    owner = await register()
    res = await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ai_not_configured"


async def test_invalid_ai_output_returns_502_and_logs_failure(client, register, scripted_ai) -> None:
    owner = await register()
    scripted_ai(["nonsense", "{}", "[]"])
    res = await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "ai_invalid_output"
    async with get_sessionmaker()() as session:
        run = (await session.scalars(select(AIRun))).one()
    assert run.status.value == "FAILED" and run.attempts == 3 and run.error_code == "ai_invalid_output"


async def test_daily_budget_is_enforced(client, register, scripted_ai, monkeypatch) -> None:
    owner = await register()
    scripted_ai([impact_plan()])
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_daily_token_limit_per_org", 100)
    first = await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    assert first.status_code == 201  # 300 tokens used → over budget now
    second = await client.post(
        "/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST + "!"}
    )
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "ai_budget_exceeded"


async def test_request_validation(client, register) -> None:
    owner = await register()
    short = await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": "قصير"})
    assert short.status_code == 422
    extra = await client.post(
        "/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST, "admin": True}
    )
    assert extra.status_code == 422  # unknown fields are rejected
