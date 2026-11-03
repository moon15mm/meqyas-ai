"""Measurement plan schemas.

``ArchitectOutput`` is what the LLM must produce (validated, repaired if
needed). ``MeasurementPlanDraft`` is the post-processed, rule-checked plan the
platform stores and shows. TypeScript mirror: packages/shared/src/schemas/plan.ts
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from ..domain.enums import (
    EvidenceLevel,
    IndicatorDirection,
    IndicatorFrequency,
    IndicatorType,
    MeasurementDesign,
    MeasurementType,
    OutcomeLevel,
    WaveType,
)


# ------------------------------------------------------------------ helpers
def _text(max_len: int) -> BeforeValidator:
    """Coerce to str, strip, and truncate (cosmetic limits never fail validation)."""

    def f(v: Any) -> Any:
        if v is None:
            return ""
        if isinstance(v, int | float):
            v = str(v)
        if isinstance(v, str):
            v = v.strip()
            return v[:max_len]
        return v

    return BeforeValidator(f)


def _list(max_items: int) -> BeforeValidator:
    def f(v: Any) -> Any:
        if v is None:
            return []
        if isinstance(v, list):
            return v[:max_items]
        return v

    return BeforeValidator(f)


def _enum(aliases: dict[str, str] | None = None) -> BeforeValidator:
    table = aliases or {}

    def f(v: Any) -> Any:
        if isinstance(v, str):
            key = re.sub(r"[\s\-/]+", "_", v.strip()).upper()
            return table.get(key, key)
        return v

    return BeforeValidator(f)


_DESIGN_ALIASES = {
    "PREPOST": "PRE_POST",
    "PRE_AND_POST": "PRE_POST",
    "PRE_POST_FOLLOWUP": "PRE_POST_FOLLOW_UP",
    "PRE_POST_AND_FOLLOW_UP": "PRE_POST_FOLLOW_UP",
    "POST": "POST_ONLY",
    "SINGLE": "POST_ONLY",
    "CROSS_SECTIONAL": "POST_ONLY",
    "LONGITUDINAL": "REPEATED",
    "RETROSPECTIVE": "RETROSPECTIVE_PRE_POST",
}
_TYPE_ALIASES = {"NEEDS": "NEEDS_ASSESSMENT", "PREPOST": "PRE_POST", "PULSE": "EMPLOYEE_PULSE"}
_WAVE_ALIASES = {"PRE": "BASELINE", "FOLLOWUP": "FOLLOW_UP", "AFTER": "POST", "BEFORE": "BASELINE"}
_INDICATOR_ALIASES = {"AVERAGE": "AVERAGE_SCORE", "MEAN": "AVERAGE_SCORE", "PERCENT": "PERCENTAGE"}

Str40 = Annotated[str, _text(40)]
Str120 = Annotated[str, _text(120)]
Str200 = Annotated[str, _text(200)]
Str300 = Annotated[str, _text(300)]
Str600 = Annotated[str, _text(600)]
Str1000 = Annotated[str, _text(1000)]

MType = Annotated[MeasurementType, _enum(_TYPE_ALIASES)]
Design = Annotated[MeasurementDesign, _enum(_DESIGN_ALIASES)]
Wave = Annotated[WaveType, _enum(_WAVE_ALIASES)]
IType = Annotated[IndicatorType, _enum(_INDICATOR_ALIASES)]
Freq = Annotated[IndicatorFrequency, _enum()]
Direction = Annotated[IndicatorDirection, _enum()]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ------------------------------------------------------------------ parts
class PlanObjective(_Model):
    key: Str40 = Field(description="Short id, e.g. o1, o2")
    title: Str300 = Field(description="Objective statement, starting with a verb")
    description: Str1000 = Field(default="", description="Optional detail")


class PlanDimension(_Model):
    key: Str40 = Field(description="snake_case English id, e.g. knowledge, confidence, actual_use")
    name: Str120 = Field(description="Dimension name in the user's language")
    description: Str600 = Field(default="", description="What exactly this dimension captures")
    objective_key: Str40 | None = Field(default=None, description="Key of the objective it serves")


class PlanIndicator(_Model):
    code: Str40 = Field(description="IND-01, IND-02, …")
    name: Str200 = Field(description="Indicator name, measurable")
    description: Str600 = Field(default="", description="How it is measured")
    dimension_key: Str40 = Field(description="Key of the dimension this indicator belongs to")
    indicator_type: IType = Field(description="Computation family")
    unit: Str40 = Field(default="", description="e.g. % , out of 5, count")
    target: Str120 = Field(default="", description="Human-readable target, e.g. ≥ 80% أو 4 من 5")
    target_value: float | None = Field(default=None, description="Numeric target if applicable")
    formula: Str300 = Field(default="", description="Plain-language formula")
    frequency: Freq = Field(default=IndicatorFrequency.PER_WAVE)
    direction: Direction = Field(default=IndicatorDirection.HIGHER_IS_BETTER)


class PlanWave(_Model):
    wave_type: Wave
    name: Str120 = Field(description="Wave label in the user's language")
    timing: Str200 = Field(default="", description="When it happens, in the user's language")
    offset_days: int | None = Field(default=None, description="Days after program end (follow-up)")


# ------------------------------------------------------------------ outputs
class ArchitectOutput(_Model):
    """Contract the Measurement Architect LLM must fulfil."""

    project_title: Str120 = Field(description="Short project title (≤ 80 chars) in the user's language")
    measurement_type: MType = Field(description="Primary measurement type — the LOWEST level answering the need")
    secondary_types: Annotated[list[MType], _list(3)] = Field(
        default_factory=list, description="Up to 3 secondary types also covered"
    )
    target_population: Str200 = Field(description="Who responds, e.g. طالبات المرحلة الثانوية")
    purpose: Str600 = Field(description="Why this measurement is done and how results will be used")
    understanding_summary: Str600 = Field(
        description="1–2 sentences starting with 'فهمنا أنك تريد' (Arabic) or 'We understand you want' (English)"
    )
    measurement_type_rationale: Str1000 = Field(
        description="Why this type — and why not a higher level such as impact, if relevant"
    )
    objectives: Annotated[list[PlanObjective], _list(6)] = Field(min_length=1, description="1–4 objectives")
    dimensions: Annotated[list[PlanDimension], _list(8)] = Field(min_length=2, description="3–6 dimensions")
    indicators: Annotated[list[PlanIndicator], _list(16)] = Field(
        min_length=1, description="1–2 indicators per dimension"
    )
    recommended_design: Design = Field(description="Measurement design")
    design_rationale: Str1000 = Field(description="Why this design fits; what it can and cannot show")
    waves: Annotated[list[PlanWave], _list(5)] = Field(min_length=1, description="Measurement waves in order")
    baseline_required: bool
    post_measurement_required: bool
    follow_up_recommended: bool
    follow_up_days: int | None = Field(default=None, description="Days after program end for follow-up")
    recommended_questions_count: int = Field(description="Total questions per survey (typically 8–25)")
    estimated_completion_minutes: int = Field(description="Minutes to complete one survey")
    methodology_notes: Annotated[list[Annotated[str, _text(500)]], _list(8)] = Field(
        default_factory=list, description="Practical methodological notes (sampling, anonymity, causality…)"
    )
    clarifying_questions: Annotated[list[Annotated[str, _text(300)]], _list(3)] = Field(
        default_factory=list, description="Up to 3 questions to refine the plan if key info is missing"
    )


class MeasurementPlanDraft(ArchitectOutput):
    """The stored, rule-checked plan (AI output or user-edited)."""

    language: Literal["ar", "en"] = "ar"
    evidence_level: EvidenceLevel = EvidenceLevel.DESCRIPTIVE
    outcome_level: OutcomeLevel = OutcomeLevel.REACTION
    rules_applied: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
