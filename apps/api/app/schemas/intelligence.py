"""Phase 6 API models: text analysis, insights, recommendations, analyst chat."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..domain.enums import Confidence, InsightKind, InsightStatus, Priority, RecommendationStatus, Severity
from .common import APIModel, InputModel


class AnalyzeIn(InputModel):
    #: False → keywords only (no AI call).
    use_ai: bool = True


class InsightOut(APIModel):
    id: uuid.UUID
    kind: InsightKind
    title: str
    body: str
    severity: Severity
    confidence: Confidence
    evidence: dict[str, Any]
    status: InsightStatus
    current: bool
    created_at: datetime
    updated_at: datetime


class InsightStatusIn(InputModel):
    status: InsightStatus


class RecommendationOut(APIModel):
    id: uuid.UUID
    insight_ids: list[str]
    problem: str
    recommendation: str
    possible_cause: str
    expected_outcome: str
    priority: Priority
    confidence: Confidence
    owner: str
    timeframe: str
    due_on: date | None
    status: RecommendationStatus
    source: str
    created_at: datetime


class RecommendationIn(InputModel):
    recommendation: str = Field(min_length=3, max_length=4000)
    problem: str = Field(default="", max_length=4000)
    possible_cause: str = Field(default="", max_length=2000)
    expected_outcome: str = Field(default="", max_length=2000)
    priority: Priority = Priority.MEDIUM
    owner: str = Field(default="", max_length=200)
    timeframe: str = Field(default="", max_length=120)
    due_on: date | None = None
    insight_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class RecommendationPatch(InputModel):
    recommendation: str | None = Field(default=None, min_length=3, max_length=4000)
    problem: str | None = Field(default=None, max_length=4000)
    possible_cause: str | None = Field(default=None, max_length=2000)
    expected_outcome: str | None = Field(default=None, max_length=2000)
    priority: Priority | None = None
    owner: str | None = Field(default=None, max_length=200)
    timeframe: str | None = Field(default=None, max_length=120)
    due_on: date | None = None
    status: RecommendationStatus | None = None


class ChatTurnIn(InputModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatIn(InputModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=12)


class ChatEvidence(BaseModel):
    id: str
    label: str
    value: str
    n: int | None = None
    ref: dict[str, Any] = Field(default_factory=dict)


class ChatOut(BaseModel):
    answer: str
    evidence: list[ChatEvidence]
    follow_ups: list[str]
