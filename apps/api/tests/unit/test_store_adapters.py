"""Store platform adapters: signature schemes and order normalization per platform."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest
from app.domain.enums import StorePlatform
from app.domain.stores import (
    OrderItem,
    OrderStage,
    PayloadError,
    parse,
    sign_custom,
    unique_items,
    verify,
)
from app.domain.survey.templates import TEMPLATES, fill_document, fill_placeholders

SECRET = "s3cret-for-tests"


def _b64(body: bytes) -> str:
    return base64.b64encode(hmac.new(SECRET.encode(), body, hashlib.sha256).digest()).decode()


def _hex(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


# ------------------------------------------------------------------ verify
def test_shopify_and_woocommerce_use_base64_hmac_of_the_raw_body() -> None:
    body = b'{"id": 1}'
    assert verify(StorePlatform.SHOPIFY, {"X-Shopify-Hmac-Sha256": _b64(body)}, body, SECRET)
    assert not verify(StorePlatform.SHOPIFY, {"X-Shopify-Hmac-Sha256": _b64(body)}, body + b" ", SECRET)
    assert verify(StorePlatform.WOOCOMMERCE, {"x-wc-webhook-signature": _b64(body)}, body, SECRET)
    assert not verify(StorePlatform.WOOCOMMERCE, {}, body, SECRET)


def test_salla_signature_and_token_strategies() -> None:
    body = b'{"event": "order.status.updated"}'
    assert verify(
        StorePlatform.SALLA, {"X-Salla-Security-Strategy": "Signature", "X-Salla-Signature": _hex(body)}, body, SECRET
    )
    assert verify(StorePlatform.SALLA, {"X-Salla-Signature": _hex(body).upper()}, body, SECRET)  # default strategy
    assert not verify(StorePlatform.SALLA, {"X-Salla-Signature": _hex(b"other")}, body, SECRET)
    token = {"X-Salla-Security-Strategy": "Token", "Authorization": f"Bearer {SECRET}"}
    assert verify(StorePlatform.SALLA, token, body, SECRET)
    assert not verify(StorePlatform.SALLA, {**token, "Authorization": "Bearer nope"}, body, SECRET)


def test_zid_basic_auth_needs_the_fixed_username_and_the_secret() -> None:
    good = "Basic " + base64.b64encode(f"meqyas:{SECRET}".encode()).decode()
    wrong_user = "Basic " + base64.b64encode(f"admin:{SECRET}".encode()).decode()
    assert verify(StorePlatform.ZID, {"Authorization": good}, b"{}", SECRET)
    assert not verify(StorePlatform.ZID, {"Authorization": wrong_user}, b"{}", SECRET)
    assert not verify(StorePlatform.ZID, {"Authorization": "Basic !!!"}, b"{}", SECRET)
    assert not verify(StorePlatform.ZID, {}, b"{}", SECRET)


def test_custom_signature_has_a_replay_window() -> None:
    body = b'{"order": {"id": "1"}}'
    header = sign_custom(SECRET, body, timestamp=1_000_000)
    assert verify(StorePlatform.CUSTOM, {"X-Meqyas-Signature": header}, body, SECRET, now=1_000_100)
    assert not verify(StorePlatform.CUSTOM, {"X-Meqyas-Signature": header}, body, SECRET, now=1_000_000 + 301)
    assert not verify(StorePlatform.CUSTOM, {"X-Meqyas-Signature": header}, b"{}", SECRET, now=1_000_100)
    assert not verify(StorePlatform.CUSTOM, {"X-Meqyas-Signature": "garbage"}, body, SECRET)


def test_an_empty_secret_never_verifies() -> None:
    assert not verify(StorePlatform.SHOPIFY, {"X-Shopify-Hmac-Sha256": ""}, b"", "")


# ------------------------------------------------------------------- parse
def test_salla_order_status_with_nested_order() -> None:
    body = json.dumps(
        {
            "event": "order.status.updated",
            "merchant": 123,
            "data": {
                "id": 9001,
                "order": {
                    "id": 9001,
                    "reference_id": 77,
                    "status": {"id": 1, "name": "تم التوصيل", "slug": "delivered"},
                    "customer": {"id": 55, "email": "c@example.com"},
                    "items": [
                        {"name": "عطر", "sku": "P-1", "quantity": 2, "product_id": 11},
                        {"name": "عطر", "sku": "P-1b", "quantity": 1, "product_id": 11},
                    ],
                },
            },
        }
    ).encode()
    event = parse(StorePlatform.SALLA, {}, body)
    assert event.order_id == "9001" and event.stage == OrderStage.DELIVERED
    assert event.customer_id == "55" and event.email == "c@example.com"
    assert [i.key for i in unique_items(event.items, 5)] == ["11"]  # variants share one product invitation


def test_salla_unwrapped_payload_and_completed_parent_status() -> None:
    body = json.dumps({"event": "order.status.updated", "data": {"id": 5, "status": {"slug": "completed"}}}).encode()
    assert parse(StorePlatform.SALLA, {}, body).stage == OrderStage.FULFILLED


def test_zid_order_schema() -> None:
    body = json.dumps(
        {
            "id": 321,
            "code": "YMK3VPgkhy",
            "order_status": {"name": "تم التوصيل", "code": "delivered"},
            "customer": {"id": 8, "email": "z@example.com"},
            "products": [{"id": "uuid-1", "name": "قهوة", "sku": "C-1", "quantity": 1}],
        }
    ).encode()
    event = parse(StorePlatform.ZID, {}, body)
    assert event.order_id == "321" and event.stage == OrderStage.DELIVERED and event.items[0].name == "قهوة"
    in_delivery = json.dumps({"id": 1, "order_status": {"code": "inDelivery"}}).encode()
    assert parse(StorePlatform.ZID, {}, in_delivery).stage == OrderStage.FULFILLED


def test_shopify_topics() -> None:
    order = {
        "id": 450789469,
        "email": "bob@example.com",
        "customer_locale": "en-US",
        "customer": {"id": 207119551},
        "line_items": [{"product_id": 632910392, "title": "IPod Nano", "sku": "IPOD2008", "quantity": 1}],
    }
    fulfilled = parse(StorePlatform.SHOPIFY, {"X-Shopify-Topic": "orders/fulfilled"}, json.dumps(order).encode())
    assert (
        fulfilled.stage == OrderStage.FULFILLED and fulfilled.locale == "en" and fulfilled.items[0].key == "632910392"
    )
    delivered = parse(
        StorePlatform.SHOPIFY,
        {"X-Shopify-Topic": "fulfillments/update"},
        json.dumps({"order_id": 450789469, "shipment_status": "delivered", "line_items": order["line_items"]}).encode(),
    )
    assert delivered.order_id == "450789469" and delivered.stage == OrderStage.DELIVERED
    cancelled = parse(
        StorePlatform.SHOPIFY,
        {"X-Shopify-Topic": "orders/updated"},
        json.dumps({**order, "cancelled_at": "x"}).encode(),
    )
    assert cancelled.stage == OrderStage.CANCELLED


def test_woocommerce_status_ping_and_guest_customers() -> None:
    body = json.dumps(
        {
            "id": 727,
            "status": "completed",
            "customer_id": 0,
            "billing": {"email": "guest@example.com"},
            "line_items": [{"product_id": 93, "name": "Woo Single", "sku": "", "quantity": 2}],
        }
    ).encode()
    event = parse(StorePlatform.WOOCOMMERCE, {"X-WC-Webhook-Topic": "order.updated"}, body)
    assert event.stage == OrderStage.DELIVERED and event.customer_id is None and event.email == "guest@example.com"
    assert event.items[0].quantity == 2
    assert parse(StorePlatform.WOOCOMMERCE, {}, b"webhook_id=12").is_ping


def test_custom_format_and_bad_payloads() -> None:
    body = json.dumps(
        {"event": "order.delivered", "order": {"id": "A-1", "items": [{"id": "x", "name": "Y"}]}}
    ).encode()
    assert parse(StorePlatform.CUSTOM, {}, body).stage == OrderStage.DELIVERED  # status taken from the event name
    unknown = json.dumps({"order": {"id": "A-2", "status": "teleported"}}).encode()
    assert parse(StorePlatform.CUSTOM, {}, unknown).stage is None
    with pytest.raises(PayloadError):
        parse(StorePlatform.CUSTOM, {}, b"not json")
    with pytest.raises(PayloadError):
        parse(StorePlatform.SHOPIFY, {"X-Shopify-Topic": "orders/paid"}, b'{"line_items": []}')  # no order id


def test_unique_items_caps_and_dedupes() -> None:
    items = tuple(OrderItem(key=k, name=k) for k in ["a", "b", "a", "c", "d"])
    assert [i.key for i in unique_items(items, 3)] == ["a", "b", "c"]


# --------------------------------------------------------------- templates
def test_templates_validate_and_placeholders_fill() -> None:
    for build in TEMPLATES.values():
        for language in ("ar", "en"):
            doc = build(language)
            assert doc.language == language and doc.sections[0].questions
    product = TEMPLATES["product_feedback"]("ar").model_dump(mode="json")
    filled = fill_document(product, {"product": "سماعة لاسلكية", "store": "متجر النور"})
    assert filled["sections"][0]["questions"][0]["text"] == "ما مدى رضاك عن سماعة لاسلكية؟"
    assert filled["sections"][0]["title"] == "سماعة لاسلكية"
    assert fill_placeholders("{{ store }} و {{unknown}}", {"store": "س"}) == "س و {{unknown}}"
