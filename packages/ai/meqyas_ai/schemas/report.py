"""Phase 7 contract: the report writer drafts the narrative sections of a report.

Tables, key figures, methodology and limitations are rendered by the platform; the
model only writes prose around facts it is given, cites them by id, and may only copy
numbers that appear in those facts (grounding check, D-040).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .insight import Fact

Language = Literal["ar", "en"]


class ReportSectionSpec(BaseModel):
    """A narrative section the platform asks the writer to draft."""

    key: str = Field(min_length=1, max_length=40)
    title: str = Field(max_length=120)
    purpose: str = Field(max_length=600)
    max_words: int = Field(default=180, ge=30, le=600)
    #: "paragraphs" — prose; "bullets" — a short list; "mixed" — a lead paragraph then bullets.
    form: Literal["paragraphs", "bullets", "mixed"] = "paragraphs"


class ContextItem(BaseModel):
    """Project context written by the organization (goal, objectives, description)."""

    id: str
    label: str
    text: str = Field(max_length=1500)


class ReportWriterInput(BaseModel):
    language: Language = "ar"
    report_type: str = "EXECUTIVE"
    tone: str = "FORMAL"
    audience: str = Field(default="", max_length=200)
    project_title: str = ""
    measurement_type: str = ""
    target_population: str = ""
    evidence_level: str = "DESCRIPTIVE"
    caveat: str = ""
    context: list[ContextItem] = Field(default_factory=list, max_length=20)
    facts: list[Fact] = Field(default_factory=list, max_length=400)
    sections: list[ReportSectionSpec] = Field(min_length=1, max_length=10)


class ReportSectionOut(BaseModel):
    key: str
    paragraphs: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)

    @field_validator("paragraphs", "bullets", mode="before")
    @classmethod
    def _as_list(cls, value: object) -> object:
        # Models sometimes return one string instead of a list.
        if isinstance(value, str):
            return [p for p in value.split("\n") if p.strip()]
        return value


class ReportWriterOutput(BaseModel):
    sections: list[ReportSectionOut] = Field(default_factory=list)
