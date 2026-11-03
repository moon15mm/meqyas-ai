"""Gifts (GIFTS.md): platform administrators prepare trial accounts; recipients activate them.

Admin endpoints require ``users.is_superuser`` (granted with ``python -m app.admin grant``).
The recipient endpoints are public, rate-limited, and only work with the one-time link token.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Request, Response, status

from ...core.rate_limit import client_ip, enforce
from ...schemas.auth import TokenOut
from ...schemas.gift import GiftClaimIn, GiftIn, GiftMessageOut, GiftOut, GiftPreviewOut, GiftResendIn
from ...services import gifts as gift_svc
from ..deps import DB, CurrentUser, request_meta
from .auth import _set_refresh_cookie

router = APIRouter(tags=["gifts"])

GiftToken = Annotated[str, Path(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")]


@router.get("/admin/gifts", response_model=list[GiftOut])
async def list_gifts(user: CurrentUser, session: DB) -> list[GiftOut]:
    return await gift_svc.list_gifts(session, user)


@router.post("/admin/gifts", response_model=GiftMessageOut, status_code=status.HTTP_201_CREATED)
async def create_gift(data: GiftIn, request: Request, user: CurrentUser, session: DB) -> GiftMessageOut:
    return await gift_svc.create_gift(session, user, data, request_meta(request))


@router.post("/admin/gifts/{gift_id}/resend", response_model=GiftMessageOut)
async def resend_gift(
    gift_id: uuid.UUID, data: GiftResendIn, request: Request, user: CurrentUser, session: DB
) -> GiftMessageOut:
    return await gift_svc.resend_gift(session, user, gift_id, send=data.send_email, request_meta=request_meta(request))


@router.post("/admin/gifts/{gift_id}/revoke", response_model=GiftOut)
async def revoke_gift(gift_id: uuid.UUID, request: Request, user: CurrentUser, session: DB) -> GiftOut:
    return await gift_svc.revoke_gift(session, user, gift_id, request_meta(request))


@router.get("/gifts/{token}", response_model=GiftPreviewOut, summary="What a gift link contains (public)")
async def preview_gift(token: GiftToken, request: Request, session: DB) -> GiftPreviewOut:
    await enforce(f"gift-preview:{client_ip(request)}", limit=30, window_s=60)
    return await gift_svc.preview(session, token)


@router.post("/gifts/claim", response_model=TokenOut, summary="Activate a gifted account and sign in (public)")
async def claim_gift(data: GiftClaimIn, request: Request, response: Response, session: DB) -> TokenOut:
    await enforce(f"gift-claim:{client_ip(request)}", limit=10, window_s=60)
    issued = await gift_svc.claim(session, data.token, data.password, data.full_name, request_meta(request))
    _set_refresh_cookie(response, issued)
    return issued.token
