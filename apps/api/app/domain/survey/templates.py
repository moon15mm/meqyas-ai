"""Ready-made customer-experience questionnaires (no AI) — CX.md §3.

Each one is a *pulse*: one tap per screen with auto-advance, about 30–45 seconds. It
measures the three CX metrics side by side — satisfaction (CSAT, the interaction), effort
(CES, where it matters) and loyalty (NPS, the outcome) — plus a few star-rated drivers
used by the key driver analysis. The closing questions adapt to the score: a short "what
should we improve?" for passives and detractors, "what did you like?" for promoters, and an
optional request to be contacted for detractors (closed loop).

Placeholders ``{{store}}``, ``{{product}}`` and ``{{branch}}`` are filled from the invitation
or the branch link when the customer opens the survey; without them they read as generic
words ("المتجر", "المنتج", "فرعنا").
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

from .document import SurveyDoc

Language = Literal["ar", "en"]
TemplateKey = Literal["store_experience", "product_feedback", "store_visit"]

_CSAT_ENDS = {"ar": ("غير راضٍ إطلاقًا", "راضٍ جدًا"), "en": ("Very dissatisfied", "Very satisfied")}
_CES_ENDS = {"ar": ("صعب جدًا", "سهل جدًا"), "en": ("Very difficult", "Very easy")}
_NPS_ENDS = {"ar": ("مستبعد تمامًا", "محتمل جدًا"), "en": ("Not at all likely", "Extremely likely")}
PULSE_SETTINGS = {
    "one_question_per_page": True,
    "show_progress": True,
    "allow_back": True,
    "experience": "pulse",
    "closed_loop": True,
}


def _csat(key: str, text: str, language: Language) -> dict[str, Any]:
    low, high = _CSAT_ENDS[language]
    return {
        "key": key,
        "type": "CSAT",
        "text": text,
        "required": True,
        "scale": {"min": 1, "max": 5, "min_label": low, "max_label": high},
    }


def _star(key: str, text: str, *, required: bool = True) -> dict[str, Any]:
    """A driver of the experience, rated with 1–5 stars."""
    return {
        "key": key,
        "type": "STAR",
        "text": text,
        "required": required,
        "scale": {"min": 1, "max": 5},
        "settings": {"cx_role": "driver"},
    }


def _ces(key: str, text: str, language: Language) -> dict[str, Any]:
    low, high = _CES_ENDS[language]
    return {
        "key": key,
        "type": "CES",
        "text": text,
        "required": True,
        "scale": {"min": 1, "max": 7, "min_label": low, "max_label": high},
    }


def _nps(key: str, text: str, language: Language) -> dict[str, Any]:
    low, high = _NPS_ENDS[language]
    return {
        "key": key,
        "type": "NPS",
        "text": text,
        "required": True,
        "scale": {"min": 0, "max": 10, "min_label": low, "max_label": high},
        "settings": {"cx_role": "outcome"},
    }


def _closing(prefix: str, nps_key: str, language: Language) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Adaptive closing questions and their display rules (closed loop)."""
    ar = language == "ar"
    questions = [
        {
            "key": f"{prefix}_improve",
            "type": "LONG_TEXT",
            "text": "ما أهم شيء نحسّنه لتكون تجربتك القادمة أفضل؟" if ar else "What one thing should we improve?",
            "required": False,
        },
        {
            "key": f"{prefix}_praise",
            "type": "LONG_TEXT",
            "text": "رائع! ما الذي أعجبك أكثر؟" if ar else "Great! What did you like most?",
            "required": False,
        },
        {
            "key": f"{prefix}_contact_ok",
            "type": "SINGLE_CHOICE",
            "text": "نأسف لذلك. هل تود أن يتواصل معك فريقنا لحل ما واجهته؟"
            if ar
            else "We are sorry. Would you like our team to contact you about it?",
            "required": False,
            "options": [
                {"value": "yes", "label": "نعم، تواصلوا معي" if ar else "Yes, please contact me"},
                {"value": "no", "label": "لا، شكرًا" if ar else "No, thank you"},
            ],
        },
        {
            "key": f"{prefix}_contact",
            "type": "SHORT_TEXT",
            "text": "رقم الجوال للتواصل" if ar else "Mobile number to reach you",
            "description": "يُستخدم مرة واحدة للتواصل بخصوص تجربتك، ولا يظهر في نتائج التحليل."
            if ar
            else "Used once to contact you about this experience; never part of the results.",
            "required": True,
            "settings": {"contact_field": "phone", "placeholder": "05xxxxxxxx" if ar else "+966 5x xxx xxxx"},
        },
    ]
    rules = [
        {
            "id": f"{prefix}_r_improve",
            "type": "DISPLAY",
            "target_key": f"{prefix}_improve",
            "condition": {"question": nps_key, "op": "lte", "value": 8},
        },
        {
            "id": f"{prefix}_r_praise",
            "type": "DISPLAY",
            "target_key": f"{prefix}_praise",
            "condition": {"question": nps_key, "op": "gte", "value": 9},
        },
        {
            "id": f"{prefix}_r_contact",
            "type": "DISPLAY",
            "target_key": f"{prefix}_contact_ok",
            "condition": {"question": nps_key, "op": "lte", "value": 6},
        },
        {
            "id": f"{prefix}_r_phone",
            "type": "DISPLAY",
            "target_key": f"{prefix}_contact",
            "condition": {"question": f"{prefix}_contact_ok", "op": "eq", "value": "yes"},
        },
    ]
    return questions, rules


