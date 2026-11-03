"""Phase 8 API models: indicator values, Theory of Change, survey copy, templates, question bank."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from .common import APIModel, InputModel


class IndicatorValueOut(APIModel):
    indicator_id: uuid.UUID
    wave: str
    value: float | None
    n: int
    reason: str | None
    computed_at: datetime


class TocOutcomeIn(InputModel):
    text: str = Field(max_length=600)
    indicator_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class TocIn(InputModel):
    inputs: list[str] = Field(default_factory=list, max_length=20)
    activities: list[str] = Field(default_factory=list, max_length=20)
    outputs: list[str] = Field(default_factory=list, max_length=20)
    short_term_outcomes: list[TocOutcomeIn] = Field(default_factory=list, max_length=20)
    medium_term_outcomes: list[TocOutcomeIn] = Field(default_factory=list, max_length=20)
    long_term_impact: list[TocOutcomeIn] = Field(default_factory=list, max_length=20)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    risks: list[str] = Field(default_factory=list, max_length=20)


class TocGenerateIn(InputModel):
    notes: str = Field(default="", max_length=1500)


class SurveyCopyIn(InputModel):
    wave_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=300)


class BankItemIn(InputModel):
    question: dict[str, Any]
    topic: str = Field(default="", max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=8)
    language: Literal["ar", "en"] = "ar"


class BankItemOut(APIModel):
    id: str
    source: Literal["system", "organization"]
    question_type: str
    text: str
    topic: str
    language: str
    tags: list[str]
    question: dict[str, Any]
    template: str | None = None
    created_at: datetime | None = None
