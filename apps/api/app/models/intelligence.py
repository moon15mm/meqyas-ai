"""Phase 6: text analytics (sentiment, themes, keywords), evidence-linked insights and
recommendations. Model outputs are stored with the ai_run that produced them; numbers in
insights live in their ``evidence`` objects, computed by the platform (ANALYTICS.md §8)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import (
    Confidence,
    InsightKind,
    InsightStatus,
    Priority,
    RecommendationStatus,
    SentimentLabel,
    Severity,
    ThemeCategory,
)

_EMPTY_JSON = text("'{}'::jsonb")
_EMPTY_LIST = text("'[]'::jsonb")


class TextAnalysis(UUIDPk, OrgScoped, Timestamped, Base):
    """Latest analysis of one open question across the project's surveys."""

    __tablename__ = "text_analyses"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    question_key: Mapped[str] = mapped_column(String(60), nullable=False)
    answers_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answers_analyzed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    keywords: Mapped[list[dict[str, Any]]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    #: AI parts that ran: {"sentiment": bool, "themes": bool}; errors are reported per part.
    parts: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (UniqueConstraint("project_id", "question_key"),)


class AnswerSentiment(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "answer_sentiments"

    answer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), unique=True)
    label: Mapped[SentimentLabel] = mapped_column(str_enum(SentimentLabel, 16), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class Theme(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "themes"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    question_key: Mapped[str] = mapped_column(String(60), nullable=False)
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[ThemeCategory] = mapped_column(str_enum(ThemeCategory, 16), nullable=False)
    sentiment: Mapped[SentimentLabel] = mapped_column(str_enum(SentimentLabel, 16), nullable=False)
    keywords: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    #: Counted from the answer assignments (never stated by the model).
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_runs.id", ondelete="SET NULL"))

    __table_args__ = (Index("ix_themes_project_question", "project_id", "question_key"),)


class AnswerTheme(OrgScoped, Base):
    __tablename__ = "answer_themes"

    answer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), primary_key=True)
    theme_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("themes.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Insight(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "insights"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[InsightKind] = mapped_column(str_enum(InsightKind, 20), nullable=False)
    #: Stable identity across regenerations (kind + subject): keeps pinned/dismissed decisions.
    fingerprint: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[Severity] = mapped_column(str_enum(Severity, 16), nullable=False)
    confidence: Mapped[Confidence] = mapped_column(str_enum(Confidence, 16), nullable=False)
    evidence: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    status: Mapped[InsightStatus] = mapped_column(
        str_enum(InsightStatus, 16), nullable=False, default=InsightStatus.NEW
    )
    #: False once a regeneration no longer finds it in the data (kept for history while pinned).
    current: Mapped[bool] = mapped_column(nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("project_id", "fingerprint"),)


class Recommendation(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "recommendations"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    insight_ids: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    problem: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)
    possible_cause: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected_outcome: Mapped[str] = mapped_column(Text, nullable=False, default="")
    priority: Mapped[Priority] = mapped_column(str_enum(Priority, 16), nullable=False, default=Priority.MEDIUM)
    confidence: Mapped[Confidence] = mapped_column(str_enum(Confidence, 16), nullable=False, default=Confidence.MEDIUM)
    owner: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    timeframe: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    due_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[RecommendationStatus] = mapped_column(
        str_enum(RecommendationStatus, 16), nullable=False, default=RecommendationStatus.PROPOSED
    )
    #: "AI" (RecommendationAgent) or "MANUAL"
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="MANUAL")
    ai_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_runs.id", ondelete="SET NULL"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
