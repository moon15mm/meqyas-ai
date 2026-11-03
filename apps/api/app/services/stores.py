"""Store connections: setup, webhook intake, invitations and e-mail delivery
(INTEGRATIONS.md, DECISIONS D-034…D-037).

A verified order event that reaches the connection's trigger stage becomes
single-use invitations: one for the store experience and/or one per distinct
product (up to ``max_products``). Re-deliveries are idempotent (unique per
survey × order × product). Cancelled orders cancel their open invitations.
"""

from __future__ import annotations

import logging
import uuid
from collections import Counter
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.config import get_settings
from ..core.crypto import decrypt, encrypt, stable_hash
from ..core.errors import Conflict, NotFound, Unauthorized, Unprocessable
from ..core.ids import public_id, token_urlsafe
from ..domain import stores as adapters
from ..domain.enums import (
    ConnectionStatus,
    InvitationDelivery,
    InvitationStatus,
    StoreEventStatus,
    StorePlatform,
)
from ..domain.permissions import Permission
from ..domain.stores import TRIGGER_STAGE, OrderEvent, OrderStage, PayloadError
from ..domain.survey.templates import PLACEHOLDER_FALLBACK, fill_placeholders
from ..models import (
    Project,
    StoreConnection,
    StoreEvent,
    StoreOptOut,
    Survey,
    SurveyInvitation,
)
from ..schemas.store import ConnectionStats, StoreConnectionIn, StoreConnectionOut, StoreConnectionUpdate
from . import locations, subscriptions
from .audit import audit
from .email import send_email
from .projects import get_owned

logger = logging.getLogger("meqyas.stores")

INVITATION_TTL_DAYS = 60
EVENT_RETENTION_DAYS = 30
MAX_BODY_BYTES = 512 * 1024
#: Invitations still waiting for (or open to) an answer.
OPEN_STATUSES = (
    InvitationStatus.READY,
    InvitationStatus.SCHEDULED,
    InvitationStatus.SENT,
    InvitationStatus.OPENED,
)


# ------------------------------------------------------------------ helpers
def webhook_url_base() -> str:
    """Public origin the stores call (the web origin: /api is routed to this service)."""
    return f"{get_settings().web_base_url.rstrip('/')}/api/v1/integrations/stores/"


def webhook_url(conn: StoreConnection) -> str:
    return f"{webhook_url_base()}{conn.public_id}/webhook"


def invitation_url(survey: Survey, inv: SurveyInvitation) -> str:
    return f"{get_settings().web_base_url.rstrip('/')}/s/{survey.public_id}?inv={inv.token}"


def email_delivery_available() -> bool:
    s = get_settings()
    return bool(s.smtp_url) or not s.is_production


async def _unique_connection_id(session: AsyncSession) -> str:
    for _ in range(10):
        candidate = public_id(16)
        if not await session.scalar(select(StoreConnection.id).where(StoreConnection.public_id == candidate)):
            return candidate
    raise Conflict("Could not allocate a webhook id")  # pragma: no cover


def _secret_hint(secret: str) -> str:
    return secret[-4:]


async def _check_surveys(
    session: AsyncSession, project_id: uuid.UUID, store_survey_id: uuid.UUID | None, product_survey_id: uuid.UUID | None
) -> None:
    if store_survey_id is None and product_survey_id is None:
        raise Unprocessable("Choose a store survey, a product survey, or both", code="survey_required")
    if store_survey_id is not None and store_survey_id == product_survey_id:
        raise Unprocessable("Use different surveys for the store and the products", code="same_survey")
    for sid in (store_survey_id, product_survey_id):
        if sid is None:
            continue
        found = await session.scalar(select(Survey.id).where(Survey.id == sid, Survey.project_id == project_id))
        if found is None:
            raise Unprocessable("The survey must belong to this project", code="survey_not_in_project")


