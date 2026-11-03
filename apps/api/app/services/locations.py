"""Physical locations (CX.md §2): branches, kiosks and counters.

A location puts a project's survey on a QR code (``/s/<id>?loc=<code>``) or on a tablet in
kiosk mode (``&kiosk=1``); POS systems can send the same code with each transaction. The
location travels with the response in its metadata, so every result can be split by branch.
Unknown or paused codes are ignored rather than rejected: a printed QR code keeps working
(as a plain link) even after its branch is removed.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.config import get_settings
from ..core.errors import Conflict, Unprocessable
from ..domain.enums import LocationKind
from ..domain.permissions import Permission
from ..models import Project, StoreLocation, Survey
from .audit import audit
from .projects import get_owned

CODE_RE = re.compile(r"^[A-Za-z0-9_-]{1,24}$")


def location_meta(loc: StoreLocation) -> dict[str, Any]:
    """What a response keeps about the location (a snapshot: renaming a branch later does not rewrite history)."""
    return {"id": str(loc.id), "code": loc.code, "name": loc.name, "kind": loc.kind.value, "city": loc.city}


def survey_links(survey: Survey, loc: StoreLocation) -> dict[str, str]:
    base = f"{get_settings().web_base_url.rstrip('/')}/s/{survey.public_id}?loc={loc.code}"
    return {"qr": f"{base}&c=qr", "kiosk": f"{base}&kiosk=1"}


async def find_active(session: AsyncSession, project_id: uuid.UUID, code: str | None) -> StoreLocation | None:
    if not code or not CODE_RE.match(code):
        return None
    return await session.scalar(
        select(StoreLocation).where(
            StoreLocation.project_id == project_id,
            func.lower(StoreLocation.code) == code.lower(),
            StoreLocation.is_active.is_(True),
        )
    )


async def list_locations(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[StoreLocation]:
    ctx.require(Permission.PROJECT_READ)
    project = await get_owned(session, Project, project_id, ctx)
    rows = await session.scalars(
        select(StoreLocation).where(StoreLocation.project_id == project.id).order_by(StoreLocation.created_at)
    )
    return list(rows.all())


async def _next_code(session: AsyncSession, project_id: uuid.UUID) -> str:
    taken = {
        c.upper()
        for c in (await session.scalars(select(StoreLocation.code).where(StoreLocation.project_id == project_id))).all()
    }
    n = len(taken) + 1
    while f"B{n:02d}" in taken:
        n += 1
    return f"B{n:02d}"


async def create_location(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: dict[str, Any]
) -> StoreLocation:
    ctx.require(Permission.PROJECT_WRITE)
    project = await get_owned(session, Project, project_id, ctx)
    code = (data.get("code") or "").strip() or await _next_code(session, project.id)
    if not CODE_RE.match(code):
        raise Unprocessable("The code may contain only letters, digits, - and _", code="invalid_location_code")
    exists = await session.scalar(
        select(StoreLocation.id).where(
            StoreLocation.project_id == project.id, func.lower(StoreLocation.code) == code.lower()
        )
    )
    if exists:
        raise Conflict("Another location already uses this code", code="location_code_taken")
    loc = StoreLocation(
        organization_id=ctx.organization_id,
        project_id=project.id,
        code=code,
        name=data["name"].strip()[:200],
        city=(data.get("city") or "").strip()[:120],
        kind=LocationKind(data.get("kind") or LocationKind.BRANCH),
    )
    session.add(loc)
    await session.flush()  # the id is assigned on flush
    audit(
        session,
        action="location.create",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="store_location",
        entity_id=loc.id,
    )
    await session.commit()
    await session.refresh(loc)
    return loc


async def update_location(
    session: AsyncSession, ctx: OrgContext, location_id: uuid.UUID, data: dict[str, Any]
) -> StoreLocation:
    ctx.require(Permission.PROJECT_WRITE)
    loc = await get_owned(session, StoreLocation, location_id, ctx)
    if data.get("name") is not None:
        loc.name = data["name"].strip()[:200]
    if data.get("city") is not None:
        loc.city = data["city"].strip()[:120]
    if data.get("kind") is not None:
        loc.kind = LocationKind(data["kind"])
    if data.get("is_active") is not None:
        loc.is_active = bool(data["is_active"])
    await session.commit()
    await session.refresh(loc)
    return loc


async def delete_location(session: AsyncSession, ctx: OrgContext, location_id: uuid.UUID) -> None:
    ctx.require(Permission.PROJECT_WRITE)
    loc = await get_owned(session, StoreLocation, location_id, ctx)
    audit(
        session,
        action="location.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="store_location",
        entity_id=loc.id,
    )
    await session.delete(loc)
    await session.commit()
