"""CLI: platform administrators — the people who manage subscribers, plans and gifts
(SUBSCRIPTIONS.md §5, GIFTS.md). There is no self-registration, so the first administrator is
created here.

    pnpm admin create-admin someone@example.com "Full Name"   # a new account; prints its activation link
    pnpm admin grant someone@example.com                      # an existing account becomes administrator
    pnpm admin revoke someone@example.com
    pnpm admin list
    pnpm admin link someone@example.com                       # a new activation / password recovery link

(or ``uv run --directory apps/api python -m app.admin …``).
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from .db.session import dispose_engine, get_sessionmaker
from .domain.subscription import UNLIMITED_PLAN
from .models import User
from .services import accounts, subscriptions
from .services.audit import audit
from .services.organizations import create_organization

USAGE = """usage:
  python -m app.admin create-admin <email> <full name>   new administrator account (prints its activation link)
  python -m app.admin grant|revoke <email>               platform administrator role of an existing account
  python -m app.admin list
  python -m app.admin link <email>                       new activation link, or password recovery link"""


async def _set(email: str, value: bool) -> int:
    async with get_sessionmaker()() as session:
        user = await accounts.find_user_by_email(session, email)
        if user is None:
            print(f'no account with the e-mail {email} — create it with: create-admin {email} "Full Name"')
            return 1
        user.is_superuser = value
        audit(
            session,
            action="platform_admin.grant" if value else "platform_admin.revoke",
            entity_type="user",
            entity_id=user.id,
        )
        await session.commit()
        print(f"{email}: platform admin = {value}")
        return 0


async def _list() -> int:
    async with get_sessionmaker()() as session:
        emails = (
            await session.scalars(select(User.email).where(User.is_superuser.is_(True)).order_by(User.email))
        ).all()
    print("\n".join(emails) if emails else "no platform admins")
    return 0


async def _create_admin(email: str, name: str) -> int:
    async with get_sessionmaker()() as session:
        await subscriptions.ensure_default_plans(session)
        provided = await accounts.provide_user(session, email=email, full_name=name, locale="ar")
        if not provided.created:
            print(f"{email} already has an account — use: grant {email}   (and: link {email} for a sign-in link)")
            return 1
        user = provided.user
        user.is_superuser = True
        org = await create_organization(session, owner=user, name=accounts.default_workspace_name(user.full_name, "ar"))
        plan = await subscriptions.get_plan(session, UNLIMITED_PLAN)
        await subscriptions.create(session, org, plan, days=None, start_now=False)
        link, expires = await accounts.activation_link(session, user)
        audit(session, action="platform_admin.create", entity_type="user", entity_id=user.id)
        await session.commit()
    print(f"{email}: platform administrator created.")
    print(f"Open this link to choose the password (single use, valid until {expires:%Y-%m-%d}):\n{link}")
    return 0


async def _link(email: str) -> int:
    async with get_sessionmaker()() as session:
        user = await accounts.find_user_by_email(session, email)
        if user is None:
            print(f"no account with the e-mail {email}")
            return 1
        if not user.is_active:
            print(f"{email}: the account is disabled")
            return 1
        message = await accounts.access_message(session, user, actor_id=None, timezone=None)
        audit(
            session,
            action="user.access_link",
            entity_type="user",
            entity_id=user.id,
            meta={"kind": message.kind, "by": "cli"},
        )
        await session.commit()
    kind = "activation" if message.kind == "activation" else "password recovery"
    valid = f"{message.expires_at:%Y-%m-%d %H:%M} UTC" if message.expires_at else "—"
    print(f"{email}: {kind} link (single use, valid until {valid}):\n{message.link}")
    return 0


async def main(argv: list[str]) -> int:
    try:
        if len(argv) == 2 and argv[0] in ("grant", "revoke"):
            return await _set(argv[1], argv[0] == "grant")
        if argv == ["list"]:
            return await _list()
        if len(argv) >= 3 and argv[0] == "create-admin":
            return await _create_admin(argv[1], " ".join(argv[2:]))
        if len(argv) == 2 and argv[0] == "link":
            return await _link(argv[1])
        print(USAGE)
        return 2
    finally:
        await dispose_engine()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
