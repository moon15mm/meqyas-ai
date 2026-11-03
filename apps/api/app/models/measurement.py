"""Projects and the measurement chain: plan → goal → objectives → dimensions →
indicators, plus measurement waves, theory of change and logic model."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import Base, OrgScoped, Timestamped, UUIDPk, str_enum
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

_EMPTY_JSON = text("'{}'::jsonb")
_EMPTY_LIST = text("'[]'::jsonb")


class ProjectType(Base):
    """Reference catalog of measurement types (seeded from meqyas_ai.domain.catalog)."""

    __tablename__ = "project_types"

    code: Mapped[MeasurementType] = mapped_column(str_enum(MeasurementType), primary_key=True)
    level: Mapped[OutcomeLevel] = mapped_column(str_enum(OutcomeLevel), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    description_ar: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    default_design: Mapped[MeasurementDesign] = mapped_column(str_enum(MeasurementDesign), nullable=False)
    change_oriented: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Project(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "projects"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    measurement_type: Mapped[MeasurementType] = mapped_column(
        str_enum(MeasurementType), ForeignKey("project_types.code"), nullable=False
    )
    sector: Mapped[Sector] = mapped_column(str_enum(Sector), nullable=False, default=Sector.EDUCATION)
    target_population: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    status: Mapped[ProjectStatus] = mapped_column(str_enum(ProjectStatus), nullable=False, default=ProjectStatus.ACTIVE)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    settings: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    plan: Mapped[MeasurementPlan | None] = relationship(back_populates="project", lazy="raise", uselist=False)

    __table_args__ = (Index("ix_projects_org_status", "organization_id", "status"),)


class MeasurementPlan(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "measurement_plans"

    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    status: Mapped[PlanStatus] = mapped_column(str_enum(PlanStatus), nullable=False, default=PlanStatus.DRAFT)
    source_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    draft: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    ai_output: Mapped[dict[str, Any] | None] = mapped_column()
    ai_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_runs.id", ondelete="SET NULL"))
    generation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Scalar plan attributes (source of truth after acceptance)
    project_title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    measurement_type: Mapped[MeasurementType] = mapped_column(str_enum(MeasurementType), nullable=False)
    target_population: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recommended_design: Mapped[MeasurementDesign] = mapped_column(str_enum(MeasurementDesign), nullable=False)
    design_rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_level: Mapped[EvidenceLevel] = mapped_column(str_enum(EvidenceLevel), nullable=False)
    baseline_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    post_measurement_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follow_up_recommended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follow_up_days: Mapped[int | None] = mapped_column(Integer)
    recommended_questions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    estimated_completion_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    methodology_notes: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project | None] = relationship(back_populates="plan", lazy="raise")


class Goal(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "goals"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Objective(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "objectives"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    goal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"))
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(400), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Dimension(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "dimensions"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    objective_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("objectives.id", ondelete="SET NULL"))
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    construct: Mapped[str | None] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("project_id", "key"),)


class Indicator(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "indicators"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    dimension_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("dimensions.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    measurement_type: Mapped[MeasurementType | None] = mapped_column(str_enum(MeasurementType))
    indicator_type: Mapped[IndicatorType] = mapped_column(str_enum(IndicatorType), nullable=False)
    formula: Mapped[str] = mapped_column(Text, nullable=False, default="")
    computation: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    unit: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    direction: Mapped[IndicatorDirection] = mapped_column(
        str_enum(IndicatorDirection), nullable=False, default=IndicatorDirection.HIGHER_IS_BETTER
    )
    target_label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    target_value: Mapped[float | None] = mapped_column(Float)
    baseline_value: Mapped[float | None] = mapped_column(Float)
    current_value: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="survey")
    frequency: Mapped[IndicatorFrequency] = mapped_column(
        str_enum(IndicatorFrequency), nullable=False, default=IndicatorFrequency.PER_WAVE
    )
    owner: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[IndicatorStatus] = mapped_column(
        str_enum(IndicatorStatus), nullable=False, default=IndicatorStatus.NOT_STARTED
    )
    last_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("project_id", "code"),)


class MeasurementWave(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "measurement_waves"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    wave_type: Mapped[WaveType] = mapped_column(str_enum(WaveType), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    timing: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    planned_date: Mapped[date | None] = mapped_column(Date)
    offset_days: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[WaveStatus] = mapped_column(str_enum(WaveStatus), nullable=False, default=WaveStatus.PLANNED)


class TheoryOfChange(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "theories_of_change"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    inputs: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    activities: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    outputs: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    short_term_outcomes: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    medium_term_outcomes: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    long_term_impact: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    assumptions: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    risks: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    indicator_links: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class LogicModel(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "logic_models"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    nodes: Mapped[list[dict[str, Any]]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    edges: Mapped[list[dict[str, Any]]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
