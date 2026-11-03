"""Phase 6 over the DEMO DATA: open-answer analysis, insights, recommendations, AI analyst."""

from __future__ import annotations

import re
from typing import Any

from app.db.session import get_sessionmaker
from app.models import AIRun, AnswerTheme
from app.seed.demo import DEMO_EMAIL, DEMO_PASSWORD, seed_demo
from helpers import add_member, demo_project
from sqlalchemy import func, select

_ITEM_ID = re.compile(r'<item id="([^"]+)">([^<]*)</item>')


def _items(messages: Any) -> list[tuple[str, str]]:
    # Repair rounds append messages: the data envelope may not be the last one.
    found: list[tuple[str, str]] = []
    for m in messages:
        found = _ITEM_ID.findall(m.content) or found
    return found


def sentiment_script(messages: Any, schema: Any) -> dict[str, Any]:
    """Negative for barrier-like answers, positive otherwise — for every id actually sent."""
    results = []
    for item_id, text in _items(messages):
        negative = any(w in text for w in ("الوقت", "ضعف", "عدم", "أحتاج"))
        results.append(
            {"id": item_id, "label": "NEGATIVE" if negative else "POSITIVE", "score": -0.6 if negative else 0.7}
        )
    return {"results": results}


def theme_script(messages: Any, schema: Any) -> dict[str, Any]:
    assignments = []
    for item_id, text in _items(messages):
        keys = ["time"] if "الوقت" in text else ["internet"] if "الإنترنت" in text else ["policy"]
        assignments.append({"id": item_id, "themes": keys})
    return {
        "themes": [
            {
                "key": "time",
                "name": "ضيق الوقت",
                "category": "PAIN_POINT",
                "sentiment": "NEGATIVE",
                "keywords": ["الوقت"],
            },
            {"key": "internet", "name": "ضعف الإنترنت", "category": "PAIN_POINT", "sentiment": "NEGATIVE"},
            {"key": "policy", "name": "وضوح السياسات والأمثلة", "category": "SUGGESTION", "sentiment": "NEUTRAL"},
        ],
        "assignments": assignments,
    }


def text_script(messages: Any, schema: Any) -> dict[str, Any]:
    """Dispatch on the agent's system prompt so batch counts never matter."""
    if "qualitative analyst" in messages[0].content:
        return theme_script(messages, schema)
    return sentiment_script(messages, schema)


