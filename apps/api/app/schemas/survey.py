from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from ..domain.enums import SurveyStatus, VersionStatus, WaveType
from ..domain.survey.document import SurveyDoc
from .common import APIModel, InputModel


class VersionMeta(APIModel):
    id: uuid.UUID
    version_number: int
    status: VersionStatus
    published_at: datetime | None
    updated_at: datetime


class SurveyMeta(APIModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_title: str
    wave_id: uuid.UUID | None
    wave_type: WaveType | None
    wave_name: str | None
    title: str
    description: str
    status: SurveyStatus
    public_id: str
    language: str
    ai_generated: bool
    is_demo: bool
    question_count: int
    current_version: VersionMeta | None
    published_version_number: int | None
    has_unpublished_changes: bool
    response_count: int = 0
    last_response_at: datetime | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    response_limit: int | None = None
    created_at: datetime
    updated_at: datetime


class LogicIssueOut(APIModel):
    rule_index: int
    rule_id: str | None
    code: str
    message: str


class ReviewIssue(APIModel):
    id: str
    question_key: str
    type: str
    severity: Literal["LOW", "MEDIUM", "HIGH"]
    problem: str
    reason: str
    #: REWRITE replaces the text, OPTIONS the options, REMOVE deletes the item, NONE = manual edit only.
    fix: Literal["REWRITE", "OPTIONS", "REMOVE", "NONE"] = "REWRITE"
    suggestion: str = ""
    suggested_options: list[str] = Field(default_factory=list)
    status: Literal["open", "accepted", "rejected", "stale"] = "open"
    question_text: str = ""


class ReviewOut(APIModel):
    ran_at: datetime | None = None
    overall_comment: str = ""
    issues: list[ReviewIssue] = Field(default_factory=list)


class SurveyDetail(APIModel):
    survey: SurveyMeta
    doc: SurveyDoc
    logic_issues: list[LogicIssueOut]
    #: Unfinished items that block publishing ({code, question_key}).
    completeness: list[dict[str, str]] = []
    quality: dict[str, Any]
    review: ReviewOut


class SurveyCreate(InputModel):
    title: str = Field(min_length=1, max_length=300)
    wave_id: uuid.UUID | None = None
    language: Literal["ar", "en"] | None = None


class SurveyGenerate(InputModel):
    wave_id: uuid.UUID | None = None
    question_count: int | None = Field(default=None, ge=3, le=60)
    include_open_questions: bool = True
    include_profile_questions: bool = True
    extra_instructions: str | None = Field(default=None, max_length=1000)


class SurveyUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    wave_id: uuid.UUID | None = None
    #: Collection window and cap (null clears them).
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    response_limit: int | None = Field(default=None, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def _window(self) -> SurveyUpdate:
        if self.opens_at and self.closes_at and self.closes_at <= self.opens_at:
            raise ValueError("closes_at must be after opens_at")
        return self


class DraftIn(InputModel):
    doc: SurveyDoc


class ReviewAction(InputModel):
    action: Literal["accept", "reject"]


SurveyAction = Literal["publish", "pause", "resume", "close", "reopen", "archive", "discard_changes"]
