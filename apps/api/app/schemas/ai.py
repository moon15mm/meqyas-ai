from __future__ import annotations

import uuid
from datetime import datetime

from ..domain.enums import AIRunStatus
from .common import APIModel


class AIStatusOut(APIModel):
    configured: bool
    provider: str | None
    provider_label: str | None = None
    model_fast: str | None
    model_smart: str | None
    local_enabled: bool
    local_provider_models: dict[str, str] | None = None
    reason: str | None = None
    healthy: bool | None = None
    health_detail: str | None = None
    #: Second provider used automatically when the primary cannot serve (rate limits, outage,
    #: rejected key, retired model). Never exposes keys or URLs.
    fallback_configured: bool = False
    fallback_provider_label: str | None = None
    fallback_model_fast: str | None = None
    fallback_model_smart: str | None = None
    fallback_reason: str | None = None
    fallback_healthy: bool | None = None
    fallback_health_detail: str | None = None


class AIRunOut(APIModel):
    id: uuid.UUID
    agent: str
    provider: str
    model: str
    status: AIRunStatus
    attempts: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: int
    error_code: str | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    created_at: datetime


class AIUsageOut(APIModel):
    today_tokens: int
    daily_limit: int
    runs_today: int
