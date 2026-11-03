"""E-commerce store connections (INTEGRATIONS.md): a store sends signed order webhooks,
MEQYAS turns qualifying orders into single-use survey invitations (store experience
and/or per product) and links the answers back for product- and store-level analysis.

Privacy: order and customer ids are kept only as keyed hashes; a customer's e-mail is
stored encrypted solely until the invitation e-mail is sent, then erased. Webhook
payloads are never stored.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import (
    ConnectionStatus,
    InvitationDelivery,
    InvitationStatus,
    StoreEventStatus,
    StorePlatform,
    StoreTrigger,
)

_EMPTY_JSON = text("'{}'::jsonb")


class StoreConnection(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "store_connections"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    platform: Mapped[StorePlatform] = mapped_column(str_enum(StorePlatform, 16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    store_url: Mapped[str | None] = mapped_column(String(300))
    #: Unguessable id in the webhook URL (the secret still has to verify every delivery).
    public_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    #: Last 4 characters, to recognise the secret without revealing it.
    secret_hint: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    status: Mapped[ConnectionStatus] = mapped_column(
        str_enum(ConnectionStatus, 16), nullable=False, default=ConnectionStatus.ACTIVE
    )
    store_survey_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("surveys.id", ondelete="SET NULL"))
    product_survey_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("surveys.id", ondelete="SET NULL"))
    trigger: Mapped[StoreTrigger] = mapped_column(
        str_enum(StoreTrigger, 16), nullable=False, default=StoreTrigger.DELIVERED
    )
    delivery: Mapped[InvitationDelivery] = mapped_column(
        str_enum(InvitationDelivery, 16), nullable=False, default=InvitationDelivery.LINK
    )
    #: E-mail delivery waits this many days after the trigger (time to use the product).
    delay_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_products: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    #: Survey-fatigue guard: a customer is invited at most once per this many days.
    min_days_between: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    events_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    events_rejected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class StoreEvent(UUIDPk, OrgScoped, CreatedAt, Base):
    """Delivery log (no payloads): what arrived and what MEQYAS did with it."""

    __tablename__ = "store_events"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("store_connections.id", ondelete="CASCADE"), nullable=False
    )
    event: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    status: Mapped[StoreEventStatus] = mapped_column(str_enum(StoreEventStatus, 16), nullable=False)
    reason: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    order_hash: Mapped[str | None] = mapped_column(String(64))
    items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    invitations_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (Index("ix_store_events_connection_created", "connection_id", "created_at"),)


class SurveyInvitation(UUIDPk, OrgScoped, CreatedAt, Base):
    """A single-use, unguessable survey link for one order (store experience) or one
    purchased product. ``context`` holds only business data shown to the customer."""

    __tablename__ = "survey_invitations"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    #: (connection_id, customer_hash) index below also serves connection lookups
    connection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("store_connections.id", ondelete="CASCADE"))
    token: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    order_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    customer_hash: Mapped[str | None] = mapped_column(String(64))
    #: "" for the order-level (store experience) invitation, else the product key.
    product_key: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    context: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    status: Mapped[InvitationStatus] = mapped_column(
        str_enum(InvitationStatus, 16), nullable=False, default=InvitationStatus.READY
    )
    #: Present only while an e-mail is waiting to be sent; erased right after sending.
    email_encrypted: Mapped[str | None] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    send_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("survey_id", "order_hash", "product_key"),
        Index("ix_invitations_connection_customer", "connection_id", "customer_hash"),
        Index("ix_invitations_due", "status", "send_at"),
    )


class StoreOptOut(UUIDPk, OrgScoped, CreatedAt, Base):
    """A customer asked not to receive more rating requests from this store."""

    __tablename__ = "store_opt_outs"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("store_connections.id", ondelete="CASCADE"), nullable=False
    )
    customer_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (UniqueConstraint("connection_id", "customer_hash"),)
