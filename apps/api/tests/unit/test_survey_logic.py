from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.domain.survey.document import LogicRuleDoc, SurveyDoc
from app.domain.survey.logic import compute_path, evaluate, pipe, validate_logic

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "logic-cases.json").read_text(encoding="utf-8")
)
DOC = SurveyDoc.model_validate(FIXTURES["survey"])


@pytest.mark.parametrize("case", FIXTURES["conditions"], ids=lambda c: c["name"])
def test_condition_parity(case: dict) -> None:
    assert evaluate(case["condition"], case["answers"]) is case["expected"]


@pytest.mark.parametrize("case", FIXTURES["paths"], ids=lambda c: c["name"])
def test_path_parity(case: dict) -> None:
    result = compute_path(DOC, case["answers"])
    assert result.visible == case["expected_visible"]
    assert result.ended_by == case["expected_ended_by"]


@pytest.mark.parametrize("case", FIXTURES["piping"], ids=lambda c: c["text"])
def test_piping_parity(case: dict) -> None:
    assert pipe(case["text"], DOC, case["answers"]) == case["expected"]


def test_fixture_survey_logic_is_valid() -> None:
    assert validate_logic(DOC) == []


def _with_rule(**rule: object) -> SurveyDoc:
    data = DOC.model_dump(mode="json")
    data["logic"] = [rule]
    return SurveyDoc.model_validate(data)


@pytest.mark.parametrize(
    ("rule", "code"),
    [
        ({"type": "SKIP", "source_key": "recommend", "target_key": "s1", "condition": {}}, "backward_skip"),
        ({"type": "SKIP", "source_key": "consent", "target_key": "nowhere", "condition": {}}, "unknown_target"),
        ({"type": "SKIP", "source_key": "ghost", "target_key": "s3", "condition": {}}, "unknown_source"),
        (
            {
                "type": "DISPLAY",
                "target_key": "grade",
                "condition": {"question": "satisfaction", "op": "eq", "value": 1},
            },
            "forward_reference",
        ),
        (
            {"type": "DISPLAY", "target_key": "comment", "condition": {"question": "comment", "op": "answered"}},
            "self_reference",
        ),
        (
            {"type": "DISPLAY", "target_key": "comment", "condition": {"question": "ghost", "op": "answered"}},
            "unknown_question",
        ),
        (
            {"type": "DISPLAY", "target_key": "comment", "condition": {"question": "grade", "op": "between"}},
            "unknown_operator",
        ),
        ({"type": "DISPLAY", "target_key": "comment", "condition": {"question": "grade", "op": "eq"}}, "missing_value"),
        (
            {"type": "DISPLAY", "target_key": "comment", "condition": {"question": "grade", "op": "eq", "value": "13"}},
            "unknown_option",
        ),
        (
            {"type": "DISPLAY", "target_key": "comment", "condition": {"question": "thanks", "op": "answered"}},
            "not_answerable",
        ),
        (
            {
                "type": "DISPLAY",
                "target_key": "comment",
                "condition": {"question": "skills", "row": "math", "op": "answered"},
            },
            "unknown_row",
        ),
        ({"type": "QUOTA", "condition": {"question": "grade", "op": "eq", "value": "10"}}, "missing_limit"),
        ({"type": "DISPLAY", "target_key": "comment", "condition": {"any": []}}, "empty_group"),
    ],
)
def test_validation_detects_bad_rules(rule: dict, code: str) -> None:
    issues = validate_logic(_with_rule(**rule))
    assert code in {i.code for i in issues}, issues


def test_skip_into_randomized_section_is_rejected() -> None:
    data = DOC.model_dump(mode="json")
    data["sections"][2]["randomize_questions"] = True
    data["logic"] = [{"type": "SKIP", "source_key": "ai_tools", "target_key": "comment", "condition": {}}]
    assert "randomized_target" in {i.code for i in validate_logic(SurveyDoc.model_validate(data))}


def test_section_display_rule_hides_whole_section() -> None:
    data = DOC.model_dump(mode="json")
    data["logic"] = [
        {"type": "DISPLAY", "target_key": "s3", "condition": {"question": "grade", "op": "eq", "value": "12"}}
    ]
    doc = SurveyDoc.model_validate(data)
    visible = compute_path(doc, {"grade": "10"}).visible
    assert "recommend" not in visible and "thanks" not in visible
    assert "recommend" in compute_path(doc, {"grade": "12"}).visible


def test_disabled_rules_are_ignored() -> None:
    rule = LogicRuleDoc(
        type="END", source_key="consent", condition={"question": "consent", "op": "eq", "value": "no"}, enabled=False
    )
    data = DOC.model_dump(mode="json")
    data["logic"] = [rule.model_dump()]
    assert compute_path(SurveyDoc.model_validate(data), {"consent": "no"}).ended_by is None
