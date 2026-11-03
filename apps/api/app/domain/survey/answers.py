"""Server-side answer validation and normalization (SURVEY_ENGINE.md §4).

Mirrors ``packages/shared/src/survey/validate.ts`` (shared fixtures in
``tests/fixtures/answer-cases.json`` keep both sides in parity) and adds the
checks a browser cannot be trusted with: option membership, exclusive
options, matrix row keys, calendar dates. ``normalize_answer`` turns a valid
answer into storage rows with numeric/text projections for analytics.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..enums import QuestionType
from .document import ANSWERABLE_TYPES, CHOICE_TYPES, NUMERIC_TYPES, TEXT_TYPES, QuestionDoc
from .logic import is_answered

SHORT_TEXT_MAX = 500
LONG_TEXT_MAX = 5000
OTHER_TEXT_MAX = 500
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: File uploads are not collected in V1 (SURVEY_ENGINE.md §2): never block a respondent on them.
UNCOLLECTED_TYPES = frozenset({QuestionType.FILE})


@dataclass(frozen=True, slots=True)
class AnswerError:
    code: str
    params: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, **self.params}


@dataclass(frozen=True, slots=True)
class AnswerRow:
    """One stored answer row (matrix questions produce one row per statement)."""

    value: Any
    row_key: str | None = None
    numeric_value: float | None = None
    text_value: str | None = None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str):
        try:
            n = float(value.strip())
        except ValueError:
            return None
        return n if math.isfinite(n) else None
    return None


def _clean_text(value: Any) -> str:
    """NFC-normalize and strip control characters (keep newlines/tabs)."""
    text = unicodedata.normalize("NFC", str(value))
    return "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch) != "Cc").strip()


def _option_numbers(question: QuestionDoc) -> set[float]:
    out: set[float] = set()
    for option in question.options:
        n = _number(option.value)
        if n is not None:
            out.add(n)
    return out


def validate_answer(question: QuestionDoc, value: Any) -> AnswerError | None:
    if question.type not in ANSWERABLE_TYPES or question.type in UNCOLLECTED_TYPES:
        return None
    v = question.validation
    if not is_answered(value):
        return AnswerError("required") if question.required else None

    if question.type in TEXT_TYPES:
        if not isinstance(value, str | int | float) or isinstance(value, bool):
            return AnswerError("invalid")
        text = str(value)
        if v.min_length and len(text.strip()) < v.min_length:
            return AnswerError("min_length", {"min": v.min_length})
        maximum = v.max_length or (SHORT_TEXT_MAX if question.type == QuestionType.SHORT_TEXT else LONG_TEXT_MAX)
        if len(text) > maximum:
            return AnswerError("max_length", {"max": maximum})
        if v.pattern:
            try:
                if not re.search(v.pattern, text):
                    return AnswerError("pattern")
            except re.error:
                return None
        return None

    if question.type in NUMERIC_TYPES:
        n = _number(value)
        if n is None:
            return AnswerError("invalid")
        minimum = v.min if v.min is not None else (question.scale.min if question.scale else None)
        maximum = v.max if v.max is not None else (question.scale.max if question.scale else None)
        if minimum is not None and n < minimum:
            return AnswerError("min", {"min": minimum})
        if maximum is not None and n > maximum:
            return AnswerError("max", {"max": maximum})
        if question.type == QuestionType.LIKERT and question.options and n not in _option_numbers(question):
            return AnswerError("invalid")
        if question.type in (QuestionType.STAR, QuestionType.NPS, QuestionType.CSAT, QuestionType.CES) and n != int(n):
            return AnswerError("invalid")
        return None

    if question.type in CHOICE_TYPES:
        if question.type == QuestionType.MULTIPLE_CHOICE:
            if not isinstance(value, list):
                return AnswerError("invalid")
            values = [str(x) for x in value]
        else:
            if isinstance(value, list | dict):
                return AnswerError("invalid")
            values = [str(value)]
        valid = {o.value for o in question.options}
        if any(x not in valid for x in values) or len(set(values)) != len(values):
            return AnswerError("invalid")
        if question.type == QuestionType.MULTIPLE_CHOICE:
            exclusive = {o.value for o in question.options if o.is_exclusive}
            if len(values) > 1 and exclusive & set(values):
                return AnswerError("invalid")
            if v.min_choices and len(values) < v.min_choices:
                return AnswerError("min_choices", {"min": v.min_choices})
            if v.max_choices and len(values) > v.max_choices:
                return AnswerError("max_choices", {"max": v.max_choices})
        return None

    if question.type == QuestionType.MATRIX:
        if not isinstance(value, dict):
            return AnswerError("invalid")
        rows = {r.key for r in question.settings.rows}
        allowed = _option_numbers(question)
        for row, cell in value.items():
            if row not in rows:
                return AnswerError("invalid")
            if not is_answered(cell):
                continue
            n = _number(cell)
            if n is None or (allowed and n not in allowed):
                return AnswerError("invalid")
        if question.required and any(not is_answered(value.get(r)) for r in rows):
            return AnswerError("matrix_incomplete")
        return None

    if question.type == QuestionType.RANKING:
        if not isinstance(value, list):
            return AnswerError("invalid")
        values = [str(x) for x in value]
        valid = {o.value for o in question.options}
        if any(x not in valid for x in values) or len(set(values)) != len(values):
            return AnswerError("invalid")
        return None

    if question.type == QuestionType.DATE:
        text = str(value)
        if not _DATE_RE.match(text):
            return AnswerError("invalid")
        try:
            date.fromisoformat(text)
        except ValueError:
            return AnswerError("invalid")
        if v.date_min and text < v.date_min:
            return AnswerError("min", {"min": v.date_min})
        if v.date_max and text > v.date_max:
            return AnswerError("max", {"max": v.date_max})
        return None

    return None


def normalize_answer(question: QuestionDoc, value: Any, other_text: str | None = None) -> list[AnswerRow]:
    """Storage rows for a *validated* answer (empty when unanswered or not collected)."""
    if question.type not in ANSWERABLE_TYPES or question.type in UNCOLLECTED_TYPES or not is_answered(value):
        return []
    other = _clean_text(other_text)[:OTHER_TEXT_MAX] if other_text else ""

    if question.type in TEXT_TYPES:
        text = _clean_text(value)
        return [AnswerRow(value=text, text_value=text)]

    if question.type in NUMERIC_TYPES:
        n = _number(value)
        if n is None:
            return []
        stored: int | float = int(n) if n == int(n) else n
        return [AnswerRow(value=stored, numeric_value=n)]

    if question.type in CHOICE_TYPES:
        options = {o.value: o for o in question.options}
        if question.type == QuestionType.MULTIPLE_CHOICE:
            values = [str(x) for x in value]
            has_other = any(options[x].is_other for x in values if x in options)
            return [AnswerRow(value=values, text_value=(other or None) if has_other else None)]
        chosen = options.get(str(value))
        score = chosen.score if chosen is not None else None
        text = other if chosen is not None and chosen.is_other and other else None
        return [AnswerRow(value=str(value), numeric_value=float(score) if score is not None else None, text_value=text)]

    if question.type == QuestionType.MATRIX:
        rows = []
        for row in question.settings.rows:
            n = _number(value.get(row.key)) if isinstance(value, dict) else None
            if n is not None:
                rows.append(AnswerRow(value=int(n) if n == int(n) else n, row_key=row.key, numeric_value=n))
        return rows

    if question.type == QuestionType.RANKING:
        return [AnswerRow(value=[str(x) for x in value])]

    if question.type == QuestionType.DATE:
        return [AnswerRow(value=str(value))]

    return []
