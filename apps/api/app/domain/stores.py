"""E-commerce platform adapters: verify a webhook delivery and normalize its order.

Pure functions (no I/O), unit-tested per platform. Verification schemes:

- **Salla** — ``X-Salla-Security-Strategy: Signature`` with ``X-Salla-Signature`` = hex
  HMAC-SHA256 of the raw body; or the Token strategy, where ``Authorization`` carries
  the secret itself.
- **Zid** — HTTP Basic auth set when the webhook is registered (username ``meqyas``,
  password = the connection secret).
- **Shopify** — ``X-Shopify-Hmac-Sha256`` = base64 HMAC-SHA256 of the raw body.
- **WooCommerce** — ``X-WC-Webhook-Signature`` = base64 HMAC-SHA256 of the raw body.
- **Custom** — ``X-Meqyas-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>." + body)>``,
  accepted within 5 minutes (replay window).

Payloads are read defensively: every platform has variants (wrapped/unwrapped orders,
custom statuses), so unknown shapes produce ``stage=None`` (ignored), never a crash.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

from .enums import StorePlatform, StoreTrigger

ZID_USERNAME = "meqyas"
CUSTOM_TOLERANCE_S = 300
MAX_ITEMS = 50


class OrderStage(IntEnum):
    CANCELLED = -1
    CREATED = 1
    PAID = 2
    FULFILLED = 3
    DELIVERED = 4


TRIGGER_STAGE = {StoreTrigger.FULFILLED: OrderStage.FULFILLED, StoreTrigger.DELIVERED: OrderStage.DELIVERED}


class PayloadError(ValueError):
    """The body is not a readable order event."""


@dataclass(frozen=True, slots=True)
class OrderItem:
    key: str
    name: str
    sku: str | None = None
    quantity: int = 1


@dataclass(frozen=True, slots=True)
class OrderEvent:
    event: str
    order_id: str | None
    stage: OrderStage | None
    customer_id: str | None = None
    #: Used only to e-mail the invitation; never stored in clear, never logged.
    email: str | None = None
    locale: str | None = None
    items: tuple[OrderItem, ...] = field(default_factory=tuple)
    is_ping: bool = False
    #: Branch code from POS systems (custom payload ``location``/``branch``), matched to a project location.
    location_code: str | None = None


# --------------------------------------------------------------- utilities
def _lower(headers: Mapping[str, str]) -> dict[str, str]:
    return {k.lower(): v for k, v in headers.items()}


def _hmac(secret: str, body: bytes) -> bytes:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()


def _same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, dict | list):
        return None
    text = str(value).strip()
    return text or None


def _locale(value: Any) -> str | None:
    text = (_text(value) or "").lower()
    return text[:2] if text[:2] in ("ar", "en") else None


def _quantity(value: Any) -> int:
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return 1


def _json(body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PayloadError("Body is not JSON") from exc
    if not isinstance(payload, dict):
        raise PayloadError("Body must be a JSON object")
    return payload


def _items(raw: Any, *, key_fields: tuple[str, ...], name_fields: tuple[str, ...]) -> tuple[OrderItem, ...]:
    out: list[OrderItem] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        product = item.get("product") if isinstance(item.get("product"), dict) else {}
        name = next((t for f in name_fields if (t := _text(item.get(f) or product.get(f)))), None)
        key = next((t for f in key_fields if (t := _text(item.get(f) or product.get(f)))), None)
        if not name and not key:
            continue
        out.append(
            OrderItem(
                key=(key or name or "")[:120],
                name=(name or key or "")[:200],
                sku=_text(item.get("sku") or product.get("sku")),
                quantity=_quantity(item.get("quantity")),
            )
        )
        if len(out) >= MAX_ITEMS:
            break
    return tuple(out)


# ------------------------------------------------------------ verification
def verify(
    platform: StorePlatform,
    headers: Mapping[str, str],
    body: bytes,
    secret: str,
    *,
    now: float | None = None,
) -> bool:
    """Constant-time check that this delivery was produced by the store holding ``secret``."""
    if not secret:
        return False
    h = _lower(headers)
    if platform == StorePlatform.SALLA:
        if h.get("x-salla-security-strategy", "signature").strip().lower() == "token":
            token = h.get("authorization", "").strip()
            token = token[7:].strip() if token.lower().startswith("bearer ") else token
            return bool(token) and _same(token, secret)
        return _same(h.get("x-salla-signature", "").strip().lower(), _hmac(secret, body).hex())
    if platform == StorePlatform.ZID:
        auth = h.get("authorization", "").strip()
        if not auth.lower().startswith("basic "):
            return False
        try:
            user, _, password = base64.b64decode(auth[6:].strip(), validate=True).decode("utf-8").partition(":")
        except (ValueError, UnicodeDecodeError):
            return False
        return _same(user, ZID_USERNAME) & _same(password, secret)
    if platform == StorePlatform.SHOPIFY:
        expected = base64.b64encode(_hmac(secret, body)).decode("ascii")
        return _same(h.get("x-shopify-hmac-sha256", "").strip(), expected)
    if platform == StorePlatform.WOOCOMMERCE:
        expected = base64.b64encode(_hmac(secret, body)).decode("ascii")
        return _same(h.get("x-wc-webhook-signature", "").strip(), expected)
    # CUSTOM
    parts = dict(p.split("=", 1) for p in h.get("x-meqyas-signature", "").split(",") if "=" in p)
    stamp, signature = parts.get("t", "").strip(), parts.get("v1", "").strip().lower()
    if not stamp.isdigit() or not signature:
        return False
    if abs((now if now is not None else time.time()) - int(stamp)) > CUSTOM_TOLERANCE_S:
        return False
    return _same(signature, _hmac(secret, stamp.encode("ascii") + b"." + body).hex())


def sign_custom(secret: str, body: bytes, *, timestamp: int | None = None) -> str:
    """The ``X-Meqyas-Signature`` value for a body (used by tests and the setup guide)."""
    stamp = str(timestamp if timestamp is not None else int(time.time()))
    return f"t={stamp},v1={_hmac(secret, stamp.encode('ascii') + b'.' + body).hex()}"


# ------------------------------------------------------------- normalizers
_SALLA_STAGE = {
    "payment_pending": OrderStage.CREATED,
    "under_review": OrderStage.PAID,
    "in_progress": OrderStage.PAID,
    "completed": OrderStage.FULFILLED,  # parent of shipped/delivering/delivered
    "shipped": OrderStage.FULFILLED,
    "delivering": OrderStage.FULFILLED,
    "delivered": OrderStage.DELIVERED,
    "canceled": OrderStage.CANCELLED,
    "cancelled": OrderStage.CANCELLED,
    "restoring": OrderStage.CANCELLED,
    "restored": OrderStage.CANCELLED,
}
_SALLA_EVENT_STAGE = {
    "order.created": OrderStage.CREATED,
    "order.cancelled": OrderStage.CANCELLED,
    "order.refunded": OrderStage.CANCELLED,
    "order.shipment.created": OrderStage.FULFILLED,
}
_ZID_STAGE = {
    "new": OrderStage.CREATED,
    "preparing": OrderStage.PAID,
    "ready": OrderStage.PAID,
    "indelivery": OrderStage.FULFILLED,
    "delivered": OrderStage.DELIVERED,
    "cancelled": OrderStage.CANCELLED,
    "canceled": OrderStage.CANCELLED,
    "reversed": OrderStage.CANCELLED,
    "reverse_in_progress": OrderStage.CANCELLED,
    "partially_reversed": OrderStage.CANCELLED,
}
_WOO_STAGE = {
    "pending": OrderStage.CREATED,
    "on-hold": OrderStage.CREATED,
    "processing": OrderStage.PAID,
    "completed": OrderStage.DELIVERED,  # WooCommerce has no separate "delivered" status
    "cancelled": OrderStage.CANCELLED,
    "refunded": OrderStage.CANCELLED,
    "failed": OrderStage.CANCELLED,
}
_CUSTOM_STAGE = {
    **{s.name.lower(): s for s in OrderStage},
    "canceled": OrderStage.CANCELLED,
    "refunded": OrderStage.CANCELLED,
    "shipped": OrderStage.FULFILLED,
    "completed": OrderStage.DELIVERED,
}


def _salla(body: bytes, h: dict[str, str]) -> OrderEvent:
    payload = _json(body)
    event = _text(payload.get("event")) or ""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    order = data.get("order") if isinstance(data.get("order"), dict) else data
    status = order.get("status") if order.get("status") is not None else data.get("status")
    slug = (_text(status.get("slug")) if isinstance(status, dict) else _text(status)) or ""
    stage = _SALLA_STAGE.get(slug.lower()) or _SALLA_EVENT_STAGE.get(event)
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    return OrderEvent(
        event=event,
        order_id=_text(order.get("id")) or _text(data.get("id")) or _text(order.get("reference_id")),
        stage=stage,
        customer_id=_text(customer.get("id")),
        email=_text(customer.get("email")),
        locale=_locale(order.get("language") or customer.get("lang") or data.get("locale")),
        items=_items(order.get("items"), key_fields=("product_id", "id", "sku"), name_fields=("name",)),
    )


def _zid(body: bytes, h: dict[str, str]) -> OrderEvent:
    payload = _json(body)
    order = payload
    if "order_status" not in payload and isinstance(payload.get("data"), dict):
        order = payload["data"]
    status = order.get("order_status")
    code = (_text(status.get("code")) if isinstance(status, dict) else _text(status)) or ""
    stage = _ZID_STAGE.get(code.lower().replace(" ", ""))
    if stage is None and (_text(order.get("payment_status")) or "").lower() == "paid":
        stage = OrderStage.PAID
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    return OrderEvent(
        event=_text(payload.get("event")) or "order.status.update",
        order_id=_text(order.get("id")) or _text(order.get("code")),
        stage=stage,
        customer_id=_text(customer.get("id")),
        email=_text(customer.get("email")),
        locale=_locale(order.get("language") or order.get("lang")),
        items=_items(order.get("products"), key_fields=("id", "sku"), name_fields=("name",)),
    )


def _shopify(body: bytes, h: dict[str, str]) -> OrderEvent:
    payload = _json(body)
    topic = h.get("x-shopify-topic", "").strip().lower()
    customer = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
    if topic.startswith("fulfillments/"):
        shipment = (_text(payload.get("shipment_status")) or "").lower()
        stage: OrderStage | None = OrderStage.DELIVERED if shipment == "delivered" else OrderStage.FULFILLED
        order_id = _text(payload.get("order_id"))
    else:
        order_id = _text(payload.get("id"))
        if topic == "orders/cancelled" or payload.get("cancelled_at"):
            stage = OrderStage.CANCELLED
        elif topic == "orders/fulfilled" or (_text(payload.get("fulfillment_status")) or "") == "fulfilled":
            stage = OrderStage.FULFILLED
        elif topic == "orders/paid" or (_text(payload.get("financial_status")) or "") == "paid":
            stage = OrderStage.PAID
        elif topic == "orders/create":
            stage = OrderStage.CREATED
        else:
            stage = None
    return OrderEvent(
        event=topic,
        order_id=order_id,
        stage=stage,
        customer_id=_text(customer.get("id")),
        email=_text(payload.get("email")) or _text(customer.get("email")),
        locale=_locale(payload.get("customer_locale") or customer.get("locale")),
        items=_items(
            payload.get("line_items"), key_fields=("product_id", "variant_id", "sku"), name_fields=("title", "name")
        ),
    )


def _woocommerce(body: bytes, h: dict[str, str]) -> OrderEvent:
    if body[:11] == b"webhook_id=":  # delivery-URL check sent when the webhook is saved
        return OrderEvent(event="ping", order_id=None, stage=None, is_ping=True)
    payload = _json(body)
    billing = payload.get("billing") if isinstance(payload.get("billing"), dict) else {}
    customer_id = _text(payload.get("customer_id"))
    return OrderEvent(
        event=h.get("x-wc-webhook-topic", "").strip().lower() or "order.updated",
        order_id=_text(payload.get("id")) or _text(payload.get("number")),
        stage=_WOO_STAGE.get((_text(payload.get("status")) or "").lower()),
        customer_id=customer_id if customer_id not in (None, "0") else None,
        email=_text(billing.get("email")),
        locale=_locale(payload.get("lang") or payload.get("locale")),
        items=_items(payload.get("line_items"), key_fields=("product_id", "sku", "id"), name_fields=("name",)),
    )


def _custom(body: bytes, h: dict[str, str]) -> OrderEvent:
    payload = _json(body)
    order = payload.get("order") if isinstance(payload.get("order"), dict) else payload
    customer = order.get("customer") if isinstance(order.get("customer"), dict) else {}
    status = (_text(order.get("status")) or (_text(payload.get("event")) or "").split(".")[-1]).lower()
    return OrderEvent(
        event=_text(payload.get("event")) or "order",
        order_id=_text(order.get("id")),
        stage=_CUSTOM_STAGE.get(status),
        customer_id=_text(customer.get("id")),
        email=_text(customer.get("email")),
        locale=_locale(order.get("locale")),
        items=_items(order.get("items"), key_fields=("id", "sku"), name_fields=("name", "title")),
        location_code=_text(order.get("location") or order.get("branch") or payload.get("location")),
    )


_PARSERS = {
    StorePlatform.SALLA: _salla,
    StorePlatform.ZID: _zid,
    StorePlatform.SHOPIFY: _shopify,
    StorePlatform.WOOCOMMERCE: _woocommerce,
    StorePlatform.CUSTOM: _custom,
}


def parse(platform: StorePlatform, headers: Mapping[str, str], body: bytes) -> OrderEvent:
    event = _PARSERS[platform](body, _lower(headers))
    if not event.is_ping and not event.order_id:
        raise PayloadError("The order id is missing")
    return event


def unique_items(items: tuple[OrderItem, ...], limit: int) -> list[OrderItem]:
    """One invitation per distinct product (variants of a product share it)."""
    seen: set[str] = set()
    out: list[OrderItem] = []
    for item in items:
        if item.key in seen:
            continue
        seen.add(item.key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def sample_order(language: str = "ar") -> dict[str, Any]:
    """The test order used by "Send a test order" (Custom format)."""
    names = (
        ["سماعة لاسلكية", "حافظة جلدية للجوال"] if language == "ar" else ["Wireless headphones", "Leather phone case"]
    )
    return {
        "event": "order.delivered",
        "order": {
            "id": f"TEST-{int(time.time())}",
            "status": "delivered",
            "locale": language,
            "customer": {"id": "test-customer"},
            "items": [
                {"id": "test-1", "name": names[0], "sku": "TEST-HP-1", "quantity": 1},
                {"id": "test-2", "name": names[1], "sku": "TEST-CS-2", "quantity": 2},
            ],
        },
    }
