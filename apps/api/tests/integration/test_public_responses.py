"""Phase 4: public survey collection, respondents, response quality and management."""

from __future__ import annotations

from typing import Any

from app.db.session import get_sessionmaker
from app.models import AIRun, Answer, Respondent, Response
from helpers import add_member
from plan_fixtures import impact_plan
from sqlalchemy import select

REQUEST = "أريد قياس أثر برنامج تدريبي لطالبات المرحلة الثانوية في استخدام أدوات الذكاء الاصطناعي في التعلم."


async def _project(client, owner, scripted_ai) -> dict[str, Any]:
    scripted_ai([impact_plan()])
    plan = (
        await client.post("/api/v1/ai/measurement-architect", headers=owner["headers"], json={"request": REQUEST})
    ).json()
    project = (await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=owner["headers"])).json()
    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=owner["headers"])).json()
    return {
        "id": project["id"],
        "waves": {w["wave_type"]: w["id"] for w in overview["plan"]["waves"]},
        "dims": {d["key"]: d["id"] for d in overview["plan"]["dimensions"]},
    }


def _doc(*, settings: dict[str, Any] | None = None, title: str = "استبيان الرضا") -> dict[str, Any]:
    likert = [
        {
            "key": f"l{i}",
            "type": "LIKERT",
            "text": f"عبارة رقم {i}",
            "required": True,
            "scoring": {"correct_values": ["5"]},
        }
        for i in range(1, 6)
    ]
    return {
        "title": title,
        "language": "ar",
        "sections": [
            {
                "key": "s1",
                "title": "الرضا",
                "questions": [
                    {
                        "key": "sat",
                        "type": "LIKERT",
                        "text": "أنا راضية عن البرنامج",
                        "required": True,
                        "settings": {"ai_followup": True},
                    },
                    {"key": "why", "type": "LONG_TEXT", "text": "ما سبب عدم رضاك؟"},
                    {
                        "key": "grade",
                        "type": "SINGLE_CHOICE",
                        "text": "الصف",
                        "options": [
                            {"value": "10", "label": "الأول", "score": 1},
                            {"value": "x", "label": "أخرى", "is_other": True},
                        ],
                        "settings": {"is_profile": True},
                    },
                    *likert,
                ],
            }
        ],
        "logic": [
            {
                "id": "r1",
                "type": "DISPLAY",
                "target_key": "why",
                "condition": {"question": "sat", "op": "lte", "value": 2},
            }
        ],
        "settings": settings or {},
    }


async def _published(client, owner, project, *, wave: str = "BASELINE", **doc_kwargs: Any) -> dict[str, Any]:
    h = owner["headers"]
    created = (
        await client.post(
            f"/api/v1/projects/{project['id']}/surveys",
            headers=h,
            json={"title": "استبيان", "wave_id": project["waves"][wave]},
        )
    ).json()
    sid = created["survey"]["id"]
    saved = await client.put(f"/api/v1/surveys/{sid}/draft", headers=h, json={"doc": _doc(**doc_kwargs)})
    assert saved.status_code == 200, saved.text
    published = await client.post(f"/api/v1/surveys/{sid}/publish", headers=h)
    assert published.status_code == 200, published.text
    return published.json()["survey"]


def _answers(**overrides: Any) -> dict[str, Any]:
    return {"sat": 4, "l1": 4, "l2": 3, "l3": 5, "l4": 2, "l5": 4, "grade": "10", **overrides}


async def _open(client, public_id: str) -> dict[str, Any]:
    res = await client.get(f"/api/v1/public/surveys/{public_id}")
    assert res.status_code == 200, res.text
    return res.json()


async def _submit(client, public_id: str, session: str, **body: Any):  # type: ignore[no-untyped-def]
    return await client.post(
        f"/api/v1/public/surveys/{public_id}/responses",
        json={"session": session, "answers": _answers(), **body},
        headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"},
    )