async def connection_stats(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, ConnectionStats]:
    rows = (
        await session.execute(
            select(SurveyInvitation.connection_id, SurveyInvitation.status, func.count())
            .where(SurveyInvitation.connection_id.in_(ids), SurveyInvitation.is_test.is_(False))
            .group_by(SurveyInvitation.connection_id, SurveyInvitation.status)
        )
    ).all()
    counts: dict[uuid.UUID, Counter[InvitationStatus]] = {i: Counter() for i in ids}
    for cid, status, n in rows:
        if cid is not None:
            counts[cid][status] += int(n)
    out: dict[uuid.UUID, ConnectionStats] = {}
    for cid, c in counts.items():
        responded = c[InvitationStatus.RESPONDED]
        opened = c[InvitationStatus.OPENED] + responded
        sent = c[InvitationStatus.SENT] + opened
        reached = sent + c[InvitationStatus.READY] + c[InvitationStatus.EXPIRED]
        out[cid] = ConnectionStats(
            invitations=sum(c.values()),
            sent=sent,
            opened=opened,
            responded=responded,
            pending_email=c[InvitationStatus.SCHEDULED],
            response_rate=round(responded / reached * 100, 1) if reached else None,
        )
    return out


def to_out(conn: StoreConnection, stats: ConnectionStats | None = None) -> StoreConnectionOut:
    return StoreConnectionOut.model_validate(
        {
            **{k: getattr(conn, k) for k in StoreConnectionOut.model_fields if hasattr(conn, k)},
            "webhook_url": webhook_url(conn),
            "auth_username": adapters.ZID_USERNAME if conn.platform == StorePlatform.ZID else None,
            "stats": stats or ConnectionStats(),
        }
    )


