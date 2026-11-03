"""Scripted LLM outputs for the survey agents."""

from __future__ import annotations

import copy
from typing import Any

GENERATED_BASELINE: dict[str, Any] = {
    "title": "الاستبيان القبلي",
    "introduction": "نقيس مستواك الحالي قبل البرنامج. الإجابات سرية.",
    "thank_you_message": "شكرًا لك.",
    "sections": [
        {
            "key": "profile",
            "title": "معلومات عامة",
            "description": "",
            "questions": [
                {
                    "key": "grade",
                    "type": "SINGLE_CHOICE",
                    "text": "الصف",
                    "required": True,
                    "is_profile": True,
                    "options": [
                        {"value": "10", "label": "الأول الثانوي", "score": None},
                        {"value": "11", "label": "الثاني الثانوي", "score": None},
                    ],
                }
            ],
        },
        {
            "key": "measures",
            "title": "المهارات والاستخدام",
            "description": "",
            "questions": [
                {
                    "key": "skill_1",
                    "type": "LIKERT",
                    "text": "أستطيع كتابة أوامر واضحة لأدوات الذكاء الاصطناعي",
                    "dimension_key": "skills",
                    "indicator_code": "IND-01",
                    "options": [],
                },
                {
                    "key": "skill_2",
                    "type": "LIKERT",
                    "text": "أستطيع تقييم دقة إجابات أدوات الذكاء الاصطناعي",
                    "dimension_key": "skills",
                    "indicator_code": "IND-01",
                    "options": [
                        {"value": "e", "label": "أوافق بشدة", "score": 5},
                        {"value": "d", "label": "أوافق", "score": 4},
                        {"value": "c", "label": "محايد", "score": 3},
                        {"value": "b", "label": "لا أوافق", "score": 2},
                        {"value": "a", "label": "لا أوافق بشدة", "score": 1},
                    ],
                },
                {
                    "key": "use_freq",
                    "type": "SINGLE_CHOICE",
                    "text": "كم مرة تستخدمين أدوات الذكاء الاصطناعي في التعلم؟",
                    "dimension_key": "usage",
                    "indicator_code": "IND-02",
                    "options": [
                        {"value": "1", "label": "أبدًا", "score": 1},
                        {"value": "3", "label": "أحيانًا", "score": 3},
                        {"value": "5", "label": "دائمًا", "score": 5},
                    ],
                },
                {
                    "key": "use_tasks",
                    "type": "MULTIPLE_CHOICE",
                    "text": "في أي مهام تستخدمينها؟",
                    "dimension_key": "usage",
                    "options": [
                        {"value": "summaries", "label": "التلخيص"},
                        {"value": "practice", "label": "التدريب على الأسئلة"},
                    ],
                },
                {
                    "key": "conf_1",
                    "type": "LIKERT",
                    "text": "أشعر بالثقة عند استخدام هذه الأدوات",
                    "dimension_key": "confidence",
                },
                {
                    "key": "conf_2",
                    "type": "MATRIX",
                    "text": "قيّمي ثقتك في المهام التالية",
                    "dimension_key": "confidence",
                    "options": [
                        {"value": "1", "label": "منخفضة", "score": 1},
                        {"value": "2", "label": "متوسطة", "score": 2},
                        {"value": "3", "label": "مرتفعة", "score": 3},
                    ],
                    "rows": [{"key": "search", "text": "البحث"}, {"key": "Writing!", "text": "الكتابة"}],
                },
                {"key": "expect", "type": "LONG_TEXT", "text": "ما الذي تأملين تعلمه؟", "required": False},
                {"key": "broken", "type": "SINGLE_CHOICE", "text": "سؤال بلا خيارات", "options": []},
            ],
        },
    ],
    "logic": [
        {"type": "DISPLAY", "target_key": "expect", "question_key": "conf_1", "op": "lte", "values": ["2"]},
        {"type": "DISPLAY", "target_key": "grade", "question_key": "conf_1", "op": "eq", "values": ["1"]},
    ],
}

GENERATED_POST_ADDENDUM: dict[str, Any] = {
    "title": "الاستبيان البعدي",
    "introduction": "نقيس مستواك بعد البرنامج.",
    "thank_you_message": "شكرًا.",
    "sections": [
        {
            "key": "measures",
            "title": "رأيك في البرنامج",
            "questions": [
                {"key": "satisfaction", "type": "CSAT", "text": "ما مدى رضاك عن البرنامج؟"},
                {"key": "skill_1", "type": "LIKERT", "text": "نسخة مكررة يجب إعادة تسميتها"},
                {"key": "best_part", "type": "LONG_TEXT", "text": "ما أكثر ما استفدت منه؟", "required": False},
            ],
        }
    ],
    "logic": [],
}

REVIEW_OUTPUT: dict[str, Any] = {
    "overall_comment": "الاستبيان جيد عمومًا.",
    "issues": [
        {
            "question_key": "skill_1",
            "type": "DOUBLE_BARRELED",
            "severity": "HIGH",
            "problem": "يجمع فكرتين.",
            "reason": "لا نعرف أي جزء أجابت عنه الطالبة.",
            "suggestion": "أستطيع كتابة أوامر واضحة لأدوات الذكاء الاصطناعي.",
            "suggested_options": [],
        },
        {
            "question_key": "conf_1",
            "type": "AMBIGUOUS",
            "severity": "LOW",
            "problem": "غير محدد.",
            "reason": "أي أدوات؟",
            "suggestion": "أشعر بالثقة عند استخدام أدوات الذكاء الاصطناعي في الواجبات.",
            "suggested_options": [],
        },
        {"question_key": "ghost", "type": "OTHER", "severity": "LOW", "problem": "x", "reason": "x", "suggestion": "x"},
    ],
}


def generated(base: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(base)
