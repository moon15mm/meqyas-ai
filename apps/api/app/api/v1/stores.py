"""Store connections (e-commerce integrations) and their public webhook.

Managing connections needs ``integrations.manage`` (admins/owners); everyone in the
project can see their status; invitation links need ``responses.read_raw``. The
webhook is public but every delivery must verify against the connection's secret. Store
integrations must be part of the workspace's plan (SUBSCRIPTIONS.md §3).
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, Request, status

from ...core.errors import AppError
from ...core.rate_limit import client_ip, enforce
from ...domain.enums import InvitationStatus
from ...domain.survey.templates import TEMPLATES
from ...schemas.common import OkOut
from ...schemas.store import (
    IntegrationsCapabilities,
    InvitationOut,
    SecretIn,
    StoreConnectionCreated,
    StoreConnectionIn,
    StoreConnectionOut,
    StoreConnectionUpdate,
    StoreEventOut,
    SurveyFromTemplateIn,
    TestOrderOut,
    WebhookResult,
)
from ...schemas.survey import SurveyDetail
from ...services import stores as svc
from ...services import surveys as survey_svc
from ..deps import DB, Ctx, feature, request_meta

router = APIRouter(tags=["integrations"])

WebhookId = Annotated[str, Path(min_length=8, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")]
Meta = Annotated[dict[str, str | None], Depends(request_meta)]
#: Managing connections needs the «integrations» module in the plan.
GATED = [Depends(feature("integrations"))]


class PayloadTooLarge(AppError):
    status_code = 413
    code = "payload_too_large"


async def _out(session: Any, conn: Any) -> StoreConnectionOut:
    stats = await svc.connection_stats(session, [conn.id])
    return svc.to_out(conn, stats.get(conn.id))


@router.get("/integrations/capabilities", response_model=IntegrationsCapabilities)
async def capabilities(ctx: Ctx) -> IntegrationsCapabilities:
    return IntegrationsCapabilities(
        email_delivery=svc.email_delivery_available(),
        webhook_base_url=svc.webhook_url_base(),
    )


@router.get("/projects/{project_id}/store-connections", response_model=list[StoreConnectionOut], dependencies=GATED)
async def list_connections(project_id: uuid.UUID, ctx: Ctx, session: DB) -> list[StoreConnectionOut]:
    return await svc.list_connections(session, ctx, project_id)


@router.post(
    "/projects/{project_id}/store-connections",
    response_model=StoreConnectionCreated,
    dependencies=GATED,
    status_code=status.HTTP_201_CREATED,
    summary="Connect a store; the secret is returned once",
)
async def create_connection(
    project_id: uuid.UUID, data: StoreConnectionIn, ctx: Ctx, session: DB, meta: Meta
) -> StoreConnectionCreated:
    conn, secret = await svc.create_connection(session, ctx, project_id, data, request_meta=meta)
    out = await _out(session, conn)
    return StoreConnectionCreated(**out.model_dump(), secret=secret)


@router.get("/store-connections/{connection_id}", response_model=StoreConnectionOut, dependencies=GATED)
async def get_connection(connection_id: uuid.UUID, ctx: Ctx, session: DB) -> StoreConnectionOut:
    return await _out(session, await svc.get_connection(session, ctx, connection_id))


@router.patch("/store-connections/{connection_id}", response_model=StoreConnectionOut, dependencies=GATED)
async def update_connection(
    connection_id: uuid.UUID, data: StoreConnectionUpdate, ctx: Ctx, session: DB
) -> StoreConnectionOut:
    return await _out(session, await svc.update_connection(session, ctx, connection_id, data))


@router.delete("/store-connections/{connection_id}", response_model=OkOut, dependencies=GATED)
async def delete_connection(connection_id: uuid.UUID, ctx: Ctx, session: DB, meta: Meta) -> OkOut:
    await svc.delete_connection(session, ctx, connection_id, request_meta=meta)
    return OkOut()


@router.post(
    "/store-connections/{connection_id}/secret",
    response_model=StoreConnectionCreated,
    dependencies=GATED,
    summary="Replace the signing secret (paste the platform's, or let MEQYAS generate one)",
)
async def rotate_secret(
    connection_id: uuid.UUID, data: SecretIn, ctx: Ctx, session: DB, meta: Meta
) -> StoreConnectionCreated:
    conn, secret = await svc.rotate_secret(session, ctx, connection_id, data.secret, request_meta=meta)
    out = await _out(session, conn)
    return StoreConnectionCreated(**out.model_dump(), secret=secret)


@router.post(
    "/store-connections/{connection_id}/test",
    response_model=TestOrderOut,
    dependencies=GATED,
    summary="Send a sample order through the pipeline (test invitations, excluded from analytics)",
)
async def test_order(connection_id: uuid.UUID, ctx: Ctx, session: DB) -> TestOrderOut:
    await enforce(f"store-test:{ctx.user_id}", limit=20, window_s=60)
    return TestOrderOut(**await svc.send_test_order(session, ctx, connection_id))


@router.get("/store-connections/{connection_id}/events", response_model=list[StoreEventOut], dependencies=GATED)
async def list_events(
    connection_id: uuid.UUID, ctx: Ctx, session: DB, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[Any]:
    return await svc.list_events(session, ctx, connection_id, limit=limit)


@router.get("/store-connections/{connection_id}/invitations", response_model=list[InvitationOut], dependencies=GATED)
async def list_invitations(
    connection_id: uuid.UUID,
    ctx: Ctx,
    session: DB,
    status_filter: Annotated[InvitationStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[dict[str, Any]]:
    return await svc.list_invitations(session, ctx, connection_id, status=status_filter, limit=limit)


@router.post(
    "/projects/{project_id}/surveys/from-template",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a ready-made store or product satisfaction survey (draft, editable)",
)
async def survey_from_template(
    project_id: uuid.UUID, data: SurveyFromTemplateIn, ctx: Ctx, session: DB
) -> SurveyDetail:
    language = data.language or ("en" if ctx.organization.locale == "en" else "ar")
    doc = TEMPLATES[data.template](language)
    survey = await survey_svc.create_survey(session, ctx, project_id, title=doc.title, wave_id=data.wave_id, doc=doc)
    return await survey_svc.survey_detail(session, survey)


# ------------------------------------------------------------------ webhook
@router.post(
    "/integrations/stores/{webhook_id}/webhook",
    response_model=WebhookResult,
    summary="Order webhook from the store (signature verified per platform)",
)
async def store_webhook(webhook_id: WebhookId, request: Request, session: DB) -> dict[str, Any]:
    await enforce(f"store-hook:{webhook_id}", limit=600, window_s=60)
    await enforce(f"store-hook-ip:{client_ip(request)}", limit=1200, window_s=60)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > svc.MAX_BODY_BYTES:
        raise PayloadTooLarge("The webhook body is too large")
    body = await request.body()
    if len(body) > svc.MAX_BODY_BYTES:
        raise PayloadTooLarge("The webhook body is too large")
    result = await svc.receive_webhook(session, webhook_id, dict(request.headers), body)
    return {"ok": True, **result}
