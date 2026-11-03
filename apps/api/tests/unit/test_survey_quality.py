from __future__ import annotations

import uuid

from app.domain.survey.document import SurveyDoc
from app.domain.survey.logic import LogicIssue
from app.domain.survey.quality import DimensionRef, IndicatorRef, estimate_minutes, quality_report

DIM_A, DIM_B = uuid.uuid4(), uuid.uuid4()
IND_A = uuid.uuid4()


def _doc(questions: list[dict]) -> SurveyDoc:
    return SurveyDoc.model_validate({"title": "t", "sections": [{"key": "s1", "questions": questions}]})


def _likert(key: str, dim: uuid.UUID | None, text: str | None = None) -> dict:
    return {"key": key, "type": "LIKERT", "text": text or f"عبارة {key}", "dimension_id": str(dim) if dim else None}


def _axis(report, key):  # type: ignore[no-untyped-def]
    return next(a for a in report.axes if a.key == key)


def test_well_built_survey_scores_high() -> None:
    doc = _doc(
        [
            {
                "key": "grade",
                "type": "SINGLE_CHOICE",
                "text": "الصف",
                "options": [{"value": "10", "label": "أول"}, {"value": "11", "label": "ثاني"}],
                "settings": {"is_profile": True},
            },
            _likert("a1", DIM_A),
            _likert("a2", DIM_A),
            _likert("b1", DIM_B),
            _likert("b2", DIM_B),
            {"key": "open", "type": "LONG_TEXT", "text": "ملاحظاتك"},
        ]
    )
    report = quality_report(
        doc,
        dimensions=[DimensionRef(DIM_A, "المعرفة"), DimensionRef(DIM_B, "الثقة")],
        indicators=[IndicatorRef(IND_A, "متوسط المعرفة", DIM_A)],
        recommended_minutes=2,
    )
    assert report.total >= 85, report.as_dict()
    assert _axis(report, "coverage").score == 15
    assert _axis(report, "logic_quality").score == 10


def test_unlinked_and_under_covered_dimensions_lower_scores() -> None:
    doc = _doc([_likert("a1", DIM_A), _likert("x", None), _likert("y", None)])
    report = quality_report(doc, dimensions=[DimensionRef(DIM_A, "المعرفة"), DimensionRef(DIM_B, "الثقة")])
    ga = _axis(report, "goal_alignment")
    assert round(ga.score, 1) == 5.0  # 1 of 3 linked
    cv = _axis(report, "coverage")
    assert cv.score < 15
    assert {n.code for n in cv.notes} >= {"dimensions_under_covered"}


def test_leading_questions_and_review_issues_penalized() -> None:
    doc = _doc([_likert("a1", DIM_A, "ألا تعتقد أن البرنامج كان رائعًا؟"), _likert("a2", DIM_A)])
    issues = [
        {"id": "1", "question_key": "a2", "type": "DOUBLE_BARRELED", "severity": "HIGH", "status": "open"},
        {"id": "2", "question_key": "a1", "type": "LEADING", "severity": "HIGH", "status": "open"},
        {"id": "3", "question_key": "a1", "type": "AMBIGUOUS", "severity": "HIGH", "status": "rejected"},
    ]
    report = quality_report(doc, dimensions=[DimensionRef(DIM_A, "المعرفة")], review_issues=issues)
    assert _axis(report, "bias_risk").score == 15 - 4 - 4  # wording heuristic + LEADING issue
    assert _axis(report, "question_quality").score == 25 - 4  # rejected issues don't count


def test_logic_issues_and_length() -> None:
    questions = [{"key": f"t{i}", "type": "LONG_TEXT", "text": f"سؤال {i}"} for i in range(25)]
    doc = _doc(questions)
    issue = LogicIssue(0, None, "backward_skip", "x")
    report = quality_report(doc, recommended_minutes=5, logic_issues=[issue])
    assert estimate_minutes(doc) == 25
    assert _axis(report, "length").score <= 5
    assert _axis(report, "logic_quality").score == 7


def test_empty_survey_scores_zero() -> None:
    doc = _doc([{"key": "info", "type": "INFORMATION", "text": "مرحبا"}])
    report = quality_report(doc)
    assert report.total == 0 and report.answerable_count == 0


def test_open_questions_do_not_dilute_goal_alignment_until_excessive() -> None:
    open_q = [{"key": f"open{i}", "type": "LONG_TEXT", "text": f"سؤال مفتوح {i}"} for i in range(5)]
    dims = [DimensionRef(DIM_A, "المعرفة"), DimensionRef(DIM_B, "الثقة")]
    closed = [_likert("a1", DIM_A), _likert("a2", DIM_A), _likert("b1", DIM_B), _likert("b2", DIM_B)]

    few = quality_report(_doc([*closed, *open_q[:3]]), dimensions=dims)
    assert _axis(few, "goal_alignment").score == 15  # strengths/suggestions questions are normal practice
    assert not _axis(few, "goal_alignment").notes

    many = quality_report(_doc([*closed, *open_q]), dimensions=dims)
    ga = _axis(many, "goal_alignment")
    assert ga.score == 13  # 2 open questions beyond the tolerated 3
    assert [n.code for n in ga.notes] == ["many_open_questions"]


def test_pulse_survey_is_estimated_at_about_a_minute() -> None:
    from app.domain.survey.quality import estimate_minutes
    from app.domain.survey.templates import store_visit

    pulse = store_visit("ar")
    assert 0.5 <= estimate_minutes(pulse) <= 1.2  # taps, short comments, conditional questions at half weight
    classic = pulse.model_copy(update={"settings": pulse.settings.model_copy(update={"experience": "standard"})})
    assert estimate_minutes(classic) > 2.5  # the same questions as a classic form
