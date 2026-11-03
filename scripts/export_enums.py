"""Write tests/fixtures/enums.json from the Python source of truth.

Run after changing any enum:  uv run python scripts/export_enums.py
Both test suites (pytest + vitest) assert their enums match this file.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.domain.enums import ProjectStatus, Role, Sector, SubscriptionState
from meqyas_ai.domain.enums import (
    EvidenceLevel,
    IndicatorDirection,
    IndicatorFrequency,
    IndicatorType,
    MeasurementDesign,
    MeasurementType,
    OutcomeLevel,
    QuestionType,
    WaveType,
)

ENUMS = {
    "MEASUREMENT_TYPES": MeasurementType,
    "MEASUREMENT_DESIGNS": MeasurementDesign,
    "WAVE_TYPES": WaveType,
    "EVIDENCE_LEVELS": EvidenceLevel,
    "OUTCOME_LEVELS": OutcomeLevel,
    "INDICATOR_TYPES": IndicatorType,
    "INDICATOR_FREQUENCIES": IndicatorFrequency,
    "INDICATOR_DIRECTIONS": IndicatorDirection,
    "QUESTION_TYPES": QuestionType,
    "ROLES": Role,
    "PROJECT_STATUSES": ProjectStatus,
    "SECTORS": Sector,
    "SUBSCRIPTION_STATES": SubscriptionState,
}


def snapshot() -> dict[str, list[str]]:
    return {name: [m.value for m in enum] for name, enum in ENUMS.items()}


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "enums.json"
    out.write_text(json.dumps(snapshot(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
