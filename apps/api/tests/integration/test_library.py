"""Phase 8: templates, question bank, survey copy, indicator values, Theory of Change."""

from __future__ import annotations

import re
from typing import Any

from app.db.session import get_sessionmaker
from app.models import IndicatorValue, LogicModel
from app.seed.demo import DEMO_EMAIL, DEMO_PASSWORD, seed_demo
from helpers import add_member, demo_project
from sqlalchemy import func, select

_ITEM = re.compile(r'<item id="([^"]+)">')


async def _demo(client) -> dict[str, Any]:
    async with get_sessionmaker()() as session:
        await seed_demo(session)
    body = (await client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})).json()
    org_id = body["memberships"][0]["organization_id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id}
    project = await demo_project(client, headers)
    return {"headers": headers, "org_id": org_id, "project_id": project["id"]}


async def _questions(client, headers, survey_id: str) -> dict[str, dict[str, Any]]:
    detail = (await client.get(f"/api/v1/surveys/{survey_id}", headers=headers)).json()
    return {q["key"]: q for s in detail["doc"]["sections"] for q in s["questions"]}


async def test_template_becomes_a_plan_then_a_project_with_linked_surveys(client, register) -> None:
    owner = await register()
    h = owner["headers"]
    templates = (await client.get("/api/v1/templates", headers=h)).json()
    assert {t["code"] for t in templates} >= {"training_impact", "customer_satisfaction", "event_evaluation"}
    detail = (await client.get("/api/v1/templates/training_impact", headers=h)).json()
    assert [s["wave_type"] for s in detail["surveys"]] == ["BASELINE", "POST", "FOLLOW_UP"]
    assert (await client.get("/api/v1/templates/nope", headers=h)).status_code == 404

    plan = await client.post("/api/v1/templates/training_impact/use", headers=h)
    assert plan.status_code == 201, plan.text
    draft = plan.json()["draft"]
    assert (
        plan.json()["status"] == "DRAFT" and draft["evidence_level"] == "CHANGE_PERSISTENCE"
    )  # same rules as AI plans
    project = (await client.post(f"/api/v1/measurement-plans/{plan.json()['id']}/accept", headers=h)).json()

    surveys = (await client.get(f"/api/v1/projects/{project['id']}/surveys", headers=h)).json()
    assert len(surveys) == 3 and all(s["status"] == "DRAFT" for s in surveys)
    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=h)).json()
    dims = {d["key"]: d["id"] for d in overview["plan"]["dimensions"]}
    indicators = {i["code"]: i["id"] for i in overview["plan"]["indicators"]}
    baseline = next(s for s in surveys if s["title"] == "استبيان ما قبل البرنامج")
    questions = await _questions(client, h, baseline["id"])
    assert questions["know_concepts"]["dimension_id"] == dims["knowledge"]
    assert questions["know_concepts"]["indicator_id"] == indicators["IND-01"]
    assert questions["experience"]["settings"]["is_profile"] is True and questions["experience"]["indicator_id"] is None
    assert questions["conf_mistake"]["scale"]["reverse_scored"] is True
    post = next(s for s in surveys if s["title"] == "استبيان ما بعد البرنامج")
    assert set(questions) <= set(await _questions(client, h, post["id"])) | {"barrier"}  # shared keys across waves
    published = await client.post(f"/api/v1/surveys/{baseline['id']}/publish", headers=h)
    assert published.status_code == 200, published.text  # ready to publish as created


