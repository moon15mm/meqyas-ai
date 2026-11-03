"""Gift API models (GIFTS.md)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field

from ..domain.enums import GiftStatus, Sector
from .common import APIModel, InputModel


class GiftIn(InputModel):
    recipient_name: str = Field(min_length=2, max_length=200)
    recipient_email: EmailStr
    #: Workspace name; defaults to «مساحة <name>».
    organization_name: str = Field(default="", max_length=200)
    sector: Sector = Sector.OTHER
    survey_limit: int = Field(default=3, ge=1, le=100)
    #: Trial length from activation; None = no time limit.
    trial_days: int | None = Field(default=30, ge=1, le=365)
    locale: Literal["ar", "en"] = "ar"
    note: str = Field(default="", max_length=1000)
    send_email: bool = True


class GiftResendIn(InputModel):
    send_email: bool = True


GiftState = Literal["pending", "expired", "active", "revoked"]


class GiftOut(APIModel):
    id: uuid.UUID
    recipient_name: str
    recipient_email: str
    organization_id: uuid.UUID | None
    organization_name: str | None
    locale: str
    note: str
    survey_limit: int
    surveys_published: int
    trial_days: int | None
    trial_ends_at: datetime | None
    new_account: bool
    status: GiftStatus
    #: ``status`` plus the activation link's expiry: what the list shows.
    state: GiftState
    token_expires_at: datetime | None
    emailed_at: datetime | None
    activated_at: datetime | None
    last_login_at: datetime | None
    created_at: datetime


class GiftMessageOut(APIModel):
    """The message for the recipient — returned once, right after the gift is prepared or a link is
    renewed (the activation link is never stored and never shown again)."""

    gift: GiftOut
    subject: str
    body: str
    #: Activation link (new accounts) or sign-in link (existing accounts).
    link: str
    emailed: bool
    #: E-mail is configured on the server (otherwise the message must be shared by hand).
    email_available: bool


class GiftPreviewOut(APIModel):
    state: Literal["valid", "expired", "used", "revoked", "invalid"]
    recipient_name: str | None = None
    email: str | None = None
    organization_name: str | None = None
    survey_limit: int | None = None
    trial_days: int | None = None
    note: str | None = None
    locale: str | None = None


class GiftClaimIn(InputModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=200)
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
