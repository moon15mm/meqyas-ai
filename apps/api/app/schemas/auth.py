from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, EmailStr, Field

from ..domain.enums import Role
from .common import APIModel, InputModel
from .subscription import SubscriptionSummary


class LoginIn(InputModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ForgotPasswordIn(InputModel):
    email: EmailStr


class ResetPasswordIn(InputModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=256)


class MembershipOut(APIModel):
    organization_id: uuid.UUID
    organization_name: str
    organization_slug: str
    role: Role
    is_demo: bool
    #: The workspace's plan, period, limits and usage (SUBSCRIPTIONS.md).
    subscription: SubscriptionSummary | None = None


class UserOut(APIModel):
    id: uuid.UUID
    email: str
    full_name: str
    locale: str
    created_at: datetime
    #: Platform administrators (``users.is_superuser``) manage subscribers, plans and gifts.
    is_platform_admin: bool = Field(default=False, validation_alias=AliasChoices("is_platform_admin", "is_superuser"))


class MeOut(APIModel):
    user: UserOut
    memberships: list[MembershipOut]


class TokenOut(APIModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut
    memberships: list[MembershipOut]


class UpdateMeIn(InputModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    locale: Literal["ar", "en"] | None = None


class ActivationPreviewOut(APIModel):
    state: Literal["valid", "expired", "used", "invalid"]
    full_name: str | None = None
    email: str | None = None
    organization_name: str | None = None
    locale: str | None = None
    expires_at: datetime | None = None


class ActivateIn(InputModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=256)
    full_name: str | None = Field(default=None, min_length=2, max_length=200)


class ChangePasswordIn(InputModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)