async def test_rule_added_indicators_are_linked_and_rounds_are_separate(client, register) -> None:
    owner = await register(email="rounds@x.example")
    h = owner["headers"]
    plan = (await client.post("/api/v1/templates/customer_satisfaction/use", headers=h)).json()
    project = (await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=h)).json()
    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=h)).json()
    rounds = [w for w in overview["plan"]["waves"] if w["wave_type"] == "ROUND"]
    assert len(rounds) == 3
    surveys = (await client.get(f"/api/v1/projects/{project['id']}/surveys", headers=h)).json()
    assert len(surveys) == 1  # one questionnaire; later rounds are copies
    indicators = {i["code"]: i for i in overview["plan"]["indicators"]}
    questions = await _questions(client, h, surveys[0]["id"])
    # IND-04 (staff) was added by the methodology rules: it measures the staff questions.
    assert questions["staff_respect"]["indicator_id"] == indicators["IND-04"]["id"]

    copied = await client.post(
        f"/api/v1/surveys/{surveys[0]['id']}/copies", headers=h, json={"wave_id": rounds[1]["id"]}
    )
    assert copied.status_code == 201, copied.text
    copy = copied.json()["survey"]
    assert copy["wave_id"] == rounds[1]["id"] and copy["title"].endswith(rounds[1]["name"])
    copy_questions = await _questions(client, h, copy["id"])
    assert set(copy_questions) == set(questions)
    assert copy_questions["csat"]["lineage_id"] == questions["csat"]["lineage_id"]

    from app.services.analytics import _wave_rank, wave_keys

    async with get_sessionmaker()() as session:
        from app.models import MeasurementWave

        waves = (
            await session.scalars(select(MeasurementWave).where(MeasurementWave.project_id == project["id"]))
        ).all()
        keys = wave_keys(list(waves))
    assert sorted(keys.values(), key=_wave_rank) == ["ROUND-1", "ROUND-2", "ROUND-3"]
    assert _wave_rank("BASELINE") < _wave_rank("POST") < _wave_rank("ROUND-1") < _wave_rank("ROUND-2")


async def test_question_bank_system_and_organization_items(client, register) -> None:
    owner = await register(email="bank@x.example")
    h = owner["headers"]
    system = (await client.get("/api/v1/question-bank?scope=system", headers=h)).json()
    assert len(system) >= 40 and all(i["source"] == "system" for i in system)
    found = (await client.get("/api/v1/question-bank?q=الادوات", headers=h)).json()  # alef folding
    assert found and all("الأدوات" in i["text"] or "الادوات" in i["text"] for i in found)
    nps = (await client.get("/api/v1/question-bank?type=NPS", headers=h)).json()
    assert nps and all(i["question_type"] == "NPS" for i in nps)

    saved = await client.post(
        "/api/v1/question-bank",
        headers=h,
        json={
            "question": {
                "key": "q7",
                "type": "LIKERT",
                "text": "أشعر بالأمان في بيئة العمل.",
                "lineage_id": "0b3c6f5e-0000-4000-8000-000000000000",
                "options": [{"value": str(i), "label": str(i)} for i in range(1, 6)],
            },
            "topic": "الأمان",
            "tags": ["hr", " "],
        },
    )
    assert saved.status_code == 201, saved.text
    item = saved.json()
    assert item["source"] == "organization" and item["tags"] == ["hr"] and "key" not in item["question"]
    mine = (await client.get("/api/v1/question-bank?scope=organization", headers=h)).json()
    assert [i["id"] for i in mine] == [item["id"]]
    bad = await client.post("/api/v1/question-bank", headers=h, json={"question": {"type": "SECTION", "text": "x"}})
    assert bad.status_code == 422
    other = await register(email="other-bank@x.example", org="جهة أخرى")
    assert (await client.delete(f"/api/v1/question-bank/{item['id']}", headers=other["headers"])).status_code == 404
    assert (await client.delete(f"/api/v1/question-bank/{item['id']}", headers=h)).status_code == 200


