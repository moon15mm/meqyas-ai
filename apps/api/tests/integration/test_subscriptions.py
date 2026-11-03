"""Subscriptions (SUBSCRIPTIONS.md): a workspace's plan decides its limits and modules, its dates
decide whether it may publish, use AI and collect answers, and suspension closes it."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.session import get_sessionmaker
from app.models import Subscription
from app.services import subscription_notices
from helpers import add_member
from sqlalchemy import update

DOC: dict[str, Any] = {
    "title": "قيّم زيارتك",
    "language": "ar",
    "sections": [
        {
            "key": "s1",
            "title": "الأسئلة",
            "questions": [{"key": "sat", "type": "LIKERT", "text": "أنا راضٍ عن الخدمة", "required": True}],
        }
    ],
}


async def _set(org_id: str, **values: Any) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(update(Subscription).where(Subscription.organization_id == org_id).values(**values))
        await session.commit()


async def _project(client: Any, h: dict[str, str]) -> str:
    res = await client.post(
        "/api/v1/projects", headers=h, json={"title": "رضا العملاء", "measurement_type": "SATISFACTION"}
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _survey(client: Any, h: dict[str, str], project_id: str) -> str:
    survey = (await client.post(f"/api/v1/projects/{project_id}/surveys", headers=h, json={"title": "رضا"})).json()
    survey_id = survey["survey"]["id"]
    assert (await client.put(f"/api/v1/surveys/{survey_id}/draft", headers=h, json={"doc": DOC})).status_code == 200
    return survey_id


async def _publish(client: Any, h: dict[str, str], survey_id: str) -> Any:
    return await client.post(f"/api/v1/surveys/{survey_id}/publish", headers=h)


async def _answer(client: Any, public_id: str) -> Any:
    opened = (await client.get(f"/api/v1/public/surveys/{public_id}")).json()
    if not opened.get("session"):
        return opened
    return await client.post(
        f"/api/v1/public/surveys/{public_id}/responses", json={"session": opened["session"], "answers": {"sat": 4}}
    )


async def _membership(client: Any, owner: dict[str, Any]) -> dict[str, Any]:
    me = (await client.get("/api/v1/auth/me", headers={"Authorization": owner["headers"]["Authorization"]})).json()
    return next(m for m in me["memberships"] if m["organization_id"] == owner["org_id"])


async def test_the_membership_carries_the_plan_limits_and_usage(client, register) -> None:
    owner = await register(plan="basic")
    sub = (await _membership(client, owner))["subscription"]
    assert sub["plan_code"] == "basic" and sub["state"] == "ACTIVE" and not sub["is_trial"]
    assert sub["limits"] == {"surveys": 10, "responses_per_month": 1000, "members": 3, "ai_daily_tokens": 500_000}
    assert sub["usage"] == {"surveys": 0, "responses_this_month": 0, "members": 1}
    assert "cx" not in sub["features"] and "exports" in sub["features"]
    assert datetime.fromisoformat(sub["month_resets_at"]).day == 1


async def test_surveys_are_counted_per_period_and_a_renewal_starts_again(client, register) -> None:
    owner = await register(plan="trial")
    await _set(owner["org_id"], overrides={"surveys": 1})
    h = owner["headers"]
    project = await _project(client, h)
    first, second = await _survey(client, h, project), await _survey(client, h, project)
    assert (await _publish(client, h, first)).status_code == 200
    blocked = await _publish(client, h, second)
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "survey_limit_reached"
    assert (await _membership(client, owner))["subscription"]["usage"]["surveys"] == 1
    await _set(owner["org_id"], surveys_used=0)  # what a renewal does
    assert (await _publish(client, h, second)).status_code == 200


async def test_the_monthly_response_limit_closes_collection(client, register) -> None:
    owner = await register(plan="trial")
    await _set(owner["org_id"], overrides={"responses_per_month": 2})
    h = owner["headers"]
    survey_id = await _survey(client, h, await _project(client, h))
    public_id = (await _publish(client, h, survey_id)).json()["survey"]["public_id"]
    for _ in range(2):
        assert (await _answer(client, public_id)).status_code == 201
    closed = await _answer(client, public_id)
    assert closed["availability"] == "CLOSED" and not closed.get("session")
    sub = (await _membership(client, owner))["subscription"]
    assert sub["usage"]["responses_this_month"] == 2 and sub["limits"]["responses_per_month"] == 2


async def test_an_ended_subscription_stops_new_work_then_collection(client, register, scripted_ai) -> None:
    owner = await register(plan="pro")
    h = owner["headers"]
    project = await _project(client, h)
    survey_id = await _survey(client, h, project)
    public_id = (await _publish(client, h, survey_id)).json()["survey"]["public_id"]
    ended = datetime.now(UTC) - timedelta(days=1)
    await _set(owner["org_id"], period_ends_at=ended)

    assert (await _membership(client, owner))["subscription"]["state"] == "EXPIRED"
    blocked = await _publish(client, h, await _survey(client, h, project))
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "subscription_ended"
    scripted_ai([])
    ai = await client.post("/api/v1/ai/measurement-architect", headers=h, json={"request": "أريد قياس رضا العملاء"})
    assert ai.status_code == 409 and ai.json()["error"]["code"] == "ai_subscription_inactive"
    # Published surveys keep collecting during the grace days, then close.
    assert (await _answer(client, public_id)).status_code == 201
    await _set(owner["org_id"], period_ends_at=datetime.now(UTC) - timedelta(days=8))
    assert (await _answer(client, public_id))["availability"] == "CLOSED"
    # Results stay readable.
    assert (await client.get(f"/api/v1/projects/{project}/analytics/summary", headers=h)).status_code == 200


async def test_a_suspended_workspace_is_closed(client, register) -> None:
    owner = await register()
    h = owner["headers"]
    survey_id = await _survey(client, h, await _project(client, h))
    public_id = (await _publish(client, h, survey_id)).json()["survey"]["public_id"]
    await _set(owner["org_id"], suspended_at=datetime.now(UTC))
    res = await client.get("/api/v1/projects", headers=h)
    assert res.status_code == 403 and res.json()["error"]["code"] == "organization_suspended"
    assert (await _answer(client, public_id))["availability"] == "CLOSED"
    # Signing in still works and tells the app why.
    assert (await _membership(client, owner))["subscription"]["state"] == "SUSPENDED"


async def test_modules_outside_the_plan_are_refused(client, register) -> None:
    owner = await register(plan="basic")  # no customer experience, no store integrations
    h = owner["headers"]
    project = await _project(client, h)
    cx = await client.get(f"/api/v1/projects/{project}/locations", headers=h)
    assert cx.status_code == 403 and cx.json()["error"] == {
        "code": "feature_not_in_plan",
        "message": "This feature is not included in the workspace's plan",
        "details": {"feature": "cx"},
    }
    stores = await client.get(f"/api/v1/projects/{project}/store-connections", headers=h)
    assert stores.status_code == 403 and stores.json()["error"]["details"]["feature"] == "integrations"
    # Exports are part of «basic».
    survey_id = await _survey(client, h, project)
    assert (await _publish(client, h, survey_id)).status_code == 200
    assert (await client.get(f"/api/v1/surveys/{survey_id}/responses/export.csv", headers=h)).status_code == 200

    pro = await register(email="pro@school.example", org="مساحة احترافية", plan="pro")
    pro_project = await _project(client, pro["headers"])
    assert (await client.get(f"/api/v1/projects/{pro_project}/locations", headers=pro["headers"])).status_code == 200


async def test_ai_agents_follow_the_plan_modules(client, register, scripted_ai) -> None:
    owner = await register()
    async with get_sessionmaker()() as session:
        from app.models import SubscriptionPlan
        from sqlalchemy import select

        plan = await session.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == "enterprise"))
        assert plan is not None
        plan.features = ["cx", "integrations", "exports"]
        await session.commit()
    h = owner["headers"]
    project = await _project(client, h)
    scripted_ai([])
    chat = await client.post(
        f"/api/v1/projects/{project}/analyst/chat", headers=h, json={"message": "ما أبرز النتائج؟"}
    )
    assert chat.status_code == 403 and chat.json()["error"]["code"] == "ai_not_in_plan"
    assert chat.json()["error"]["details"] == {"feature": "ai_analysis"}


async def test_the_member_limit_counts_invitations(client, register) -> None:
    owner = await register(plan="trial")
    await _set(owner["org_id"], overrides={"members": 2})
    await add_member(client, owner, "first@school.example", "VIEWER", register)
    res = await client.post(
        f"/api/v1/organizations/{owner['org_id']}/members",
        headers=owner["headers"],
        json={"email": "second@school.example", "role": "VIEWER"},
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "member_limit_reached"
    assert res.json()["error"]["details"] == {"limit": 2}


async def test_reminders_are_e_mailed_once(client, register, monkeypatch) -> None:
    owner = await register(plan="pro")
    await _set(owner["org_id"], period_ends_at=datetime.now(UTC) + timedelta(days=5))
    sent: list[tuple[str, str]] = []

    async def fake_send(to: str, subject: str, body: str) -> None:
        sent.append((to, subject))

    monkeypatch.setattr(subscription_notices, "send_email", fake_send)
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_url", "smtp://mail.example:587")
    async with get_sessionmaker()() as session:
        assert await subscription_notices.send_notices(session) == 1
    assert sent == [("owner@school.example", "ينتهي اشتراك «مدرسة الاختبار» خلال أسبوع")]
    async with get_sessionmaker()() as session:
        assert await subscription_notices.send_notices(session) == 0  # once
