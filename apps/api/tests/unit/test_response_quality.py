from __future__ import annotations

import uuid

from app.domain.enums import QualityStatus
from app.domain.survey.document import SurveyDoc
from app.domain.survey.response_quality import assess_response, is_low_effort_text

DIM = uuid.uuid4()


def _likert(key: str, *, reverse: bool = False, required: bool = True) -> dict:
    return {
        "key": key,
        "type": "LIKERT",
        "text": f"عبارة {key}",
        "required": required,
        "dimension_id": str(DIM),
        "scale": {"min": 1, "max": 5, "reverse_scored": reverse},
    }


def _doc(questions: list[dict]) -> SurveyDoc:
    return SurveyDoc.model_validate({"title": "t", "sections": [{"key": "s1", "questions": questions}]})


SIX = _doc([_likert(f"l{i}") for i in range(6)] + [{"key": "open", "type": "LONG_TEXT", "text": "ملاحظات"}])
KEYS = [q.key for q in SIX.questions()]


def _flags(result) -> set[str]:  # type: ignore[no-untyped-def]
    return {f["code"] for f in result.flags}


def test_thoughtful_response_is_valid() -> None:
    answers = {"l0": 4, "l1": 5, "l2": 3, "l3": 4, "l4": 2, "l5": 4, "open": "المحتوى مفيد والأمثلة واضحة"}
    result = assess_response(SIX, answers, visible_keys=KEYS, duration_seconds=180)
    assert result.status == QualityStatus.VALID and result.score == 100 and not result.flags


def test_speed_flags_scale_with_expected_time() -> None:
    answers = {"l0": 4, "l1": 5, "l2": 3, "l3": 4, "l4": 2, "l5": 4}
    fast = assess_response(SIX, answers, visible_keys=KEYS, duration_seconds=12)
    assert _flags(fast) == {"too_fast"} and fast.status == QualityStatus.SUSPICIOUS
    instant = assess_response(SIX, answers, visible_keys=KEYS, duration_seconds=3)
    assert _flags(instant) == {"way_too_fast"}
    assert instant.flags[0]["expected"] >= 20


def test_straightlining_needs_enough_items() -> None:
    same = {f"l{i}": 5 for i in range(6)}
    assert "straightlining" in _flags(assess_response(SIX, same, visible_keys=KEYS, duration_seconds=120))
    few = _doc([_likert("a"), _likert("b"), _likert("c")])
    assert not _flags(assess_response(few, {"a": 5, "b": 5, "c": 5}, visible_keys=["a", "b", "c"], duration_seconds=60))


def test_reverse_scored_contradiction() -> None:
    doc = _doc([_likert("pos"), _likert("neg", reverse=True)])
    contradictory = assess_response(doc, {"pos": 5, "neg": 5}, visible_keys=["pos", "neg"], duration_seconds=60)
    assert "inconsistent_reverse_items" in _flags(contradictory)
    coherent = assess_response(doc, {"pos": 5, "neg": 1}, visible_keys=["pos", "neg"], duration_seconds=60)
    assert not coherent.flags


def test_low_effort_text_detection() -> None:
    assert is_low_effort_text("aaaaaa")
    assert is_low_effort_text("هههههههه")
    assert is_low_effort_text(".....")
    assert is_low_effort_text("asasasasasas")
    assert not is_low_effort_text("لا يوجد")
    assert not is_low_effort_text("16", long_answer=False)  # a short answer may be a number
    assert not is_low_effort_text("المدربة كانت متعاونة جدًا")


def test_combined_signals_mark_low_quality() -> None:
    answers = {f"l{i}": 1 for i in range(6)} | {"open": "......"}
    result = assess_response(SIX, answers, visible_keys=KEYS, duration_seconds=4, repeat_device=True)
    assert _flags(result) == {"way_too_fast", "straightlining", "low_effort_text", "repeat_device"}
    assert result.status == QualityStatus.LOW_QUALITY and result.score == 5


def test_skipped_optional_questions() -> None:
    doc = _doc([_likert(f"o{i}", required=False) for i in range(5)])
    keys = [q.key for q in doc.questions()]
    result = assess_response(doc, {"o0": 3}, visible_keys=keys, duration_seconds=60)
    assert _flags(result) == {"skipped_optional"}


def _cx_visit(experience: str) -> SurveyDoc:
    questions = [{"key": "csat", "type": "CSAT", "text": "رضاك؟", "scale": {"min": 1, "max": 5}}]
    questions += [
        {"key": f"f{i}", "type": "STAR", "text": f"عامل {i}", "scale": {"min": 1, "max": 5}} for i in range(5)
    ]
    questions.append({"key": "nps", "type": "NPS", "text": "توصي بنا؟", "scale": {"min": 0, "max": 10}})
    doc = _doc(questions)
    return doc.model_copy(update={"settings": doc.settings.model_copy(update={"experience": experience})})


def test_pulse_ratings_are_calibrated_for_taps() -> None:
    delighted = {"csat": 5, "nps": 10} | {f"f{i}": 5 for i in range(5)}
    keys = ["csat", "nps", *(f"f{i}" for i in range(5))]
    # Seven taps in nine seconds is a normal pulse answer, and all-top ratings are not straight-lining there.
    pulse = assess_response(_cx_visit("pulse"), delighted, visible_keys=keys, duration_seconds=9)
    assert pulse.status == QualityStatus.VALID and not pulse.flags
    # The same answers on a classic form read as rushed and straight-lined.
    classic = assess_response(_cx_visit("standard"), delighted, visible_keys=keys, duration_seconds=9)
    assert _flags(classic) == {"too_fast", "straightlining"}
    # A tap-through still shows: under a fifth of the pulse expectation.
    bot = assess_response(_cx_visit("pulse"), delighted, visible_keys=keys, duration_seconds=2)
    assert _flags(bot) == {"way_too_fast"}
