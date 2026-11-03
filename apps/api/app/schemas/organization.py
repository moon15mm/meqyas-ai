from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import EmailStr, Field

from ..domain.enums import Role, Sector
from .common import APIModel, InputModel
from .subscription import AccountMessageOut


class OrganizationOut(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    sector: Sector
    locale: str
    timezone: str
    settings: dict[str, Any]
    is_demo: bool
    created_at: datetime
    role: Role | None = None


class AISettingsIn(InputModel):
    allow_cloud_ai: bool | None = None
    followup_limit: int | None = Field(default=None, ge=0, le=3)


class OrganizationSettingsIn(InputModel):
    ai: AISettingsIn | None = None


class OrganizationUpdate(InputModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    sector: Sector | None = None
    locale: str | None = Field(default=None, pattern="^(ar|en)$")
    timezone: str | None = Field(default=None, max_length=64)
    settings: OrganizationSettingsIn | None = None


class MemberOut(APIModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: Role
    created_at: datetime
    last_login_at: datetime | None = None
    #: Invited, but has not activated the account yet.
    pending: bool = False
    #: The workspace's administrators may prepare an activation or recovery link for this
    #: person: the account belongs to this workspace only (SUBSCRIPTIONS.md §4).
    links_allowed: bool = False


class MemberAdd(InputModel):
    email: EmailStr
    role: Role = Role.VIEWER
    #: For a new account; defaults to the part of the e-mail before «@».
    full_name: str = Field(default="", max_length=200)
    send_email: bool = True


class MemberAddOut(APIModel):
    member: MemberOut
    #: The invitation: an activation link for a new account, or a sign-in link.
    message: AccountMessageOut


class MemberUpdate(InputModel):
    role: Role
