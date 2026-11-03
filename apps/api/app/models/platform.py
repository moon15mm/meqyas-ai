"""Cross-cutting platform tables: AI run log and audit log."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, UUIDPk, str_enum
from ..domain.enums import AIRunStatus


class AIRun(UUIDPk, CreatedAt, Base):
    """One row per agent execution. Never stores prompts, outputs or respondent data."""

    __tablename__ = "ai_runs"

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    agent: Mapped[str] = mapped_column(String(80), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[AIRunStatus] = mapped_column(str_enum(AIRunStatus, 16), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(String(300))
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID | None] = mapped_column()

    __table_args__ = (Index("ix_ai_runs_org_created", "organization_id", "created_at"),)


class AuditLog(UUIDPk, CreatedAt, Base):
    __tablename__ = "audit_logs"

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID | None] = mapped_column()
    meta: Mapped[dict[str, Any]] = mapped_column(
        "metadata", nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))

    __table_args__ = (Index("ix_audit_logs_org_created", "organization_id", "created_at"),)
