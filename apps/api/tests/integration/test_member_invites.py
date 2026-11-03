"""Workspace invitations and password recovery (SUBSCRIPTIONS.md §4): a workspace's administrators
add people — new accounts get a one-time activation link — and may prepare a recovery link only for
accounts that belong to their workspace alone. Signed-in people change their own password."""

from __future__ import annotations

from typing import Any

from helpers import add_member

PASSWORD = "Str0ng-Passw0rd!"
CSRF = {"X-Requested-With": "meqyas"}


def _token(link: str) -> str:
    return link.rsplit("/activate/", 1)[1]


async def _invite(client: Any, owner: dict[str, Any], email: str, role: str = "EDITOR", **extra: Any) -> Any:
    return await client.post(
        f"/api/v1/organizations/{owner['org_id']}/members",
        headers=owner["headers"],
        json={"email": email, "role": role, "send_email": False, **extra},
    )


async def test_inviting_a_new_person_creates_an_account_to_activate(client, register) -> None:
    owner = await register()
    res = await _invite(client, owner, "teacher@school.example", full_name="أمل الحربي")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["member"]["pending"] is True and body["member"]["links_allowed"] is True
    message = body["message"]
    assert message["kind"] == "activation" and "أضافك مالك الاختبار إلى «مدرسة الاختبار»" in message["body"]

    preview = (await client.get(f"/api/v1/auth/activation/{_token(message['link'])}")).json()
    assert preview["full_name"] == "أمل الحربي" and preview["organization_name"] == "مدرسة الاختبار"
    weak = await client.post(
        "/api/v1/auth/activate", json={"token": _token(message["link"]), "password": "onlyletters"}
    )
    assert weak.status_code == 422 and weak.json()["error"]["code"] == "weak_password"
    signed_in = await client.post(
        "/api/v1/auth/activate", json={"token": _token(message["link"]), "password": PASSWORD}
    )
    assert signed_in.status_code == 200
    membership = signed_in.json()["memberships"][0]
    assert membership["organization_id"] == owner["org_id"] and membership["role"] == "EDITOR"

    members = (await client.get(f"/api/v1/organizations/{owner['org_id']}/members", headers=owner["headers"])).json()
    teacher = next(m for m in members if m["email"] == "teacher@school.example")
    assert teacher["pending"] is False and teacher["last_login_at"]


async def test_an_existing_account_is_added_with_a_sign_in_message(client, register) -> None:
    owner = await register()
    await register(email="known@school.example", org="مساحة أخرى")
    res = await _invite(client, owner, "known@school.example", role="VIEWER")
    body = res.json()
    assert body["message"]["kind"] == "sign_in" and body["message"]["link"].endswith("/login")
    # The account also belongs to another workspace: links are for the platform administrators.
    assert body["member"]["links_allowed"] is False
    link = await client.post(
        f"/api/v1/organizations/{owner['org_id']}/members/{body['member']['id']}/access-link",
        headers=owner["headers"],
        json={},
    )
    assert link.status_code == 409 and link.json()["error"]["code"] == "member_in_other_workspaces"


async def test_recovery_links_for_the_workspace_members(client, register) -> None:
    owner = await register()
    invited = (await _invite(client, owner, "member@school.example")).json()
    member_id = invited["member"]["id"]
    base = f"/api/v1/organizations/{owner['org_id']}/members"

    # Never activated: a new activation link (the first one stops working).
    again = (await client.post(f"{base}/{member_id}/access-link", headers=owner["headers"], json={})).json()
    assert again["kind"] == "activation"
    stale = await client.post(
        "/api/v1/auth/activate", json={"token": _token(invited["message"]["link"]), "password": PASSWORD}
    )
    assert stale.status_code == 422
    activated = await client.post("/api/v1/auth/activate", json={"token": _token(again["link"]), "password": PASSWORD})
    assert activated.status_code == 200

    # Forgot the password: a recovery link.
    recovery = (await client.post(f"{base}/{member_id}/access-link", headers=owner["headers"], json={})).json()
    assert recovery["kind"] == "reset" and "صالح لمرة واحدة" in recovery["body"]
    token = recovery["link"].split("token=", 1)[1]
    assert (
        await client.post("/api/v1/auth/reset-password", json={"token": token, "password": "N3w-Str0ng-Pass!"})
    ).status_code == 200

    # Not for oneself, not by a viewer, and an admin cannot touch an owner.
    own = next(m for m in (await client.get(base, headers=owner["headers"])).json() if m["user_id"] == owner["user_id"])
    me = await client.post(f"{base}/{own['id']}/access-link", headers=owner["headers"], json={})
    assert me.status_code == 409 and me.json()["error"]["code"] == "cannot_link_self"
    admin = await add_member(client, owner, "admin@school.example", "ADMIN", register)
    on_owner = await client.post(f"{base}/{own['id']}/access-link", headers=admin["headers_in_owner_org"], json={})
    assert on_owner.status_code == 403


async def test_change_password_keeps_this_session_and_ends_the_others(client, register) -> None:
    user = await register(email="change@school.example")
    other = await client.post("/api/v1/auth/login", json={"email": "change@school.example", "password": PASSWORD})
    other_cookie = other.cookies["meqyas_rt"]
    auth = {"Authorization": user["headers"]["Authorization"]}

    wrong = await client.post(
        "/api/v1/auth/change-password",
        headers=auth,
        json={"current_password": "nope", "new_password": "N3w-Str0ng-Pass!"},
    )
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "invalid_current_password"
    ok = await client.post(
        "/api/v1/auth/change-password",
        headers=auth,
        json={"current_password": PASSWORD, "new_password": "N3w-Str0ng-Pass!"},
    )
    assert ok.status_code == 200

    client.cookies.set("meqyas_rt", other_cookie, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", headers=CSRF)).status_code == 401  # the other session ended
    client.cookies.set("meqyas_rt", user["cookies"]["meqyas_rt"], path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", headers=CSRF)).status_code == 200  # this one stays
    old = await client.post("/api/v1/auth/login", json={"email": "change@school.example", "password": PASSWORD})
    assert old.status_code == 401
