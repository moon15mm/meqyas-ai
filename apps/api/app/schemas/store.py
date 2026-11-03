"""Store connection API models (INTEGRATIONS.md)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

from ..domain.enums import (
    ConnectionStatus,
    InvitationDelivery,
    InvitationStatus,
    StoreEventStatus,
    StorePlatform,
    StoreTrigger,
)
from .common import APIModel, InputModel


class StoreConnectionIn(InputModel):
    platform: StorePlatform
    name: str = Field(min_length=1, max_length=120)
    store_url: HttpUrl | None = None
    store_survey_id: uuid.UUID | None = None
    product_survey_id: uuid.UUID | None = None
    trigger: StoreTrigger = StoreTrigger.DELIVERED
    delivery: InvitationDelivery = InvitationDelivery.LINK
    delay_days: int = Field(default=0, ge=0, le=30)
    max_products: int = Field(default=3, ge=1, le=10)
    min_days_between: int = Field(default=30, ge=0, le=365)
    #: Shopify and Salla generate the signing secret: paste it here. Otherwise MEQYAS generates one.
    secret: str | None = Field(default=None, min_length=8, max_length=200)

    @field_validator("store_url", mode="before")
    @classmethod
    def _blank_url(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value


class StoreConnectionUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    store_url: HttpUrl | None = None
    store_survey_id: uuid.UUID | None = None
    product_survey_id: uuid.UUID | None = None
    trigger: StoreTrigger | None = None
    delivery: InvitationDelivery | None = None
    delay_days: int | None = Field(default=None, ge=0, le=30)
    max_products: int | None = Field(default=None, ge=1, le=10)
    min_days_between: int | None = Field(default=None, ge=0, le=365)
    status: ConnectionStatus | None = None


class SecretIn(InputModel):
    secret: str | None = Field(default=None, min_length=8, max_length=200)


class ConnectionStats(BaseModel):
    invitations: int = 0
    sent: int = 0
    opened: int = 0
    responded: int = 0
    pending_email: int = 0
    #: responded / invitations that reached the customer (sent, opened or answered), in %.
    response_rate: float | None = None


class StoreConnectionOut(APIModel):
    id: uuid.UUID
    project_id: uuid.UUID
    platform: StorePlatform
    name: str
    store_url: str | None
    status: ConnectionStatus
    store_survey_id: uuid.UUID | None
    product_survey_id: uuid.UUID | None
    trigger: StoreTrigger
    delivery: InvitationDelivery
    delay_days: int
    max_products: int
    min_days_between: int
    webhook_url: str
    #: Zid sends HTTP Basic auth: this username with the secret as password.
    auth_username: str | None = None
    secret_hint: str
    last_event_at: datetime | None
    events_received: int
    events_rejected: int
    created_at: datetime
    stats: ConnectionStats = Field(default_factory=ConnectionStats)


class StoreConnectionCreated(StoreConnectionOut):
    #: Shown once (creation / rotation); stored encrypted.
    secret: str | None = None


class StoreEventOut(APIModel):
    id: uuid.UUID
    created_at: datetime
    event: str
    status: StoreEventStatus
    reason: str
    items: int
    invitations_created: int
    is_test: bool


class InvitationOut(APIModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    status: InvitationStatus
    product: str | None = None
    url: str
    created_at: datetime
    sent_at: datetime | None
    opened_at: datetime | None
    responded_at: datetime | None
    expires_at: datetime
    is_test: bool


class WebhookResult(BaseModel):
    ok: bool = True
    status: Literal["accepted", "duplicate", "ignored", "ping", "paused"]
    reason: str = ""
    invitations: list[dict[str, str | None]] = Field(default_factory=list)


class TestOrderOut(BaseModel):
    status: str
    reason: str = ""
    invitations: list[dict[str, str | None]] = Field(default_factory=list)


class SurveyFromTemplateIn(InputModel):
    template: Literal["store_experience", "product_feedback", "store_visit"]
    language: Literal["ar", "en"] | None = None
    wave_id: uuid.UUID | None = None


class IntegrationsCapabilities(BaseModel):
    #: False in production without SMTP_URL: e-mail delivery would not reach customers.
    email_delivery: bool
    webhook_base_url: str
