from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from meqyas_ai.schemas.plan import MeasurementPlanDraft
from pydantic import Field

from ..domain.enums import PlanStatus
from .common import APIModel, InputModel


class ArchitectRequestIn(InputModel):
    request: str = Field(min_length=8, max_length=2000, description="ماذا تريد أن تقيس؟")
    language: Literal["ar", "en"] | None = Field(default=None, description="Output language; auto-detected if omitted")
    audience_hint: str | None = Field(default=None, max_length=200)


class RegenerateIn(InputModel):
    feedback: str = Field(min_length=3, max_length=1500)


class MeasurementPlanOut(APIModel):
    id: uuid.UUID
    status: PlanStatus
    project_id: uuid.UUID | None
    source_prompt: str
    language: str
    generation_count: int
    draft: MeasurementPlanDraft
    ai_run_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None
