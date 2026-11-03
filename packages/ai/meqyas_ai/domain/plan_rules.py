"""Deterministic plan rules (MEASUREMENT_ENGINE.md §5).

Applied to every plan — AI-generated or user-edited — so the stored plan is
methodologically coherent regardless of model quality. Each rule that changes
something records its id in ``rules_applied``.
"""

from __future__ import annotations

import re

from ..schemas.plan import ArchitectOutput, MeasurementPlanDraft, PlanIndicator, PlanWave
from .catalog import (
    BASELINE_MANDATORY_TYPES,
    DESIGN_CATALOG,
    REACTION_TYPES,
    TYPE_CATALOG,
    WAVE_LABELS,
    WAVE_TIMING,
)
from .causality import design_note
from .enums import (
    EvidenceLevel,
    IndicatorType,
    MeasurementDesign,
    MeasurementType,
    WaveType,
)
from .intent import IntentSignals

MIN_QUESTIONS, MAX_QUESTIONS = 5, 60
MAX_NOTES = 8
DEFAULT_FOLLOW_UP_DAYS = 30

_CHANGE_EVIDENCE = {
    EvidenceLevel.PERCEIVED_CHANGE,
    EvidenceLevel.CHANGE,
    EvidenceLevel.CHANGE_PERSISTENCE,
    EvidenceLevel.TREND,
    EvidenceLevel.CONTRIBUTION,
}
_LEARNING_LIKE = {
    MeasurementType.KNOWLEDGE,
    MeasurementType.SKILLS,
    MeasurementType.BEHAVIOR,
    MeasurementType.TRAINING_EVALUATION,
}


def _t(lang: str, ar: str, en: str) -> str:
    return ar if lang == "ar" else en


