"""Phase 8 contract: Theory of Change drafted from the project's measurement plan."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Language = Literal["ar", "en"]


class TocIndicatorRef(BaseModel):
    code: str
    name: str
    dimension: str = ""


class TocInput(BaseModel):
    language: Language = "ar"
    project_title: str = ""
    measurement_type: str = ""
    target_population: str = ""
    purpose: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)
    objectives: list[str] = Field(default_factory=list, max_length=12)
    dimensions: list[str] = Field(default_factory=list, max_length=16)
    indicators: list[TocIndicatorRef] = Field(default_factory=list, max_length=40)
    waves: list[str] = Field(default_factory=list, max_length=8)
    notes: str = Field(default="", max_length=1500)


def _texts(value: object) -> object:
    """Accept ["…"] or [{"text": "…"}] — models use both."""
    if isinstance(value, list):
        return [v.get("text", "") if isinstance(v, dict) else v for v in value]
    return value


class TocOutcome(BaseModel):
    text: str
    indicator_codes: list[str] = Field(default_factory=list)

    @field_validator("indicator_codes", mode="before")
    @classmethod
    def _codes(cls, value: object) -> object:
        # "IND-01, IND-02" as one string, or inside a list.
        items = [value] if isinstance(value, str) else value if isinstance(value, list) else None
        if items is None:
            return value
        return [c.strip() for item in items for c in str(item).replace("،", ",").split(",") if c.strip()]


class TocOutput(BaseModel):
    inputs: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    short_term_outcomes: list[TocOutcome] = Field(default_factory=list)
    medium_term_outcomes: list[TocOutcome] = Field(default_factory=list)
    long_term_impact: list[TocOutcome] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)

    _plain = field_validator("inputs", "activities", "outputs", "assumptions", "risks", mode="before")(
        classmethod(lambda cls, v: _texts(v))
    )

    @field_validator("short_term_outcomes", "medium_term_outcomes", "long_term_impact", mode="before")
    @classmethod
    def _outcomes(cls, value: object) -> object:
        if isinstance(value, list):
            return [{"text": v} if isinstance(v, str) else v for v in value]
        return value
