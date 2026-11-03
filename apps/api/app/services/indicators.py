"""Indicator values (Phase 8, MEASUREMENT_ENGINE.md §6).

The analytics engine computes every indicator live from the accepted responses; this
module persists the result — baseline, current value and status on the indicator, and
the value of each wave in ``indicator_values`` — so lists, the Theory of Change and the
portfolio read them without recomputing a dataset. Values refresh whenever insights are
generated (reports do that too) or on demand.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..domain.enums import IndicatorStatus, IndicatorType
from ..domain.permissions import Permission
from ..models import Indicator, IndicatorValue, Project
from . import analytics
from .projects import get_owned

_CHANGE_LIKE = {IndicatorType.CHANGE.value, IndicatorType.EFFECT_SIZE.value}


async def persist(session: AsyncSession, data: analytics.Loaded) -> None:
    """Write the computed values of every indicator (does not commit)."""
    results = {r["id"]: r for r in data.summary["indicators"]}
    now = datetime.now(UTC)
    rows = {
        (v.indicator_id, v.wave): v
        for v in (
            await session.scalars(select(IndicatorValue).where(IndicatorValue.project_id == data.project.id))
        ).all()
    }
    seen: set[tuple[uuid.UUID, str]] = set()
    for ind in data.inds:
        result = results.get(str(ind.id))
        if result is None:
            continue
        ind.current_value = result["current_value"]
        # A change or effect size has no baseline of its own (it is computed between two waves).
        ind.baseline_value = None if result["indicator_type"] in _CHANGE_LIKE else result["baseline_value"]
        ind.status = IndicatorStatus(result["status"])
        ind.last_computed_at = now
        for wave in result["waves"]:
            key = (ind.id, wave["wave"])
            seen.add(key)
            row = rows.get(key)
            if row is None:
                row = IndicatorValue(
                    organization_id=data.project.organization_id,
                    project_id=data.project.id,
                    indicator_id=ind.id,
                    wave=wave["wave"],
                )
                session.add(row)
            row.value, row.n, row.reason, row.computed_at = wave["value"], wave["n"], wave["reason"], now
    for key, row in rows.items():
        if key not in seen:
            await session.delete(row)


async def recompute(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[Indicator]:
    ctx.require(Permission.AI_ANALYZE)
    data = await analytics.load_project(session, ctx, project_id)
    await persist(session, data)
    await session.commit()
    return list(data.inds)


async def wave_values(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[dict[str, Any]]:
    ctx.require(Permission.ANALYTICS_READ)
    project = await get_owned(session, Project, project_id, ctx)
    rows = sorted(
        (await session.scalars(select(IndicatorValue).where(IndicatorValue.project_id == project.id))).all(),
        key=lambda r: analytics._wave_rank(r.wave),  # pre → post → follow-up, rounds in order
    )
    return [
        {
            "indicator_id": r.indicator_id,
            "wave": r.wave,
            "value": r.value,
            "n": r.n,
            "reason": r.reason,
            "computed_at": r.computed_at,
        }
        for r in rows
    ]
