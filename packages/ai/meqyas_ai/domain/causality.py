"""Causality guard: what may be claimed for a given evidence level, and a
detector for over-claiming language in generated narratives."""

from __future__ import annotations

import re

from .enums import EvidenceLevel, MeasurementDesign

_CAUSAL_AR = [
    r"تسبب",
    r"تسبّب",
    # Verb-first order puts the subject in between: «أدى البرنامج إلى…».
    r"أدّ?ى\s+(?:\S+\s+){0,3}?إلى",
    r"ادى\s+(?:\S+\s+){0,3}?الى",
    r"بسبب البرنامج",
    r"نتيجة للبرنامج",
    r"بفضل البرنامج",
    r"أثبت",
    r"يثبت",
    r"اثبت",
    r"أحدث البرنامج",
    r"البرنامج هو السبب",
]
_CAUSAL_EN = [
    r"\bcaused\b",
    r"\bcauses\b",
    r"\bled to\b",
    r"\bresulted in\b",
    r"\bdue to the program",
    r"\bthanks to the program",
    r"\bprove[sd]?\b",
    r"\bthe program is responsible",
]
_CAUSAL_RE = re.compile("|".join(_CAUSAL_AR + _CAUSAL_EN), re.IGNORECASE)
_HEDGE_RE = re.compile(r"لا يثبت|لا تثبت|does not prove|cannot prove|not prove|لا يمكن الجزم", re.IGNORECASE)

#: Claim strength allowed per evidence level (higher = stronger claims allowed).
CLAIM_STRENGTH: dict[EvidenceLevel, int] = {
    EvidenceLevel.DESCRIPTIVE: 0,
    EvidenceLevel.PERCEIVED_CHANGE: 1,
    EvidenceLevel.TREND: 1,
    EvidenceLevel.CHANGE: 2,
    EvidenceLevel.CHANGE_PERSISTENCE: 2,
    EvidenceLevel.CONTRIBUTION: 3,
    EvidenceLevel.ATTRIBUTION: 4,
}


def find_causal_claims(text: str) -> list[str]:
    """Return causal phrases found in sentences that are not explicitly hedged."""
    hits: list[str] = []
    for sentence in re.split(r"(?<=[.!؟?\n])\s+", text or ""):
        if _HEDGE_RE.search(sentence):
            continue
        hits.extend(m.group(0) for m in _CAUSAL_RE.finditer(sentence))
    return hits


def allows_causal_language(level: EvidenceLevel) -> bool:
    return CLAIM_STRENGTH[level] >= 4


_RESULT_CAVEATS: dict[EvidenceLevel, tuple[str, str]] = {
    EvidenceLevel.DESCRIPTIVE: (
        "تصف هذه النتائج آراء المشاركين ومستواهم الحالي، ولا تقيس تغيرًا أو أثرًا.",
        "These results describe participants' views and current levels; they do not measure change or impact.",
    ),
    EvidenceLevel.PERCEIVED_CHANGE: (
        "التغير المرصود هو ما يدركه المشاركون أنفسهم، وليس قياسًا مباشرًا للتغير.",
        "The change reported is as perceived by participants, not a direct measurement of change.",
    ),
    EvidenceLevel.CHANGE: (
        "أظهرت النتائج تغيرًا في المؤشرات بعد البرنامج، لكن هذا التصميم وحده لا يثبت أن البرنامج هو السبب "
        "الوحيد في هذا التغير.",
        "Results show a change in the indicators after the program, but this design alone does not prove the "
        "program was the only cause of the change.",
    ),
    EvidenceLevel.CHANGE_PERSISTENCE: (
        "أظهرت النتائج تغيرًا بعد البرنامج ومدى استمراره في قياس المتابعة، لكن هذا التصميم وحده لا يثبت أن "
        "البرنامج هو السبب الوحيد في هذا التغير.",
        "Results show a change after the program and whether it persisted at follow-up, but this design alone "
        "does not prove the program was the only cause.",
    ),
    EvidenceLevel.TREND: (
        "تُظهر القياسات المتكررة اتجاهًا عبر الزمن، لكنها لا تحدد وحدها أسباب هذا الاتجاه.",
        "Repeated measurements show a trend over time but do not by themselves identify its causes.",
    ),
    EvidenceLevel.CONTRIBUTION: (
        "المقارنة بمجموعة غير مشاركة تقوّي الاستنتاج حول إسهام البرنامج، لكنها لا ترقى إلى إثبات سببي كامل ما لم "
        "يكن توزيع المشاركين عشوائيًا.",
        "Comparing with a non-participating group strengthens conclusions about the program's contribution, but "
        "is not full causal proof unless assignment was random.",
    ),
    EvidenceLevel.ATTRIBUTION: ("", ""),
}

_DESIGN_NOTES: dict[MeasurementDesign, tuple[str, str]] = {
    MeasurementDesign.PRE_POST: (
        "التصميم القبلي/البعدي يُظهر التغير في المؤشرات، لكنه وحده لا يثبت أن البرنامج هو السبب الوحيد في هذا "
        "التغير. لتقوية الاستنتاج يمكن إضافة مجموعة مقارنة لم تشارك في البرنامج.",
        "A pre/post design shows change in the indicators but alone does not prove the program was the only "
        "cause. Adding a non-participating comparison group strengthens the conclusion.",
    ),
    MeasurementDesign.PRE_POST_FOLLOW_UP: (
        "القياس القبلي/البعدي مع المتابعة يُظهر التغير واستمراريته، لكنه وحده لا يثبت أن البرنامج هو السبب "
        "الوحيد. لتقوية الاستنتاج يمكن إضافة مجموعة مقارنة لم تشارك في البرنامج.",
        "Pre/post with follow-up shows change and its persistence, but alone does not prove the program was the "
        "only cause. A comparison group strengthens the conclusion.",
    ),
    MeasurementDesign.RETROSPECTIVE_PRE_POST: (
        "التصميم الاسترجاعي يعتمد على تقدير المشاركين لمستواهم السابق، لذا يقيس التغير المُدرَك لا التغير الفعلي.",
        "A retrospective design relies on participants' recollection of their prior level, so it measures "
        "perceived rather than actual change.",
    ),
    MeasurementDesign.REPEATED: (
        "القياسات المتكررة تكشف الاتجاهات عبر الزمن، لكنها لا تحدد وحدها أسباب التغير.",
        "Repeated measurements reveal trends over time but do not by themselves identify causes.",
    ),
    MeasurementDesign.COMPARISON_GROUP: (
        "مجموعة المقارنة تقوّي استنتاج الإسهام، ويجب أن تكون مشابهة للمجموعة المشاركة قدر الإمكان.",
        "A comparison group strengthens contribution claims and should be as similar as possible to participants.",
    ),
}


def result_caveat(level: EvidenceLevel, lang: str = "ar") -> str:
    ar, en = _RESULT_CAVEATS[level]
    return ar if lang == "ar" else en


def design_note(design: MeasurementDesign, lang: str = "ar") -> str | None:
    pair = _DESIGN_NOTES.get(design)
    if not pair:
        return None
    return pair[0] if lang == "ar" else pair[1]
