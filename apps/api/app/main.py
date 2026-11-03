"""FastAPI application factory."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .api.v1.router import api_router
from .core.cache import close_redis, get_redis
from .core.config import get_settings
from .core.errors import install_error_handlers
from .core.logging import configure_logging, request_id_var
from .db.session import dispose_engine, get_sessionmaker
from .services.ai import close_ai_registry, get_ai_registry

logger = logging.getLogger("meqyas.api")

MAX_JSON_BODY = 2 * 1024 * 1024  # 2 MB

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    get_ai_registry()
    await get_redis()
    from .seed.reference import seed_reference_data

    async with get_sessionmaker()() as session:
        await seed_reference_data(session)
        if settings.seed_demo_on_startup and not settings.is_production:
            from .seed.demo import seed_demo

            try:
                await seed_demo(session)
            except Exception:  # demo data must never block startup
                logger.exception("demo seed failed")
    logger.info("MEQYAS AI API started (env=%s, ai=%s)", settings.environment, settings.ai_provider)
    yield
    await close_ai_registry()
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.is_production)

    app = FastAPI(
        title="MEQYAS AI API",
        description="مِقياس AI — AI Measurement & Impact Platform. From idea to evidence.",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=[
                "Authorization",
                "Content-Type",
                "X-Organization-Id",
                "X-Requested-With",
                "Idempotency-Key",
                "Accept-Language",
            ],
            max_age=600,
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        started = time.perf_counter()
        try:
            length = request.headers.get("content-length")
            ctype = request.headers.get("content-type", "")
            if length and ctype.startswith("application/json") and int(length) > MAX_JSON_BODY:
                return JSONResponse(
                    {"error": {"code": "payload_too_large", "message": "Request body too large", "details": {}}},
                    status_code=413,
                )
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        duration = (time.perf_counter() - started) * 1000
        response.headers["X-Request-Id"] = rid
        for key, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        if settings.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if request.url.path.startswith("/api/v1"):
            response.headers.setdefault("Cache-Control", "no-store")
        logger.info(
            "%s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(duration, 1),
            },
        )
        return response

    install_error_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/api/health", tags=["health"])
    async def health() -> dict[str, object]:
        db_ok = True
        try:
            async with get_sessionmaker()() as session:
                await session.execute(text("SELECT 1"))
        except Exception:
            db_ok = False
        redis = await get_redis()
        return {"status": "ok" if db_ok else "degraded", "database": db_ok, "redis": redis is not None}

    return app


app = create_app()
