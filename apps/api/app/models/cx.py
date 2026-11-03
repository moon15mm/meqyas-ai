"""Customer experience (CX.md): physical locations and closed-loop follow-up cases.

A location (branch, kiosk, counter) gives a project's survey a QR code and a kiosk link;
responses carry the location in their metadata. A case is opened when a customer gives a
low score so the business can follow up; the customer's contact details exist only inside
the case, encrypted, and only when the customer asked to be contacted.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, OrgScoped, Timestamped, UUIDPk, str_enum
from ..domain.enums import CaseReason, CaseStatus, LocationKind


class StoreLocation(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "store_locations"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Short code used in links (?loc=) and by POS systems; unique per project.
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    kind: Mapped[LocationKind] = mapped_column(str_enum(LocationKind, 16), nullable=False, default=LocationKind.BRANCH)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (UniqueConstraint("project_id", "code"),)


class CxCase(UUIDPk, OrgScoped, Timestamped, Base):
    __tablename__ = "cx_cases"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    response_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("responses.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("store_locations.id", ondelete="SET NULL"))
    reason: Mapped[CaseReason] = mapped_column(str_enum(CaseReason, 20), nullable=False)
    #: The score that opened the case and its type (NPS | CSAT | CES).
    score: Mapped[float] = mapped_column(Float, nullable=False)
    score_type: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[CaseStatus] = mapped_column(str_enum(CaseStatus, 16), nullable=False, default=CaseStatus.OPEN)
    contact_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Encrypted JSON {phone?, email?}; cleared as soon as the case is resolved.
    contact_encrypted: Mapped[str | None] = mapped_column(Text)
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
