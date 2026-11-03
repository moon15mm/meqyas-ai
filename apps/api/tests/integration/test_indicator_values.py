"""Indicator values: a dimension's second indicator is measured on the dimension's questions, and an
indicator with answers below the privacy minimum is «collecting», not «not started»."""

from __future__ import annotations

from typing import Any

from app.db.session import get_sessionmaker
from app.domain.enums import ReviewStatus
from app.models import Response
from plan_fixtures import satisfaction_plan
from sqlalchemy import update

REQUEST = "أريد قياس رضا الطالبات عن البرنامج التدريبي ومدى استخدامهن لما تعلمنه."


def _likert(key: str, text: str, dimension_id: str, indicator_id: str | None = None) -> dict[str, Any]:
    return {
        "key": key,
        "type": "LIKERT",
        "text": text,
        "required": True,
        "dimension_id": dimension_id,
        "indicator_id": indicator_id,
    }


async def _setup(client: Any, owner: dict[str, Any], scripted_ai: Any) -> dict[str, Any]:
    h = owner["headers"]
    scripted_ai([satisfaction_plan()])
    plan = (await client.post("/api/v1/ai/measurement-architect", headers=h, json={"request": REQUEST})).json()
    project = (await client.post(f"/api/v1/measurement-plans/{plan['id']}/accept", headers=h)).json()
    overview = (await client.get(f"/api/v1/projects/{project['id']}/overview", headers=h)).json()
    dims = {d["key"]: d["id"] for d in overview["plan"]["dimensions"]}
    inds = {i["code"]: i for i in overview["plan"]["indicators"]}
    wave = overview["plan"]["waves"][0]["id"]
    # Like the survey generator: every question links to one indicator — here only the average of
    # «skills» — so IND-02 («% usage», dimension «usage») has no question of its own.
    doc = {
        "title": "استبيان الرضا",
        "language": "ar",
        "sections": [
            {
                "key": "s1",
                "title": "الأسئلة",
                "questions": [
                    _likert("skills_1", "أستطيع استخدام الأدوات بثقة", dims["skills"], inds["IND-01"]["id"]),
                    _likert("skills_2", "أفهم متى تكون الأداة مفيدة", dims["skills"], inds["IND-01"]["id"]),
                    _likert("usage_1", "أستخدم الأدوات أسبوعيًا", dims["usage"]),
                    _likert("usage_2", "أستخدمها في الواجبات", dims["usage"]),
                ],
            }
        ],
    }
    survey = (
        await client.post(
            f"/api/v1/projects/{project['id']}/surveys", headers=h, json={"title": "رضا", "wave_id": wave}
        )
    ).json()["survey"]
    assert (await client.put(f"/api/v1/surveys/{survey['id']}/draft", headers=h, json={"doc": doc})).status_code == 200
    published = (await client.post(f"/api/v1/surveys/{survey['id']}/publish", headers=h)).json()["survey"]
    return {"project_id": project["id"], "public_id": published["public_id"], "inds": inds}


async def _respond(client: Any, public_id: str, answers: dict[str, int]) -> None:
    opened = (await client.get(f"/api/v1/public/surveys/{public_id}")).json()
    res = await client.post(
        f"/api/v1/public/surveys/{public_id}/responses", json={"session": opened["session"], "answers": answers}
    )
    assert res.status_code == 201, res.text
    async with get_sessionmaker()() as session:  # fast scripted answers would read as speeding
        await session.execute(update(Response).values(review_status=ReviewStatus.KEEP))
        await session.commit()


async def _indicators(client: Any, owner: dict[str, Any], project_id: str) -> dict[str, dict[str, Any]]:
    summary = (await client.get(f"/api/v1/projects/{project_id}/analytics/summary", headers=owner["headers"])).json()
    return {i["code"]: i for i in summary["indicators"]}


ANSWERS = [
    {"skills_1": 5, "skills_2": 4, "usage_1": 5, "usage_2": 4},
    {"skills_1": 4, "skills_2": 4, "usage_1": 2, "usage_2": 3},
    {"skills_1": 3, "skills_2": 5, "usage_1": 4, "usage_2": 5},
    {"skills_1": 5, "skills_2": 3, "usage_1": 1, "usage_2": 2},
    {"skills_1": 4, "skills_2": 5, "usage_1": 5, "usage_2": 5},
]


async def test_dimension_indicator_and_collecting_status(client, register, scripted_ai) -> None:
    owner = await register()
    setup = await _setup(client, owner, scripted_ai)

    before = await _indicators(client, owner, setup["project_id"])
    assert before["IND-01"]["status"] == "NOT_STARTED"  # nothing collected yet
    assert before["IND-02"]["items"] == 2 and before["IND-02"]["items_from"] == "dimension"
    assert before["IND-01"]["items_from"] == "indicator"

    await _respond(client, setup["public_id"], ANSWERS[0])
    one = await _indicators(client, owner, setup["project_id"])
    for code in ("IND-01", "IND-02"):
        assert one[code]["status"] == "COLLECTING" and one[code]["current_value"] is None
        assert one[code]["waves"][0]["reason"] == "below_k_anonymity" and one[code]["waves"][0]["n"] == 1

    for answers in ANSWERS[1:]:
        await _respond(client, setup["public_id"], answers)
    five = await _indicators(client, owner, setup["project_id"])
    assert five["IND-01"]["current_value"] == 4.2  # mean of the respondents' skills means
    # «% usage» is measured on the dimension's questions: respondent means ≥ 4 → 3 of 5.
    assert five["IND-02"]["current_value"] == 60.0 and five["IND-02"]["status"] == "ACHIEVED"
