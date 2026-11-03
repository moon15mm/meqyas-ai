"""Measurement catalog: human labels, levels and default designs.

This is the deterministic knowledge the platform relies on — the AI proposes,
the catalog + rules keep the plan methodologically coherent.
"""

from __future__ import annotations

from dataclasses import dataclass

from .enums import EvidenceLevel, MeasurementDesign, MeasurementType, OutcomeLevel, WaveType


@dataclass(frozen=True, slots=True)
class TypeInfo:
    code: MeasurementType
    level: OutcomeLevel
    name_ar: str
    name_en: str
    description_ar: str
    description_en: str
    default_design: MeasurementDesign
    change_oriented: bool  # the question asked is "did something change?"
    sort_order: int


_T = MeasurementType
_L = OutcomeLevel
_D = MeasurementDesign

TYPE_CATALOG: dict[MeasurementType, TypeInfo] = {
    info.code: info
    for info in [
        TypeInfo(
            _T.SATISFACTION,
            _L.REACTION,
            "قياس الرضا",
            "Satisfaction",
            "مدى رضا المستفيدين عن برنامج أو خدمة أو نشاط.",
            "How satisfied beneficiaries are with a program, service or activity.",
            _D.POST_ONLY,
            False,
            1,
        ),
        TypeInfo(
            _T.PERCEPTION,
            _L.REACTION,
            "قياس الانطباعات",
            "Perception",
            "آراء وانطباعات المشاركين وتصوراتهم.",
            "Participants' opinions, impressions and perceptions.",
            _D.POST_ONLY,
            False,
            2,
        ),
        TypeInfo(
            _T.EXPERIENCE,
            _L.REACTION,
            "قياس التجربة",
            "Experience",
            "جودة التجربة ونقاط الألم واللحظات المهمة.",
            "Quality of the experience, pain points and key moments.",
            _D.POST_ONLY,
            False,
            3,
        ),
        TypeInfo(
            _T.NEEDS_ASSESSMENT,
            _L.NEED,
            "قياس الاحتياجات",
            "Needs assessment",
            "تحديد الاحتياجات والأولويات قبل تصميم التدخل.",
            "Identify needs and priorities before designing an intervention.",
            _D.POST_ONLY,
            False,
            4,
        ),
        TypeInfo(
            _T.AWARENESS,
            _L.LEARNING,
            "قياس الوعي",
            "Awareness",
            "مستوى الوعي بموضوع أو مفهوم.",
            "Level of awareness about a topic or concept.",
            _D.POST_ONLY,
            False,
            5,
        ),
        TypeInfo(
            _T.KNOWLEDGE,
            _L.LEARNING,
            "قياس المعرفة",
            "Knowledge",
            "ما يعرفه المشاركون عن موضوع محدد.",
            "What participants know about a specific topic.",
            _D.PRE_POST,
            True,
            6,
        ),
        TypeInfo(
            _T.SKILLS,
            _L.LEARNING,
            "قياس المهارات",
            "Skills",
            "قدرة المشاركين على أداء مهارات محددة.",
            "Participants' ability to perform specific skills.",
            _D.PRE_POST,
            True,
            7,
        ),
        TypeInfo(
            _T.BEHAVIOR,
            _L.BEHAVIOR,
            "قياس السلوك",
            "Behavior",
            "تغير الممارسات والسلوك الفعلي.",
            "Change in actual practices and behaviour.",
            _D.PRE_POST_FOLLOW_UP,
            True,
            8,
        ),
        TypeInfo(
            _T.ENGAGEMENT,
            _L.BEHAVIOR,
            "قياس الانخراط",
            "Engagement",
            "مستوى المشاركة والانخراط والتفاعل.",
            "Level of participation, involvement and interaction.",
            _D.POST_ONLY,
            False,
            9,
        ),
        TypeInfo(
            _T.PROGRAM_EVALUATION,
            _L.COMPOSITE,
            "تقييم برنامج",
            "Program evaluation",
            "تقييم شامل لتصميم البرنامج وتنفيذه ونتائجه.",
            "Holistic evaluation of a program's design, delivery and results.",
            _D.POST_ONLY,
            False,
            10,
        ),
        TypeInfo(
            _T.TRAINING_EVALUATION,
            _L.COMPOSITE,
            "تقييم تدريب",
            "Training evaluation",
            "تقييم التدريب: الرضا والتعلم والتطبيق.",
            "Evaluate training: reaction, learning and application.",
            _D.PRE_POST,
            True,
            11,
        ),
        TypeInfo(
            _T.OUTCOME,
            _L.RESULTS,
            "قياس النتائج",
            "Outcome",
            "التغير قصير المدى الناتج بعد التدخل.",
            "Short-term change observed after the intervention.",
            _D.PRE_POST,
            True,
            12,
        ),
        TypeInfo(
            _T.IMPACT,
            _L.RESULTS,
            "قياس الأثر",
            "Impact",
            "التغير الأعمق والأطول أمدًا ومدى إسهام التدخل فيه.",
            "Deeper, longer-term change and the intervention's contribution to it.",
            _D.PRE_POST_FOLLOW_UP,
            True,
            13,
        ),
        TypeInfo(
            _T.PRE_POST,
            _L.DESIGN,
            "قياس قبلي/بعدي",
            "Pre/Post",
            "مقارنة المؤشرات قبل التدخل وبعده.",
            "Compare indicators before and after an intervention.",
            _D.PRE_POST,
            True,
            14,
        ),
        TypeInfo(
            _T.LONGITUDINAL,
            _L.DESIGN,
            "قياس طولي",
            "Longitudinal",
            "تتبع المؤشرات عبر عدة قياسات زمنية.",
            "Track indicators across several points in time.",
            _D.REPEATED,
            False,
            15,
        ),
        TypeInfo(
            _T.EVENT_EVALUATION,
            _L.REACTION,
            "تقييم فعالية",
            "Event evaluation",
            "تقييم فعالية أو حدث من حيث التنظيم والمحتوى والفائدة.",
            "Evaluate an event's organization, content and usefulness.",
            _D.POST_ONLY,
            False,
            16,
        ),
        TypeInfo(
            _T.EMPLOYEE_PULSE,
            _L.REACTION,
            "نبض الموظفين",
            "Employee pulse",
            "قياس دوري قصير لمناخ العمل والرضا الوظيفي.",
            "Short recurring check of work climate and engagement.",
            _D.REPEATED,
            False,
            17,
        ),
        TypeInfo(
            _T.CUSTOMER_FEEDBACK,
            _L.REACTION,
            "آراء العملاء",
            "Customer feedback",
            "آراء العملاء أو المستفيدين عن الخدمة.",
            "Customers' or beneficiaries' feedback on a service.",
            _D.POST_ONLY,
            False,
            18,
        ),
    ]
}

