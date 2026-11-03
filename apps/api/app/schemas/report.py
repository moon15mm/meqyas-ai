"""Phase 7 API models: reports and their versions."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from ..domain.enums import ReportTone, ReportType
from .common import APIModel, InputModel


class ReportCreateIn(InputModel):
    report_type: ReportType
    tone: ReportTone = ReportTone.FORMAL
    #: None → the language of the project's surveys.
    language: Literal["ar", "en"] | None = None
    title: str = Field(default="", max_length=300)
    audience: str = Field(default="", max_length=200)
    #: False → narrative sections are assembled from computed insights (no AI call).
    use_ai: bool = True


class ReportRegenerateIn(InputModel):
    tone: ReportTone | None = None
    audience: str | None = Field(default=None, max_length=200)
    use_ai: bool = True


class SectionPatch(InputModel):
    key: str = Field(min_length=1, max_length=40)
    hidden: bool | None = None
    paragraphs: list[str] | None = Field(default=None, max_length=20)
    bullets: list[str] | None = Field(default=None, max_length=30)


class ReportEditIn(InputModel):
    title: str | None = Field(default=None, max_length=300)
    sections: list[SectionPatch] = Field(default_factory=list, max_length=40)


class ReportSummaryOut(APIModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_title: str
    report_type: ReportType
    tone: ReportTone
    language: str
    title: str
    audience: str
    current_version: int
    created_at: datetime
    updated_at: datetime


class ReportVersionOut(APIModel):
    version_number: int
    reason: str
    created_at: datetime
    content: dict[str, Any]


class ReportOut(ReportSummaryOut):
    version: ReportVersionOut


class ReportVersionMetaOut(APIModel):
    version_number: int
    reason: str
    created_at: datetime
    created_by: str | None
    ai_used: bool
    data_generated_at: str | None
    responses: int | None