async def test_indicator_values_are_persisted(client, register) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    before = (await client.get(f"{base}/measurement-plan", headers=demo["headers"])).json()
    assert all(i["current_value"] is None for i in before["indicators"])
    await client.post(f"{base}/insights/generate", headers=demo["headers"])  # computes and stores the values
    after = {
        i["code"]: i
        for i in (await client.get(f"{base}/measurement-plan", headers=demo["headers"])).json()["indicators"]
    }
    summary = (await client.get(f"{base}/analytics/summary", headers=demo["headers"])).json()
    live = {i["code"]: i for i in summary["indicators"]}
    assert after["IND-03"]["current_value"] == live["IND-03"]["current_value"]
    assert after["IND-03"]["status"] == live["IND-03"]["status"] == "OFF_TRACK"
    assert after["IND-02"]["baseline_value"] is None  # a change has no baseline of its own
    values = (await client.get(f"{base}/indicators/values", headers=demo["headers"])).json()
    assert {v["wave"] for v in values} == {"BASELINE", "POST", "FOLLOW_UP"}
    recomputed = await client.post(f"{base}/indicators/recompute", headers=demo["headers"])
    assert recomputed.status_code == 200 and len(recomputed.json()) == len(after)
    async with get_sessionmaker()() as session:
        rows = await session.scalar(select(func.count()).select_from(IndicatorValue))
    assert rows == len(values)  # recompute upserts, never duplicates
    viewer = await add_member(
        client, {"headers": demo["headers"], "org_id": demo["org_id"]}, "viewer-ind@x.example", "VIEWER", register
    )
    assert (
        await client.post(f"{base}/indicators/recompute", headers=viewer["headers_in_owner_org"])
    ).status_code == 403


def toc_script(messages: Any, schema: Any) -> dict[str, Any]:
    user = messages[1].content
    codes = [c for c in _ITEM.findall(user) if c.startswith("IND-")]
    return {
        "inputs": ["مدربون متخصصون", "وقت مخصص للتدريب"],
        "activities": ["تنفيذ ورش تطبيقية"],
        "outputs": ["ورش منفذة للمعلمين"],
        "short_term_outcomes": [{"text": "ارتفاع المعرفة والثقة", "indicator_codes": codes[:2]}],
        "medium_term_outcomes": [{"text": "استخدام الأدوات في الصف", "indicator_codes": codes[2:]}],
        "long_term_impact": [{"text": "تعلم أفضل للطلاب", "indicator_codes": []}],
        "assumptions": ["توفر الأجهزة والإنترنت"],
        "risks": ["ضيق وقت المعلمين"],
    }


async def test_theory_of_change_links_outcomes_to_indicators(client, register, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}/theory-of-change"
    empty = (await client.get(base, headers=demo["headers"])).json()
    assert empty["theory"] is None and empty["indicators"] and empty["evidence_level"] == "CHANGE_PERSISTENCE"

    provider = scripted_ai([toc_script])
    res = await client.post(f"{base}/generate", headers=demo["headers"], json={"notes": "البرنامج لمدة شهر"})
    assert res.status_code == 200, res.text
    theory = res.json()["theory"]
    by_code = {i["code"]: i["id"] for i in res.json()["indicators"]}
    assert theory["ai_generated"] is True and theory["inputs"] == ["مدربون متخصصون", "وقت مخصص للتدريب"]
    assert theory["short_term_outcomes"][0]["indicator_ids"] == [by_code["IND-01"], by_code["IND-02"]]
    assert '<untrusted_data source="indicators">' in provider.calls[0]["messages"][1].content

    edited = dict(theory)
    edited["risks"] = [*theory["risks"], "  تغيّر جدول المدارس  ", ""]
    edited["long_term_impact"] = [{"text": "تعلم أفضل للطلاب", "indicator_ids": [by_code["IND-05"]]}]
    for k in ("ai_generated", "updated_at"):
        edited.pop(k)
    saved = await client.put(base, headers=demo["headers"], json=edited)
    assert saved.status_code == 200, saved.text
    out = saved.json()["theory"]
    assert out["risks"] == ["ضيق وقت المعلمين", "تغيّر جدول المدارس"]
    assert out["long_term_impact"][0]["indicator_ids"] == [by_code["IND-05"]]
    async with get_sessionmaker()() as session:
        model = (await session.scalars(select(LogicModel))).one()
    assert {n["column"] for n in model.nodes} >= {"inputs", "short_term_outcomes", "risks"}
    assert any(e["kind"] == "measured_by" and e["to"] == f"indicator:{by_code['IND-05']}" for e in model.edges)

    stranger = await register(email="toc@x.example", org="جهة")
    other_ind = await client.put(
        base,
        headers=demo["headers"],
        json={**edited, "short_term_outcomes": [{"text": "x", "indicator_ids": [stranger["org_id"]]}]},
    )
    assert other_ind.status_code == 422 and other_ind.json()["error"]["code"] == "unknown_indicator"
