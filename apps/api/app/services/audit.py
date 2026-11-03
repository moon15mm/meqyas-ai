"""Audit log writer. Never put PII (emails, answers, tokens) in ``meta``."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import keyed_hash
from ..models import AuditLog


def audit(
    session: AsyncSession,
    *,
    action: str,
    organization_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    meta: dict[str, Any] | None = None,
    request_meta: dict[str, str | None] | None = None,
) -> None:
    ip = (request_meta or {}).get("ip")
    session.add(
        AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta or {},
            ip_hash=keyed_hash(ip, purpose="audit-ip") if ip else None,
            user_agent=(request_meta or {}).get("user_agent"),
        )
    )
