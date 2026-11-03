from __future__ import annotations

from factories import plan_dict, satisfaction_plan
from meqyas_ai.domain.enums import EvidenceLevel, MeasurementDesign, WaveType
from meqyas_ai.domain.intent import detect_signals
from meqyas_ai.domain.plan_rules import apply_rules, overclaim_issues, reapply_rules
from meqyas_ai.schemas.plan import ArchitectOutput


def _apply(data: dict, request: str | None = None, lang: str = "ar"):
    signals = detect_signals(request) if request else None
    return apply_rules(ArchitectOutput.model_validate(data), language=lang, signals=signals)


def test_valid_impact_plan_is_kept_and_enriched() -> None:
    draft = _apply(plan_dict(), "أريد قياس أثر برنامج تدريبي للمعلمين")
    assert draft.recommended_design == MeasurementDesign.PRE_POST_FOLLOW_UP
    assert [w.wave_type for w in draft.waves] == [WaveType.BASELINE, WaveType.POST, WaveType.FOLLOW_UP]
    assert draft.evidence_level == EvidenceLevel.CHANGE_PERSISTENCE
    assert draft.baseline_required and draft.post_measurement_required and draft.follow_up_recommended
    # causality note is always present for change designs
    assert any("لا يثبت" in n for n in draft.methodology_notes)
    # every dimension gets at least one indicator (actual_use had none)
    assert {i.dimension_key for i in draft.indicators} >= {d.key for d in draft.dimensions}
    assert "R6_indicator_added_for_dimension" in draft.rules_applied


def test_impact_with_post_only_gets_baseline() -> None:
    draft = _apply(
        plan_dict(
            recommended_design="POST_ONLY",
            waves=[{"wave_type": "SINGLE", "name": "x", "timing": "", "offset_days": None}],
        )
    )
    assert draft.recommended_design == MeasurementDesign.PRE_POST_FOLLOW_UP
    assert draft.baseline_required and draft.follow_up_days == 30
    assert "R3_baseline_added" in draft.rules_applied


def test_satisfaction_request_with_prepost_is_downgraded() -> None:
    data = satisfaction_plan(
        recommended_design="PRE_POST",
        waves=[
            {"wave_type": "BASELINE", "name": "قبل", "timing": "", "offset_days": None},
            {"wave_type": "POST", "name": "بعد", "timing": "", "offset_days": None},
        ],
    )
    draft = _apply(data, "أريد قياس رضا الطالبات عن النشاط")
    assert draft.recommended_design == MeasurementDesign.POST_ONLY
    assert [w.wave_type for w in draft.waves] == [WaveType.SINGLE]
    assert draft.evidence_level == EvidenceLevel.DESCRIPTIVE
    assert not draft.baseline_required


def test_flags_follow_design_not_model() -> None:
    draft = _apply(satisfaction_plan(baseline_required=True, follow_up_recommended=True))
    assert not draft.baseline_required and not draft.follow_up_recommended
    assert "R2_flags_from_design" in draft.rules_applied


def test_keys_are_normalized_and_references_repaired() -> None:
    data = plan_dict(
        dimensions=[
            {"key": "المعرفة", "name": "المعرفة", "description": "", "objective_key": "x"},
            {"key": "Confidence Level", "name": "الثقة", "description": "", "objective_key": "o2"},
        ],
        indicators=[
            {**plan_dict()["indicators"][0], "dimension_key": "المعرفة", "code": "bad code"},
            {**plan_dict()["indicators"][1], "dimension_key": "الثقة", "code": "IND-02"},
        ],
    )
    draft = _apply(data)
    keys = [d.key for d in draft.dimensions]
    assert keys == ["d1", "confidence_level"]
    assert draft.indicators[0].dimension_key == "d1"
    assert draft.indicators[0].code == "IND-01"
    assert draft.indicators[1].dimension_key == "confidence_level"  # matched by name
    assert draft.dimensions[1].objective_key == "o2"


def test_question_count_and_minutes_are_clamped() -> None:
    draft = _apply(plan_dict(recommended_questions_count=200, estimated_completion_minutes=90))
    assert draft.recommended_questions_count == 60
    assert draft.estimated_completion_minutes == 21


def test_question_count_covers_dimensions() -> None:
    draft = _apply(plan_dict(recommended_questions_count=3))
    assert draft.recommended_questions_count >= 2 * len(draft.dimensions) + 1


def test_overclaim_detection() -> None:
    plan = ArchitectOutput.model_validate(plan_dict())
    issues = overclaim_issues(plan, detect_signals("أريد قياس رضا الطالبات عن النشاط"))
    assert issues and "SATISFACTION" in issues[0]
    assert overclaim_issues(plan, detect_signals("أريد قياس أثر البرنامج")) == []


def test_repeated_design_for_pulse() -> None:
    draft = _apply(satisfaction_plan(measurement_type="EMPLOYEE_PULSE"))
    assert draft.recommended_design == MeasurementDesign.REPEATED
    assert [w.wave_type for w in draft.waves] == [WaveType.ROUND] * 3
    assert draft.waves[1].name == "الجولة 2"


def test_english_language_notes() -> None:
    draft = _apply(plan_dict(methodology_notes=[]), lang="en")
    assert draft.language == "en"
    assert any("does not prove" in n for n in draft.methodology_notes)


def test_reapply_rules_is_idempotent() -> None:
    draft = _apply(plan_dict(), "أريد قياس أثر برنامج")
    again = reapply_rules(draft)
    assert again.model_dump(exclude={"rules_applied"}) == draft.model_dump(exclude={"rules_applied"})


def test_lenient_normalization_of_enums_and_lengths() -> None:
    data = plan_dict(
        measurement_type="impact",
        recommended_design="pre-post follow-up",
        project_title="x" * 500,
    )
    out = ArchitectOutput.model_validate(data)
    assert out.measurement_type.value == "IMPACT"
    assert out.recommended_design.value == "PRE_POST_FOLLOW_UP"
    assert len(out.project_title) == 120