# --------------------------------------------------------------------- CRUD
async def list_connections(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[StoreConnectionOut]:
    ctx.require(Permission.PROJECT_READ)
    project = await get_owned(session, Project, project_id, ctx)
    conns = (
        await session.scalars(
            select(StoreConnection)
            .where(StoreConnection.project_id == project.id, StoreConnection.organization_id == ctx.organization_id)
            .order_by(StoreConnection.created_at)
        )
    ).all()
    stats = await connection_stats(session, [c.id for c in conns])
    return [to_out(c, stats.get(c.id)) for c in conns]


async def get_connection(session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> StoreConnection:
    ctx.require(Permission.PROJECT_READ)
    return await get_owned(session, StoreConnection, connection_id, ctx)


async def create_connection(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: StoreConnectionIn, *, request_meta: Any = None
) -> tuple[StoreConnection, str]:
    ctx.require(Permission.INTEGRATIONS_MANAGE)
    project = await get_owned(session, Project, project_id, ctx)
    await _check_surveys(session, project.id, data.store_survey_id, data.product_survey_id)
    secret = (data.secret or "").strip() or token_urlsafe(24)
    conn = StoreConnection(
        organization_id=ctx.organization_id,
        project_id=project.id,
        platform=data.platform,
        name=data.name,
        store_url=str(data.store_url) if data.store_url else None,
        public_id=await _unique_connection_id(session),
        secret_encrypted=encrypt(secret) or "",
        secret_hint=_secret_hint(secret),
        store_survey_id=data.store_survey_id,
        product_survey_id=data.product_survey_id,
        trigger=data.trigger,
        delivery=data.delivery,
        delay_days=data.delay_days,
        max_products=data.max_products,
        min_days_between=data.min_days_between,
        created_by_id=ctx.user_id,
    )
    session.add(conn)
    await session.flush()
    audit(
        session,
        action="integration.store.create",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="store_connection",
        entity_id=conn.id,
        meta={"platform": conn.platform.value},
        request_meta=request_meta,
    )
    await session.commit()
    await session.refresh(conn)
    return conn, secret


async def update_connection(
    session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, data: StoreConnectionUpdate
) -> StoreConnection:
    ctx.require(Permission.INTEGRATIONS_MANAGE)
    conn = await get_owned(session, StoreConnection, connection_id, ctx)
    changes = data.model_dump(exclude_unset=True)
    store_survey = changes.get("store_survey_id", conn.store_survey_id)
    product_survey = changes.get("product_survey_id", conn.product_survey_id)
    if "store_survey_id" in changes or "product_survey_id" in changes:
        await _check_surveys(session, conn.project_id, store_survey, product_survey)
    for key, value in changes.items():
        if key == "store_url":
            value = str(value) if value else None
        if key == "name" and value is None:
            continue
        setattr(conn, key, value)
    await session.commit()
    await session.refresh(conn)
    return conn


async def rotate_secret(
    session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, secret: str | None, *, request_meta: Any = None
) -> tuple[StoreConnection, str]:
    ctx.require(Permission.INTEGRATIONS_MANAGE)
    conn = await get_owned(session, StoreConnection, connection_id, ctx)
    value = (secret or "").strip() or token_urlsafe(24)
    conn.secret_encrypted = encrypt(value) or ""
    conn.secret_hint = _secret_hint(value)
    audit(
        session,
        action="integration.store.secret_rotated",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="store_connection",
        entity_id=conn.id,
        request_meta=request_meta,
    )
    await session.commit()
    await session.refresh(conn)
    return conn, value


async def delete_connection(
    session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, *, request_meta: Any = None
) -> None:
    ctx.require(Permission.INTEGRATIONS_MANAGE)
    conn = await get_owned(session, StoreConnection, connection_id, ctx)
    audit(
        session,
        action="integration.store.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="store_connection",
        entity_id=conn.id,
        meta={"platform": conn.platform.value},
        request_meta=request_meta,
    )
    # Answers stay; their invitations go with the connection (responses keep their store context).
    await session.delete(conn)
    await session.commit()


async def list_events(
    session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, *, limit: int = 50
) -> list[StoreEvent]:
    conn = await get_connection(session, ctx, connection_id)
    return list(
        (
            await session.scalars(
                select(StoreEvent)
                .where(StoreEvent.connection_id == conn.id)
                .order_by(StoreEvent.created_at.desc())
                .limit(limit)
            )
        ).all()
    )


async def list_invitations(
    session: AsyncSession,
    ctx: OrgContext,
    connection_id: uuid.UUID,
    *,
    status: InvitationStatus | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Invitation links are capability URLs: only roles that may read raw responses see them."""
    ctx.require(Permission.RESPONSES_READ_RAW)
    conn = await get_connection(session, ctx, connection_id)
    stmt = select(SurveyInvitation, Survey).join(Survey, Survey.id == SurveyInvitation.survey_id)
    stmt = stmt.where(SurveyInvitation.connection_id == conn.id)
    if status is not None:
        stmt = stmt.where(SurveyInvitation.status == status)
    rows = (await session.execute(stmt.order_by(SurveyInvitation.created_at.desc()).limit(limit))).all()
    return [
        {
            "id": inv.id,
            "survey_id": inv.survey_id,
            "status": inv.status,
            "product": (inv.context.get("product") or {}).get("name"),
            "url": invitation_url(survey, inv),
            "created_at": inv.created_at,
            "sent_at": inv.sent_at,
            "opened_at": inv.opened_at,
            "responded_at": inv.responded_at,
            "expires_at": inv.expires_at,
            "is_test": inv.is_test,
        }
        for inv, survey in rows
    ]


# ------------------------------------------------------------------ intake
def _log(conn: StoreConnection, event: str, status: StoreEventStatus, reason: str = "", **kw: Any) -> StoreEvent:
    return StoreEvent(
        organization_id=conn.organization_id,
        connection_id=conn.id,
        event=event[:80],
        status=status,
        reason=reason,
        **kw,
    )


async def _open_survey(session: AsyncSession, survey_id: uuid.UUID | None) -> Survey | None:
    if survey_id is None:
        return None
    from .public import availability  # local import: public imports this module

    survey = await session.get(Survey, survey_id)
    if survey is None or survey.published_version_id is None:
        return None
    return survey if await availability(session, survey) == "OPEN" else None


async def process_order(
    session: AsyncSession, conn: StoreConnection, event: OrderEvent, *, is_test: bool = False
) -> tuple[StoreEventStatus, str, list[tuple[SurveyInvitation, Survey]]]:
    """Apply one verified order event. The caller commits."""
    now = datetime.now(UTC)
    order_hash = stable_hash(f"{conn.id}:{event.order_id}", purpose="store-order")
    who = event.customer_id or (event.email or "").strip().lower() or None
    customer_hash = stable_hash(f"{conn.id}:{who}", purpose="store-customer") if who else None
    base = {"order_hash": order_hash, "items": len(event.items), "is_test": is_test}

    def done(status: StoreEventStatus, reason: str, created: int = 0) -> None:
        session.add(_log(conn, event.event, status, reason, invitations_created=created, **base))

    if event.stage is None:
        done(StoreEventStatus.IGNORED, "unknown_status")
        return StoreEventStatus.IGNORED, "unknown_status", []
    if event.stage == OrderStage.CANCELLED:
        result = await session.execute(
            update(SurveyInvitation)
            .where(
                SurveyInvitation.connection_id == conn.id,
                SurveyInvitation.order_hash == order_hash,
                SurveyInvitation.status.in_(OPEN_STATUSES),
            )
            .values(status=InvitationStatus.CANCELLED, email_encrypted=None)
        )
        reason = "order_cancelled" if result.rowcount else "cancelled_before_invite"  # type: ignore[attr-defined]
        done(StoreEventStatus.ACCEPTED, reason)
        return StoreEventStatus.ACCEPTED, reason, []
    if event.stage < TRIGGER_STAGE[conn.trigger]:
        done(StoreEventStatus.IGNORED, "before_trigger")
        return StoreEventStatus.IGNORED, "before_trigger", []

    if customer_hash and not is_test:
        opted_out = await session.scalar(
            select(StoreOptOut.id).where(
                StoreOptOut.connection_id == conn.id, StoreOptOut.customer_hash == customer_hash
            )
        )
        if opted_out:
            done(StoreEventStatus.IGNORED, "opted_out")
            return StoreEventStatus.IGNORED, "opted_out", []
        if conn.min_days_between > 0:
            recent = await session.scalar(
                select(SurveyInvitation.id).where(
                    SurveyInvitation.connection_id == conn.id,
                    SurveyInvitation.customer_hash == customer_hash,
                    SurveyInvitation.order_hash != order_hash,
                    SurveyInvitation.status != InvitationStatus.CANCELLED,
                    SurveyInvitation.created_at >= now - timedelta(days=conn.min_days_between),
                )
            )
            if recent:
                done(StoreEventStatus.IGNORED, "recently_invited")
                return StoreEventStatus.IGNORED, "recently_invited", []

    store_survey = await _open_survey(session, conn.store_survey_id)
    product_survey = await _open_survey(session, conn.product_survey_id)
    # POS systems name the branch: its customers' answers are then split by branch.
    loc = await locations.find_active(session, conn.project_id, event.location_code)
    where = {"location": locations.location_meta(loc)} if loc is not None else {}
    targets: list[tuple[Survey, str, dict[str, Any]]] = []
    if store_survey is not None:
        targets.append((store_survey, "", {"store": conn.name, "items": len(event.items), **where}))
    if product_survey is not None:
        for item in adapters.unique_items(event.items, conn.max_products):
            product = {"key": item.key, "name": item.name, "sku": item.sku}
            targets.append((product_survey, item.key, {"store": conn.name, "product": product, **where}))
    if not targets:
        reason = "no_products" if store_survey is None and product_survey is not None else "survey_not_open"
        done(StoreEventStatus.IGNORED, reason)
        return StoreEventStatus.IGNORED, reason, []

    email = (event.email or "").strip() or None
    by_email = conn.delivery == InvitationDelivery.EMAIL and email is not None
    created: list[tuple[SurveyInvitation, Survey]] = []
    for survey, product_key, context in targets:
        inv = SurveyInvitation(
            organization_id=conn.organization_id,
            project_id=conn.project_id,
            survey_id=survey.id,
            connection_id=conn.id,
            token=token_urlsafe(18),
            order_hash=order_hash,
            customer_hash=customer_hash,
            product_key=product_key,
            context=context,
            status=InvitationStatus.SCHEDULED if by_email else InvitationStatus.READY,
            email_encrypted=encrypt(email) if by_email else None,
            locale=event.locale or survey.language or "ar",
            send_at=now + timedelta(days=conn.delay_days) if by_email else None,
            expires_at=now + timedelta(days=INVITATION_TTL_DAYS + (conn.delay_days if by_email else 0)),
            is_test=is_test,
        )
        try:
            async with session.begin_nested():
                session.add(inv)
                await session.flush()
        except IntegrityError:
            continue  # this order (and product) was already invited: re-deliveries are idempotent
        created.append((inv, survey))
    if not created:
        done(StoreEventStatus.DUPLICATE, "already_invited")
        return StoreEventStatus.DUPLICATE, "already_invited", []
    done(StoreEventStatus.ACCEPTED, "scheduled_email" if by_email else "links_ready", len(created))
    return StoreEventStatus.ACCEPTED, "scheduled_email" if by_email else "links_ready", created


def _links(created: list[tuple[SurveyInvitation, Survey]]) -> list[dict[str, str | None]]:
    return [
        {"url": invitation_url(survey, inv), "product": (inv.context.get("product") or {}).get("name")}
        for inv, survey in created
    ]


async def receive_webhook(
    session: AsyncSession, connection_public_id: str, headers: Mapping[str, str], body: bytes
) -> dict[str, Any]:
    conn = await session.scalar(select(StoreConnection).where(StoreConnection.public_id == connection_public_id))
    if conn is None:
        raise NotFound("Unknown webhook")
    if conn.platform == StorePlatform.WOOCOMMERCE and body[:11] == b"webhook_id=":
        return {"status": "ping"}  # WooCommerce checks the URL when the webhook is saved; no side effects
    now = datetime.now(UTC)
    secret = decrypt(conn.secret_encrypted) or ""
    if not adapters.verify(conn.platform, headers, body, secret):
        conn.events_rejected += 1
        session.add(_log(conn, "", StoreEventStatus.REJECTED, "bad_signature"))
        await session.commit()
        logger.warning("store webhook rejected: bad signature (connection=%s)", conn.id)
        raise Unauthorized("Invalid webhook signature")
    conn.events_received += 1
    conn.last_event_at = now
    try:
        event = adapters.parse(conn.platform, headers, body)
    except PayloadError:
        session.add(_log(conn, "", StoreEventStatus.IGNORED, "unreadable_payload"))
        await session.commit()
        return {"status": "ignored", "reason": "unreadable_payload"}
    if event.is_ping:
        await session.commit()
        return {"status": "ping"}
    if conn.status == ConnectionStatus.PAUSED:
        session.add(_log(conn, event.event, StoreEventStatus.IGNORED, "paused"))
        await session.commit()
        return {"status": "paused"}
    ent = await subscriptions.load(session, conn.organization_id)
    if not (ent.has("integrations") and ent.can_collect):
        # Not in the plan any more, suspended, or ended: orders are acknowledged, not processed.
        session.add(_log(conn, event.event, StoreEventStatus.IGNORED, "subscription"))
        await session.commit()
        return {"status": "ignored", "reason": "subscription"}
    status, reason, created = await process_order(session, conn, event)
    await session.commit()
    return {"status": status.value.lower(), "reason": reason, "invitations": _links(created)}


async def send_test_order(session: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> dict[str, Any]:
    """Run a sample order through the same pipeline (flagged as test, excluded from analytics)."""
    ctx.require(Permission.INTEGRATIONS_MANAGE)
    conn = await get_owned(session, StoreConnection, connection_id, ctx)
    survey_id = conn.product_survey_id or conn.store_survey_id
    survey = await session.get(Survey, survey_id) if survey_id else None
    payload = adapters.sample_order(survey.language if survey else "ar")
    order = payload["order"]
    event = OrderEvent(
        event="test.order",
        order_id=order["id"],
        stage=TRIGGER_STAGE[conn.trigger],
        customer_id=None,
        locale=order["locale"],
        items=tuple(
            adapters.OrderItem(key=i["id"], name=i["name"], sku=i["sku"], quantity=i["quantity"])
            for i in order["items"]
        ),
    )
    status, reason, created = await process_order(session, conn, event, is_test=True)
    await session.commit()
    return {"status": status.value.lower(), "reason": reason, "invitations": _links(created)}


# ------------------------------------------------------------- invitations
async def find_invitation(session: AsyncSession, survey: Survey, token: str) -> tuple[SurveyInvitation | None, str]:
    """(invitation, state) where state ∈ valid | used | expired | closed | invalid."""
    inv = await session.scalar(
        select(SurveyInvitation).where(SurveyInvitation.token == token, SurveyInvitation.survey_id == survey.id)
    )
    if inv is None:
        return None, "invalid"
    if inv.status == InvitationStatus.RESPONDED:
        return inv, "used"
    if inv.status in (InvitationStatus.CANCELLED, InvitationStatus.OPTED_OUT):
        return inv, "closed"
    if inv.status == InvitationStatus.EXPIRED or inv.expires_at <= datetime.now(UTC):
        return inv, "expired"
    return inv, "valid"


def placeholder_values(inv: SurveyInvitation | None, language: str) -> dict[str, str]:
    values = dict(PLACEHOLDER_FALLBACK.get(language, PLACEHOLDER_FALLBACK["ar"]))
    if inv is not None:
        if inv.context.get("store"):
            values["store"] = str(inv.context["store"])
        product = inv.context.get("product") or {}
        if product.get("name"):
            values["product"] = str(product["name"])
        location = inv.context.get("location") or {}
        if location.get("name"):
            values["branch"] = str(location["name"])
    return values


def store_meta(inv: SurveyInvitation, conn: StoreConnection | None) -> dict[str, Any]:
    product = inv.context.get("product") or {}
    return {
        "store": {
            "connection_id": str(inv.connection_id) if inv.connection_id else None,
            "name": inv.context.get("store") or (conn.name if conn else None),
            "platform": conn.platform.value if conn else None,
            "product_key": product.get("key"),
            "product_name": product.get("name"),
            "test": inv.is_test,
        },
        **({"location": inv.context["location"]} if inv.context.get("location") else {}),
    }


async def opt_out(session: AsyncSession, survey: Survey, token: str) -> None:
    inv, _ = await find_invitation(session, survey, token)
    if inv is None:
        raise NotFound("Invitation not found")
    if inv.status in OPEN_STATUSES:
        inv.status = InvitationStatus.OPTED_OUT
        inv.email_encrypted = None
    if inv.connection_id is not None and inv.customer_hash:
        exists = await session.scalar(
            select(StoreOptOut.id).where(
                StoreOptOut.connection_id == inv.connection_id, StoreOptOut.customer_hash == inv.customer_hash
            )
        )
        if not exists:
            session.add(
                StoreOptOut(
                    organization_id=inv.organization_id,
                    connection_id=inv.connection_id,
                    customer_hash=inv.customer_hash,
                )
            )
        # The customer's other open invitations from this store stop too.
        await session.execute(
            update(SurveyInvitation)
            .where(
                SurveyInvitation.connection_id == inv.connection_id,
                SurveyInvitation.customer_hash == inv.customer_hash,
                SurveyInvitation.status.in_(OPEN_STATUSES),
            )
            .values(status=InvitationStatus.OPTED_OUT, email_encrypted=None)
        )
    await session.commit()


# ------------------------------------------------------------------- e-mail
def render_email(inv: SurveyInvitation, survey: Survey) -> tuple[str, str]:
    language = "en" if inv.locale == "en" else "ar"
    values = placeholder_values(inv, language)
    product = (inv.context.get("product") or {}).get("name")
    url = invitation_url(survey, inv)
    if language == "ar":
        subject = f"ما رأيك في {product}؟" if product else f"{values['store']}: كيف كانت تجربتك؟"
        about = f"رأيك في {product}" if product else "رأيك في تجربة طلبك"
        body = (
            f"مرحبًا،\n\nشكرًا لطلبك من {values['store']}. يهمنا أن نعرف {about} — لن يستغرق ذلك أكثر من دقيقتين.\n\n"
            f"{url}\n\nالرابط خاص بطلبك ويُستخدم مرة واحدة. إذا لم ترغب في طلبات تقييم أخرى يمكنك إيقافها من أسفل صفحة التقييم."
        )
    else:
        subject = f"What do you think of {product}?" if product else f"{values['store']}: how was your order?"
        about = f"what you think of {product}" if product else "how your order went"
        body = (
            f"Hello,\n\nThank you for ordering from {values['store']}. We would love to know {about} — it takes under two minutes.\n\n"
            f"{url}\n\nThis link is personal to your order and works once. To stop rating requests, use the link at the bottom of the page."
        )
    return fill_placeholders(subject, values), body


async def send_due_invitations(session: AsyncSession, *, now: datetime | None = None, limit: int = 200) -> int:
    """Worker job: e-mail invitations whose send time has come, then erase the address."""
    moment = now or datetime.now(UTC)
    due = (
        await session.scalars(
            select(SurveyInvitation)
            .where(SurveyInvitation.status == InvitationStatus.SCHEDULED, SurveyInvitation.send_at <= moment)
            .order_by(SurveyInvitation.send_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).all()
    sent = 0
    for inv in due:
        email = decrypt(inv.email_encrypted)
        survey = await session.get(Survey, inv.survey_id)
        if not email or survey is None:
            inv.status, inv.email_encrypted = InvitationStatus.READY, None
            continue
        subject, body = render_email(inv, survey)
        try:
            await send_email(email, subject, body)
        except Exception:
            attempts = int(inv.context.get("send_attempts", 0)) + 1
            inv.context = {**inv.context, "send_attempts": attempts}
            if attempts >= 3:
                inv.status, inv.email_encrypted = InvitationStatus.READY, None
            else:
                inv.send_at = moment + timedelta(hours=attempts)
            logger.warning("invitation e-mail failed (invitation=%s, attempt=%s)", inv.id, attempts)
            continue
        inv.status, inv.sent_at, inv.email_encrypted = InvitationStatus.SENT, moment, None
        sent += 1
    await session.commit()
    return sent


async def expire_invitations(session: AsyncSession, *, now: datetime | None = None) -> int:
    moment = now or datetime.now(UTC)
    result = await session.execute(
        update(SurveyInvitation)
        .where(SurveyInvitation.status.in_(OPEN_STATUSES), SurveyInvitation.expires_at <= moment)
        .values(status=InvitationStatus.EXPIRED, email_encrypted=None)
    )
    old = await session.execute(
        delete(StoreEvent).where(StoreEvent.created_at < moment - timedelta(days=EVENT_RETENTION_DAYS))
    )
    await session.commit()
    return int(result.rowcount or 0) + int(old.rowcount or 0)  # type: ignore[attr-defined]
