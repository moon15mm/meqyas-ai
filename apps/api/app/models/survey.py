"""Survey engine tables: surveys → versions (immutable when published) →
sections → questions → options, plus logic rules per version."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import QuestionType, SurveyStatus, VersionStatus

_EMPTY_JSON = text("'{}'::jsonb")


class Survey(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "surveys"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    wave_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("measurement_waves.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[SurveyStatus] = mapped_column(str_enum(SurveyStatus, 16), nullable=False, default=SurveyStatus.DRAFT)
    public_id: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="SET NULL", use_alter=True, name="fk_surveys_current_version")
    )
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="SET NULL", use_alter=True, name="fk_surveys_published_version")
    )
    settings: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response_limit: Mapped[int | None] = mapped_column(Integer)
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (Index("ix_surveys_org_status", "organization_id", "status"),)


class SurveyVersion(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "survey_versions"

    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[VersionStatus] = mapped_column(
        str_enum(VersionStatus, 16), nullable=False, default=VersionStatus.DRAFT
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    introduction: Mapped[str] = mapped_column(Text, nullable=False, default="")
    thank_you_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    settings: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    review: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (UniqueConstraint("survey_id", "version_number"),)


class SurveySection(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "survey_sections"

    survey_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    randomize_questions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Question(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "questions"

    survey_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("survey_sections.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    lineage_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    type: Mapped[QuestionType] = mapped_column(str_enum(QuestionType, 24), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dimension_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("dimensions.id", ondelete="SET NULL"), index=True)
    indicator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("indicators.id", ondelete="SET NULL"), index=True)
    scale: Mapped[dict[str, Any] | None] = mapped_column()
    validation: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    settings: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    scoring: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("survey_version_id", "key"),)


class QuestionOption(UUIDPk, OrgScoped, Base):
    __tablename__ = "question_options"

    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    value: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_other: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class LogicRule(UUIDPk, OrgScoped, Base):
    __tablename__ = "logic_rules"

    survey_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE"), index=True
    )
    rule_key: Mapped[str | None] = mapped_column(String(60))
    rule_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_key: Mapped[str | None] = mapped_column(String(60))
    target_key: Mapped[str | None] = mapped_column(String(60))
    condition: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    limit: Mapped[int | None] = mapped_column("quota_limit", Integer)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
