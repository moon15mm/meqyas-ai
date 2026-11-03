from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.domain.survey.answers import normalize_answer, validate_answer
from app.domain.survey.document import QuestionDoc

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "answer-cases.json").read_text(encoding="utf-8")
)
QUESTIONS = {key: QuestionDoc.model_validate(raw) for key, raw in FIXTURES["questions"].items()}


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=lambda c: f"{c['q']}:{json.dumps(c['value'])}")
def test_answer_validation_parity(case: dict[str, Any]) -> None:
    error = validate_answer(QUESTIONS[case["q"]], case["value"])
    assert (error.code if error else None) == case["expected"]


def test_normalize_projections() -> None:
    likert = normalize_answer(QUESTIONS["likert"], "4")
    assert [(r.value, r.numeric_value) for r in likert] == [(4, 4.0)]

    matrix = normalize_answer(QUESTIONS["matrix"], {"content": 2, "trainer": 3})
    assert [(r.row_key, r.numeric_value) for r in matrix] == [("content", 2.0), ("trainer", 3.0)]

    other = normalize_answer(QUESTIONS["single"], "other", other_text="  الصف التاسع\u0000 ")
    assert other[0].value == "other" and other[0].text_value == "الصف التاسع"  # control chars stripped
    plain = normalize_answer(QUESTIONS["single"], "10", other_text="ignored")
    assert plain[0].text_value is None

    multi = normalize_answer(QUESTIONS["multi"], ["a", "b"])
    assert multi[0].value == ["a", "b"] and multi[0].numeric_value is None

    text = normalize_answer(QUESTIONS["long"], "  رائع جدًا  ")
    assert text[0].text_value == "رائع جدًا"

    assert normalize_answer(QUESTIONS["file"], {"name": "x.pdf"}) == []
    assert normalize_answer(QUESTIONS["long"], "") == []