CHANGE_TYPES = frozenset(t for t, i in TYPE_CATALOG.items() if i.change_oriented)
REACTION_TYPES = frozenset(t for t, i in TYPE_CATALOG.items() if i.level == OutcomeLevel.REACTION)
#: Types whose design MUST include a baseline (strong change claims).
BASELINE_MANDATORY_TYPES = frozenset({_T.OUTCOME, _T.IMPACT, _T.PRE_POST})


@dataclass(frozen=True, slots=True)
class DesignInfo:
    code: MeasurementDesign
    waves: tuple[WaveType, ...]
    evidence: EvidenceLevel
    name_ar: str
    name_en: str


DESIGN_CATALOG: dict[MeasurementDesign, DesignInfo] = {
    _D.POST_ONLY: DesignInfo(
        _D.POST_ONLY, (WaveType.SINGLE,), EvidenceLevel.DESCRIPTIVE, "قياس واحد", "Single measurement"
    ),
    _D.RETROSPECTIVE_PRE_POST: DesignInfo(
        _D.RETROSPECTIVE_PRE_POST,
        (WaveType.SINGLE,),
        EvidenceLevel.PERCEIVED_CHANGE,
        "قبلي/بعدي استرجاعي",
        "Retrospective pre/post",
    ),
    _D.PRE_POST: DesignInfo(
        _D.PRE_POST, (WaveType.BASELINE, WaveType.POST), EvidenceLevel.CHANGE, "قبلي/بعدي", "Pre/Post"
    ),
    _D.PRE_POST_FOLLOW_UP: DesignInfo(
        _D.PRE_POST_FOLLOW_UP,
        (WaveType.BASELINE, WaveType.POST, WaveType.FOLLOW_UP),
        EvidenceLevel.CHANGE_PERSISTENCE,
        "قبلي/بعدي/متابعة",
        "Pre/Post/Follow-up",
    ),
    _D.REPEATED: DesignInfo(
        _D.REPEATED,
        (WaveType.ROUND, WaveType.ROUND, WaveType.ROUND),
        EvidenceLevel.TREND,
        "قياسات متكررة",
        "Repeated measurements",
    ),
    _D.COMPARISON_GROUP: DesignInfo(
        _D.COMPARISON_GROUP,
        (WaveType.BASELINE, WaveType.POST),
        EvidenceLevel.CONTRIBUTION,
        "مجموعة مقارنة",
        "Comparison group",
    ),
}

