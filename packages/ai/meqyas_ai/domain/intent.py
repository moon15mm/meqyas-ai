"""Lightweight intent signals (Arabic + English) used to *advise* the
Measurement Architect and to detect over-claiming after generation.

These are not a classifier replacement — the LLM decides — but they let the
platform guarantee the core promise: a request about satisfaction is never
silently turned into an "impact" study.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_AR_DIACRITICS = re.compile("[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
_TATWEEL = "\u0640"


def normalize_ar(text: str) -> str:
    """Normalize Arabic for matching: strip diacritics/tatweel, unify alef,
    ya/alef-maqsura and ta-marbuta, lowercase Latin."""
    t = _AR_DIACRITICS.sub("", text or "").replace(_TATWEEL, "")
    t = re.sub("[إأآٱ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return t.lower()


# Arabic stems are matched as substrings of normalized text (see normalize_ar);
# Latin stems are matched at a word start to avoid e.g. "pre" in "present".
_SIGNALS: dict[str, tuple[str, ...]] = {
    "satisfaction": (
        "رضا",
        "رضى",
        "راضي",
        "راضون",
        "راضين",
        "انطباع",
        "اراء",
        "رايهم",
        "راي ",
        "تجربه",
        "تقييم النشاط",
        "استحسان",
        "satisf",
        "opinion",
        "impression",
        "perception",
        "feedback",
        "experience",
    ),
    "change": (
        "تحسن",
        "تغير",
        "تطور",
        "الفرق",
        "قبل وبعد",
        "قبلي",
        "بعدي",
        "هل ادي",
        "هل ساهم",
        "ارتفاع",
        "انخفاض",
        "زياده",
        "improv",
        "chang",
        "differen",
        "before and after",
        "pre-test",
        "post-test",
        "pre/post",
        "baseline",
        "increase",
        "decrease",
        "progress",
    ),
    "impact": (
        "اثر",
        "تاثير",
        "نتايج",
        "نتيجه",
        "مخرجات",
        "فاعليه",
        "impact",
        "effect",
        "outcome",
        "result",
    ),
    "learning": (
        "معرفه",
        "معارف",
        "مهاره",
        "مهارات",
        "وعي",
        "اتقان",
        "كفايات",
        "knowledge",
        "skill",
        "awareness",
        "competenc",
        "understanding",
    ),
    "behavior": (
        "سلوك",
        "ممارسه",
        "ممارسات",
        "استخدام",
        "تطبيق",
        "عادات",
        "توظيف",
        "behavio",
        "practice",
        "usage",
        "adoption",
        "use of",
    ),
    "needs": ("احتياج", "حاجات", "فجوه", "فجوات", "اولويات", "need", "gap"),
    "training": ("تدريب", "دوره", "ورشه", "training", "course", "workshop"),
    "event": ("فعاليه", "حفل", "ملتقي", "مؤتمر", "يوم مفتوح", "event", "conference", "ceremony"),
    "repeated": ("دوري", "شهري", "اسبوعي", "نبض", "طولي", "pulse", "monthly", "weekly", "longitudinal", "over time"),
    "follow_up": ("متابعه", "بعد شهر", "استمرار", "follow-up", "follow up", "sustain", "retention"),
}

_LATIN = re.compile(r"[a-z]")


@dataclass(slots=True)
class IntentSignals:
    matches: dict[str, list[str]] = field(default_factory=dict)

    def has(self, key: str) -> bool:
        return bool(self.matches.get(key))

    @property
    def reaction_only(self) -> bool:
        """Talks about satisfaction/impressions and NOT about change/impact/learning/behavior."""
        return self.has("satisfaction") and not (
            self.has("change") or self.has("impact") or self.has("learning") or self.has("behavior")
        )

    @property
    def wants_change(self) -> bool:
        return self.has("change") or self.has("impact")

    def advisory_text(self) -> str:
        if not self.matches:
            return "No strong lexical signals detected."
        parts = [f"{k}: {', '.join(sorted(set(v))[:6])}" for k, v in self.matches.items() if v]
        note = ""
        if self.reaction_only:
            note = " → The request reads as reaction-level (satisfaction/impressions), NOT change/impact."
        elif self.wants_change:
            note = " → The request asks about change/effect: a baseline is needed to observe change."
        return "; ".join(parts) + note


def _stem_found(stem: str, padded: str) -> bool:
    norm = normalize_ar(stem)
    if _LATIN.match(norm):
        return re.search(rf"(?<![a-z]){re.escape(norm)}", padded) is not None
    return norm in padded


def detect_signals(text: str) -> IntentSignals:
    padded = f" {normalize_ar(text)} "
    matches: dict[str, list[str]] = {}
    for key, stems in _SIGNALS.items():
        found = [stem.strip() for stem in stems if _stem_found(stem, padded)]
        if found:
            matches[key] = found
    return IntentSignals(matches=matches)