async def test_public_lifecycle_validation_and_idempotency(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    h = owner["headers"]
    draft = (await client.post(f"/api/v1/projects/{project['id']}/surveys", headers=h, json={"title": "مسودة"})).json()[
        "survey"
    ]
    assert (await client.get(f"/api/v1/public/surveys/{draft['public_id']}")).status_code == 404

    survey = await _published(client, owner, project)
    pid = survey["public_id"]
    opened = await _open(client, pid)
    assert opened["availability"] == "OPEN" and opened["session"] and opened["version"] == 1
    question = opened["doc"]["sections"][0]["questions"][0]
    assert "scoring" not in question and "dimension_id" not in question and "lineage_id" not in question
    likert = opened["doc"]["sections"][0]["questions"][3]
    assert "scoring" not in likert  # correct answers never reach the browser
    grade = opened["doc"]["sections"][0]["questions"][2]
    assert "score" not in grade["options"][0] and "is_profile" not in grade["settings"]
    assert opened["ai_followup"] is False  # AI not configured for this request path

    # server-side validation: required + invalid option, with field-level codes
    bad = await client.post(
        f"/api/v1/public/surveys/{pid}/responses",
        json={"session": opened["session"], "answers": {"sat": 9, "grade": "nope"}},
    )
    assert bad.status_code == 422
    errors = bad.json()["error"]["details"]["errors"]
    assert (
        errors["sat"]["code"] == "max" and errors["grade"]["code"] == "invalid" and errors["l1"]["code"] == "required"
    )

    # hidden question answers are dropped (why is only shown when sat <= 2)
    ok = await _submit(client, pid, opened["session"], answers=_answers(why="لا شيء"), other_texts={"grade": "x"})
    assert ok.status_code == 201, ok.text
    response_id = ok.json()["response_id"]
    again = await _submit(client, pid, opened["session"])
    assert again.status_code == 201 and again.json()["response_id"] == response_id  # idempotent per session

    async with get_sessionmaker()() as session:
        stored = await session.get(Response, response_id)
        assert stored is not None and stored.device == "mobile" and stored.answered_count == 7
        keys = set((await session.scalars(select(Answer.question_key).where(Answer.response_id == stored.id))).all())
    assert "why" not in keys and {"sat", "grade", "l1"} <= keys

    # the owner sees the response; the survey meta counts it
    meta = (await client.get(f"/api/v1/surveys/{survey['id']}", headers=h)).json()["survey"]
    assert meta["response_count"] == 1 and meta["last_response_at"]
    detail = (await client.get(f"/api/v1/responses/{response_id}", headers=h)).json()
    shown = {a["question_key"]: a["display"] for a in detail["answers"]}
    assert shown["grade"] == "الأول" and shown["sat"] == "أوافق"  # labels, not raw codes

    # pause → not accepting; an old session cannot sneak in
    await client.post(f"/api/v1/surveys/{survey['id']}/pause", headers=h)
    paused = await _open(client, pid)
    assert paused["availability"] == "PAUSED" and paused["doc"] is None and paused["session"] is None
    second_session = opened["session"].replace(opened["session"][-6:], "AAAAAA")
    late = await _submit(client, pid, second_session)
    assert late.status_code == 422 and late.json()["error"]["code"] == "invalid_session"
    await client.post(f"/api/v1/surveys/{survey['id']}/resume", headers=h)
    fresh = await _open(client, pid)
    await client.post(f"/api/v1/surveys/{survey['id']}/pause", headers=h)
    blocked = await _submit(client, pid, fresh["session"])
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "survey_paused"
    await client.post(f"/api/v1/surveys/{survey['id']}/resume", headers=h)

    # response limit
    limited = await client.patch(f"/api/v1/surveys/{survey['id']}", headers=h, json={"response_limit": 1})
    assert limited.json()["survey"]["response_limit"] == 1
    assert (await _open(client, pid))["availability"] == "FULL"


async def test_pseudonymous_codes_pair_waves_without_storing_codes(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    settings = {"anonymity_mode": "PSEUDONYMOUS", "collect_respondent_code": True}
    pre = await _published(client, owner, project, wave="BASELINE", settings=settings)
    post = await _published(client, owner, project, wave="POST", settings=settings)

    s1 = (await _open(client, pre["public_id"]))["session"]
    missing = await _submit(client, pre["public_id"], s1)
    assert missing.status_code == 422
    assert missing.json()["error"]["details"]["errors"]["_respondent_code"]["code"] == "required"
    assert (await _submit(client, pre["public_id"], s1, respondent_code="nm-07 ٣")).status_code == 201
    s2 = (await _open(client, post["public_id"]))["session"]
    assert (await _submit(client, post["public_id"], s2, respondent_code="NM073")).status_code == 201

    page = (await client.get(f"/api/v1/projects/{project['id']}/responses", headers=owner["headers"])).json()
    labels = {item["respondent_label"] for item in page["items"]}
    assert len(labels) == 1 and next(iter(labels)).startswith("R-")  # same person across waves
    async with get_sessionmaker()() as session:
        respondent = (await session.scalars(select(Respondent))).one()
    assert respondent.code_hash and "NM073" not in respondent.code_hash and respondent.name_encrypted is None


async def test_identified_mode_encrypts_identity(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    survey = await _published(client, owner, project, settings={"anonymity_mode": "IDENTIFIED"})
    pid = survey["public_id"]
    session_token = (await _open(client, pid))["session"]
    assert (await _submit(client, pid, session_token)).status_code == 422  # name required
    res = await _submit(
        client, pid, session_token, respondent_name="نورة  الأحمد", respondent_email="Noura@School.example"
    )
    assert res.status_code == 201, res.text
    async with get_sessionmaker()() as session:
        respondent = (await session.scalars(select(Respondent))).one()
    assert respondent.name_encrypted and "نورة" not in respondent.name_encrypted
    detail = (await client.get(f"/api/v1/responses/{res.json()['response_id']}", headers=owner["headers"])).json()
    assert detail["respondent_name"] == "نورة الأحمد" and detail["respondent_email"] == "noura@school.example"


async def test_quality_flags_ordering_and_review(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    survey = await _published(client, owner, project)
    pid = survey["public_id"]
    good = (await _open(client, pid))["session"]
    junk = (await _open(client, pid))["session"]
    assert (await _submit(client, pid, good)).status_code == 201
    straight = {"sat": 1, "why": "......", "l1": 1, "l2": 1, "l3": 1, "l4": 1, "l5": 1, "grade": "10"}
    res = await _submit(client, pid, junk, answers=straight, client_id="device-1")
    assert res.status_code == 201

    page = (await client.get(f"/api/v1/surveys/{survey['id']}/responses", headers=owner["headers"])).json()
    first = page["items"][0]
    assert first["id"] == res.json()["response_id"]  # needs-attention first
    codes = {f["code"] for f in first["quality_flags"]}
    assert {"way_too_fast", "straightlining", "low_effort_text"} <= codes
    assert first["quality_status"] == "LOW_QUALITY"
    assert page["counts"]["total"] == 2 and page["counts"]["low_quality"] == 1

    reviewed = await client.patch(
        f"/api/v1/responses/{first['id']}", headers=owner["headers"], json={"review_status": "EXCLUDE"}
    )
    assert reviewed.status_code == 200 and reviewed.json()["review_status"] == "EXCLUDE"
    counts = (await client.get(f"/api/v1/surveys/{survey['id']}/responses", headers=owner["headers"])).json()["counts"]
    assert counts["excluded"] == 1


async def test_ai_followup_is_bounded_and_server_issued(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    survey = await _published(client, owner, project, settings={"ai_followup_enabled": True, "ai_followup_max": 1})
    pid = survey["public_id"]
    provider = scripted_ai([{"ask": True, "question": "ما الذي جعل تقييمك منخفضًا؟"}])
    opened = await _open(client, pid)
    assert opened["ai_followup"] is True
    assert opened["doc"]["sections"][0]["questions"][0]["settings"]["ai_followup"] is True
    token = opened["session"]

    asked = await client.post(
        f"/api/v1/public/surveys/{pid}/followup", json={"session": token, "question_key": "sat", "answer": 2}
    )
    assert asked.json() == {"ask": True, "question": "ما الذي جعل تقييمك منخفضًا؟"}
    # the respondent's answer reaches the model only inside the untrusted envelope, with its scale position
    prompt = provider.calls[0]["messages"][-1].content
    assert "<untrusted_data" in prompt and "2 / 5" in prompt
    # AI usage of anonymous respondents is recorded (it counts against the organization's budget)
    async with get_sessionmaker()() as session:
        runs = (await session.scalars(select(AIRun).where(AIRun.agent == "adaptive_interviewer"))).all()
    assert len(runs) == 1 and runs[0].status.value == "SUCCESS" and runs[0].user_id is None
    # bounded: max 1 per session, never twice for the same question, only on enabled questions
    for key, answer in (("sat", 1), ("l1", 2)):
        res = await client.post(
            f"/api/v1/public/surveys/{pid}/followup", json={"session": token, "question_key": key, "answer": answer}
        )
        assert res.json()["ask"] is False

    res = await _submit(
        client,
        pid,
        token,
        answers=_answers(sat=2, why="المحتوى سريع"),
        followups={"sat": "الشرح كان سريعًا", "l1": "مزوّر"},
    )
    assert res.status_code == 201, res.text
    detail = (await client.get(f"/api/v1/responses/{res.json()['response_id']}", headers=owner["headers"])).json()
    follow = [a for a in detail["answers"] if a["is_followup"]]
    assert len(follow) == 1 and follow[0]["question_key"] == "sat"
    assert follow[0]["followup_prompt"] == "ما الذي جعل تقييمك منخفضًا؟" and follow[0]["display"] == "الشرح كان سريعًا"


async def test_response_permissions_isolation_and_qr(client, register, scripted_ai) -> None:
    owner = await register()
    project = await _project(client, owner, scripted_ai)
    survey = await _published(client, owner, project)
    pid = survey["public_id"]
    rid = (await _submit(client, pid, (await _open(client, pid))["session"])).json()["response_id"]

    viewer = await add_member(client, owner, "viewer@school.example", "VIEWER", register)
    analyst = await add_member(client, owner, "analyst@school.example", "ANALYST", register)
    editor = await add_member(client, owner, "editor@school.example", "EDITOR", register)
    assert (await client.get(f"/api/v1/responses/{rid}", headers=viewer["headers_in_owner_org"])).status_code == 403
    assert (await client.get(f"/api/v1/responses/{rid}", headers=analyst["headers_in_owner_org"])).status_code == 200
    assert (await client.delete(f"/api/v1/responses/{rid}", headers=editor["headers_in_owner_org"])).status_code == 403

    stranger = await register(email="other@elsewhere.example", org="مدرسة أخرى")
    assert (await client.get(f"/api/v1/responses/{rid}", headers=stranger["headers"])).status_code == 404
    listing = await client.get(f"/api/v1/projects/{project['id']}/responses", headers=stranger["headers"])
    assert listing.status_code == 404

    svg = await client.get(f"/api/v1/surveys/{survey['id']}/qr.svg", headers=owner["headers"])
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml") and b"<svg" in svg.content
    png = await client.get(f"/api/v1/surveys/{survey['id']}/qr.png", headers=owner["headers"])
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert (await client.get(f"/api/v1/surveys/{survey['id']}/qr.svg", headers=stranger["headers"])).status_code == 404

    assert (await client.delete(f"/api/v1/responses/{rid}", headers=owner["headers"])).status_code == 200
    assert (await client.get(f"/api/v1/responses/{rid}", headers=owner["headers"])).status_code == 404
