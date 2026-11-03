"""Platform administration (SUBSCRIPTIONS.md §5): subscribers, plans and accounts."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.session import get_sessionmaker
from app.models import Subscription, User
from sqlalchemy import select, update

PASSWORD = "Str0ng-Passw0rd!"
NEW: dict[str, Any] = {
    "owner_name": "نورة العتيبي",
    "owner_email": "noura@school.example",
    "organization_name": "مدرسة الريادة",
    "sector": "EDUCATION",
    "plan_code": "basic",
    "days": 365,
    "admin_note": "عقد 2026-14",
    "send_email": False,
}


async def _admin(register: Any, email: str = "admin@meqyas.example") -> dict[str, Any]:
    admin = await register(email=email, org="إدارة المنصة")
    async with get_sessionmaker()() as session:
        await session.execute(update(User).where(User.email == email).values(is_superuser=True))
        await session.commit()
    return admin


def _token(link: str) -> str:
    return link.rsplit("/activate/", 1)[1]


async def _create(client: Any, admin: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    res = await client.post("/api/v1/admin/subscribers", headers=admin["headers"], json={**NEW, **overrides})
    assert res.status_code == 201, res.text
    return res.json()


async def _activate(client: Any, link: str, password: str = PASSWORD) -> dict[str, Any]:
    res = await client.post("/api/v1/auth/activate", json={"token": _token(link), "password": password})
    assert res.status_code == 200, res.text
    return res.json()


async def test_only_platform_admins(client, register) -> None:
    user = await register()
    h = user["headers"]
    for method, path in (
        ("get", "/api/v1/admin/subscribers"),
        ("get", "/api/v1/admin/plans"),
        ("post", f"/api/v1/admin/subscribers/{user['org_id']}/suspend"),
        ("post", f"/api/v1/admin/users/{user['user_id']}/access-link"),
    ):
        res = await getattr(client, method)(path, headers=h, **({"json": {}} if method == "post" else {}))
        assert res.status_code == 403 and res.json()["error"]["code"] == "platform_admin_only", path


async def test_a_new_subscriber_activates_and_the_period_starts_then(client, register) -> None:
    admin = await _admin(register)
    body = await _create(client, admin)
    message, item = body["message"], body["subscriber"]
    assert message["kind"] == "activation" and "/activate/" in message["link"]
    assert "الباقة: أساسية" in message["body"] and "تبدأ من تفعيل الحساب" in message["body"]
    assert "حتى 1,000 رد كل شهر" in message["body"] and PASSWORD not in message["body"]
    assert item["subscription"]["state"] == "PENDING" and item["subscription"]["pending_days"] == 365
    assert item["owner"]["pending"] is True

    preview = (await client.get(f"/api/v1/auth/activation/{_token(message['link'])}")).json()
    assert preview["state"] == "valid" and preview["organization_name"] == "مدرسة الريادة"
    assert (
        await client.post("/api/v1/auth/login", json={"email": NEW["owner_email"], "password": PASSWORD})
    ).status_code == 401

    session_body = await _activate(client, message["link"])
    sub = session_body["memberships"][0]["subscription"]
    assert sub["state"] == "ACTIVE" and sub["plan_code"] == "basic"
    ends = datetime.fromisoformat(sub["period_ends_at"])
    assert timedelta(days=364) < ends - datetime.now(UTC) <= timedelta(days=365)
    # Single use.
    assert (await client.get(f"/api/v1/auth/activation/{_token(message['link'])}")).json()["state"] == "used"
    again = await client.post("/api/v1/auth/activate", json={"token": _token(message["link"]), "password": PASSWORD})
    assert again.status_code == 422 and again.json()["error"]["code"] == "activation_invalid"


async def test_an_existing_account_gets_the_workspace_at_once(client, register) -> None:
    admin = await _admin(register)
    known = await register(email="known@school.example", org="مساحتي")
    body = await _create(client, admin, owner_email="Known@School.example", organization_name="الفرع الثاني")
    assert body["message"]["kind"] == "sign_in" and body["message"]["link"].endswith("/login")
    assert body["subscriber"]["subscription"]["state"] == "ACTIVE"
    me = (await client.get("/api/v1/auth/me", headers={"Authorization": known["headers"]["Authorization"]})).json()
    assert {m["organization_name"] for m in me["memberships"]} == {"مساحتي", "الفرع الثاني"}


async def test_bulk_creation_reports_every_row(client, register) -> None:
    admin = await _admin(register)
    await register(email="exists@school.example", org="موجودة")
    res = await client.post(
        "/api/v1/admin/subscribers/bulk",
        headers=admin["headers"],
        json={
            "plan_code": "trial",
            "days": 14,
            "send_email": False,
            "rows": [
                {"name": "مدرسة أ", "email": "a@schools.example", "organization_name": "مدرسة أ"},
                {"name": "بلا بريد", "email": "not-an-email"},
                {"name": "مكرر", "email": "A@schools.example"},
                {"name": "", "email": "exists@school.example"},
            ],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert [r["status"] for r in body["results"]] == ["created", "error", "error", "added"]
    assert [r["error_code"] for r in body["results"]] == [None, "invalid_email", "duplicate_row", None]
    assert body["created"] == 1 and body["added"] == 1 and body["failed"] == 2
    assert body["results"][0]["message"]["kind"] == "activation"

    page = (await client.get("/api/v1/admin/subscribers?state=PENDING", headers=admin["headers"])).json()
    assert [i["organization_name"] for i in page["items"]] == ["مدرسة أ"]
    assert page["stats"]["by_state"]["PENDING"] == 1


async def test_list_search_and_detail(client, register) -> None:
    admin = await _admin(register)
    await _create(client, admin)
    page = (await client.get("/api/v1/admin/subscribers?q=NOURA", headers=admin["headers"])).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["owner"]["email"] == NEW["owner_email"] and item["subscription"]["limits"]["members"] == 3
    detail = (await client.get(f"/api/v1/admin/subscribers/{item['organization_id']}", headers=admin["headers"])).json()
    assert detail["admin_note"] == "عقد 2026-14" and detail["members"][0]["role"] == "OWNER"
    assert detail["events"][0]["action"] == "subscriber.create" and detail["events"][0]["actor_name"]


async def test_plan_change_renewal_suspension(client, register) -> None:
    admin = await _admin(register)
    owner = await register(email="owner2@school.example", org="مدرسة النخبة", plan="trial")
    org_id, h = owner["org_id"], admin["headers"]
    base = f"/api/v1/admin/subscribers/{org_id}"

    changed = (await client.patch(base, headers=h, json={"plan_code": "pro", "overrides": {"members": 25}})).json()
    assert changed["subscription"]["plan_code"] == "pro" and changed["subscription"]["limits"]["members"] == 25
    assert changed["overrides"] == {"members": 25}
    plain = (await client.patch(base, headers=h, json={"plan_code": "basic"})).json()
    assert plain["overrides"] == {}  # the previous plan's own limits do not carry over
    archived_end = (await client.patch(base, headers=h, json={"period_ends_at": None})).json()
    assert archived_end["subscription"]["period_ends_at"] is None

    async with get_sessionmaker()() as session:
        await session.execute(
            update(Subscription)
            .where(Subscription.organization_id == org_id)
            .values(surveys_used=4, period_ends_at=datetime.now(UTC) + timedelta(days=10))
        )
        await session.commit()
    renewed = (await client.post(f"{base}/renew", headers=h, json={"days": 30})).json()
    left = datetime.fromisoformat(renewed["subscription"]["period_ends_at"]) - datetime.now(UTC)
    assert timedelta(days=39) < left <= timedelta(days=40)  # added to what was left
    assert renewed["subscription"]["usage"]["surveys"] == 0

    suspended = (await client.post(f"{base}/suspend", headers=h, json={"reason": "عدم السداد"})).json()
    assert suspended["subscription"]["state"] == "SUSPENDED" and suspended["suspension_reason"] == "عدم السداد"
    assert (await client.get("/api/v1/projects", headers=owner["headers"])).status_code == 403
    back = (await client.post(f"{base}/reactivate", headers=h)).json()
    assert back["subscription"]["state"] == "ACTIVE"
    assert (await client.get("/api/v1/projects", headers=owner["headers"])).status_code == 200

    actions = [e["action"] for e in back["events"]]
    assert {"subscription.update", "subscription.renew", "subscription.suspend", "subscription.reactivate"} <= set(
        actions
    )


async def test_admin_adds_members_and_prepares_links(client, register) -> None:
    admin = await _admin(register)
    owner = await register(email="owner3@school.example", org="مدرسة الأمل", plan="trial")
    res = await client.post(
        f"/api/v1/admin/subscribers/{owner['org_id']}/members",
        headers=admin["headers"],
        json={
            "send_email": False,
            "members": [
                {"name": "معلمة أولى", "email": "t1@school.example", "role": "EDITOR"},
                {"name": "معلمة ثانية", "email": "t2@school.example", "role": "VIEWER"},
                {"name": "معلمة ثالثة", "email": "t3@school.example", "role": "VIEWER"},
            ],
        },
    )
    body = res.json()
    # The trial plan includes 3 members: the owner and two more.
    assert [r["status"] for r in body["results"]] == ["created", "created", "error"]
    assert body["results"][2]["error_code"] == "member_limit_reached"
    invite = body["results"][0]["message"]
    assert invite["kind"] == "activation" and "بدور «محرر»" in invite["body"]

    detail = (await client.get(f"/api/v1/admin/subscribers/{owner['org_id']}", headers=admin["headers"])).json()
    teacher = next(m for m in detail["members"] if m["email"] == "t1@school.example")
    assert teacher["pending"] is True

    # A pending account gets a new activation link; the earlier one stops working.
    link = (
        await client.post(f"/api/v1/admin/users/{teacher['user_id']}/access-link", headers=admin["headers"], json={})
    ).json()
    assert link["kind"] == "activation"
    assert (await client.get(f"/api/v1/auth/activation/{_token(invite['link'])}")).json()["state"] == "used"
    await _activate(client, link["link"])

    # An active account gets a recovery link (24 hours) that sets a new password.
    recovery = (
        await client.post(f"/api/v1/admin/users/{teacher['user_id']}/access-link", headers=admin["headers"], json={})
    ).json()
    assert recovery["kind"] == "reset" and "/reset-password?token=" in recovery["link"]
    token = recovery["link"].split("token=", 1)[1]
    done = await client.post("/api/v1/auth/reset-password", json={"token": token, "password": "N3w-Str0ng-Pass!"})
    assert done.status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": "t1@school.example", "password": "N3w-Str0ng-Pass!"})
    assert login.status_code == 200

    # Disabled accounts cannot sign in; administrators cannot disable themselves.
    off = await client.post(f"/api/v1/admin/users/{teacher['user_id']}/disable", headers=admin["headers"])
    assert off.status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": "t1@school.example", "password": "N3w-Str0ng-Pass!"})
    assert login.status_code == 401
    self_off = await client.post(f"/api/v1/admin/users/{admin['user_id']}/disable", headers=admin["headers"])
    assert self_off.status_code == 409 and self_off.json()["error"]["code"] == "cannot_disable_self"


async def test_plans_are_edited_and_archived(client, register) -> None:
    admin = await _admin(register)
    h = admin["headers"]
    plans = (await client.get("/api/v1/admin/plans", headers=h)).json()
    assert [p["code"] for p in plans] == ["trial", "basic", "pro", "enterprise"]
    assert next(p for p in plans if p["code"] == "enterprise")["subscribers"] == 1  # the admin's own workspace

    created = await client.post(
        "/api/v1/admin/plans",
        headers=h,
        json={
            "code": "schools",
            "name_ar": "المدارس",
            "name_en": "Schools",
            "max_surveys": 20,
            "max_members": 15,
            "default_days": 365,
            "features": ["exports", "ai_analysis"],
        },
    )
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["features"] == ["ai_analysis", "exports"] and plan["subscribers"] == 0
    dup = await client.post("/api/v1/admin/plans", headers=h, json={"code": "schools", "name_ar": "x", "name_en": "x"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "plan_code_taken"

    edited = (
        await client.patch(
            f"/api/v1/admin/plans/{plan['id']}", headers=h, json={"max_surveys": None, "is_archived": True}
        )
    ).json()
    assert edited["max_surveys"] is None and edited["is_archived"] is True
    refused = await client.post("/api/v1/admin/subscribers", headers=h, json={**NEW, "plan_code": "schools"})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "plan_archived"
    async with get_sessionmaker()() as session:
        assert await session.scalar(select(User).where(User.email == NEW["owner_email"])) is None  # nothing created
