"""Scripted LLM outputs used by API tests (shape of ArchitectOutput)."""

from __future__ import annotations

import copy
from typing import Any

IMPACT_PLAN: dict[str, Any] = {
    "project_title": "قياس أثر برنامج تدريبي لطالبات المرحلة الثانوية",
    "measurement_type": "IMPACT",
    "secondary_types": ["SKILLS"],
    "target_population": "طالبات المرحلة الثانوية المشاركات",
    "purpose": "معرفة أثر البرنامج على استخدام الطالبات لأدوات الذكاء الاصطناعي في التعلم.",
    "understanding_summary": "فهمنا أنك تريد قياس أثر برنامج تدريبي على استخدام الطالبات لأدوات الذكاء الاصطناعي.",
    "measurement_type_rationale": "الطلب يسأل عن الأثر، لذلك نحتاج قياسًا قبليًا وبعديًا.",
    "objectives": [{"key": "o1", "title": "قياس التغير في المهارات", "description": ""}],
    "dimensions": [
        {"key": "skills", "name": "المهارات", "description": "", "objective_key": "o1"},
        {"key": "usage", "name": "الاستخدام", "description": "", "objective_key": "o1"},
        {"key": "confidence", "name": "الثقة", "description": "", "objective_key": "o1"},
    ],
    "indicators": [
        {
            "code": "IND-01",
            "name": "متوسط المهارات",
            "description": "",
            "dimension_key": "skills",
            "indicator_type": "AVERAGE_SCORE",
            "unit": "من 5",
            "target": "4 من 5",
            "target_value": 4,
            "formula": "",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-02",
            "name": "نسبة الاستخدام الأسبوعي",
            "description": "",
            "dimension_key": "usage",
            "indicator_type": "PERCENTAGE",
            "unit": "%",
            "target": "60%",
            "target_value": 60,
            "formula": "",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
    ],
    "recommended_design": "PRE_POST_FOLLOW_UP",
    "design_rationale": "لرصد التغير واستمراره.",
    "waves": [
        {"wave_type": "BASELINE", "name": "القياس القبلي", "timing": "قبل البرنامج", "offset_days": None},
        {"wave_type": "POST", "name": "القياس البعدي", "timing": "بعد البرنامج", "offset_days": None},
        {"wave_type": "FOLLOW_UP", "name": "المتابعة", "timing": "بعد شهر", "offset_days": 30},
    ],
    "baseline_required": True,
    "post_measurement_required": True,
    "follow_up_recommended": True,
    "follow_up_days": 30,
    "recommended_questions_count": 16,
    "estimated_completion_minutes": 6,
    "methodology_notes": ["احرص على سرية الإجابات."],
    "clarifying_questions": ["كم مدة البرنامج؟"],
}


def impact_plan(**overrides: Any) -> dict[str, Any]:
    data = copy.deepcopy(IMPACT_PLAN)
    data.update(overrides)
    return data


def satisfaction_plan() -> dict[str, Any]:
    return impact_plan(
        project_title="قياس رضا الطالبات عن البرنامج",
        measurement_type="SATISFACTION",
        secondary_types=[],
        recommended_design="POST_ONLY",
        waves=[{"wave_type": "SINGLE", "name": "القياس", "timing": "بعد البرنامج", "offset_days": None}],
        baseline_required=False,
        post_measurement_required=False,
        follow_up_recommended=False,
        follow_up_days=None,
    )