def store_experience(language: Language = "ar") -> SurveyDoc:
    """After an online order is delivered: the shopping experience end to end."""
    ar = language == "ar"
    closing, rules = _closing("store", "store_nps", language)
    questions = [
        _csat(
            "store_csat",
            "ما مدى رضاك عن تجربة الشراء من {{store}}؟" if ar else "How satisfied are you with shopping at {{store}}?",
            language,
        ),
        _star("delivery_on_time", "قيّم سرعة وصول طلبك" if ar else "Rate how quickly your order arrived"),
        _star(
            "packaging", "قيّم حالة الطلب والتغليف عند الاستلام" if ar else "Rate the order's condition and packaging"
        ),
        _ces(
            "ordering_ease",
            "ما مدى سهولة إتمام طلبك ودفعه؟" if ar else "How easy was it to place and pay for your order?",
            language,
        ),
        _star(
            "support",
            "قيّم التواصل مع المتجر (إن احتجت إليه)" if ar else "Rate contacting the store (if you needed to)",
            required=False,
        ),
        _nps(
            "store_nps",
            "ما مدى احتمال أن توصي بـ{{store}} لصديق؟"
            if ar
            else "How likely are you to recommend {{store}} to a friend?",
            language,
        ),
    ]
    return SurveyDoc.model_validate(
        {
            "title": "تقييم تجربة الشراء" if ar else "Shopping experience",
            "introduction": (
                "شكرًا لطلبك! نقرات قليلة تساعدنا على التحسين — أقل من دقيقة."
                if ar
                else "Thank you for your order! A few taps help us improve — under a minute."
            ),
            "thank_you_message": "شكرًا لك! رأيك يصل إلى فريق المتجر."
            if ar
            else "Thank you! Your feedback reaches the store team.",
            "language": language,
            "sections": [
                {
                    "key": "experience",
                    "title": "تجربتك" if ar else "Your experience",
                    "questions": [*questions, *closing],
                }
            ],
            "logic": rules,
            "settings": PULSE_SETTINGS,
        }
    )


