"""Response Quality Engine (SURVEY_ENGINE.md §12) — deterministic, explainable.

Each submission gets a 0–100 score and flags with the evidence behind them.
Nothing here guesses intent: the flags describe observable patterns and the
survey owner decides (KEEP / EXCLUDE) — analytics never silently drops data.
"""

from __future__ import annotations

import re
import statistics
import unicodedata
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from ..enums import QualityStatus, QuestionType
from .document import SCALE_TYPES, TEXT_TYPES, QuestionDoc, SurveyDoc
from .logic import is_answered
from .quality import MATRIX_SECONDS_PER_ROW, PULSE_TAP_SECONDS, PULSE_TAP_TYPES, SECONDS_PER_TYPE

#: Below this share of the expected answering time a response is "too fast".
TOO_FAST_RATIO = 0.33
#: …and below this one it is almost certainly not read.
WAY_TOO_FAST_RATIO = 0.2
MIN_EXPECTED_SECONDS = 20
#: Pulse surveys (CX.md §3) are answered by taps; per-tap times are shared with quality.py.
PULSE_MIN_EXPECTED_SECONDS = 8
#: Straight-lining needs enough items to mean something.
STRAIGHTLINE_MIN_ITEMS = 5

WEIGHTS = {
    "way_too_fast": 50,
    "too_fast": 35,
    "straightlining": 25,
    "inconsistent_reverse_items": 15,
    "low_effort_text": 10,
    "skipped_optional": 10,
    "repeat_device": 10,
}
VALID_FROM = 70
SUSPICIOUS_FROM = 40

_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


@dataclass(slots=True)
class QualityAssessment:
    score: int
    status: QualityStatus
    flags: list[dict[str, Any]] = field(default_factory=list)


def expected_seconds(questions: list[QuestionDoc], *, pulse: bool = False) -> float:
    seconds = 0.0
    for q in questions:
        if pulse and q.type in PULSE_TAP_TYPES:
            seconds += PULSE_TAP_SECONDS
        elif q.type == QuestionType.MATRIX:
            seconds += SECONDS_PER_TYPE[q.type] + MATRIX_SECONDS_PER_ROW * len(q.settings.rows)
        else:
            seconds += SECONDS_PER_TYPE.get(q.type, 10)
    return seconds


def is_low_effort_text(text: str, *, long_answer: bool = True) -> bool:
    """Keyboard mashing, one repeated character, or (for long answers) no letters at all.
    Short answers may legitimately be numbers ("16", "10")."""
    compact = "".join(ch for ch in unicodedata.normalize("NFKC", text) if not ch.isspace())
    if not compact:
        return False
    if long_answer and not _LETTER.search(compact):
        return True  # only digits/punctuation, e.g. "....", "123"
    if len(compact) >= 4 and len(set(compact)) == 1:
        return True  # "ههههه", "aaaa"
    return len(compact) >= 8 and len(set(compact)) / len(compact) < 0.25


def _scale_points(question: QuestionDoc, answers: Mapping[str, Any]) -> list[tuple[str, float, float, float]]:
    """(item id, value, min, max) for every answered scale item of a question."""
    value = answers.get(question.key)
    if question.type == QuestionType.MATRIX and isinstance(value, Mapping):
        numbers = [float(o.value) for o in question.options if o.value.lstrip("-").isdigit()]
        if not numbers:
            return []
        lo, hi = min(numbers), max(numbers)
        return [(f"{question.key}.{row}", float(v), lo, hi) for row, v in value.items() if isinstance(v, int | float)]
    if question.type in SCALE_TYPES and isinstance(value, int | float) and not isinstance(value, bool):
        lo = question.scale.min if question.scale else 1
        hi = question.scale.max if question.scale else 5
        return [(question.key, float(value), float(lo), float(hi))]
    return []