async def _demo(client) -> dict[str, Any]:
    async with get_sessionmaker()() as session:
        await seed_demo(session)
    body = (await client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})).json()
    org_id = body["memberships"][0]["organization_id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id}
    project = await demo_project(client, headers)
    return {"headers": headers, "org_id": org_id, "project_id": project["id"]}


async def test_open_answers_keywords_sentiment_and_themes(client, register, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}/text-analysis"
    provider = scripted_ai([text_script] * 6)
    res = await client.post(f"{base}/barrier", headers=demo["headers"], json={})
    assert res.status_code == 200, res.text
    out = res.json()
    total = out["answers"]
    assert total >= 20 and out["answers_analyzed"] == total
    assert out["keywords"] and out["keywords"][0]["answers"] >= 2  # deterministic, no model
    assert sum(out["sentiment"]["counts"].values()) == total
    themes = {t["key"]: t for t in out["themes"]}
    assert set(themes) == {"time", "internet", "policy"}
    # Duplicate answers were sent once but every answer is counted.
    assert sum(t["count"] for t in themes.values()) == total
    assert themes["time"]["samples"]  # the owner may read raw answers
    theme_calls = [c for c in provider.calls if "qualitative analyst" in c["messages"][0].content]
    first_prompt = theme_calls[0]["messages"][1].content
    assert first_prompt.count("الوقت ما زال التحدي الأكبر.") == 1  # identical answers are sent once
    assert all('source="survey_answers"' in c["messages"][1].content for c in provider.calls)

    async with get_sessionmaker()() as session:
        links = await session.scalar(select(func.count()).select_from(AnswerTheme))
        runs = await session.scalar(select(func.count()).select_from(AIRun).where(AIRun.agent == "theme_analyzer"))
    assert links == total and runs == 1

    # Already rated answers are not sent again (and the unchanged theme input is served from cache).
    second = scripted_ai([text_script] * 3)
    again = (await client.post(f"{base}/barrier", headers=demo["headers"], json={})).json()
    assert again["answers_analyzed"] == total and again["themes"]
    assert not any("rate the sentiment" in c["messages"][0].content for c in second.calls)

    viewer = await add_member(
        client, {"headers": demo["headers"], "org_id": demo["org_id"]}, "v@x.example", "VIEWER", register
    )
    listing = (await client.get(base, headers=viewer["headers_in_owner_org"])).json()
    barrier = next(q for q in listing if q["question_key"] == "barrier")
    assert barrier["themes"] and all("samples" not in t for t in barrier["themes"])  # aggregates only
    assert (await client.post(f"{base}/barrier", headers=viewer["headers_in_owner_org"], json={})).status_code == 403
    keywords_only = (await client.post(f"{base}/challenge", headers=demo["headers"], json={"use_ai": False})).json()
    assert keywords_only["keywords"] and keywords_only["sentiment"] is None


async def test_insights_are_evidence_linked_and_keep_decisions(client) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    res = await client.post(f"{base}/insights/generate", headers=demo["headers"])
    assert res.status_code == 200, res.text
    insights = res.json()
    kinds = {i["kind"] for i in insights}
    assert {"IMPROVEMENT", "WEAKNESS", "STRENGTH", "RISK", "SUCCESS"} <= kinds
    improvement = next(
        i for i in insights if i["kind"] == "IMPROVEMENT" and i["evidence"]["dimension_key"] == "knowledge"
    )
    ev = improvement["evidence"]
    assert ev["from_wave"] == "BASELINE" and ev["to_wave"] == "FOLLOW_UP" and ev["paired"] is True
    assert ev["p_value"] < 0.05 and ev["to_value"] > ev["from_value"]
    assert "لا يثبت" in improvement["body"]  # causality caveat for a change design
    assert (
        str(ev["to_value"]).rstrip("0").rstrip(".") in improvement["body"]
        or f"{ev['to_value']:.2f}" in improvement["body"]
    )
    risk = next(i for i in insights if i["kind"] == "RISK" and i["evidence"]["indicator_code"] == "IND-03")
    assert risk["severity"] == "HIGH" and risk["evidence"]["status"] == "OFF_TRACK"
    # A change indicator is reported between the waves it is computed on, at full precision.
    change = next(i for i in insights if i["evidence"].get("indicator_code") == "IND-02")
    cev = change["evidence"]
    assert (cev["from_wave"], cev["to_wave"]) == ("BASELINE", "POST") and "wave" not in cev
    assert f"+{cev['value']:.2f}".rstrip("0").rstrip(".") in change["body"] and "←" in change["body"]
    for gap in (i for i in insights if i["kind"] == "GAP"):
        significant = gap["evidence"]["p_value"] is not None and gap["evidence"]["p_value"] < 0.05
        assert significant or "غير دال إحصائيًا" in gap["body"]

    pinned = await client.patch(f"/api/v1/insights/{risk['id']}", headers=demo["headers"], json={"status": "PINNED"})
    assert pinned.json()["status"] == "PINNED"
    dismissed = next(i for i in insights if i["kind"] == "STRENGTH")
    await client.patch(f"/api/v1/insights/{dismissed['id']}", headers=demo["headers"], json={"status": "DISMISSED"})
    again = (await client.post(f"{base}/insights/generate", headers=demo["headers"])).json()
    by_id = {i["id"]: i for i in again}
    assert by_id[risk["id"]]["status"] == "PINNED"  # same fingerprint → same row, decision kept
    assert dismissed["id"] not in by_id  # dismissed are hidden by default
    everything = (await client.get(f"{base}/insights?include_dismissed=true", headers=demo["headers"])).json()
    assert any(i["id"] == dismissed["id"] for i in everything)


async def test_recommendations_from_insights_and_manual(client, register, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    none_yet = await client.post(f"{base}/recommendations/generate", headers=demo["headers"])
    assert none_yet.status_code == 422 and none_yet.json()["error"]["code"] == "no_insights"
    await client.post(f"{base}/insights/generate", headers=demo["headers"])

    def recs(messages: Any, schema: Any) -> dict[str, Any]:
        first = _items(messages)[0][0]
        return {
            "recommendations": [
                {
                    "insight_ids": [first, "N99"],
                    "problem": "مؤشر خارج المسار",
                    "recommendation": "تخصيص حصة أسبوعية للتطبيق العملي",
                    "possible_cause": "ضيق الوقت في الجدول",
                    "priority": "HIGH",
                }
            ]
        }

    scripted_ai([recs])
    res = await client.post(f"{base}/recommendations/generate", headers=demo["headers"])
    assert res.status_code == 200, res.text
    rec = res.json()[0]
    assert rec["source"] == "AI" and rec["status"] == "PROPOSED" and len(rec["insight_ids"]) == 1
    assert rec["possible_cause"].startswith("فرضية: ")
    insight_ids = {i["id"] for i in (await client.get(f"{base}/insights", headers=demo["headers"])).json()}
    assert rec["insight_ids"][0] in insight_ids

    accepted = await client.patch(
        f"/api/v1/recommendations/{rec['id']}",
        headers=demo["headers"],
        json={"status": "ACCEPTED", "owner": "إدارة البرنامج"},
    )
    assert accepted.json()["status"] == "ACCEPTED"
    scripted_ai([recs])
    regenerated = (await client.post(f"{base}/recommendations/generate", headers=demo["headers"])).json()
    assert len(regenerated) == 2 and any(r["id"] == rec["id"] for r in regenerated)  # accepted ones are kept

    manual = await client.post(
        f"{base}/recommendations",
        headers=demo["headers"],
        json={"recommendation": "متابعة شهرية مع المدربين", "priority": "LOW"},
    )
    assert manual.status_code == 201 and manual.json()["source"] == "MANUAL"
    assert (
        await client.delete(f"/api/v1/recommendations/{manual.json()['id']}", headers=demo["headers"])
    ).status_code == 200

    viewer = await add_member(
        client, {"headers": demo["headers"], "org_id": demo["org_id"]}, "v2@x.example", "VIEWER", register
    )
    assert (await client.get(f"{base}/recommendations", headers=viewer["headers_in_owner_org"])).status_code == 200
    blocked = await client.post(
        f"{base}/recommendations", headers=viewer["headers_in_owner_org"], json={"recommendation": "x x x"}
    )
    assert blocked.status_code == 403


async def test_analyst_answers_from_the_pack_only(client, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    pack = (await client.get(f"{base}/analytics/pack", headers=demo["headers"])).json()
    knowledge = next(
        f
        for f in pack["facts"]
        if "المعرفة" in f["label"] and "القياس البعدي" in f["label"] and f["ref"].get("kind") == "dimension"
    )

    def answer(value_fact: dict[str, Any], *, fake: bool):
        def script(messages: Any, schema: Any) -> dict[str, Any]:
            if fake:
                return {"answer": "درجة المعرفة 97 من 100", "evidence_ids": ["F999"]}
            number = value_fact["value"].split(" ")[0]
            return {
                "answer": f"بلغت درجة المعرفة في القياس البعدي {number} من 100.",
                "evidence_ids": [value_fact["id"]],
                "follow_ups": ["كيف تغيرت عن القبلي؟"],
            }

        return script

    provider = scripted_ai([answer(knowledge, fake=True), answer(knowledge, fake=False)])
    res = await client.post(
        f"{base}/analyst/chat", headers=demo["headers"], json={"message": "ما مستوى المعرفة بعد البرنامج؟"}
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert len(provider.calls) == 2  # invented number + unknown id were repaired
    assert out["evidence"][0]["id"] == knowledge["id"] and out["evidence"][0]["value"] == knowledge["value"]
    prompt = provider.calls[0]["messages"][-1].content
    assert "ضعف الإنترنت" not in prompt  # aggregates only — never raw answers
    assert "<user_request>" in prompt


async def test_unverified_analyst_answers_are_never_shown(client, scripted_ai) -> None:
    demo = await _demo(client)
    fake = {"answer": "تحسنت المعرفة بنسبة 87%", "evidence_ids": ["F1"]}
    scripted_ai([fake] * 3)  # the invented number survives every repair round
    res = await client.post(
        f"/api/v1/projects/{demo['project_id']}/analyst/chat",
        headers=demo["headers"],
        json={"message": "كم تحسنت المعرفة؟"},
    )
    assert res.status_code == 422 and res.json()["error"]["code"] == "analyst_unverified"
