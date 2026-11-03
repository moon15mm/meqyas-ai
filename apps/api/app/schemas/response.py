"""Public survey (respondent) and response-management (owner) API models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from ..domain.enums import QualityStatus, ResponseChannel, ReviewStatus, WaveType
from .common import APIModel, InputModel

Availability = Literal["OPEN", "PAUSED", "CLOSED", "NOT_STARTED", "FULL"]

MAX_ANSWER_KEYS = 400


# ------------------------------------------------------------------ public
class PublicSurveyOut(BaseModel):
    public_id: str
    title: str
    language: str
    availability: Availability
    version: int | None = None
    #: Respondent-safe projection of the published document (no scoring keys, no internal ids).
    doc: dict[str, Any] | None = None
    #: Signed session token (only when the survey is open).
    session: str | None = None
    ai_followup: bool = False
    is_demo: bool = False
    #: Store invitation the link carried: ``{state, store?, product?}``; state is one of
    #: valid | used | expired | closed | invalid (the form is only sent when valid).
    invitation: dict[str, str | None] | None = None
    #: Branch / kiosk the link names (``?loc=``): ``{code, name}`` when the code is known and active.
    location: dict[str, str] | None = None


class SubmissionIn(InputModel):
    session: str = Field(min_length=20, max_length=2000)
    answers: dict[str, Any] = Field(default_factory=dict)
    other_texts: dict[str, str] = Field(default_factory=dict)
    #: question_key → the respondent's answer to the AI follow-up issued for that question.
    followups: dict[str, str] = Field(default_factory=dict)
    respondent_code: str | None = Field(default=None, max_length=40)
    respondent_name: str | None = Field(default=None, max_length=200)
    respondent_email: EmailStr | None = None
    #: Random id stored in the respondent's browser (flags repeats; never identifies anyone).
    client_id: str | None = Field(default=None, max_length=64)
    channel: Literal["LINK", "QR", "EMBED", "KIOSK"] = "LINK"
    locale: str | None = Field(default=None, max_length=8)
    #: Single-use store invitation token (``?inv=``); the response is then linked to the order/product.
    invitation: str | None = Field(default=None, min_length=8, max_length=64)
    #: Branch / kiosk code from the link (``?loc=``); unknown codes are ignored.
    location: str | None = Field(default=None, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("answers", "other_texts", "followups")
    @classmethod
    def _bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > MAX_ANSWER_KEYS:
            raise ValueError("too many answers")
        return value

    @field_validator("other_texts", "followups")
    @classmethod
    def _short_texts(cls, value: dict[str, str]) -> dict[str, str]:
        return {k: v[:2000] for k, v in value.items()}

    @field_validator("respondent_email", mode="before")
    @classmethod
    def _blank_email(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value


class SubmissionOut(BaseModel):
    response_id: uuid.UUID
    status: Literal["COMPLETED"] = "COMPLETED"


class FollowupIn(InputModel):
    session: str = Field(min_length=20, max_length=2000)
    question_key: str = Field(min_length=1, max_length=60)
    answer: Any = None
    other_text: str | None = Field(default=None, max_length=500)


class FollowupOut(BaseModel):
    ask: bool
    question: str = ""


# ------------------------------------------------------------------- owner
class ResponseSummary(APIModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    survey_title: str
    version_number: int
    wave_type: WaveType | None = None
    respondent_label: str | None = None
    completed_at: datetime | None
    duration_seconds: int | None
    channel: ResponseChannel
    device: str
    locale: str
    answered_count: int
    quality_score: int
    quality_status: QualityStatus
    quality_flags: list[dict[str, Any]]
    review_status: ReviewStatus
    is_demo: bool
    created_at: datetime


class ResponseCounts(BaseModel):
    total: int = 0
    valid: int = 0
    suspicious: int = 0
    low_quality: int = 0
    excluded: int = 0
    kept: int = 0


class ResponsePage(BaseModel):
    items: list[ResponseSummary]
    total: int
    limit: int
    offset: int
    counts: ResponseCounts


class AnswerOut(BaseModel):
    question_key: str
    question_text: str
    question_type: str
    section_title: str = ""
    row_key: str | None = None
    row_text: str | None = None
    value: Any
    display: str
    other_text: str | None = None
    is_followup: bool = False
    followup_prompt: str | None = None


class ResponseDetail(ResponseSummary):
    answers: list[AnswerOut]
    respondent_name: str | None = None
    respondent_email: str | None = None


class ResponseReviewIn(InputModel):
    review_status: ReviewStatus