def product_feedback(language: Language = "ar") -> SurveyDoc:
    """After delivery: one survey per product bought."""
    ar = language == "ar"
    closing, rules = _closing("product", "product_nps", language)
    questions = [
        _csat(
            "product_csat", "ما مدى رضاك عن {{product}}؟" if ar else "How satisfied are you with {{product}}?", language
        ),
        _star("as_described", "قيّم مطابقة المنتج للوصف والصور" if ar else "Rate how well it matched the description"),
        _star("value_for_money", "قيّم جودة المنتج مقارنة بسعره" if ar else "Rate its quality for the price"),
        _nps(
            "product_nps",
            "ما مدى احتمال أن توصي بـ{{product}}؟" if ar else "How likely are you to recommend {{product}}?",
            language,
        ),
    ]
    return SurveyDoc.model_validate(
        {
            "title": "تقييم المنتج" if ar else "Product feedback",
            "introduction": (
                "ما رأيك في المنتج الذي وصلك؟ أقل من دقيقة."
                if ar
                else "What do you think of the product you received? Under a minute."
            ),
            "thank_you_message": "شكرًا لك! تقييمك يساعد العملاء الآخرين والمتجر."
            if ar
            else "Thank you! Your rating helps the store and other customers.",
            "language": language,
            "sections": [{"key": "product", "title": "{{product}}", "questions": [*questions, *closing]}],
            "logic": rules,
            "settings": PULSE_SETTINGS,
        }
    )


def store_visit(language: Language = "ar") -> SurveyDoc:
    """At a physical branch: QR code at the counter or a tablet at the exit."""
    ar = language == "ar"
    closing, rules = _closing("visit", "visit_nps", language)
    questions = [
        _csat(
            "visit_csat",
            "ما مدى رضاك عن زيارتك اليوم لـ{{branch}}؟"
            if ar
            else "How satisfied are you with today's visit to {{branch}}?",
            language,
        ),
        _star("staff", "قيّم تعامل الموظفين ومساعدتهم" if ar else "Rate our staff's help and courtesy"),
        _star("checkout", "قيّم سرعة المحاسبة ووقت الانتظار" if ar else "Rate checkout speed and waiting time"),
        _star("availability", "قيّم توفر ما كنت تبحث عنه" if ar else "Rate whether you found what you wanted"),
        _star("cleanliness", "قيّم نظافة الفرع وترتيبه" if ar else "Rate the branch's cleanliness and layout"),
        _star("value", "قيّم القيمة مقابل السعر" if ar else "Rate the value for money"),
        _nps(
            "visit_nps",
            "ما مدى احتمال أن توصي بنا لصديق أو قريب؟" if ar else "How likely are you to recommend us to a friend?",
            language,
        ),
    ]
    return SurveyDoc.model_validate(
        {
            "title": "قيّم زيارتك" if ar else "Rate your visit",
            "introduction": (
                "شكرًا لزيارتك {{branch}}! نقرات قليلة — أقل من دقيقة."
                if ar
                else "Thanks for visiting {{branch}}! A few taps — under a minute."
            ),
            "thank_you_message": "شكرًا لك! رأيك يصل إلى فريق الفرع مباشرة."
            if ar
            else "Thank you! Your feedback goes straight to the branch team.",
            "language": language,
            "sections": [
                {"key": "visit", "title": "زيارتك" if ar else "Your visit", "questions": [*questions, *closing]}
            ],
            "logic": rules,
            "settings": PULSE_SETTINGS,
        }
    )


TEMPLATES = {"store_experience": store_experience, "product_feedback": product_feedback, "store_visit": store_visit}

#: Generic words used when a survey with placeholders is opened without an invitation or branch.
PLACEHOLDER_FALLBACK = {
    "ar": {"store": "المتجر", "product": "المنتج", "branch": "فرعنا"},
    "en": {"store": "the store", "product": "the product", "branch": "our branch"},
}


_PLACEHOLDER = re.compile(r"\{\{\s*(store|product|branch)\s*\}\}")
_PIPED_KEYS = frozenset(
    {"title", "text", "description", "introduction", "thank_you_message", "label", "min_label", "max_label"}
)


def fill_placeholders(text: str, values: Mapping[str, str]) -> str:
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1)) or m.group(0), text)


def fill_document(node: Any, values: Mapping[str, str]) -> Any:
    """Replace ``{{store}}``/``{{product}}``/``{{branch}}`` in every respondent-facing text of a document dict."""
    if isinstance(node, list):
        return [fill_document(item, values) for item in node]
    if isinstance(node, dict):
        return {
            k: fill_placeholders(v, values) if k in _PIPED_KEYS and isinstance(v, str) else fill_document(v, values)
            for k, v in node.items()
        }
    return node