def assess_response(
    doc: SurveyDoc,
    answers: Mapping[str, Any],
    *,
    visible_keys: list[str],
    duration_seconds: float | None,
    repeat_device: bool = False,
) -> QualityAssessment:
    by_key = doc.question_map()
    visible = [by_key[k] for k in visible_keys if k in by_key and by_key[k].answerable]
    answered = [q for q in visible if is_answered(answers.get(q.key))]
    flags: list[dict[str, Any]] = []
    pulse = doc.settings.experience == "pulse"

    # -- Speed: compared with the expected time for the questions actually answered.
    expected = max(
        PULSE_MIN_EXPECTED_SECONDS if pulse else MIN_EXPECTED_SECONDS, expected_seconds(answered, pulse=pulse)
    )
    if duration_seconds is not None and answered:
        ratio = duration_seconds / expected
        if ratio < WAY_TOO_FAST_RATIO:
            flags.append({"code": "way_too_fast", "seconds": round(duration_seconds), "expected": round(expected)})
        elif ratio < TOO_FAST_RATIO:
            flags.append({"code": "too_fast", "seconds": round(duration_seconds), "expected": round(expected)})

    # -- Straight-lining: identical answers across many scale items (normalized position).
    # Not for pulse CX ratings: all-top or all-bottom answers are exactly how delighted or upset
    # customers rate a visit, and flagging them would hide the detractors the closed loop exists for.
    points = [p for q in answered for p in _scale_points(q, answers)]
    if len(points) >= STRAIGHTLINE_MIN_ITEMS and not pulse:
        positions = {round((v - lo) / (hi - lo), 3) if hi > lo else 0.0 for _, v, lo, hi in points}
        if len(positions) == 1:
            flags.append({"code": "straightlining", "items": len(points)})

    # -- Reverse-scored items contradicting regular items of the same dimension.
    groups: dict[str, dict[bool, list[float]]] = defaultdict(lambda: {True: [], False: []})
    for q in answered:
        if not q.dimension_id or q.type not in SCALE_TYPES or not q.scale:
            continue
        for _, v, lo, hi in _scale_points(q, answers):
            if hi > lo:
                groups[str(q.dimension_id)][q.scale.reverse_scored].append((v - lo) / (hi - lo))
    for dim, sides in groups.items():
        if sides[True] and sides[False]:
            regular = statistics.fmean(sides[False])
            reversed_agreement = statistics.fmean(sides[True])
            # Agreeing strongly with both a statement and its reverse is contradictory.
            if (regular >= 0.75 and reversed_agreement >= 0.75) or (regular <= 0.25 and reversed_agreement <= 0.25):
                flags.append({"code": "inconsistent_reverse_items", "dimension_id": dim})
                break

    # -- Open answers with no content.
    junk = [
        q.key
        for q in answered
        if q.type in TEXT_TYPES
        and isinstance(answers.get(q.key), str)
        and is_low_effort_text(answers[q.key], long_answer=q.type == QuestionType.LONG_TEXT)
    ]
    if junk:
        flags.append({"code": "low_effort_text", "keys": junk[:10]})

    # -- Most optional questions skipped.
    optional = [q for q in visible if not q.required]
    if len(optional) >= 4:
        skipped = [q for q in optional if not is_answered(answers.get(q.key))]
        if len(skipped) / len(optional) > 0.5:
            flags.append({"code": "skipped_optional", "skipped": len(skipped), "optional": len(optional)})

    if repeat_device:
        flags.append({"code": "repeat_device"})

    penalty = sum(WEIGHTS[f["code"]] * (2 if f["code"] == "low_effort_text" and len(junk) > 1 else 1) for f in flags)
    score = max(0, min(100, 100 - penalty))
    status = (
        QualityStatus.VALID
        if score >= VALID_FROM
        else QualityStatus.SUSPICIOUS
        if score >= SUSPICIOUS_FROM
        else QualityStatus.LOW_QUALITY
    )
    return QualityAssessment(score=score, status=status, flags=flags)
