"""Response collection: respondents (pseudonymous panel per project) →
responses (one per submission, bound to the exact survey version) → answers
(one row per question / matrix row, with numeric/text projections)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, OrgScoped, UUIDPk, str_enum
from ..domain.enums import QualityStatus, ResponseChannel, ResponseStatus, ReviewStatus

_EMPTY_JSON = text("'{}'::jsonb")
_EMPTY_LIST = text("'[]'::jsonb")


class Respondent(UUIDPk, OrgScoped, CreatedAt, Base):
    """A person across waves of one project. Identity is never stored in clear:
    the pseudonymous code is kept only as a keyed hash; names/emails are encrypted."""

    __tablename__ = "respondents"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str | None] = mapped_column(String(64))
    email_hash: Mapped[str | None] = mapped_column(String(64))
    #: Short display id derived from the hash (e.g. "R-7F3K2A"); reveals nothing about the person.
    label: Mapped[str] = mapped_column(String(16), nullable=False)
    name_encrypted: Mapped[str | None] = mapped_column(Text)
    email_encrypted: Mapped[str | None] = mapped_column(Text)
    attributes: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("project_id", "code_hash"),
        UniqueConstraint("project_id", "email_hash"),
    )


class Response(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "responses"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    # (survey_id, created_at) index below also serves survey_id lookups
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"))
    survey_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE"), index=True
    )
    wave_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("measurement_waves.id", ondelete="SET NULL"))
    respondent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("respondents.id", ondelete="SET NULL"), index=True
    )
    #: Survey session (signed token id) — one response per session makes submission idempotent.
    session_id: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[ResponseStatus] = mapped_column(
        str_enum(ResponseStatus, 16), nullable=False, default=ResponseStatus.COMPLETED
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    channel: Mapped[ResponseChannel] = mapped_column(
        str_enum(ResponseChannel, 16), nullable=False, default=ResponseChannel.LINK
    )
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    device: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    #: Allow-listed, non-identifying context only (never IP, never full user agent).
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", nullable=False, default=dict, server_default=_EMPTY_JSON)
    #: Keyed hash of the browser's random install id: flags repeats without identifying anyone.
    dedupe_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    answered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quality_score: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    quality_status: Mapped[QualityStatus] = mapped_column(
        str_enum(QualityStatus, 16), nullable=False, default=QualityStatus.VALID
    )
    quality_flags: Mapped[list[dict[str, Any]]] = mapped_column(
        nullable=False, default=list, server_default=_EMPTY_LIST
    )
    review_status: Mapped[ReviewStatus] = mapped_column(
        str_enum(ReviewStatus, 16), nullable=False, default=ReviewStatus.NONE
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Store invitation this response answers (one response per invitation).
    invitation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("survey_invitations.id", ondelete="SET NULL"), unique=True
    )

    __table_args__ = (
        UniqueConstraint("survey_id", "session_id"),
        Index("ix_responses_survey_created", "survey_id", "created_at"),
        Index("ix_responses_org_quality", "organization_id", "quality_status"),
    )


class Answer(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "answers"

    response_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("responses.id", ondelete="CASCADE"), index=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"))
    question_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("questions.id", ondelete="SET NULL"))
    question_key: Mapped[str] = mapped_column(String(60), nullable=False)
    #: Same question across versions (and pre/post waves copied verbatim share the key).
    lineage_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    row_key: Mapped[str | None] = mapped_column(String(60))
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    numeric_value: Mapped[float | None] = mapped_column(Float)
    text_value: Mapped[str | None] = mapped_column(Text)
    is_followup: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    followup_prompt: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_answers_survey_question", "survey_id", "question_key"),)
