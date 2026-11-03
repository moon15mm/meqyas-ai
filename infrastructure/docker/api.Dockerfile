# syntax=docker/dockerfile:1.7
# MEQYAS AI — API & worker image (FastAPI + arq). Build context: repository root.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /bin/
WORKDIR /app

# ---- dependencies (cached layer) -------------------------------------------
FROM base AS deps
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY packages/ai/pyproject.toml packages/ai/pyproject.toml
RUN mkdir -p apps/api/app packages/ai/meqyas_ai \
    && touch apps/api/app/__init__.py packages/ai/meqyas_ai/__init__.py \
    && uv sync --frozen --no-dev --no-install-workspace

# ---- runtime ------------------------------------------------------------------
FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --home /app app \
    && mkdir -p /data/storage && chown -R app:app /data
COPY --from=deps /opt/venv /opt/venv
COPY pyproject.toml uv.lock ./
COPY packages/ai packages/ai
COPY apps/api apps/api
COPY tests/fixtures tests/fixtures
RUN uv sync --frozen --no-dev
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app/apps/api
USER app
EXPOSE 8000
# Migrations run on start (idempotent); uvicorn serves with multiple workers.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${API_WORKERS:-2} --proxy-headers --forwarded-allow-ips='*'"]
