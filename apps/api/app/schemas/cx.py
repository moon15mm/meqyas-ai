"""Customer experience API models: locations and closed-loop cases."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from ..domain.enums import CaseStatus, LocationKind
from .common import APIModel, InputModel


class LocationIn(InputModel):
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(default="", max_length=120)
    kind: LocationKind = LocationKind.BRANCH
    #: Optional; generated (B01, B02…) when empty.
    code: str = Field(default="", max_length=24)


class LocationPatch(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    kind: LocationKind | None = None
    is_active: bool | None = None


class LocationOut(APIModel):
    id: uuid.UUID
    code: str
    name: str
    city: str
    kind: LocationKind
    is_active: bool
    created_at: datetime


class CasePatch(InputModel):
    status: CaseStatus | None = None
    assign_to_me: bool = False
    resolution_note: str | None = Field(default=None, max_length=2000)


class CaseOut(APIModel):
    id: uuid.UUID
    reason: str
    score: float
    score_type: str
    status: str
    contact_requested: bool
    has_contact: bool
    location: str | None
    assigned_to: str | None
    assigned_to_id: uuid.UUID | None
    due_at: datetime
    overdue: bool
    resolved_at: datetime | None
    resolution_note: str
    comment: str | None
    created_at: datetime
    response_id: uuid.UUID


CaseFilter = Literal["open", "resolved", "all"]
