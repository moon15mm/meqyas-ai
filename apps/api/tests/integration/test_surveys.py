from __future__ import annotations

import json
from typing import Any

from app.db.session import get_sessionmaker
from app.models import AIRun, SurveyVersion
from helpers import add_member
from plan_fixtures import impact_plan
from sqlalchemy import select
from survey_fixtures import GENERATED_BASELINE, GENERATED_POST_ADDENDUM, REVIEW_OUTPUT, generated

REQUEST = "أريد قياس أثر برنامج تدريبي لطالبات المرحلة الثانوية في استخدام أدوات الذكاء الاصطناعي في التعلم."


async def _project(client, owner, scripted_ai) -> dict[str, Any]:
    scripted_ai([impact_plan()])
    plan = (
        await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    ).json()
    project = (await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=owner["headers"])).json()
    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=owner["headers"])).json()
    waves = {w["wave_type"]: w["id"] for w in overview["plan"]["waves"]}
    dims = {d["key"]: d["id"] for d in overview["plan"]["dimensions"]}
    return {"id": project["id"], "waves": waves, "dims": dims}


def _doc(dims: dict[str, str], *, title: str = "استبيان", logic: list | None = None) -> dict[str, Any]:
    return {
        "title": title,
        "language": "ar",
        "sections": [
            {
                "key": "s1",
                "title": "القسم الأول",
                "questions": [
                    {
                        "key": "sat",
                        "type": "LIKERT",
                        "text": "أنا راضية",
                        "required": True,
                        "dimension_id": dims["skills"],
                    },
                    {"key": "why", "type": "LONG_TEXT", "text": "لماذا؟"},
                    {"key": "nps", "type": "NPS", "text": "هل توصين بالبرنامج؟"},
                ],
            }
        ],
        "logic": logic
        if logic is not None
        else [
            {
                "id": "r1",
                "type": "DISPLAY",
                "target_key": "why",
                "condition": {"question": "sat", "op": "lte", "value": 2},
            }
        ],
    }


