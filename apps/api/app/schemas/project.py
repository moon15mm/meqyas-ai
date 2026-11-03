from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import Field

from ..domain.enums import (
    EvidenceLevel,
    IndicatorDirection,
    IndicatorFrequency,
    IndicatorStatus,
    IndicatorType,
    MeasurementDesign,
    MeasurementType,
    OutcomeLevel,
    PlanStatus,
    ProjectStatus,
    Sector,
    WaveStatus,
    WaveType,
)
from .common import APIModel, InputModel


class ProjectTypeOut(APIModel):
    code: MeasurementType
    level: OutcomeLevel
    name_ar: str
    name_en: str
    description_ar: str
    description_en: str
    default_design: MeasurementDesign
    change_oriented: bool
    sort_order: int


class ProjectOut(APIModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    title: str
    description: str
    measurement_type: MeasurementType
    sector: Sector
    target_population: str
    status: ProjectStatus
    is_demo: bool
    starts_on: date | None
    ends_on: date | None
    created_at: datetime
    updated_at: datetime


class ProjectCreate(InputModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=5000)
    measurement_type: MeasurementType
    target_population: str = Field(default="", max_length=300)
    starts_on: date | None = None
    ends_on: date | None = None


class ProjectUpdate(InputModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    target_population: str | None = Field(default=None, max_length=300)
    status: ProjectStatus | None = None
    starts_on: date | None = None
    ends_on: date | None = None


# ----------------------------------------------------------- plan parts
class GoalOut(APIModel):
    id: uuid.UUID
    statement: str
    description: str


class ObjectiveOut(APIModel):
    id: uuid.UUID
    key: str
    title: str
    description: str
    goal_id: uuid.UUID | None
    sort_order: int


class ObjectiveIn(InputModel):
    title: str = Field(min_length=2, max_length=400)
    description: str = Field(default="", max_length=2000)


class ObjectivePatch(InputModel):
    title: str | None = Field(default=None, min_length=2, max_length=400)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = None


class DimensionOut(APIModel):
    id: uuid.UUID
    key: str
    name: str
    description: str
    objective_id: uuid.UUID | None
    sort_order: int


class DimensionIn(InputModel):
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    objective_id: uuid.UUID | None = None
    key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,39}$")


class DimensionPatch(InputModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    objective_id: uuid.UUID | None = None
    sort_order: int | None = None


class IndicatorOut(APIModel):
    id: uuid.UUID
    dimension_id: uuid.UUID | None
    code: str
    name: str
    description: str
    measurement_type: MeasurementType | None
    indicator_type: IndicatorType
    formula: str
    computation: dict[str, Any]
    unit: str
    direction: IndicatorDirection
    target_label: str
    target_value: float | None
    baseline_value: float | None
    current_value: float | None
    source: str
    frequency: IndicatorFrequency
    owner: str
    status: IndicatorStatus
    last_computed_at: datetime | None
    sort_order: int


class IndicatorIn(InputModel):
    name: str = Field(min_length=2, max_length=300)
    description: str = Field(default="", max_length=2000)
    dimension_id: uuid.UUID | None = None
    indicator_type: IndicatorType = IndicatorType.AVERAGE_SCORE
    formula: str = Field(default="", max_length=1000)
    unit: str = Field(default="", max_length=40)
    direction: IndicatorDirection = IndicatorDirection.HIGHER_IS_BETTER
    target_label: str = Field(default="", max_length=120)
    target_value: float | None = None
    frequency: IndicatorFrequency = IndicatorFrequency.PER_WAVE
    owner: str = Field(default="", max_length=200)


class IndicatorPatch(InputModel):
    name: str | None = Field(default=None, min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    dimension_id: uuid.UUID | None = None
    indicator_type: IndicatorType | None = None
    formula: str | None = Field(default=None, max_length=1000)
    unit: str | None = Field(default=None, max_length=40)
    direction: IndicatorDirection | None = None
    target_label: str | None = Field(default=None, max_length=120)
    target_value: float | None = None
    baseline_value: float | None = None
    frequency: IndicatorFrequency | None = None
    owner: str | None = Field(default=None, max_length=200)
    status: IndicatorStatus | None = None
    sort_order: int | None = None


class WaveOut(APIModel):
    id: uuid.UUID
    wave_type: WaveType
    name: str
    timing: str
    sort_order: int
    planned_date: date | None
    offset_days: int | None
    status: WaveStatus


class WavePatch(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    timing: str | None = Field(default=None, max_length=200)
    planned_date: date | None = None
    status: WaveStatus | None = None


class ProjectPlanOut(APIModel):
    """The accepted, normalized measurement plan of a project."""

    plan_id: uuid.UUID | None
    status: PlanStatus | None
    measurement_type: MeasurementType
    recommended_design: MeasurementDesign | None
    design_rationale: str
    evidence_level: EvidenceLevel | None
    purpose: str
    target_population: str
    baseline_required: bool
    post_measurement_required: bool
    follow_up_recommended: bool
    follow_up_days: int | None
    recommended_questions_count: int | None
    estimated_completion_minutes: int | None
    methodology_notes: list[str]
    understanding_summary: str
    measurement_type_rationale: str
    source_prompt: str
    goal: GoalOut | None
    objectives: list[ObjectiveOut]
    dimensions: list[DimensionOut]
    indicators: list[IndicatorOut]
    waves: list[WaveOut]


class ProjectOverviewOut(APIModel):
    project: ProjectOut
    plan: ProjectPlanOut
    counts: dict[str, int]
