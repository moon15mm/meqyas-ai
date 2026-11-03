"""Test data builders for the AI package."""

from __future__ import annotations

import copy
from typing import Any

_BASE_PLAN: dict[str, Any] = {
    "project_title": "قياس أثر برنامج تدريبي في الذكاء الاصطناعي",
    "measurement_type": "IMPACT",
    "secondary_types": ["TRAINING_EVALUATION", "BEHAVIOR"],
    "target_population": "معلمو المدرسة المشاركون في البرنامج",
    "purpose": "معرفة مدى تحسن معرفة المعلمين وثقتهم واستخدامهم لأدوات الذكاء الاصطناعي بعد البرنامج.",
    "understanding_summary": "فهمنا أنك تريد قياس أثر برنامج تدريبي على استخدام المعلمين للذكاء الاصطناعي.",
    "measurement_type_rationale": "الطلب يسأل عن الأثر والتغير، لذلك نحتاج قياسًا قبليًا وبعديًا ومتابعة.",
    "objectives": [
        {"key": "o1", "title": "قياس التغير في معرفة المعلمين", "description": ""},
        {"key": "o2", "title": "رصد الاستخدام الفعلي في الصف", "description": ""},
    ],
    "dimensions": [
        {"key": "knowledge", "name": "المعرفة", "description": "", "objective_key": "o1"},
        {"key": "confidence", "name": "الثقة", "description": "", "objective_key": "o1"},
        {"key": "actual_use", "name": "الاستخدام الفعلي", "description": "", "objective_key": "o2"},
    ],
    "indicators": [
        {
            "code": "IND-01",
            "name": "متوسط درجة المعرفة",
            "description": "",
            "dimension_key": "knowledge",
            "indicator_type": "AVERAGE_SCORE",
            "unit": "من 5",
            "target": "≥ 4 من 5",
            "target_value": 4,
            "formula": "متوسط البنود",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-02",
            "name": "نسبة الواثقين",
            "description": "",
            "dimension_key": "confidence",
            "indicator_type": "PERCENTAGE",
            "unit": "%",
            "target": "≥ 75%",
            "target_value": 75,
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
        {"wave_type": "FOLLOW_UP", "name": "المتابعة", "timing": "بعد 30 يومًا", "offset_days": 30},
    ],
    "baseline_required": True,
    "post_measurement_required": True,
    "follow_up_recommended": True,
    "follow_up_days": 30,
    "recommended_questions_count": 18,
    "estimated_completion_minutes": 7,
    "methodology_notes": ["احرص على سرية الإجابات."],
    "clarifying_questions": [],
}


def plan_dict(**overrides: Any) -> dict[str, Any]:
    data = copy.deepcopy(_BASE_PLAN)
    data.update(overrides)
    return data


def satisfaction_plan(**overrides: Any) -> dict[str, Any]:
    data = plan_dict(
        project_title="قياس رضا الطالبات عن النشاط",
        measurement_type="SATISFACTION",
        secondary_types=[],
        recommended_design="POST_ONLY",
        waves=[{"wave_type": "SINGLE", "name": "القياس", "timing": "بعد النشاط", "offset_days": None}],
        baseline_required=False,
        post_measurement_required=False,
        follow_up_recommended=False,
        follow_up_days=None,
        dimensions=[
            {"key": "content", "name": "المحتوى", "description": "", "objective_key": "o1"},
            {"key": "organization", "name": "التنظيم", "description": "", "objective_key": "o1"},
        ],
        indicators=[
            {
                "code": "IND-01",
                "name": "نسبة الراضيات",
                "description": "",
                "dimension_key": "content",
                "indicator_type": "PERCENTAGE",
                "unit": "%",
                "target": "≥ 80%",
                "target_value": 80,
                "formula": "",
                "frequency": "ONCE",
                "direction": "HIGHER_IS_BETTER",
            }
        ],
        recommended_questions_count=10,
        estimated_completion_minutes=4,
    )
    data.update(overrides)
    return data
