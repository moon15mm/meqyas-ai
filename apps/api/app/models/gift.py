"""Gifts (GIFTS.md): a platform admin prepares a trial account — a workspace with a survey
quota — and a message with a one-time activation link for the recipient."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, Timestamped, UUIDPk, str_enum
from ..domain.enums import GiftStatus


class Gift(UUIDPk, Timestamped, Base):
    __tablename__ = "gifts"

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    #: The gifted workspace; kept as history (NULL) if it is later removed.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    survey_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    trial_days: Mapped[int | None] = mapped_column(Integer)
    #: The account was created by this gift (revoking a pending gift removes it).
    new_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[GiftStatus] = mapped_column(str_enum(GiftStatus, 16), nullable=False, default=GiftStatus.PENDING)
    #: SHA-256 of the one-time activation token (the token itself is never stored).
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