async def _create(client, owner, project) -> dict[str, Any]:
    res = await client.post(
        f"/api/v1/projects/{project['id']}/surveys",
        headers=owner["headers"],
        json={"title": "استبيان الرضا", "wave_id": project["waves"]["BASELINE"]},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_create_save_and_read_document(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    created = await _create(client, owner, project)
    assert created["survey"]["status"] == "DRAFT"
    assert created["survey"]["wave_type"] == "BASELINE"
    assert created["doc"]["sections"][0]["key"] == "s1"
    assert created["quality"]["total"] == 0

    sid = created["survey"]["id"]
    saved = await client.put(
        f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": _doc(project["dims"])}
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    questions = body["doc"]["sections"][0]["questions"]
    assert [q["key"] for q in questions] == ["sat", "why", "nps"]
    assert questions[0]["options"][0]["label"] == "لا أوافق بشدة"  # default Likert labels
    assert questions[2]["scale"]["min"] == 0 and questions[2]["scale"]["max"] == 10  # NPS fixed scale
    assert all(q["lineage_id"] for q in questions)
    assert body["logic_issues"] == []
    assert body["survey"]["question_count"] == 3
    assert 0 < body["quality"]["total"] <= 100
    assert {a["key"] for a in body["quality"]["axes"]} == {
        "question_quality",
        "goal_alignment",
        "bias_risk",
        "length",
        "coverage",
        "analysis_readiness",
        "logic_quality",
    }

    lineage = questions[0]["lineage_id"]
    again = await client.put(f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": body["doc"]})
    assert again.json()["doc"]["sections"][0]["questions"][0]["lineage_id"] == lineage  # stable identity


async def test_invalid_documents_are_rejected(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    bad_key = _doc(project["dims"])
    bad_key["sections"][0]["questions"][0]["key"] = "Bad Key"
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": bad_key})
    ).status_code == 422
    duplicate = _doc(project["dims"])
    duplicate["sections"][0]["questions"][1]["key"] = "sat"
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": duplicate})
    ).status_code == 422
    no_options = _doc(project["dims"])
    no_options["sections"][0]["questions"].append(
        {"key": "pick", "type": "SINGLE_CHOICE", "text": "اختر", "options": []}
    )
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": no_options})
    ).status_code == 422


async def test_drafts_may_be_incomplete_but_publishing_requires_completion(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    h = owner["headers"]
    draft = _doc(project["dims"])
    draft["sections"][0]["questions"].append(
        {
            "key": "new_q",
            "type": "SINGLE_CHOICE",
            "text": "",
            "options": [{"value": "1", "label": ""}, {"value": "2", "label": "ب"}],
        }
    )
    saved = await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": draft})
    assert saved.status_code == 200, saved.text  # autosave never fails on half-written questions
    assert {(i["code"], i["question_key"]) for i in saved.json()["completeness"]} == {
        ("missing_text", "new_q"),
        ("missing_option_label", "new_q"),
    }
    blocked = await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)
    assert blocked.status_code == 422 and blocked.json()["error"]["code"] == "incomplete_questions"

    draft["sections"][0]["questions"][-1].update(
        {"text": "اختر", "options": [{"value": "1", "label": "أ"}, {"value": "2", "label": "ب"}]}
    )
    fixed = (await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": draft})).json()
    assert fixed["completeness"] == []
    assert (await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)).status_code == 200


async def test_logic_issues_are_reported_and_block_publishing(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    doc = _doc(project["dims"], logic=[{"type": "SKIP", "source_key": "nps", "target_key": "sat", "condition": {}}])
    saved = (await client.put(f"/api/v1/surveys/{sid}/draft", headers=owner["headers"], json={"doc": doc})).json()
    assert [i["code"] for i in saved["logic_issues"]] == ["backward_skip"]
    publish = await client.post(f"/api/v1/surveys/{sid}/publish", headers=owner["headers"])
    assert publish.status_code == 422 and publish.json()["error"]["code"] == "logic_issues"


async def test_publish_versioning_and_state_machine(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    h = owner["headers"]

    empty = await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "empty_survey"

    await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": _doc(project["dims"])})
    published = (await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)).json()
    assert published["survey"]["status"] == "PUBLISHED"
    assert published["survey"]["current_version"]["version_number"] == 1
    assert published["survey"]["current_version"]["status"] == "PUBLISHED"
    assert (await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)).json()["error"][
        "code"
    ] == "nothing_to_publish"

    # Editing a published survey creates version 2 (copy-on-write); v1 stays frozen.
    edited_doc = _doc(project["dims"], title="استبيان معدل")
    edited = (await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": edited_doc})).json()
    assert edited["survey"]["current_version"]["version_number"] == 2
    assert edited["survey"]["has_unpublished_changes"] is True
    assert edited["survey"]["published_version_number"] == 1
    async with get_sessionmaker()() as session:
        v1 = await session.scalar(select(SurveyVersion).where(SurveyVersion.version_number == 1))
        assert v1 is not None and v1.title == "استبيان" and v1.status.value == "PUBLISHED"

    discarded = (await client.post(f"/api/v1/surveys/{sid}/discard_changes", headers=h)).json()
    assert discarded["survey"]["current_version"]["version_number"] == 1
    assert discarded["doc"]["title"] == "استبيان"

    await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": edited_doc})
    v2 = (await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)).json()
    assert v2["survey"]["published_version_number"] == 2  # the discarded draft's number is reused
    async with get_sessionmaker()() as session:
        statuses = {v.version_number: v.status.value for v in (await session.scalars(select(SurveyVersion))).all()}
    assert statuses == {1: "RETIRED", 2: "PUBLISHED"}

    assert (await client.post(f"/api/v1/surveys/{sid}/resume", headers=h)).status_code == 409
    assert (await client.post(f"/api/v1/surveys/{sid}/pause", headers=h)).json()["survey"]["status"] == "PAUSED"
    # Publishing a new version of a paused survey does not silently resume collection.
    await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": _doc(project["dims"], title="v3")})
    v3 = (await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)).json()
    assert v3["survey"]["published_version_number"] == 3 and v3["survey"]["status"] == "PAUSED"
    assert (await client.post(f"/api/v1/surveys/{sid}/resume", headers=h)).json()["survey"]["status"] == "PUBLISHED"
    assert (await client.post(f"/api/v1/surveys/{sid}/archive", headers=h)).status_code == 409
    assert (await client.post(f"/api/v1/surveys/{sid}/close", headers=h)).json()["survey"]["status"] == "CLOSED"
    assert (await client.post(f"/api/v1/surveys/{sid}/reopen", headers=h)).json()["survey"]["status"] == "PUBLISHED"
    await client.post(f"/api/v1/surveys/{sid}/close", headers=h)
    assert (await client.post(f"/api/v1/surveys/{sid}/archive", headers=h)).json()["survey"]["status"] == "ARCHIVED"
    locked = await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": edited_doc})
    assert locked.status_code == 409
    assert (await client.delete(f"/api/v1/surveys/{sid}", headers=h)).status_code == 409  # published data is kept


async def test_delete_unpublished_survey(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    assert (await client.delete(f"/api/v1/surveys/{sid}", headers=owner["headers"])).status_code == 200
    assert (await client.get(f"/api/v1/surveys/{sid}", headers=owner["headers"])).status_code == 404


async def test_generate_baseline_then_post_reuses_identical_items(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    h = owner["headers"]

    provider = scripted_ai([generated(GENERATED_BASELINE), generated(GENERATED_BASELINE)])
    res = await client.post(
        f"/api/v1/projects/{project['id']}/surveys/generate", headers=h, json={"wave_id": project["waves"]["BASELINE"]}
    )
    assert res.status_code == 201, res.text
    baseline = res.json()
    assert baseline["survey"]["ai_generated"] is True and baseline["survey"]["wave_type"] == "BASELINE"
    questions = {q["key"]: q for s in baseline["doc"]["sections"] for q in s["questions"]}
    assert questions["skill_1"]["dimension_id"] == project["dims"]["skills"]
    assert questions["grade"]["settings"]["is_profile"] is True and questions["grade"]["dimension_id"] is None
    assert questions["broken"]["type"] == "LONG_TEXT"  # invalid choice simplified, not dropped
    assert [o["value"] for o in questions["skill_2"]["options"]] == ["1", "2", "3", "4", "5"]
    assert questions["skill_2"]["options"][0]["label"] == "لا أوافق بشدة"  # re-ordered ascending
    assert [r["key"] for r in questions["conf_2"]["settings"]["rows"]] == ["search", "writing_"]
    assert [r["target_key"] for r in baseline["doc"]["logic"]] == ["expect"]  # invalid forward rule dropped
    assert baseline["logic_issues"] == []
    assert baseline["doc"]["settings"]["collect_respondent_code"] is True
    assert "Wave: BASELINE" in provider.calls[0]["messages"][1].content
    assert "need at least 2 options: broken" in provider.calls[1]["messages"][-1].content  # semantic repair round

    post_provider = scripted_ai([generated(GENERATED_POST_ADDENDUM)])
    res = await client.post(
        f"/api/v1/projects/{project['id']}/surveys/generate", headers=h, json={"wave_id": project["waves"]["POST"]}
    )
    assert res.status_code == 201, res.text
    post = res.json()
    post_keys = [q["key"] for s in post["doc"]["sections"] for q in s["questions"]]
    for key in ("grade", "skill_1", "skill_2", "use_freq", "conf_1", "conf_2"):
        assert key in post_keys  # identical repeated items (same keys) for pre/post comparison
    assert "expect" not in post_keys  # baseline-only open question is not repeated
    assert "satisfaction" in post_keys and "skill_1_2" in post_keys  # addendum de-conflicted
    prompt = post_provider.calls[0]["messages"][1].content
    assert "Mode: addendum" in prompt and "skill_1" in prompt
    base_q = {q["key"]: q for s in baseline["doc"]["sections"] for q in s["questions"]}
    post_q = {q["key"]: q for s in post["doc"]["sections"] for q in s["questions"]}
    assert post_q["skill_2"]["text"] == base_q["skill_2"]["text"]
    assert post_q["skill_2"]["options"] == base_q["skill_2"]["options"]

    async with get_sessionmaker()() as session:
        runs = (await session.scalars(select(AIRun).where(AIRun.agent == "survey_generator"))).all()
    assert {str(r.entity_id) for r in runs} == {baseline["survey"]["id"], post["survey"]["id"]}


async def test_review_accept_reject_and_stale(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    h = owner["headers"]
    scripted_ai([generated(GENERATED_BASELINE), generated(GENERATED_BASELINE)])
    survey = (
        await client.post(
            f"/api/v1/projects/{project['id']}/surveys/generate",
            headers=h,
            json={"wave_id": project["waves"]["BASELINE"]},
        )
    ).json()
    sid = survey["survey"]["id"]
    before = survey["quality"]["total"]

    scripted_ai([REVIEW_OUTPUT])
    reviewed = (await client.post(f"/api/v1/surveys/{sid}/review", headers=h)).json()
    issues = reviewed["review"]["issues"]
    assert [i["question_key"] for i in issues] == ["skill_1", "conf_1"]  # unknown key dropped
    assert all(i["status"] == "open" for i in issues)
    assert reviewed["quality"]["total"] < before

    # publish, then accept a suggestion → copy-on-write draft with the new text
    await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)
    accepted = (
        await client.post(
            f"/api/v1/surveys/{sid}/review/issues/{issues[0]['id']}", headers=h, json={"action": "accept"}
        )
    ).json()
    q = {x["key"]: x for s in accepted["doc"]["sections"] for x in s["questions"]}
    assert q["skill_1"]["text"] == "أستطيع كتابة أوامر واضحة لأدوات الذكاء الاصطناعي."
    assert accepted["survey"]["current_version"]["version_number"] == 2
    statuses = {i["question_key"]: i["status"] for i in accepted["review"]["issues"]}
    assert statuses == {"skill_1": "accepted", "conf_1": "open"}

    rejected = (
        await client.post(
            f"/api/v1/surveys/{sid}/review/issues/{issues[1]['id']}", headers=h, json={"action": "reject"}
        )
    ).json()
    assert {i["question_key"]: i["status"] for i in rejected["review"]["issues"]}["conf_1"] == "rejected"

    # editing a reviewed question makes its open issue stale
    scripted_ai([REVIEW_OUTPUT])
    fresh = (await client.post(f"/api/v1/surveys/{sid}/review", headers=h)).json()
    doc = fresh["doc"]
    for section in doc["sections"]:
        for question in section["questions"]:
            if question["key"] == "conf_1":
                question["text"] = "نص جديد كتبته المعلمة"
    edited = (await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": doc})).json()
    assert {i["question_key"]: i["status"] for i in edited["review"]["issues"]}["conf_1"] == "stale"


async def test_survey_permissions(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    sid = (await _create(client, owner, project))["survey"]["id"]
    analyst = await add_member(client, owner, "analyst@school.example", "ANALYST", register)
    viewer = await add_member(client, owner, "viewer@school.example", "VIEWER", register)
    editor = await add_member(client, owner, "editor@school.example", "EDITOR", register)

    assert (
        await client.get(f"/api/v1/projects/{project['id']}/surveys", headers=viewer["headers_in_owner_org"])
    ).status_code == 200
    assert (await client.get(f"/api/v1/surveys/{sid}", headers=viewer["headers_in_owner_org"])).status_code == 200
    doc = {"doc": _doc(project["dims"])}
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=analyst["headers_in_owner_org"], json=doc)
    ).status_code == 403
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=viewer["headers_in_owner_org"], json=doc)
    ).status_code == 403
    assert (
        await client.put(f"/api/v1/surveys/{sid}/draft", headers=editor["headers_in_owner_org"], json=doc)
    ).status_code == 200
    assert (
        await client.post(f"/api/v1/surveys/{sid}/publish", headers=analyst["headers_in_owner_org"])
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/surveys/{sid}/publish", headers=editor["headers_in_owner_org"])
    ).status_code == 200


async def test_survey_tenant_isolation(client, register, scripted_ai) -> None:
    a = await register(email="a@a.example", org="Org A")
    b = await register(email="b@b.example", org="Org B")
    project_a = await _project(client, a, scripted_ai)
    project_b = await _project(client, b, scripted_ai)
    sid_b = (await _create(client, b, project_b))["survey"]["id"]
    h = a["headers"]
    checks = [
        ("GET", f"/api/v1/surveys/{sid_b}", None),
        ("PUT", f"/api/v1/surveys/{sid_b}/draft", {"doc": _doc(project_b["dims"])}),
        ("POST", f"/api/v1/surveys/{sid_b}/publish", None),
        ("POST", f"/api/v1/surveys/{sid_b}/review", None),
        ("DELETE", f"/api/v1/surveys/{sid_b}", None),
        ("GET", f"/api/v1/projects/{project_b['id']}/surveys", None),
        ("POST", f"/api/v1/projects/{project_b['id']}/surveys", {"title": "x"}),
    ]
    for method, url, body in checks:
        res = await client.request(method, url, headers=h, json=body)
        assert res.status_code == 404, f"{method} {url} → {res.status_code}"
    assert (await client.get("/api/v1/surveys", headers=h)).json() == []

    # A's survey cannot link to B's dimension or wave
    sid_a = (await _create(client, a, project_a))["survey"]["id"]
    foreign = await client.put(f"/api/v1/surveys/{sid_a}/draft", headers=h, json={"doc": _doc(project_b["dims"])})
    assert foreign.status_code == 422 and foreign.json()["error"]["code"] == "invalid_dimension"
    wave = await client.post(
        f"/api/v1/projects/{project_a['id']}/surveys",
        headers=h,
        json={"title": "x", "wave_id": project_b["waves"]["POST"]},
    )
    assert wave.status_code == 404


async def test_review_fix_types_remove_and_manual(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    h = owner["headers"]
    scripted_ai([generated(GENERATED_BASELINE), generated(GENERATED_BASELINE)])
    sid = (
        await client.post(
            f"/api/v1/projects/{project['id']}/surveys/generate",
            headers=h,
            json={"wave_id": project["waves"]["BASELINE"]},
        )
    ).json()["survey"]["id"]

    review = {
        "overall_comment": "",
        "issues": [
            # duplicate item: the fix is to delete it, never to paste advice as question text
            {
                "question_key": "skill_2",
                "type": "DUPLICATE",
                "severity": "MEDIUM",
                "problem": "مكرر",
                "reason": "يقيس ما يقيسه skill_1",
                "fix": "REMOVE",
                "suggestion": "احذف هذا السؤال",
            },
            # advice instead of a rewrite → downgraded to a manual note
            {
                "question_key": "conf_1",
                "type": "AMBIGUOUS",
                "severity": "LOW",
                "problem": "غامض",
                "reason": "x",
                "fix": "REWRITE",
                "suggestion": "احذف كلمة الأدوات وحدد الأداة",
            },
        ],
    }
    scripted_ai([review])
    reviewed = (await client.post(f"/api/v1/surveys/{sid}/review", headers=h)).json()
    issues = {i["question_key"]: i for i in reviewed["review"]["issues"]}
    assert issues["skill_2"]["fix"] == "REMOVE" and issues["skill_2"]["suggestion"] == ""
    assert issues["conf_1"]["fix"] == "NONE"

    manual = await client.post(
        f"/api/v1/surveys/{sid}/review/issues/{issues['conf_1']['id']}", headers=h, json={"action": "accept"}
    )
    assert manual.status_code == 409 and manual.json()["error"]["code"] == "no_automatic_fix"

    removed = (
        await client.post(
            f"/api/v1/surveys/{sid}/review/issues/{issues['skill_2']['id']}", headers=h, json={"action": "accept"}
        )
    ).json()
    keys = {q["key"] for s in removed["doc"]["sections"] for q in s["questions"]}
    assert "skill_2" not in keys and "skill_1" in keys
    assert all(
        "skill_2" not in json.dumps(rule, ensure_ascii=False) for rule in removed["doc"]["logic"]
    )  # no dangling logic
    assert {i["question_key"]: i["status"] for i in removed["review"]["issues"]}["skill_2"] == "accepted"
