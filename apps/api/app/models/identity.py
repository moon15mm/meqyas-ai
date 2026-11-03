"""Users, organizations, memberships and auth tokens."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import Base, CreatedAt, Timestamped, UUIDPk, str_enum
from ..domain.enums import Role, Sector, TokenPurpose


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[OrganizationMember]] = relationship(
        back_populates="user",
        lazy="raise",
        cascade="all, delete-orphan",
        foreign_keys="OrganizationMember.user_id",
    )

    __table_args__ = (Index("uq_users_email_lower", func.lower(text("email")), unique=True),)


class Organization(UUIDPk, Timestamped, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    sector: Mapped[Sector] = mapped_column(str_enum(Sector), nullable=False, default=Sector.EDUCATION)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ar")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Riyadh")
    settings: Mapped[dict[str, Any]] = mapped_column(nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Limits, trial dates and suspension live on the workspace's subscription (SUBSCRIPTIONS.md).

    members: Mapped[list[OrganizationMember]] = relationship(
        back_populates="organization", lazy="raise", cascade="all, delete-orphan"
    )


class OrganizationMember(UUIDPk, CreatedAt, Base):
    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[Role] = mapped_column(str_enum(Role, 16), nullable=False)
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    organization: Mapped[Organization] = relationship(back_populates="members", lazy="raise")
    user: Mapped[User] = relationship(back_populates="memberships", lazy="raise", foreign_keys=[user_id])

    __table_args__ = (UniqueConstraint("organization_id", "user_id"),)


class RefreshToken(UUIDPk, CreatedAt, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("refresh_tokens.id", ondelete="SET NULL"))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip_hash: Mapped[str | None] = mapped_column(String(64))


class PasswordResetToken(UUIDPk, CreatedAt, Base):
    """One-time links that set a password: «forgot password» or a recovery link (RESET), or the
    first password of an account created by an administrator or an invitation (ACTIVATE).
    Only the SHA-256 of the token is stored."""

    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose: Mapped[TokenPurpose] = mapped_column(
        str_enum(TokenPurpose, 16), nullable=False, default=TokenPurpose.RESET, server_default="RESET"
    )
    #: The administrator who prepared the link (``None`` for «forgot password»).
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
