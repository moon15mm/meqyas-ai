"""Store connections end to end: signed webhooks → invitations → answers → analytics."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

from app.db.session import get_sessionmaker
from app.models import Response, StoreEvent, SurveyInvitation
from app.services.stores import send_due_invitations
from helpers import add_member
from sqlalchemy import select

WOO_SECRET = "woo-secret-for-tests"


def _woo_headers(body: bytes, secret: str = WOO_SECRET) -> dict[str, str]:
    sig = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    return {"X-WC-Webhook-Signature": sig, "X-WC-Webhook-Topic": "order.updated", "Content-Type": "application/json"}


def _woo_order(order_id: int, status: str, *, customer: int = 7, items: list[dict[str, Any]] | None = None) -> bytes:
    return json.dumps(
        {
            "id": order_id,
            "status": status,
            "customer_id": customer,
            "billing": {"email": f"customer{customer}@example.com"},
            "line_items": items
            if items is not None
            else [
                {"product_id": 93, "name": "سماعة لاسلكية", "sku": "HP-1", "quantity": 1},
                {"product_id": 93, "name": "سماعة لاسلكية (أسود)", "sku": "HP-1-B", "quantity": 1},
                {"product_id": 94, "name": "حافظة جلدية", "sku": "CS-2", "quantity": 2},
            ],
        }
    ).encode()


async def _store_project(client, owner) -> dict[str, Any]:
    h = owner["headers"]
    project = (
        await client.post(
            "/api/v1/projects",
            headers=h,
            json={"title": "رضا عملاء المتجر", "measurement_type": "SATISFACTION"},
        )
    ).json()
    surveys = {}
    for template in ("store_experience", "product_feedback"):
        res = await client.post(
            f"/api/v1/projects/{project['id']}/surveys/from-template", headers=h, json={"template": template}
        )
        assert res.status_code == 201, res.text
        survey = res.json()["survey"]
        published = await client.post(f"/api/v1/surveys/{survey['id']}/publish", headers=h)
        assert published.status_code == 200, published.text
        surveys[template] = published.json()["survey"]
    return {"id": project["id"], "surveys": surveys}


async def _connect(client, owner, project, **overrides: Any) -> dict[str, Any]:
    body = {
        "platform": "WOOCOMMERCE",
        "name": "متجر النور",
        "store_survey_id": project["surveys"]["store_experience"]["id"],
        "product_survey_id": project["surveys"]["product_feedback"]["id"],
        "secret": WOO_SECRET,
        **overrides,
    }
    res = await client.post(f"/api/v1/projects/{project['id']}/store-connections", headers=owner["headers"], json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _hook_path(conn: dict[str, Any]) -> str:
    return "/api/v1/" + conn["webhook_url"].split("/api/v1/", 1)[1]


async def _answer(client, url: str, answers: dict[str, Any]):  # type: ignore[no-untyped-def]
    public_id, token = url.split("/s/", 1)[1].split("?inv=")
    opened = (await client.get(f"/api/v1/public/surveys/{public_id}?inv={token}")).json()
    res = await client.post(
        f"/api/v1/public/surveys/{public_id}/responses",
        json={"session": opened["session"], "answers": answers, "invitation": token},
    )
    return opened, res


PRODUCT_ANSWERS = {"product_csat": 5, "as_described": 4, "value_for_money": 4, "product_nps": 9}


async def test_webhook_to_invitations_to_answers(client, register) -> None:
    owner = await register()
    project = await _store_project(client, owner)
    conn = await _connect(client, owner, project)
    assert conn["secret"] == WOO_SECRET and conn["secret_hint"] == WOO_SECRET[-4:]
    hook = _hook_path(conn)

    # Unsigned or wrongly signed deliveries are rejected and counted.
    bad = await client.post(hook, content=_woo_order(1, "completed"), headers=_woo_headers(b"x"))
    assert bad.status_code == 401
    assert (await client.post(hook, content=b"webhook_id=5")).json()["status"] == "ping"

    early = _woo_order(1, "processing")
    assert (await client.post(hook, content=early, headers=_woo_headers(early))).json()["reason"] == "before_trigger"

    done = _woo_order(1, "completed")
    res = await client.post(hook, content=done, headers=_woo_headers(done))
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["status"] == "accepted" and result["reason"] == "links_ready"
    links = result["invitations"]
    # One store-experience invitation + one per distinct product (the colour variant shares one).
    assert sorted(i["product"] or "" for i in links) == ["", "حافظة جلدية", "سماعة لاسلكية"]
    again = await client.post(hook, content=done, headers=_woo_headers(done))
    assert again.json()["status"] == "duplicate"

    product_url = next(i["url"] for i in links if i["product"] == "سماعة لاسلكية")
    opened, submitted = await _answer(client, product_url, PRODUCT_ANSWERS)
    assert opened["invitation"] == {"state": "valid", "store": "متجر النور", "product": "سماعة لاسلكية"}
    first_question = opened["doc"]["sections"][0]["questions"][0]["text"]
    assert first_question == "ما مدى رضاك عن سماعة لاسلكية؟"  # piped from the order
    assert submitted.status_code == 201, submitted.text

    async with get_sessionmaker()() as session:
        response = await session.get(Response, submitted.json()["response_id"])
        assert response is not None and response.channel.value == "STORE"
        assert response.meta["store"]["product_name"] == "سماعة لاسلكية"
        inv = await session.get(SurveyInvitation, response.invitation_id)
        assert inv is not None and inv.status.value == "RESPONDED" and inv.email_encrypted is None

    # Single use: a new session with the same link is refused, and the link no longer opens the form.
    public_id, token = product_url.split("/s/", 1)[1].split("?inv=")
    fresh = (await client.get(f"/api/v1/public/surveys/{public_id}")).json()
    twice = await client.post(
        f"/api/v1/public/surveys/{public_id}/responses",
        json={"session": fresh["session"], "answers": PRODUCT_ANSWERS, "invitation": token},
    )
    assert twice.status_code == 409 and twice.json()["error"]["code"] == "invitation_used"
    used = (await client.get(f"/api/v1/public/surveys/{public_id}?inv={token}")).json()
    assert used["invitation"] == {"state": "used"} and used["doc"] is None
    unknown = (await client.get(f"/api/v1/public/surveys/{public_id}?inv=not-a-real-token")).json()
    assert unknown["invitation"] == {"state": "invalid"} and unknown["doc"] is None
    # Without an invitation the placeholders read generically.
    plain = (await client.get(f"/api/v1/public/surveys/{public_id}")).json()
    assert plain["doc"]["sections"][0]["questions"][0]["text"] == "ما مدى رضاك عن المنتج؟"

    # Cancelling the order closes its remaining open invitations.
    cancel = _woo_order(1, "cancelled")
    assert (await client.post(hook, content=cancel, headers=_woo_headers(cancel))).json()["reason"] == "order_cancelled"
    store_url = next(i["url"] for i in links if not i["product"])
    sid, stoken = store_url.split("/s/", 1)[1].split("?inv=")
    assert (await client.get(f"/api/v1/public/surveys/{sid}?inv={stoken}")).json()["invitation"]["state"] == "closed"

    detail = (await client.get(f"/api/v1/store-connections/{conn['id']}", headers=owner["headers"])).json()
    assert detail["events_rejected"] == 1 and detail["stats"]["responded"] == 1
    # Cancelled invitations leave the denominator: 1 answered of 1 that stayed open.
    assert detail["stats"]["invitations"] == 3 and detail["stats"]["response_rate"] == 100.0
    events = (await client.get(f"/api/v1/store-connections/{conn['id']}/events", headers=owner["headers"])).json()
    assert [e["status"] for e in events][-1] == "REJECTED"

    # Product-level analysis: the answer is attributed to its product (masked below k=5).
    analytics = f"/api/v1/projects/{project['id']}/analytics"
    page = (await client.get(f"{analytics}/questions?segment=product", headers=owner["headers"])).json()
    csat = next(q for q in page["questions"] if q["key"] == "product_csat")
    assert [s["label"] for s in csat["segments"]] == ["سماعة لاسلكية"] and csat["segments"][0]["masked"] is True
    summary = (await client.get(f"{analytics}/summary", headers=owner["headers"])).json()
    assert summary["channels"] == {"STORE": 1} and summary["products"] == 1


async def test_fatigue_opt_out_and_test_orders(client, register) -> None:
    owner = await register()
    project = await _store_project(client, owner)
    conn = await _connect(client, owner, project, product_survey_id=None)
    hook = _hook_path(conn)

    first = _woo_order(10, "completed", customer=42)
    links = (await client.post(hook, content=first, headers=_woo_headers(first))).json()["invitations"]
    assert len(links) == 1 and links[0]["product"] is None
    # The same customer ordering again within 30 days is not asked again.
    second = _woo_order(11, "completed", customer=42)
    assert (await client.post(hook, content=second, headers=_woo_headers(second))).json()[
        "reason"
    ] == "recently_invited"

    # Opting out stops this customer's requests for good.
    sid, token = links[0]["url"].split("/s/", 1)[1].split("?inv=")
    assert (await client.post(f"/api/v1/public/surveys/{sid}/invitations/{token}/opt-out")).status_code == 200
    await client.patch(
        f"/api/v1/store-connections/{conn['id']}", headers=owner["headers"], json={"min_days_between": 0}
    )
    third = _woo_order(12, "completed", customer=42)
    assert (await client.post(hook, content=third, headers=_woo_headers(third))).json()["reason"] == "opted_out"

    # A test order goes through the same pipeline but never reaches analytics.
    test = (await client.post(f"/api/v1/store-connections/{conn['id']}/test", headers=owner["headers"])).json()
    assert test["status"] == "accepted" and len(test["invitations"]) == 1
    answers = {"store_csat": 4, "delivery_on_time": 5, "packaging": 4, "ordering_ease": 6, "store_nps": 10}
    _, res = await _answer(client, test["invitations"][0]["url"], answers)
    assert res.status_code == 201, res.text
    summary = (await client.get(f"/api/v1/projects/{project['id']}/analytics/summary", headers=owner["headers"])).json()
    assert summary["counts"]["total"] == 0

    paused = await client.patch(
        f"/api/v1/store-connections/{conn['id']}", headers=owner["headers"], json={"status": "PAUSED"}
    )
    assert paused.json()["status"] == "PAUSED"
    fourth = _woo_order(13, "completed", customer=99)
    assert (await client.post(hook, content=fourth, headers=_woo_headers(fourth))).json()["status"] == "paused"


async def test_email_delivery_is_scheduled_then_the_address_is_erased(client, register) -> None:
    owner = await register()
    project = await _store_project(client, owner)
    conn = await _connect(client, owner, project, delivery="EMAIL", delay_days=0, store_survey_id=None)
    hook = _hook_path(conn)
    body = _woo_order(20, "completed", customer=5, items=[{"product_id": 1, "name": "قهوة", "quantity": 1}])
    result = (await client.post(hook, content=body, headers=_woo_headers(body))).json()
    assert result["reason"] == "scheduled_email"
    async with get_sessionmaker()() as session:
        inv = await session.scalar(select(SurveyInvitation).where(SurveyInvitation.connection_id == conn["id"]))
        assert inv is not None and inv.status.value == "SCHEDULED" and inv.email_encrypted
        assert "customer5@example.com" not in inv.email_encrypted  # encrypted at rest
        sent = await send_due_invitations(session)
        assert sent == 1
        await session.refresh(inv)
        assert inv.status.value == "SENT" and inv.email_encrypted is None and inv.sent_at is not None
        logged = (await session.scalars(select(StoreEvent).where(StoreEvent.connection_id == conn["id"]))).all()
        assert all("example.com" not in (e.reason + e.event) for e in logged)


async def test_permissions_and_isolation(client, register) -> None:
    owner = await register()
    project = await _store_project(client, owner)
    conn = await _connect(client, owner, project)
    editor = await add_member(client, owner, "editor@shop.example", "EDITOR", register)
    viewer = await add_member(client, owner, "viewer@shop.example", "VIEWER", register)

    as_editor = await client.post(
        f"/api/v1/projects/{project['id']}/store-connections",
        headers=editor["headers_in_owner_org"],
        json={"platform": "SHOPIFY", "name": "x", "store_survey_id": project["surveys"]["store_experience"]["id"]},
    )
    assert as_editor.status_code == 403  # integrations hold secrets: admins/owners only
    listed = await client.get(
        f"/api/v1/projects/{project['id']}/store-connections", headers=viewer["headers_in_owner_org"]
    )
    assert listed.status_code == 200 and "secret" not in listed.json()[0]
    links = await client.get(
        f"/api/v1/store-connections/{conn['id']}/invitations", headers=viewer["headers_in_owner_org"]
    )
    assert links.status_code == 403  # invitation links are capability URLs

    stranger = await register(email="stranger@other.example", org="متجر آخر")
    assert (await client.get(f"/api/v1/store-connections/{conn['id']}", headers=stranger["headers"])).status_code == 404

    same = await client.post(
        f"/api/v1/projects/{project['id']}/store-connections",
        headers=owner["headers"],
        json={
            "platform": "SALLA",
            "name": "x",
            "store_survey_id": project["surveys"]["store_experience"]["id"],
            "product_survey_id": project["surveys"]["store_experience"]["id"],
        },
    )
    assert same.status_code == 422 and same.json()["error"]["code"] == "same_survey"

    rotated = (
        await client.post(f"/api/v1/store-connections/{conn['id']}/secret", headers=owner["headers"], json={})
    ).json()
    assert rotated["secret"] and rotated["secret"] != WOO_SECRET
    old = _woo_order(30, "completed")
    assert (await client.post(_hook_path(conn), content=old, headers=_woo_headers(old))).status_code == 401
    assert (await client.delete(f"/api/v1/store-connections/{conn['id']}", headers=owner["headers"])).status_code == 200
    assert (await client.post(_hook_path(conn), content=old, headers=_woo_headers(old))).status_code == 404
