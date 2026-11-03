from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Header, Path, Request, Response, status

from ...core.config import get_settings
from ...core.errors import Forbidden
from ...core.rate_limit import client_ip, enforce
from ...schemas.auth import (
    ActivateIn,
    ActivationPreviewOut,
    ChangePasswordIn,
    ForgotPasswordIn,
    LoginIn,
    MeOut,
    ResetPasswordIn,
    TokenOut,
    UpdateMeIn,
    UserOut,
)
from ...schemas.common import OkOut
from ...services import auth as auth_service
from ...services.auth import IssuedSession
from ...services.organizations import memberships_for
from ..deps import DB, CurrentUser, SessionFamily, request_meta

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "meqyas_rt"
CSRF_HEADER_VALUE = "meqyas"


def _set_refresh_cookie(response: Response, issued: IssuedSession) -> None:
    s = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        issued.refresh_token,
        max_age=issued.refresh_max_age,
        httponly=True,
        secure=s.secure_cookies,
        samesite="strict",
        path=f"{s.api_prefix}/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(
        REFRESH_COOKIE, path=f"{s.api_prefix}/auth", secure=s.secure_cookies, httponly=True, samesite="strict"
    )


def _require_csrf_header(value: str | None) -> None:
    # Cookie-authenticated endpoints require a custom header that cross-site
    # forms cannot send (and cross-origin JS cannot send without a CORS preflight).
    if value != CSRF_HEADER_VALUE:
        raise Forbidden("Missing or invalid X-Requested-With header", code="csrf_check_failed")


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request, response: Response, session: DB) -> TokenOut:
    await enforce(f"login-ip:{client_ip(request)}", limit=10, window_s=60)
    await enforce(f"login-email:{data.email.lower()}", limit=5, window_s=60)
    issued = await auth_service.login(session, data.email, data.password, request_meta(request))
    _set_refresh_cookie(response, issued)
    return issued.token


@router.post("/refresh", response_model=TokenOut)
async def refresh(
    request: Request,
    response: Response,
    session: DB,
    x_requested_with: Annotated[str | None, Header()] = None,
    meqyas_rt: Annotated[str | None, Cookie()] = None,
) -> TokenOut:
    _require_csrf_header(x_requested_with)
    await enforce(f"refresh:{client_ip(request)}", limit=60, window_s=60)
    try:
        issued = await auth_service.refresh(session, meqyas_rt, request_meta(request))
    except Exception:
        _clear_refresh_cookie(response)
        raise
    _set_refresh_cookie(response, issued)
    return issued.token


@router.post("/logout", response_model=OkOut)
async def logout(
    request: Request,
    response: Response,
    session: DB,
    x_requested_with: Annotated[str | None, Header()] = None,
    meqyas_rt: Annotated[str | None, Cookie()] = None,
) -> OkOut:
    _require_csrf_header(x_requested_with)
    await auth_service.logout(session, meqyas_rt, request_meta(request))
    _clear_refresh_cookie(response)
    return OkOut()


@router.post("/forgot-password", response_model=OkOut, status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(data: ForgotPasswordIn, request: Request, session: DB) -> OkOut:
    await enforce(f"forgot:{client_ip(request)}", limit=5, window_s=60)
    await enforce(f"forgot-email:{data.email.lower()}", limit=3, window_s=900)
    await auth_service.forgot_password(session, data.email, request_meta(request))
    return OkOut()


@router.post("/reset-password", response_model=OkOut)
async def reset_password(data: ResetPasswordIn, request: Request, session: DB) -> OkOut:
    await enforce(f"reset:{client_ip(request)}", limit=10, window_s=60)
    await auth_service.reset_password(session, data.token, data.password, request_meta(request))
    return OkOut()


@router.get(
    "/activation/{token}",
    response_model=ActivationPreviewOut,
    summary="What an activation link opens (public): the person and the workspace",
)
async def activation_preview(
    token: Annotated[str, Path(min_length=20, max_length=200)], request: Request, session: DB
) -> ActivationPreviewOut:
    await enforce(f"activation-preview:{client_ip(request)}", limit=30, window_s=60)
    return await auth_service.activation_preview(session, token)


@router.post("/activate", response_model=TokenOut, summary="A new account chooses its password and signs in")
async def activate(data: ActivateIn, request: Request, response: Response, session: DB) -> TokenOut:
    await enforce(f"activate:{client_ip(request)}", limit=10, window_s=60)
    issued = await auth_service.activate(session, data.token, data.password, data.full_name, request_meta(request))
    _set_refresh_cookie(response, issued)
    return issued.token


@router.post(
    "/change-password",
    response_model=OkOut,
    summary="Change one's password (the current one is required); other sessions are signed out",
)
async def change_password(
    data: ChangePasswordIn, user: CurrentUser, family: SessionFamily, request: Request, session: DB
) -> OkOut:
    await enforce(f"change-password:{user.id}", limit=5, window_s=300)
    await auth_service.change_password(
        session,
        user,
        data.current_password,
        data.new_password,
        keep_family=family,
        request_meta=request_meta(request),
    )
    return OkOut()


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, session: DB) -> MeOut:
    return MeOut(user=UserOut.model_validate(user), memberships=await memberships_for(session, user.id))


@router.patch("/me", response_model=UserOut)
async def update_me(data: UpdateMeIn, user: CurrentUser, session: DB) -> UserOut:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    await session.commit()
    await session.refresh(user)
    return UserOut.model_validate(user)
