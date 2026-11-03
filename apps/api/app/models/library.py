"""Phase 8: persisted indicator values and the organization's question bank.

System templates and system question-bank items live in code (``app/domain/library``),
versioned with the platform; the database holds what organizations add themselves.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import QuestionType

_EMPTY_JSON = text("'{}'::jsonb")
_EMPTY_LIST = text("'[]'::jsonb")


class IndicatorValue(UUIDPk, OrgScoped, Base):
    """The value of an indicator in one wave, as last computed from the accepted responses."""

    __tablename__ = "indicator_values"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    indicator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("indicators.id", ondelete="CASCADE"), nullable=False, index=True
    )
    wave: Mapped[str] = mapped_column(String(20), nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    n: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: why there is no value: no_data, below_k_anonymity, no_linked_questions, …
    reason: Mapped[str | None] = mapped_column(String(40))
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("indicator_id", "wave"),)


class QuestionBankItem(UUIDPk, OrgScoped, Timestamped, Base):
    """A question an organization saved for reuse (system items are defined in code)."""

    __tablename__ = "question_bank"

    question_type: Mapped[QuestionType] = mapped_column(str_enum(QuestionType, 24), nullable=False)
    text: Mapped[str] = mapped_column(String(1000), nullable=False)
    construct: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    tags: Mapped[list[str]] = mapped_column(nullable=False, default=list, server_default=_EMPTY_LIST)
    #: The question document (type, text, options, scale, settings) without key or lineage.
    question: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
