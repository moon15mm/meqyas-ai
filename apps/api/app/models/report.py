"""Phase 7: reports. A report is a sequence of immutable versions; each version keeps
the rendered content (sections) and the data snapshot it was built from, so any version
can be re-read later with exactly the numbers it was written with (REPORTS.md)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, CreatedAt, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import ReportTone, ReportType

_EMPTY_JSON = text("'{}'::jsonb")


class Report(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "reports"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    report_type: Mapped[ReportType] = mapped_column(str_enum(ReportType, 16), nullable=False)
    tone: Mapped[ReportTone] = mapped_column(str_enum(ReportTone, 16), nullable=False, default=ReportTone.FORMAL)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    audience: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    #: version_number of the version shown by default (the latest one)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ReportVersion(UUIDPk, OrgScoped, CreatedAt, Base):
    __tablename__ = "report_versions"

    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: "generated" | "refreshed" | "edited"
    reason: Mapped[str] = mapped_column(String(16), nullable=False, default="generated")
    content: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    data_snapshot: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=_EMPTY_JSON)
    ai_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_runs.id", ondelete="SET NULL"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (UniqueConstraint("report_id", "version_number"),)
