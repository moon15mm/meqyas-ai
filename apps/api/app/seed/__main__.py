"""CLI: ``python -m app.seed`` (pnpm db:seed) — reference data + DEMO DATA (development only).

``python -m app.seed --reset-demo`` removes the demo organization and recreates it.
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import delete

from ..core.config import get_settings
from ..db.session import dispose_engine, get_sessionmaker
from ..models import Organization
from .demo import DEMO_ORG_SLUG, seed_demo
from .reference import seed_reference_data


async def main(reset_demo: bool) -> None:
    settings = get_settings()
    async with get_sessionmaker()() as session:
        await seed_reference_data(session)
        print("reference data: ok")
        if settings.is_production:
            print("production environment: DEMO DATA skipped")
        else:
            if reset_demo:
                await session.execute(delete(Organization).where(Organization.slug == DEMO_ORG_SLUG))
                await session.commit()
                print("demo organization removed")
            await seed_demo(session)
            print("DEMO DATA: ok (login demo@meqyas.example / Demo-Meqyas-2026)")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main(reset_demo="--reset-demo" in sys.argv))