WAVE_LABELS: dict[WaveType, tuple[str, str]] = {
    WaveType.BASELINE: ("القياس القبلي", "Baseline"),
    WaveType.MIDLINE: ("القياس المرحلي", "Midline"),
    WaveType.POST: ("القياس البعدي", "Post"),
    WaveType.FOLLOW_UP: ("قياس المتابعة", "Follow-up"),
    WaveType.SINGLE: ("القياس", "Measurement"),
    WaveType.ROUND: ("جولة قياس", "Measurement round"),
}

WAVE_TIMING: dict[WaveType, tuple[str, str]] = {
    WaveType.BASELINE: ("قبل بدء البرنامج", "Before the program starts"),
    WaveType.MIDLINE: ("في منتصف البرنامج", "Midway through the program"),
    WaveType.POST: ("مباشرة بعد انتهاء البرنامج", "Right after the program ends"),
    WaveType.FOLLOW_UP: ("بعد {days} يومًا من انتهاء البرنامج", "{days} days after the program ends"),
    WaveType.SINGLE: ("بعد انتهاء النشاط أو الخدمة", "After the activity or service"),
    WaveType.ROUND: ("بشكل دوري", "Periodically"),
}

EVIDENCE_LABELS: dict[EvidenceLevel, tuple[str, str]] = {
    EvidenceLevel.DESCRIPTIVE: ("وصفي — يصف الآراء والمستوى الحالي", "Descriptive — describes current views/levels"),
    EvidenceLevel.PERCEIVED_CHANGE: ("تغير مُدرَك — كما يراه المشاركون", "Perceived change — as reported"),
    EvidenceLevel.CHANGE: ("تغير ملحوظ — مقارنة قبل وبعد", "Observed change — before vs after"),
    EvidenceLevel.CHANGE_PERSISTENCE: (
        "تغير واستمرارية — قبل وبعد ومتابعة",
        "Change & persistence — before, after, follow-up",
    ),
    EvidenceLevel.TREND: ("اتجاه عبر الزمن", "Trend over time"),
    EvidenceLevel.CONTRIBUTION: ("إسهام — مقارنة بمجموعة غير مشاركة", "Contribution — vs comparison group"),
    EvidenceLevel.ATTRIBUTION: ("إسناد سببي — تصميم تجريبي", "Attribution — experimental design"),
}


def type_label(t: MeasurementType, lang: str = "ar") -> str:
    info = TYPE_CATALOG[t]
    return info.name_ar if lang == "ar" else info.name_en


def wave_label(w: WaveType, lang: str = "ar") -> str:
    ar, en = WAVE_LABELS[w]
    return ar if lang == "ar" else en
