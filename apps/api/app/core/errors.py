"""Application errors and their HTTP mapping.

Response shape: ``{"error": {"code": "...", "message": "...", "details": {...}}}``
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from meqyas_ai.errors import AIError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("meqyas.errors")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "", *, details: dict[str, Any] | None = None, code: str | None = None):
        super().__init__(message or self.code)
        self.message = message or self.code
        self.details = details or {}
        if code:
            self.code = code


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class Gone(AppError):
    status_code = 410
    code = "gone"


class Unprocessable(AppError):
    status_code = 422
    code = "validation_error"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


_AI_STATUS = {
    "ai_not_configured": 503,
    "ai_unavailable": 503,
    "ai_auth_error": 503,
    "ai_rate_limited": 429,
    "ai_timeout": 504,
    "ai_bad_request": 502,
    "ai_invalid_output": 502,
    "ai_budget_exceeded": 429,
    "ai_subscription_inactive": 409,
    "ai_not_in_plan": 403,
    "ai_unsupported": 501,
}


def _body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        headers = {"Retry-After": str(exc.details.get("retry_after", 60))} if exc.status_code == 429 else None
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status_code, headers=headers)

    @app.exception_handler(AIError)
    async def _ai_error(_: Request, exc: AIError) -> JSONResponse:
        status = _AI_STATUS.get(exc.code, 502)
        details = {k: v for k, v in (exc.details or {}).items() if k in ("problems", "attempts", "feature")}
        return JSONResponse(_body(exc.code, exc.message, details), status_code=status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", ""), "type": e.get("type", "")}
            for e in exc.errors()[:30]
        ]
        return JSONResponse(_body("validation_error", "Invalid request", {"errors": errors}), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(_body("internal_error", "Internal server error"), status_code=500)
