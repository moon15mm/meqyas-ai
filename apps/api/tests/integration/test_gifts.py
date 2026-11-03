"""Gifts (GIFTS.md): platform admins prepare trial accounts, recipients activate them with a one-time
link, and the gifted workspace — on the trial plan (SUBSCRIPTIONS.md) — is limited to its surveys,
trial period and AI budget."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.session import get_sessionmaker
from app.models import AIRun, AuditLog, Gift, Organization, Subscription, User
from sqlalchemy import func, select, update

GIFT: dict[str, Any] = {
    "recipient_name": "سارة القحطاني",
    "recipient_email": "sara@clinic.example",
    "organization_name": "عيادة الندى",
    "survey_limit": 2,
    "trial_days": 30,
    "note": "يسعدنا أن تجربوا المنصة في قياس رضا المراجعين.",
}
PASSWORD = "Str0ng-Passw0rd!"


async def _admin(register: Any, email: str = "admin@meqyas.example") -> dict[str, Any]:
    admin = await register(email=email)
    async with get_sessionmaker()() as session:
        await session.execute(update(User).where(User.email == email).values(is_superuser=True))
        await session.commit()
    return admin


def _token(link: str) -> str:
    return link.rsplit("/gift/", 1)[1]


async def _gift(client: Any, admin: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    res = await client.post("/api/v1/admin/gifts", headers=admin["headers"], json={**GIFT, **overrides})
    assert res.status_code == 201, res.text
    return res.json()


async def _claim(client: Any, link: str) -> dict[str, Any]:
    res = await client.post("/api/v1/gifts/claim", json={"token": _token(link), "password": PASSWORD})
    assert res.status_code == 200, res.text
    body = res.json()
    membership = body["memberships"][0]
    return {
        "headers": {
            "Authorization": f"Bearer {body['access_token']}",
            "X-Organization-Id": membership["organization_id"],
        },
        "membership": membership,
        "body": body,
    }


async def _survey(client: Any, h: dict[str, str], project_id: str) -> dict[str, Any]:
    res = await client.post(
        f"/api/v1/projects/{project_id}/surveys/from-template", headers=h, json={"template": "store_visit"}
    )
    assert res.status_code == 201, res.text
    return res.json()["survey"]


async def test_only_platform_admins_send_gifts(client, register) -> None:
    user = await register()
    res = await client.post("/api/v1/admin/gifts", headers=user["headers"], json=GIFT)
    assert res.status_code == 403 and res.json()["error"]["code"] == "platform_admin_only"
    assert (await client.get("/api/v1/admin/gifts", headers=user["headers"])).status_code == 403
    me = (await client.get("/api/v1/auth/me", headers=user["headers"])).json()
    assert me["user"]["is_platform_admin"] is False


async def test_gift_is_prepared_activated_and_limited(client, register) -> None:
    admin = await _admin(register)
    me = (await client.get("/api/v1/auth/me", headers=admin["headers"])).json()
    assert me["user"]["is_platform_admin"] is True

    body = await _gift(client, admin)
    assert body["gift"]["state"] == "pending" and body["gift"]["new_account"] is True
    message = body["body"]
    assert "sara@clinic.example" in message and body["link"] in message and "/gift/" in body["link"]
    assert "استبانتان" in message and "30 يومًا" in message and GIFT["note"] in message
    assert "كلمة المرور" in message and "Str0ng" not in message  # a link to choose one, never a password
    assert body["emailed"] is False and body["email_available"] is False  # no SMTP here: shared by hand
    token = _token(body["link"])
    async with get_sessionmaker()() as session:
        gift = await session.scalar(select(Gift))
        assert gift is not None and gift.token_hash and gift.token_hash != token  # only a hash is stored
        audits = await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "gift.create")
        )
        assert audits == 1

    # Nobody can sign in before activation: the account has no usable password.
    early = await client.post("/api/v1/auth/login", json={"email": GIFT["recipient_email"], "password": PASSWORD})
    assert early.status_code == 401

    preview = (await client.get(f"/api/v1/gifts/{token}")).json()
    assert (
        preview["state"] == "valid" and preview["organization_name"] == "عيادة الندى" and preview["survey_limit"] == 2
    )

    weak = await client.post("/api/v1/gifts/claim", json={"token": token, "password": "onlyletters"})
    assert weak.status_code == 422
    recipient = await _claim(client, body["link"])
    membership = recipient["membership"]
    plan = membership["subscription"]
    assert membership["organization_name"] == "عيادة الندى" and plan["limits"]["surveys"] == 2
    assert plan["plan_code"] == "trial" and plan["state"] == "TRIAL"
    trial_ends = datetime.fromisoformat(plan["period_ends_at"])
    assert timedelta(days=29) < trial_ends - datetime.now(UTC) <= timedelta(days=30)  # counted from activation

    # Single use.
    assert (await client.get(f"/api/v1/gifts/{token}")).json()["state"] == "used"
    again = await client.post("/api/v1/gifts/claim", json={"token": token, "password": PASSWORD})
    assert again.status_code == 422 and again.json()["error"]["code"] == "gift_invalid"
    login = await client.post("/api/v1/auth/login", json={"email": GIFT["recipient_email"], "password": PASSWORD})
    assert login.status_code == 200

    # Publishing is limited to the gifted surveys; drafts and new versions are free.
    h = recipient["headers"]
    project = (
        await client.post(
            "/api/v1/projects", headers=h, json={"title": "رضا المراجعين", "measurement_type": "SATISFACTION"}
        )
    ).json()
    surveys = [await _survey(client, h, project["id"]) for _ in range(3)]
    for survey in surveys[:2]:
        assert (await client.post(f"/api/v1/surveys/{survey['id']}/publish", headers=h)).status_code == 200
    third = await client.post(f"/api/v1/surveys/{surveys[2]['id']}/publish", headers=h)
    assert third.status_code == 409 and third.json()["error"]["code"] == "survey_limit_reached"
    detail = (await client.get(f"/api/v1/surveys/{surveys[0]['id']}", headers=h)).json()
    doc = {**detail["doc"], "title": "قيّم زيارتك — الإصدار الثاني"}
    assert (
        await client.put(f"/api/v1/surveys/{surveys[0]['id']}/draft", headers=h, json={"doc": doc})
    ).status_code == 200
    assert (await client.post(f"/api/v1/surveys/{surveys[0]['id']}/publish", headers=h)).status_code == 200
    # Deleting a published survey does not give the slot back.
    assert (await client.delete(f"/api/v1/surveys/{surveys[1]['id']}", headers=h)).status_code in (200, 409)
    still = await client.post(f"/api/v1/surveys/{surveys[2]['id']}/publish", headers=h)
    assert still.json()["error"]["code"] == "survey_limit_reached"

    listed = (await client.get("/api/v1/admin/gifts", headers=admin["headers"])).json()
    assert listed[0]["state"] == "active" and listed[0]["surveys_published"] == 2 and listed[0]["last_login_at"]


async def test_trial_end_blocks_new_publications(client, register) -> None:
    admin = await _admin(register)
    recipient = await _claim(client, (await _gift(client, admin, survey_limit=5))["link"])
    async with get_sessionmaker()() as session:
        await session.execute(
            update(Subscription)
            .where(Subscription.organization_id == recipient["membership"]["organization_id"])
            .values(period_ends_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()
    h = recipient["headers"]
    project = (
        await client.post("/api/v1/projects", headers=h, json={"title": "مشروع", "measurement_type": "SATISFACTION"})
    ).json()
    survey = await _survey(client, h, project["id"])
    res = await client.post(f"/api/v1/surveys/{survey['id']}/publish", headers=h)
    assert res.status_code == 409 and res.json()["error"]["code"] == "subscription_ended"


async def test_an_existing_account_gets_the_workspace_at_once(client, register) -> None:
    admin = await _admin(register)
    known = await register(email="known@example.org")
    body = await _gift(client, admin, recipient_email="Known@Example.org", organization_name="مساحة الهدية")
    assert body["gift"]["state"] == "active" and body["gift"]["new_account"] is False
    assert body["link"].endswith("/login") and "سجّل الدخول" in body["body"] and "/gift/" not in body["body"]
    assert "تبدأ من اليوم" in body["body"]  # an existing account's trial starts now
    me = (await client.get("/api/v1/auth/me", headers=known["headers"])).json()
    gifted = next(m for m in me["memberships"] if m["organization_name"] == "مساحة الهدية")
    assert gifted["role"] == "OWNER" and gifted["subscription"]["limits"]["surveys"] == 2
    assert gifted["subscription"]["period_ends_at"] and gifted["subscription"]["state"] == "TRIAL"


async def test_resend_replaces_the_link_and_revoke_removes_the_account(client, register) -> None:
    admin = await _admin(register)
    first = await _gift(client, admin, send_email=False)
    gift_id = first["gift"]["id"]
    second = (
        await client.post(f"/api/v1/admin/gifts/{gift_id}/resend", headers=admin["headers"], json={"send_email": False})
    ).json()
    assert second["link"] != first["link"]
    assert (await client.get(f"/api/v1/gifts/{_token(first['link'])}")).json()["state"] == "invalid"
    assert (await client.get(f"/api/v1/gifts/{_token(second['link'])}")).json()["state"] == "valid"

    revoked = await client.post(f"/api/v1/admin/gifts/{gift_id}/revoke", headers=admin["headers"])
    assert revoked.status_code == 200 and revoked.json()["state"] == "revoked"
    async with get_sessionmaker()() as session:
        assert await session.scalar(select(User).where(User.email == GIFT["recipient_email"])) is None
        assert await session.scalar(select(Organization).where(Organization.name == GIFT["organization_name"])) is None
    assert (await client.get(f"/api/v1/gifts/{_token(second['link'])}")).json()["state"] == "revoked"
    claim = await client.post("/api/v1/gifts/claim", json={"token": _token(second["link"]), "password": PASSWORD})
    assert claim.json()["error"]["code"] == "gift_invalid"

    # An activated gift cannot be revoked (it is a real workspace now).
    active = await _gift(client, admin, recipient_email="other@example.org", organization_name="مساحة أخرى")
    await _claim(client, active["link"])
    res = await client.post(f"/api/v1/admin/gifts/{active['gift']['id']}/revoke", headers=admin["headers"])
    assert res.status_code == 409 and res.json()["error"]["code"] == "gift_not_pending"


async def test_a_gifted_workspace_has_its_own_ai_budget(client, register) -> None:
    admin = await _admin(register)
    recipient = await _claim(client, (await _gift(client, admin))["link"])
    org_id = recipient["membership"]["organization_id"]
    usage = (await client.get("/api/v1/ai/usage", headers=recipient["headers"])).json()
    assert usage["daily_limit"] == 300_000  # the trial plan's budget, not the platform default
    async with get_sessionmaker()() as session:
        session.add(
            AIRun(
                organization_id=org_id,
                agent="measurement_architect",
                provider="p",
                model="m",
                input_hash="h",
                status="SUCCESS",
                prompt_tokens=200_000,
                completion_tokens=100_001,
                total_tokens=300_001,
            )
        )
        await session.commit()
    res = await client.post(
        "/api/v1/ai/measurement-architect",
        headers=recipient["headers"],
        json={"request": "أريد قياس رضا المراجعين في العيادة."},
    )
    assert res.json()["error"]["code"] == "ai_budget_exceeded"
