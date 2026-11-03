"""Survey Quality Score (SURVEY_ENGINE.md §9) — deterministic, 0–100.

Notes are returned as codes + params so the UI localizes them; the AI
reviewer's open issues feed the Question Quality and Bias Risk axes.
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from ..enums import QuestionType
from .document import NUMERIC_TYPES, TEXT_TYPES, QuestionDoc, SurveyDoc
from .logic import LogicIssue

AXES: tuple[tuple[str, int], ...] = (
    ("question_quality", 25),
    ("goal_alignment", 15),
    ("bias_risk", 15),
    ("length", 10),
    ("coverage", 15),
    ("analysis_readiness", 10),
    ("logic_quality", 10),
)

#: Average answering time per question type (seconds).
SECONDS_PER_TYPE: dict[QuestionType, float] = {
    QuestionType.SHORT_TEXT: 30,
    QuestionType.LONG_TEXT: 60,
    QuestionType.SINGLE_CHOICE: 8,
    QuestionType.MULTIPLE_CHOICE: 12,
    QuestionType.DROPDOWN: 8,
    QuestionType.RATING: 6,
    QuestionType.STAR: 5,
    QuestionType.LIKERT: 7,
    QuestionType.MATRIX: 5,
    QuestionType.RANKING: 20,
    QuestionType.SLIDER: 7,
    QuestionType.NPS: 6,
    QuestionType.CSAT: 6,
    QuestionType.CES: 6,
    QuestionType.NUMBER: 10,
    QuestionType.DATE: 10,
    QuestionType.FILE: 30,
    QuestionType.INFORMATION: 5,
    QuestionType.SECTION: 0,
}
MATRIX_SECONDS_PER_ROW = 6
#: Pulse surveys (CX.md §3) take one tap per screen and move on by themselves: a rating is
#: answered in a couple of seconds and an optional comment is a short sentence (or skipped).
PULSE_TAP_SECONDS = 2.5
PULSE_TEXT_SECONDS = 20
PULSE_TAP_TYPES = frozenset(
    {
        QuestionType.NPS,
        QuestionType.CSAT,
        QuestionType.CES,
        QuestionType.STAR,
        QuestionType.RATING,
        QuestionType.LIKERT,
        QuestionType.SINGLE_CHOICE,
        QuestionType.DROPDOWN,
    }
)
MAX_QUESTION_CHARS = 180
#: Unlinked open-text questions tolerated before Goal Alignment drops.
MAX_FREE_OPEN_QUESTIONS = 3

_LEADING = re.compile(
    r"(ألا تعتقد|ألا ترى|ألا توافق|أليس|اليس من|لا شك أن|كم أعجبك|إلى أي حد أعجبك|"
    r"don't you|wouldn't you|isn't it|aren't you|how much did you (enjoy|like|love)|how great)",
    re.IGNORECASE,
)

_SEVERITY_WEIGHT = {"HIGH": 4.0, "MEDIUM": 2.5, "LOW": 1.0}
_BIAS_TYPES = {"LEADING", "BIASED"}


@dataclass(slots=True)
class Note:
    code: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class AxisScore:
    key: str
    score: float
    max: int
    notes: list[Note] = field(default_factory=list)


@dataclass(slots=True)
class QualityReport:
    total: int
    axes: list[AxisScore]
    estimated_minutes: float
    answerable_count: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "estimated_minutes": round(self.estimated_minutes, 1),
            "answerable_count": self.answerable_count,
            "axes": [
                {
                    "key": a.key,
                    "score": round(a.score, 1),
                    "max": a.max,
                    "notes": [{"code": n.code, "params": n.params} for n in a.notes],
                }
                for a in self.axes
            ],
        }


@dataclass(frozen=True, slots=True)
class DimensionRef:
    id: uuid.UUID
    name: str


@dataclass(frozen=True, slots=True)
class IndicatorRef:
    id: uuid.UUID
    name: str
    dimension_id: uuid.UUID | None


def estimate_minutes(doc: SurveyDoc) -> float:
    if doc.settings.experience == "pulse":
        return _pulse_seconds(doc) / 60
    seconds = 0.0
    for q in doc.questions():
        if q.type == QuestionType.MATRIX:
            seconds += SECONDS_PER_TYPE[q.type] + MATRIX_SECONDS_PER_ROW * len(q.settings.rows)
        else:
            seconds += SECONDS_PER_TYPE.get(q.type, 10)
    return seconds / 60


def _pulse_seconds(doc: SurveyDoc) -> float:
    """A typical pulse respondent: taps for ratings and choices, a short sentence for open
    questions, and half weight for questions shown only to some respondents (display logic —
    e.g. «what should we improve?» for detractors versus «what did you like?» for promoters)."""
    conditional = {r.target_key for r in doc.logic if r.type == "DISPLAY" and r.enabled and r.target_key}
    seconds = 0.0
    for q in doc.questions():
        if q.type in PULSE_TAP_TYPES:
            s = PULSE_TAP_SECONDS
        elif q.type in TEXT_TYPES:
            s = PULSE_TEXT_SECONDS
        else:
            s = SECONDS_PER_TYPE.get(q.type, 10)
        seconds += s / 2 if q.key in conditional else s
    return seconds


def _clamp(value: float, maximum: float) -> float:
    return max(0.0, min(maximum, value))


def _items(q: QuestionDoc) -> int:
    """Number of measurement items a question contributes (matrix rows count each)."""
    return max(1, len(q.settings.rows)) if q.type == QuestionType.MATRIX else 1


def quality_report(
    doc: SurveyDoc,
    *,
    dimensions: Sequence[DimensionRef] = (),
    indicators: Sequence[IndicatorRef] = (),
    recommended_minutes: float | None = None,
    review_issues: Sequence[dict[str, Any]] = (),
    logic_issues: Sequence[LogicIssue] = (),
) -> QualityReport:
    questions = [q for q in doc.questions() if q.answerable]
    measures = [q for q in questions if not q.settings.is_profile]
    open_issues = [i for i in review_issues if i.get("status", "open") == "open"]
    axes: dict[str, AxisScore] = {key: AxisScore(key, float(mx), mx) for key, mx in AXES}

    if not questions:
        for axis in axes.values():
            axis.score = 0
        axes["question_quality"].notes.append(Note("no_questions"))
        return QualityReport(total=0, axes=list(axes.values()), estimated_minutes=0, answerable_count=0)

    # -- Question quality ----------------------------------------------------
    qq = axes["question_quality"]
    for issue in open_issues:
        if issue.get("type") not in _BIAS_TYPES:
            qq.score -= _SEVERITY_WEIGHT.get(str(issue.get("severity", "MEDIUM")), 2.5)
    long_questions = [q.key for q in questions if len(q.text) > MAX_QUESTION_CHARS]
    if long_questions:
        qq.score -= 1.5 * len(long_questions)
        qq.notes.append(Note("long_questions", {"keys": long_questions[:10], "count": len(long_questions)}))
    texts = defaultdict(list)
    for q in questions:
        texts[re.sub(r"\s+", " ", q.text.strip().lower())].append(q.key)
    duplicates = [keys for keys in texts.values() if len(keys) > 1]
    if duplicates:
        qq.score -= 3 * len(duplicates)
        qq.notes.append(Note("duplicate_questions", {"groups": duplicates[:5]}))
    review_count = sum(1 for i in open_issues if i.get("type") not in _BIAS_TYPES)
    if review_count:
        qq.notes.append(Note("open_review_issues", {"count": review_count}))
    qq.score = _clamp(qq.score, qq.max)

    # -- Goal alignment -------------------------------------------------------
    # Closed items must feed the plan. A few unlinked open questions (strengths, suggestions)
    # are normal practice; only an excess of them costs points.
    ga = axes["goal_alignment"]
    closed = [q for q in measures if q.type not in TEXT_TYPES]
    open_unlinked = [q.key for q in measures if q.type in TEXT_TYPES and not (q.dimension_id or q.indicator_id)]
    scored = closed or measures
    if scored:
        linked = [q for q in scored if q.dimension_id or q.indicator_id]
        ga.score = ga.max * len(linked) / len(scored)
        unlinked = [q.key for q in scored if not (q.dimension_id or q.indicator_id)]
        if unlinked:
            ga.notes.append(Note("unlinked_questions", {"keys": unlinked[:10], "count": len(unlinked)}))
        extra_open = len(open_unlinked) - MAX_FREE_OPEN_QUESTIONS
        if closed and extra_open > 0:
            ga.score -= extra_open
            ga.notes.append(Note("many_open_questions", {"count": len(open_unlinked), "max": MAX_FREE_OPEN_QUESTIONS}))
        ga.score = _clamp(ga.score, ga.max)
    else:
        ga.score = 0
        ga.notes.append(Note("no_measure_questions"))

    # -- Bias risk -------------------------------------------------------------
    br = axes["bias_risk"]
    leading = [q.key for q in questions if _LEADING.search(q.text)]
    if leading:
        br.score -= 4 * len(leading)
        br.notes.append(Note("leading_wording", {"keys": leading[:10]}))
    for issue in open_issues:
        if issue.get("type") in _BIAS_TYPES:
            br.score -= _SEVERITY_WEIGHT.get(str(issue.get("severity", "MEDIUM")), 2.5)
    unlabeled = [
        q.key
        for q in questions
        if q.type in (QuestionType.RATING, QuestionType.SLIDER)
        and q.scale
        and not (q.scale.min_label and q.scale.max_label)
    ]
    if unlabeled:
        br.score -= 1 * len(unlabeled)
        br.notes.append(Note("unlabeled_scale_ends", {"keys": unlabeled[:10]}))
    br.score = _clamp(br.score, br.max)

    # -- Length ----------------------------------------------------------------
    ln = axes["length"]
    minutes = estimate_minutes(doc)
    pulse_target = max(0.5, len(questions) * 0.1)  # a pulse is meant to take about a minute
    target = recommended_minutes or (
        pulse_target if doc.settings.experience == "pulse" else max(2.0, len(questions) * 0.35)
    )
    ratio = minutes / target if target else 1
    if ratio > 1.4 or ratio < 0.5:
        ln.score = _clamp(ln.max * (1 - (abs(ratio - 1) - 0.4)), ln.max)
        ln.notes.append(Note("length_off_target", {"estimated": round(minutes, 1), "target": round(target, 1)}))
    if minutes > 20:
        ln.score = min(ln.score, ln.max / 2)
        ln.notes.append(Note("too_long", {"estimated": round(minutes, 1)}))

    # -- Coverage --------------------------------------------------------------
    cv = axes["coverage"]
    if dimensions:
        per_dim: dict[uuid.UUID, int] = defaultdict(int)
        for q in measures:
            if q.dimension_id:
                per_dim[q.dimension_id] += _items(q)
        weak = [d.name for d in dimensions if per_dim.get(d.id, 0) < 2]
        covered_ratio = 1 - len(weak) / len(dimensions)
        indicator_ratio = 1.0
        if indicators:
            fed = {q.indicator_id for q in measures if q.indicator_id}
            dims_with_items = {d for d, n in per_dim.items() if n > 0}
            served = [i for i in indicators if i.id in fed or (i.dimension_id and i.dimension_id in dims_with_items)]
            indicator_ratio = len(served) / len(indicators)
            unserved = [i.name for i in indicators if i not in served]
            if unserved:
                cv.notes.append(Note("indicators_without_questions", {"names": unserved[:10]}))
        cv.score = cv.max * (0.7 * covered_ratio + 0.3 * indicator_ratio)
        if weak:
            cv.notes.append(Note("dimensions_under_covered", {"names": weak[:10]}))
    else:
        cv.score = cv.max * min(1.0, len(measures) / 5)
        cv.notes.append(Note("no_dimensions"))

    # -- Analysis readiness ----------------------------------------------------
    ar = axes["analysis_readiness"]
    linked_measures = [q for q in measures if q.dimension_id]
    if linked_measures:
        closed = [
            q
            for q in linked_measures
            if q.type in NUMERIC_TYPES
            or q.type == QuestionType.MATRIX
            or (q.type == QuestionType.SINGLE_CHOICE and any(o.score is not None for o in q.options))
        ]
        ar.score = ar.max * (len(closed) / len(linked_measures))
        mixed: list[str] = []
        ranges: dict[uuid.UUID, set[tuple[int, int]]] = defaultdict(set)
        for q in closed:
            if q.scale and q.dimension_id:
                ranges[q.dimension_id].add((q.scale.min, q.scale.max))
        for dim_id, found in ranges.items():
            if len(found) > 1:
                name = next((d.name for d in dimensions if d.id == dim_id), str(dim_id))
                mixed.append(name)
        if mixed:
            ar.score -= 2 * len(mixed)
            ar.notes.append(Note("mixed_scales", {"names": mixed}))
        if len(closed) < len(linked_measures):
            ar.notes.append(Note("open_items_on_indicators", {"count": len(linked_measures) - len(closed)}))
        ar.score = _clamp(ar.score, ar.max)
    else:
        ar.score = ar.max * 0.5 if [q for q in measures if q.type not in TEXT_TYPES] else 0
        ar.notes.append(Note("no_linked_measures"))

    # -- Logic quality ---------------------------------------------------------
    lq = axes["logic_quality"]
    if logic_issues:
        lq.score = _clamp(lq.max - 3 * len(logic_issues), lq.max)
        lq.notes.append(Note("logic_issues", {"count": len(logic_issues)}))

    total = round(sum(a.score for a in axes.values()))
    return QualityReport(
        total=total, axes=list(axes.values()), estimated_minutes=minutes, answerable_count=len(questions)
    )