def _slug(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return s[:40]


def overclaim_issues(plan: ArchitectOutput, signals: IntentSignals | None) -> list[str]:
    """Semantic check used to trigger a repair round: a reaction-level request
    (satisfaction/impressions only) must not be classified as change/impact."""
    if signals is None:
        return []
    issues: list[str] = []
    strong = {MeasurementType.IMPACT, MeasurementType.OUTCOME, MeasurementType.PRE_POST}
    if signals.reaction_only and plan.measurement_type in strong:
        issues.append(
            "The user's request is about satisfaction/impressions only (reaction level) and does not ask whether "
            f"anything changed, yet measurement_type is {plan.measurement_type.value}. Reclassify as SATISFACTION, "
            "PERCEPTION, EXPERIENCE or EVENT_EVALUATION with a POST_ONLY design, and explain in "
            "measurement_type_rationale why this is not impact measurement."
        )
    return issues


def apply_rules(
    plan: ArchitectOutput,
    *,
    language: str = "ar",
    signals: IntentSignals | None = None,
) -> MeasurementPlanDraft:
    lang = "en" if language == "en" else "ar"
    data = plan.model_dump()
    applied: list[str] = []
    warnings: list[str] = []
    extra_notes: list[str] = []

    mtype = MeasurementType(data["measurement_type"])
    design = MeasurementDesign(data["recommended_design"])

    # ---- R3: type ↔ design coherence ------------------------------------
    if mtype in BASELINE_MANDATORY_TYPES and design in (MeasurementDesign.POST_ONLY, MeasurementDesign.REPEATED):
        design = MeasurementDesign.PRE_POST_FOLLOW_UP if mtype == MeasurementType.IMPACT else MeasurementDesign.PRE_POST
        applied.append("R3_baseline_added")
        extra_notes.append(
            _t(
                lang,
                "أُضيف قياس قبلي (Baseline) لأن قياس التغير أو الأثر يتطلب نقطة مرجعية قبل البرنامج.",
                "A baseline was added because measuring change or impact requires a reference point before the "
                "program.",
            )
        )
    elif mtype in _LEARNING_LIKE and design == MeasurementDesign.POST_ONLY:
        if signals is not None and signals.wants_change:
            design = MeasurementDesign.PRE_POST
            applied.append("R3_baseline_added")
            extra_notes.append(
                _t(
                    lang,
                    "أُضيف قياس قبلي لأن الطلب يسأل عن التحسن، ولا يمكن رصد التحسن دون قياس قبل البرنامج.",
                    "A baseline was added because the request asks about improvement, which cannot be observed "
                    "without measuring before the program.",
                )
            )
        else:
            extra_notes.append(
                _t(
                    lang,
                    "هذا التصميم يقيس المستوى الحالي فقط؛ إذا أردت معرفة مقدار التحسن فأضف قياسًا قبليًا.",
                    "This design measures the current level only; add a baseline to know how much it improved.",
                )
            )
    elif (
        mtype in REACTION_TYPES
        and mtype not in (MeasurementType.EMPLOYEE_PULSE,)
        and design not in (MeasurementDesign.POST_ONLY, MeasurementDesign.REPEATED)
        and signals is not None
        and signals.reaction_only
    ):
        design = MeasurementDesign.POST_ONLY
        applied.append("R3_reaction_post_only")
        extra_notes.append(
            _t(
                lang,
                "قياس الرضا والانطباعات لا يتطلب قياسًا قبليًا؛ يكفي قياس واحد بعد النشاط.",
                "Satisfaction and impressions do not require a baseline; one measurement after the activity is enough.",
            )
        )

    if mtype in (MeasurementType.LONGITUDINAL, MeasurementType.EMPLOYEE_PULSE) and design != MeasurementDesign.REPEATED:
        design = MeasurementDesign.REPEATED
        applied.append("R3_repeated_design")

    if mtype == MeasurementType.IMPACT and design == MeasurementDesign.PRE_POST:
        extra_notes.append(
            _t(
                lang,
                "لقياس الأثر يُستحسن إضافة قياس متابعة بعد فترة للتحقق من استمرار التغير.",
                "For impact, a follow-up measurement is recommended to check that the change persists.",
            )
        )

    data["recommended_design"] = design
    design_info = DESIGN_CATALOG[design]

    # ---- R8 + R1: follow-up days and waves from design --------------------
    follow_days = data.get("follow_up_days")
    if WaveType.FOLLOW_UP in design_info.waves:
        if not isinstance(follow_days, int) or not (7 <= follow_days <= 365):
            follow_days = DEFAULT_FOLLOW_UP_DAYS
            applied.append("R8_follow_up_days")
    else:
        follow_days = None
    data["follow_up_days"] = follow_days

    proposed: dict[WaveType, list[PlanWave]] = {}
    for w in plan.waves:
        proposed.setdefault(w.wave_type, []).append(w)
    new_waves: list[dict] = []
    round_no = 0
    for wave_type in design_info.waves:
        candidates = proposed.get(wave_type) or []
        source = candidates.pop(0) if candidates else None
        name = source.name if source and source.name else None
        timing = source.timing if source and source.timing else None
        if wave_type == WaveType.ROUND:
            round_no += 1
            name = name or _t(lang, f"الجولة {round_no}", f"Round {round_no}")
        default_name = WAVE_LABELS[wave_type][0 if lang == "ar" else 1]
        timing_tpl = WAVE_TIMING[wave_type][0 if lang == "ar" else 1]
        new_waves.append(
            {
                "wave_type": wave_type,
                "name": name or default_name,
                "timing": timing or timing_tpl.format(days=follow_days or DEFAULT_FOLLOW_UP_DAYS),
                "offset_days": follow_days if wave_type == WaveType.FOLLOW_UP else None,
            }
        )
    if [w.wave_type for w in plan.waves] != [w["wave_type"] for w in new_waves]:
        applied.append("R1_waves_from_design")
    data["waves"] = new_waves

    # ---- R2: flags from waves ----------------------------------------------
    wave_types = {w["wave_type"] for w in new_waves}
    flags = {
        "baseline_required": WaveType.BASELINE in wave_types,
        "post_measurement_required": WaveType.POST in wave_types,
        "follow_up_recommended": WaveType.FOLLOW_UP in wave_types,
    }
    if any(data[k] != v for k, v in flags.items()):
        applied.append("R2_flags_from_design")
    data.update(flags)

    # ---- R4: evidence level ------------------------------------------------
    evidence = design_info.evidence
    data["evidence_level"] = evidence
    data["outcome_level"] = TYPE_CATALOG[mtype].level

    # ---- R6: keys & cross references --------------------------------------
    obj_map: dict[str, str] = {}
    objectives = []
    for i, obj in enumerate(plan.objectives, start=1):
        new_key = f"o{i}"
        obj_map[obj.key] = new_key
        objectives.append({**obj.model_dump(), "key": new_key})
    data["objectives"] = objectives

    dim_map: dict[str, str] = {}
    dim_by_name: dict[str, str] = {}
    used: set[str] = set()
    dimensions = []
    for i, dim in enumerate(plan.dimensions, start=1):
        key = _slug(dim.key) or f"d{i}"
        if key in used:
            key = f"{key}_{i}"
        used.add(key)
        dim_map[dim.key] = key
        dim_by_name[dim.name.strip().lower()] = key
        obj_key = obj_map.get(dim.objective_key or "")
        if obj_key is None and len(objectives) == 1:
            obj_key = objectives[0]["key"]
        dimensions.append({**dim.model_dump(), "key": key, "objective_key": obj_key})
    if [d["key"] for d in dimensions] != [d.key for d in plan.dimensions]:
        applied.append("R6_dimension_keys")
    data["dimensions"] = dimensions

    indicators = []
    codes: set[str] = set()
    for i, ind in enumerate(plan.indicators, start=1):
        dim_key = dim_map.get(ind.dimension_key) or dim_by_name.get(ind.dimension_key.strip().lower())
        if dim_key is None:
            dim_key = _slug(ind.dimension_key) if _slug(ind.dimension_key) in used else dimensions[0]["key"]
            applied.append("R6_indicator_dimension_repaired")
        code = (ind.code or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{2,5}-\d{1,3}", code) or code in codes:
            code = f"IND-{i:02d}"
        codes.add(code)
        indicators.append({**ind.model_dump(), "dimension_key": dim_key, "code": code})

    covered = {ind["dimension_key"] for ind in indicators}
    for dim in dimensions:
        if dim["key"] not in covered:
            n = len(indicators) + 1
            code = f"IND-{n:02d}"
            while code in codes:
                n += 1
                code = f"IND-{n:02d}"
            codes.add(code)
            indicators.append(
                PlanIndicator(
                    code=code,
                    name=_t(lang, f"متوسط درجة «{dim['name']}»", f"Average “{dim['name']}” score"),
                    description=_t(
                        lang,
                        f"متوسط إجابات بنود بُعد {dim['name']} على مقياس من 1 إلى 5.",
                        f"Mean of the {dim['name']} items on a 1–5 scale.",
                    ),
                    dimension_key=dim["key"],
                    indicator_type=IndicatorType.AVERAGE_SCORE,
                    unit=_t(lang, "من 5", "out of 5"),
                    target=_t(lang, "4 من 5 أو أعلى", "4 out of 5 or higher"),
                    target_value=4.0,
                    formula=_t(lang, "مجموع الدرجات ÷ عدد الإجابات", "sum of scores ÷ number of answers"),
                ).model_dump()
            )
            applied.append("R6_indicator_added_for_dimension")
    data["indicators"] = indicators

    # ---- R7: counts ----------------------------------------------------------
    q = int(data.get("recommended_questions_count") or 0)
    q_new = max(MIN_QUESTIONS, min(MAX_QUESTIONS, q))
    q_new = max(q_new, min(MAX_QUESTIONS, 2 * len(dimensions) + 1))
    if q_new != q:
        applied.append("R7_question_count")
    data["recommended_questions_count"] = q_new
    m = int(data.get("estimated_completion_minutes") or 0)
    if not (q_new * 0.2 <= m <= q_new * 0.7) or not (2 <= m <= 30):
        data["estimated_completion_minutes"] = max(2, min(30, round(q_new * 0.35)))
        applied.append("R7_completion_minutes")

    # ---- secondary types ---------------------------------------------------
    data["secondary_types"] = [t for t in dict.fromkeys(data.get("secondary_types") or []) if t != mtype][:3]

    # ---- R5: notes (model notes first, then deterministic ones) -----------
    notes: list[str] = [n for n in (data.get("methodology_notes") or []) if n]
    if evidence in _CHANGE_EVIDENCE:
        has_causal = any(re.search(r"سبب|caus", n, re.IGNORECASE) for n in notes)
        note = design_note(design, lang)
        if note and not has_causal:
            extra_notes.append(note)
            applied.append("R5_causality_note")
    has_pairing_note = any(re.search(r"مستعار|رمز|pseudonym|\bcodes?\b", n, re.IGNORECASE) for n in notes)
    if flags["baseline_required"] and not has_pairing_note:
        extra_notes.append(
            _t(
                lang,
                "لربط إجابات المشارك نفسه بين القياسات دون جمع هويته، استخدم رمزًا مستعارًا ثابتًا لكل مشارك.",
                "To link the same participant across waves without collecting identity, use a stable "
                "pseudonymous code.",
            )
        )
    seen: set[str] = set()
    merged: list[str] = []
    for n in [*notes, *extra_notes]:
        k = n.strip()
        if k and k not in seen:
            seen.add(k)
            merged.append(k)
    # Deterministic notes must survive the cap: keep them, trim model notes first.
    overflow = len(merged) - MAX_NOTES
    if overflow > 0:
        model_part = [n for n in merged if n not in extra_notes]
        keep_model = model_part[: max(0, len(model_part) - overflow)]
        merged = [n for n in merged if n in keep_model or n in extra_notes][:MAX_NOTES]
    data["methodology_notes"] = merged

    # ---- R9: over-claim warning (if repair did not fix it) -----------------
    for issue in overclaim_issues(plan.model_copy(update={"measurement_type": mtype}), signals):
        warnings.append(issue)
        applied.append("R9_overclaim_flagged")

    data["rules_applied"] = list(dict.fromkeys(applied))
    data["warnings"] = warnings
    data["language"] = lang
    return MeasurementPlanDraft.model_validate(data)


def reapply_rules(draft: MeasurementPlanDraft) -> MeasurementPlanDraft:
    """Re-run rules after a user edit (no lexical signals: the user decides)."""
    base = ArchitectOutput.model_validate(draft.model_dump())
    return apply_rules(base, language=draft.language, signals=None)


__all__ = ["apply_rules", "overclaim_issues", "reapply_rules"]
