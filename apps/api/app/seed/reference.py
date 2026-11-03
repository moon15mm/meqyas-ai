"""Reference data that must exist in every environment (idempotent)."""

from __future__ import annotations

from meqyas_ai.domain.catalog import TYPE_CATALOG
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ProjectType
from ..services.subscriptions import ensure_default_plans


async def seed_reference_data(session: AsyncSession) -> None:
    rows = [
        {
            "code": info.code,
            "level": info.level,
            "name_ar": info.name_ar,
            "name_en": info.name_en,
            "description_ar": info.description_ar,
            "description_en": info.description_en,
            "default_design": info.default_design,
            "change_oriented": info.change_oriented,
            "sort_order": info.sort_order,
        }
        for info in TYPE_CATALOG.values()
    ]
    stmt = insert(ProjectType).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ProjectType.code],
        set_={k: stmt.excluded[k] for k in rows[0] if k != "code"},
    )
    await session.execute(stmt)
    # Subscription plans: only the missing defaults (an administrator's edits are never overwritten).
    await ensure_default_plans(session)
    await session.commit()
