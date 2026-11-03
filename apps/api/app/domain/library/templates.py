"""Measurement templates (Phase 8): a ready plan blueprint plus the questionnaire of each wave.

Using a template creates a plan draft that goes through the same review → accept flow as a
plan from the Measurement Architect (the same deterministic methodology rules apply). On
accept, the questionnaires are created as draft surveys, linked to the project's dimensions
and indicators. Questions repeated across waves keep the same key, so pre/post comparisons
match respondents and items. All wording is original; no published instrument is copied.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

AGREE = ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"]


@dataclass(frozen=True)
class Q:
    """A question in a template: its dimension/indicator are plan keys, resolved on accept."""

    key: str
    type: str
    text: str
    dimension: str | None = None
    indicator: str | None = None
    options: tuple[str, ...] = ()
    required: bool = True
    profile: bool = False
    scale: tuple[int, int, str, str] | None = None
    reverse: bool = False

    def doc(self) -> dict[str, Any]:
        """The question document (without dimension/indicator ids)."""
        out: dict[str, Any] = {"key": self.key, "type": self.type, "text": self.text, "required": self.required}
        if self.type == "LIKERT":
            out["options"] = [{"value": str(i + 1), "label": label} for i, label in enumerate(self.options or AGREE)]
            out["scale"] = {"min": 1, "max": 5, "reverse_scored": self.reverse}
        elif self.options:
            out["options"] = [{"value": f"o{i + 1}", "label": label} for i, label in enumerate(self.options)]
        if self.scale:
            lo, hi, low, high = self.scale
            out["scale"] = {"min": lo, "max": hi, "min_label": low, "max_label": high, "reverse_scored": self.reverse}
        if self.profile:
            out["settings"] = {"is_profile": True}
        return out


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    questions: tuple[Q, ...]


@dataclass(frozen=True)
class SurveySpec:
    title: str
    introduction: str
    sections: tuple[Section, ...]
    thank_you: str = "شكرًا لوقتك! إجاباتك تساعدنا على التحسين."


@dataclass(frozen=True)
class Template:
    code: str
    category: str
    sector: str
    icon: str
    name: tuple[str, str]
    description: tuple[str, str]
    plan: dict[str, Any]
    surveys: dict[str, SurveySpec] = field(default_factory=dict)

    def questions(self) -> list[Q]:
        seen: dict[str, Q] = {}
        for spec in self.surveys.values():
            for section in spec.sections:
                for q in section.questions:
                    seen.setdefault(q.key, q)
        return list(seen.values())


def _csat(key: str, text: str, dimension: str, indicator: str | None = None) -> Q:
    return Q(key, "CSAT", text, dimension, indicator, scale=(1, 5, "غير راضٍ إطلاقًا", "راضٍ جدًا"))


def _ind(
    code: str, name: str, dimension: str, kind: str, target: str, value: float | None, **extra: Any
) -> dict[str, Any]:
    units = {"PERCENTAGE": "%", "AVERAGE_SCORE": "من 5", "CHANGE": "نقطة"}
    return {
        "code": code,
        "name": name,
        "dimension_key": dimension,
        "indicator_type": kind,
        "unit": units.get(kind, ""),
        "target": target,
        "target_value": value,
        "description": extra.pop("description", ""),
        "formula": extra.pop("formula", ""),
        **extra,
    }


# ---------------------------------------------------------------- training
_EXPERIENCE = Q(
    "experience",
    "SINGLE_CHOICE",
    "سنوات الخبرة في مجال العمل",
    options=("أقل من 3 سنوات", "من 3 إلى 10 سنوات", "أكثر من 10 سنوات"),
    profile=True,
)
_TRAINING_CORE = (
    Section(
        "knowledge",
        "المعرفة",
        (
            Q("know_concepts", "LIKERT", "أفهم المفاهيم الأساسية لموضوع البرنامج.", "knowledge", "IND-01"),
            Q("know_tools", "LIKERT", "أعرف الأدوات والأساليب المناسبة لعملي في هذا المجال.", "knowledge", "IND-01"),
            Q("know_explain", "LIKERT", "أستطيع شرح الفكرة الرئيسية للموضوع لزميل.", "knowledge", "IND-01"),
        ),
    ),
    Section(
        "apply",
        "القدرة على التطبيق",
        (
            Q("apply_plan", "LIKERT", "أستطيع التخطيط لاستخدام ما تعلمته في مهمة حقيقية.", "apply", "IND-02"),
            Q("apply_solve", "LIKERT", "أستطيع حل مشكلة عملية مستخدمًا مهارات هذا المجال.", "apply", "IND-02"),
            Q("apply_adapt", "LIKERT", "أستطيع تكييف الأساليب بما يناسب ظروف عملي.", "apply", "IND-02"),
        ),
    ),
    Section(
        "confidence",
        "الثقة",
        (
            Q("conf_start", "LIKERT", "أشعر بالثقة عند البدء بتطبيق ما تعلمته دون مساعدة.", "confidence", "IND-03"),
            Q("conf_mistake", "LIKERT", "أتوقف عن المحاولة عندما أواجه صعوبة في التطبيق.", "confidence", reverse=True),
        ),
    ),
    Section(
        "use",
        "التطبيق في العمل",
        (
            Q("use_weekly", "LIKERT", "استخدمت مهارات هذا المجال في عملي خلال الأسبوعين الماضيين.", "use", "IND-04"),
            Q("use_share", "LIKERT", "شاركت زملائي طريقة أو أداة من هذا المجال.", "use"),
        ),
    ),
)
_TRAINING_OPEN = Q("barrier", "LONG_TEXT", "ما أكبر عائق يحدّ من تطبيقك لهذه المهارات في عملك؟", required=False)

TRAINING_IMPACT = Template(
    code="training_impact",
    category="training",
    sector="EDUCATION",
    icon="graduation-cap",
    name=("تقييم أثر برنامج تدريبي", "Training program impact"),
    description=(
        "قياس قبلي وبعدي ومتابعة للمعرفة والقدرة على التطبيق والثقة والتطبيق الفعلي، مع رضا المشاركين عن التدريب.",
        "Pre, post and follow-up measurement of knowledge, ability to apply, confidence and actual use, plus satisfaction.",
    ),
    plan={
        "project_title": "تقييم أثر برنامج تدريبي",
        "measurement_type": "TRAINING_EVALUATION",
        "secondary_types": ["KNOWLEDGE", "BEHAVIOR"],
        "target_population": "المشاركون في البرنامج التدريبي",
        "purpose": "معرفة ما إذا كان البرنامج قد رفع معرفة المشاركين وقدرتهم على التطبيق، وهل استمر التطبيق في العمل بعد انتهائه.",
        "understanding_summary": "تقييم تدريب يقيس التغير بين ما قبل البرنامج وما بعده، ثم استمرار الأثر في العمل بعد فترة.",
        "measurement_type_rationale": "الهدف تغير في المعرفة والسلوك المهني، لذا يتجاوز القياس الرضا إلى التعلم والتطبيق.",
        "objectives": [
            {"key": "o1", "title": "رفع معرفة المشاركين بموضوع البرنامج"},
            {"key": "o2", "title": "تمكين المشاركين من تطبيق المهارات في عملهم"},
            {"key": "o3", "title": "قياس رضا المشاركين عن تجربة التدريب"},
        ],
        "dimensions": [
            {
                "key": "knowledge",
                "name": "المعرفة",
                "description": "فهم المفاهيم والأدوات الأساسية",
                "objective_key": "o1",
            },
            {
                "key": "apply",
                "name": "القدرة على التطبيق",
                "description": "تخطيط المهارات واستخدامها في مواقف حقيقية",
                "objective_key": "o2",
            },
            {"key": "confidence", "name": "الثقة", "description": "الثقة في التطبيق المستقل", "objective_key": "o2"},
            {
                "key": "use",
                "name": "التطبيق في العمل",
                "description": "الاستخدام الفعلي في العمل اليومي",
                "objective_key": "o2",
            },
            {
                "key": "satisfaction",
                "name": "الرضا عن التدريب",
                "description": "تقييم المحتوى والمدرب والتنظيم",
                "objective_key": "o3",
            },
        ],
        "indicators": [
            _ind("IND-01", "متوسط درجة المعرفة", "knowledge", "AVERAGE_SCORE", "4 من 5", 4.0),
            _ind(
                "IND-02",
                "التغير في القدرة على التطبيق",
                "apply",
                "CHANGE",
                "+0.8 نقطة",
                0.8,
                formula="متوسط البعدي − متوسط القبلي",
            ),
            _ind("IND-03", "نسبة الواثقين من التطبيق المستقل", "confidence", "PERCENTAGE", "≥ 70%", 70.0),
            _ind("IND-04", "نسبة المطبقين خلال أسبوعين", "use", "PERCENTAGE", "≥ 60%", 60.0),
            _ind("IND-05", "نسبة الراضين عن التدريب", "satisfaction", "PERCENTAGE", "≥ 80%", 80.0),
        ],
        "recommended_design": "PRE_POST_FOLLOW_UP",
        "design_rationale": "القبلي يحدد نقطة البداية، والبعدي يقيس التغير المباشر، والمتابعة تبيّن هل استمر التطبيق. التصميم يصف التغير ولا يثبت وحده أن البرنامج سببه.",
        "waves": [
            {"wave_type": "BASELINE", "name": "القياس القبلي", "timing": "قبل بدء البرنامج"},
            {"wave_type": "POST", "name": "القياس البعدي", "timing": "في نهاية البرنامج مباشرة"},
            {
                "wave_type": "FOLLOW_UP",
                "name": "قياس المتابعة",
                "timing": "بعد شهرين من انتهاء البرنامج",
                "offset_days": 60,
            },
        ],
        "baseline_required": True,
        "post_measurement_required": True,
        "follow_up_recommended": True,
        "follow_up_days": 60,
        "recommended_questions_count": 14,
        "estimated_completion_minutes": 5,
        "methodology_notes": [
            "استخدم الرمز المستعار نفسه للمشارك في القياسات الثلاثة لربط إجاباته.",
            "اجعل أسئلة المعرفة والتطبيق متطابقة في القياسات حتى تصح المقارنة.",
        ],
        "clarifying_questions": [],
    },
    surveys={
        "BASELINE": SurveySpec(
            "استبيان ما قبل البرنامج",
            "نود معرفة مستواك الحالي قبل بدء البرنامج. لا توجد إجابات صحيحة أو خاطئة — يستغرق نحو 5 دقائق.",
            (Section("profile", "عنك", (_EXPERIENCE,)), *_TRAINING_CORE, Section("open", "رأيك", (_TRAINING_OPEN,))),
        ),
        "POST": SurveySpec(
            "استبيان ما بعد البرنامج",
            "شكرًا لمشاركتك في البرنامج. أجب عن الأسئلة نفسها كما تراها الآن، ثم قيّم تجربة التدريب.",
            (
                Section("profile", "عنك", (_EXPERIENCE,)),
                *_TRAINING_CORE,
                Section(
                    "satisfaction",
                    "تجربة التدريب",
                    (
                        _csat("overall_csat", "ما مدى رضاك عن البرنامج بشكل عام؟", "satisfaction", "IND-05"),
                        Q("trainer_clear", "LIKERT", "قدّم المدرب المحتوى بوضوح وأمثلة عملية.", "satisfaction"),
                        Q("time_enough", "LIKERT", "كان وقت التطبيق داخل البرنامج كافيًا.", "satisfaction"),
                    ),
                ),
                Section(
                    "open",
                    "رأيك",
                    (_TRAINING_OPEN, Q("improve", "LONG_TEXT", "ما الذي تقترحه لتحسين البرنامج؟", required=False)),
                ),
            ),
        ),
        "FOLLOW_UP": SurveySpec(
            "استبيان المتابعة",
            "مرّ وقت على انتهاء البرنامج. نود معرفة ما بقي معك وما تطبقه فعلًا في عملك — نحو 5 دقائق.",
            (Section("profile", "عنك", (_EXPERIENCE,)), *_TRAINING_CORE, Section("open", "رأيك", (_TRAINING_OPEN,))),
        ),
    },
)

# ---------------------------------------------------------------- customers
_CUSTOMER_SECTIONS = (
    Section(
        "overall",
        "تجربتك العامة",
        (
            _csat("csat", "ما مدى رضاك عن الخدمة التي حصلت عليها؟", "quality", "IND-01"),
            Q("nps", "NPS", "ما مدى احتمال أن توصي بخدماتنا لصديق أو زميل؟", "loyalty"),
        ),
    ),
    Section(
        "details",
        "تفاصيل الخدمة",
        (
            Q("quality_need", "LIKERT", "لبّت الخدمة احتياجي كما توقعت.", "quality", "IND-02"),
            Q("speed_time", "LIKERT", "أُنجزت الخدمة في وقت مناسب.", "speed", "IND-03"),
            Q("speed_wait", "LIKERT", "كان وقت الانتظار مقبولًا.", "speed", "IND-03"),
            Q("staff_respect", "LIKERT", "تعامل الموظفون معي باحترام.", "staff"),
            Q("staff_knowledge", "LIKERT", "كانت لدى الموظفين معرفة كافية للإجابة عن أسئلتي.", "staff"),
            Q("ease_steps", "LIKERT", "كانت إجراءات الحصول على الخدمة واضحة وسهلة.", "ease"),
        ),
    ),
    Section(
        "open",
        "رأيك",
        (
            Q(
                "channel",
                "SINGLE_CHOICE",
                "كيف حصلت على الخدمة؟",
                options=("زيارة حضورية", "الموقع أو التطبيق", "الهاتف"),
                profile=True,
            ),
            Q("improve", "LONG_TEXT", "ما أهم شيء يمكن أن نحسّنه؟", required=False),
        ),
    ),
)

CUSTOMER_SATISFACTION = Template(
    code="customer_satisfaction",
    category="customers",
    sector="CUSTOMER",
    icon="smile",
    name=("رضا العملاء عن الخدمة", "Customer service satisfaction"),
    description=(
        "قياس دوري لرضا العملاء وجودة الخدمة وسرعتها وتعامل الموظفين وسهولة الإجراءات، مع احتمال التوصية.",
        "A recurring survey of satisfaction, service quality, speed, staff and ease, with likelihood to recommend.",
    ),
    plan={
        "project_title": "رضا العملاء عن الخدمة",
        "measurement_type": "SATISFACTION",
        "secondary_types": ["EXPERIENCE"],
        "target_population": "العملاء الذين حصلوا على الخدمة",
        "purpose": "معرفة مستوى رضا العملاء ونقاط القوة والضعف في الخدمة لتحديد أولويات التحسين.",
        "understanding_summary": "قياس رضا وتجربة عملاء يتكرر دوريًا لمتابعة أثر التحسينات.",
        "measurement_type_rationale": "الهدف معرفة الرضا والتجربة، وهو مستوى رد الفعل، دون ادعاء أثر.",
        "objectives": [
            {"key": "o1", "title": "قياس رضا العملاء العام عن الخدمة"},
            {"key": "o2", "title": "تحديد جوانب الخدمة التي تحتاج إلى تحسين"},
        ],
        "dimensions": [
            {
                "key": "quality",
                "name": "جودة الخدمة",
                "description": "مدى تلبية الخدمة للاحتياج",
                "objective_key": "o1",
            },
            {
                "key": "speed",
                "name": "سرعة الإنجاز",
                "description": "الوقت المستغرق ووقت الانتظار",
                "objective_key": "o2",
            },
            {"key": "staff", "name": "تعامل الموظفين", "description": "الاحترام والمعرفة", "objective_key": "o2"},
            {"key": "ease", "name": "سهولة الإجراءات", "description": "وضوح الخطوات وسهولتها", "objective_key": "o2"},
            {
                "key": "loyalty",
                "name": "الولاء والتوصية",
                "description": "احتمال التوصية بالخدمة",
                "objective_key": "o1",
            },
        ],
        "indicators": [
            _ind("IND-01", "نسبة العملاء الراضين", "quality", "PERCENTAGE", "≥ 80%", 80.0),
            _ind("IND-02", "متوسط تقييم جودة الخدمة", "quality", "AVERAGE_SCORE", "4 من 5", 4.0),
            _ind("IND-03", "نسبة الراضين عن سرعة الإنجاز", "speed", "PERCENTAGE", "≥ 75%", 75.0),
        ],
        "recommended_design": "REPEATED",
        "design_rationale": "قياس متكرر بالأداة نفسها يبيّن اتجاه الرضا عبر الزمن؛ يصف الاتجاه ولا يفسر أسبابه وحده.",
        "waves": [{"wave_type": "ROUND", "name": "جولة القياس", "timing": "كل ثلاثة أشهر"}],
        "baseline_required": False,
        "post_measurement_required": False,
        "follow_up_recommended": False,
        "recommended_questions_count": 10,
        "estimated_completion_minutes": 3,
        "methodology_notes": ["أرسل الاستبيان بعد الحصول على الخدمة مباشرة لتقليل أثر النسيان."],
        "clarifying_questions": [],
    },
    surveys={
        "ROUND": SurveySpec(
            "استبيان رضا العملاء",
            "شكرًا لاختيارك خدماتنا. أسئلة قليلة تساعدنا على تحسين تجربتك — أقل من 3 دقائق.",
            _CUSTOMER_SECTIONS,
        )
    },
)

# ---------------------------------------------------------------- events
EVENT_EVALUATION = Template(
    code="event_evaluation",
    category="events",
    sector="EVENTS",
    icon="calendar",
    name=("تقييم فعالية أو مؤتمر", "Event evaluation"),
    description=(
        "تقييم ما بعد الفعالية: المحتوى والمتحدثون والتنظيم والمكان والفائدة، والرغبة في الحضور مستقبلًا.",
        "Post-event evaluation of content, speakers, organization, venue and benefit, and intent to return.",
    ),
    plan={
        "project_title": "تقييم فعالية",
        "measurement_type": "EXPERIENCE",
        "secondary_types": ["SATISFACTION"],
        "target_population": "حضور الفعالية",
        "purpose": "معرفة تقييم الحضور للفعالية وما يجب تحسينه في الفعاليات القادمة.",
        "understanding_summary": "تقييم تجربة الحضور بعد انتهاء الفعالية مباشرة.",
        "measurement_type_rationale": "الهدف تقييم التجربة والرضا، وهو مستوى رد الفعل.",
        "objectives": [
            {"key": "o1", "title": "قياس رضا الحضور عن الفعالية"},
            {"key": "o2", "title": "تحديد ما يحتاج إلى تحسين في الفعاليات القادمة"},
        ],
        "dimensions": [
            {"key": "content", "name": "المحتوى", "description": "جودة الموضوعات وفائدتها", "objective_key": "o1"},
            {"key": "speakers", "name": "المتحدثون", "description": "وضوح العرض والخبرة", "objective_key": "o1"},
            {
                "key": "organization",
                "name": "التنظيم",
                "description": "الالتزام بالوقت وسلاسة الإجراءات",
                "objective_key": "o2",
            },
            {
                "key": "venue",
                "name": "المكان أو المنصة",
                "description": "ملاءمة المكان أو المنصة الإلكترونية",
                "objective_key": "o2",
            },
        ],
        "indicators": [
            _ind("IND-01", "نسبة الحضور الراضين عن الفعالية", "content", "PERCENTAGE", "≥ 85%", 85.0),
            _ind("IND-02", "متوسط تقييم المحتوى", "content", "AVERAGE_SCORE", "4.2 من 5", 4.2),
            _ind("IND-03", "نسبة الراضين عن التنظيم", "organization", "PERCENTAGE", "≥ 80%", 80.0),
        ],
        "recommended_design": "POST_ONLY",
        "design_rationale": "قياس واحد بعد الفعالية يكفي لتقييم التجربة؛ لا يقيس تغيرًا.",
        "waves": [{"wave_type": "SINGLE", "name": "بعد الفعالية", "timing": "خلال يومين من انتهاء الفعالية"}],
        "baseline_required": False,
        "post_measurement_required": True,
        "follow_up_recommended": False,
        "recommended_questions_count": 10,
        "estimated_completion_minutes": 3,
        "methodology_notes": ["أرسل الرابط في نهاية الفعالية أو عبر رمز QR في القاعة لرفع نسبة الاستجابة."],
        "clarifying_questions": [],
    },
    surveys={
        "SINGLE": SurveySpec(
            "تقييم الفعالية",
            "شكرًا لحضورك. رأيك يساعدنا على تحسين الفعاليات القادمة — نحو 3 دقائق.",
            (
                Section(
                    "overall",
                    "الانطباع العام",
                    (_csat("event_csat", "ما مدى رضاك عن الفعالية بشكل عام؟", "content", "IND-01"),),
                ),
                Section(
                    "details",
                    "التفاصيل",
                    (
                        Q("content_useful", "LIKERT", "كانت موضوعات الفعالية مفيدة لي.", "content", "IND-02"),
                        Q("content_new", "LIKERT", "تعلمت شيئًا جديدًا يمكنني الاستفادة منه.", "content", "IND-02"),
                        Q("speakers_clear", "LIKERT", "عرض المتحدثون أفكارهم بوضوح.", "speakers"),
                        Q("org_time", "LIKERT", "التزمت الفعالية بالوقت المعلن.", "organization", "IND-03"),
                        Q("org_smooth", "LIKERT", "كانت إجراءات التسجيل والدخول سهلة.", "organization", "IND-03"),
                        Q("venue_fit", "LIKERT", "كان المكان أو المنصة مناسبًا للفعالية.", "venue"),
                    ),
                ),
                Section(
                    "open",
                    "رأيك",
                    (
                        Q("return", "SINGLE_CHOICE", "هل ستحضر فعالية مشابهة مستقبلًا؟", options=("نعم", "ربما", "لا")),
                        Q("best", "LONG_TEXT", "ما أكثر ما أعجبك؟", required=False),
                        Q("improve", "LONG_TEXT", "ما الذي نحسّنه في المرة القادمة؟", required=False),
                    ),
                ),
            ),
        )
    },
)

# ---------------------------------------------------------------- employees
EMPLOYEE_PULSE = Template(
    code="employee_pulse",
    category="hr",
    sector="HR",
    icon="users",
    name=("نبض الموظفين", "Employee pulse"),
    description=(
        "استبيان قصير متكرر عن عبء العمل ودعم المدير ووضوح الأدوار وفرص التطور والانتماء.",
        "A short recurring survey on workload, manager support, role clarity, growth and belonging.",
    ),
    plan={
        "project_title": "نبض الموظفين",
        "measurement_type": "ENGAGEMENT",
        "secondary_types": ["PERCEPTION"],
        "target_population": "موظفو الجهة",
        "purpose": "متابعة شعور الموظفين بالعمل بشكل دوري لاكتشاف المشكلات مبكرًا ومتابعة أثر المبادرات.",
        "understanding_summary": "قياس نبض متكرر للاندماج الوظيفي وظروف العمل.",
        "measurement_type_rationale": "الهدف متابعة الاندماج والتصورات عبر الزمن.",
        "objectives": [
            {"key": "o1", "title": "متابعة مستوى انتماء الموظفين واندماجهم"},
            {"key": "o2", "title": "تحديد ظروف العمل التي تحتاج إلى تدخل"},
        ],
        "dimensions": [
            {"key": "workload", "name": "عبء العمل", "description": "توازن المهام والوقت", "objective_key": "o2"},
            {"key": "manager", "name": "دعم المدير", "description": "التوجيه والتقدير", "objective_key": "o2"},
            {
                "key": "clarity",
                "name": "وضوح الأدوار",
                "description": "وضوح المسؤوليات والتوقعات",
                "objective_key": "o2",
            },
            {"key": "growth", "name": "فرص التطور", "description": "التعلم والتقدم المهني", "objective_key": "o2"},
            {
                "key": "belonging",
                "name": "الانتماء",
                "description": "الارتباط بالجهة والرغبة في البقاء",
                "objective_key": "o1",
            },
        ],
        "indicators": [
            _ind("IND-01", "نسبة الموظفين المنتمين", "belonging", "PERCENTAGE", "≥ 75%", 75.0),
            _ind("IND-02", "متوسط دعم المدير", "manager", "AVERAGE_SCORE", "4 من 5", 4.0),
            _ind("IND-03", "نسبة من يرون عبء العمل مناسبًا", "workload", "PERCENTAGE", "≥ 65%", 65.0),
        ],
        "recommended_design": "REPEATED",
        "design_rationale": "تكرار الاستبيان نفسه كل ربع سنة يبيّن الاتجاه؛ لا يفسر أسباب التغير وحده.",
        "waves": [{"wave_type": "ROUND", "name": "جولة النبض", "timing": "كل ثلاثة أشهر"}],
        "baseline_required": False,
        "post_measurement_required": False,
        "follow_up_recommended": False,
        "recommended_questions_count": 10,
        "estimated_completion_minutes": 3,
        "methodology_notes": ["اجعل الاستبيان مجهول الهوية وأعلن ذلك بوضوح لرفع صدق الإجابات."],
        "clarifying_questions": [],
    },
    surveys={
        "ROUND": SurveySpec(
            "نبض الموظفين",
            "إجاباتك مجهولة الهوية ولا تُعرض إلا مجمّعة لمجموعات من 5 أشخاص أو أكثر — نحو 3 دقائق.",
            (
                Section(
                    "work",
                    "عملك",
                    (
                        Q("workload_fair", "LIKERT", "حجم العمل المطلوب مني مناسب للوقت المتاح.", "workload", "IND-03"),
                        Q(
                            "workload_pressure",
                            "LIKERT",
                            "أشعر بضغط عمل مستمر يصعب التعامل معه.",
                            "workload",
                            reverse=True,
                        ),
                        Q("manager_support", "LIKERT", "يدعمني مديري عندما أواجه صعوبة.", "manager", "IND-02"),
                        Q(
                            "manager_recognition",
                            "LIKERT",
                            "أحصل على تقدير مناسب عندما أنجز عملًا جيدًا.",
                            "manager",
                            "IND-02",
                        ),
                        Q("clarity_role", "LIKERT", "أعرف بوضوح ما هو متوقع مني.", "clarity"),
                        Q("growth_learn", "LIKERT", "تتاح لي فرص لتعلم مهارات جديدة.", "growth"),
                        Q("belong_proud", "LIKERT", "أشعر بالفخر بالعمل في هذه الجهة.", "belonging", "IND-01"),
                        Q("belong_stay", "LIKERT", "أرى نفسي أعمل هنا بعد سنتين.", "belonging", "IND-01"),
                    ),
                ),
                Section(
                    "open",
                    "رأيك",
                    (
                        Q(
                            "unit",
                            "SINGLE_CHOICE",
                            "مدة عملك في الجهة",
                            options=("أقل من سنة", "من سنة إلى 5 سنوات", "أكثر من 5 سنوات"),
                            profile=True,
                        ),
                        Q(
                            "one_change",
                            "LONG_TEXT",
                            "لو استطعت تغيير شيء واحد في بيئة عملك، ماذا سيكون؟",
                            required=False,
                        ),
                    ),
                ),
            ),
        )
    },
)

# ---------------------------------------------------------------- students
COURSE_FEEDBACK = Template(
    code="course_feedback",
    category="education",
    sector="EDUCATION",
    icon="book-open",
    name=("رضا الطلاب عن مقرر دراسي", "Course feedback"),
    description=(
        "تقييم الطلاب للمقرر في نهاية الفصل: المحتوى والتدريس وعدالة التقييم وعبء العمل.",
        "End-of-term student feedback on content, teaching, fair assessment and workload.",
    ),
    plan={
        "project_title": "رضا الطلاب عن مقرر دراسي",
        "measurement_type": "SATISFACTION",
        "secondary_types": ["PERCEPTION"],
        "target_population": "طلاب المقرر",
        "purpose": "معرفة تقييم الطلاب للمقرر لتطوير المحتوى وطرق التدريس والتقييم في الفصل القادم.",
        "understanding_summary": "تقييم نهاية فصل لتجربة الطلاب في المقرر.",
        "measurement_type_rationale": "الهدف تقييم التجربة والرضا عن المقرر.",
        "objectives": [
            {"key": "o1", "title": "قياس رضا الطلاب عن المقرر"},
            {"key": "o2", "title": "تحديد جوانب المقرر التي تحتاج إلى تطوير"},
        ],
        "dimensions": [
            {
                "key": "content",
                "name": "المحتوى",
                "description": "وضوح المحتوى وارتباطه بالأهداف",
                "objective_key": "o2",
            },
            {"key": "teaching", "name": "التدريس", "description": "وضوح الشرح والتفاعل", "objective_key": "o2"},
            {
                "key": "assessment",
                "name": "عدالة التقييم",
                "description": "ارتباط التقييم بما دُرّس ووضوح معاييره",
                "objective_key": "o2",
            },
            {"key": "workload", "name": "عبء العمل", "description": "مناسبة الواجبات للوقت", "objective_key": "o2"},
        ],
        "indicators": [
            _ind("IND-01", "نسبة الطلاب الراضين عن المقرر", "content", "PERCENTAGE", "≥ 80%", 80.0),
            _ind("IND-02", "متوسط تقييم التدريس", "teaching", "AVERAGE_SCORE", "4 من 5", 4.0),
            _ind("IND-03", "نسبة من يرون التقييم عادلًا", "assessment", "PERCENTAGE", "≥ 75%", 75.0),
        ],
        "recommended_design": "POST_ONLY",
        "design_rationale": "قياس واحد في نهاية الفصل؛ يصف تجربة الطلاب ولا يقيس تعلمهم.",
        "waves": [{"wave_type": "SINGLE", "name": "نهاية الفصل", "timing": "في الأسبوعين الأخيرين من الفصل"}],
        "baseline_required": False,
        "post_measurement_required": True,
        "follow_up_recommended": False,
        "recommended_questions_count": 10,
        "estimated_completion_minutes": 4,
        "methodology_notes": ["اجمع الإجابات قبل إعلان الدرجات النهائية لتقليل تأثرها بها."],
        "clarifying_questions": [],
    },
    surveys={
        "SINGLE": SurveySpec(
            "تقييم المقرر",
            "رأيك يساعد على تطوير المقرر للدفعات القادمة. الإجابات مجهولة الهوية — نحو 4 دقائق.",
            (
                Section(
                    "course",
                    "المقرر",
                    (
                        _csat("course_csat", "ما مدى رضاك عن المقرر بشكل عام؟", "content", "IND-01"),
                        Q("content_clear", "LIKERT", "كان محتوى المقرر واضحًا ومنظمًا.", "content"),
                        Q("content_useful", "LIKERT", "أرى فائدة ما تعلمته في المقرر.", "content"),
                        Q("teach_explain", "LIKERT", "شرح المحاضِر الموضوعات بطريقة مفهومة.", "teaching", "IND-02"),
                        Q("teach_questions", "LIKERT", "شجّع المحاضِر الطلاب على السؤال والنقاش.", "teaching", "IND-02"),
                        Q("assess_fair", "LIKERT", "ارتبطت الاختبارات والواجبات بما دُرّس.", "assessment", "IND-03"),
                        Q("assess_criteria", "LIKERT", "كانت معايير التقييم واضحة من البداية.", "assessment", "IND-03"),
                        Q("workload_ok", "LIKERT", "كان حجم الواجبات مناسبًا للوقت المتاح.", "workload"),
                    ),
                ),
                Section(
                    "open",
                    "رأيك",
                    (
                        Q("keep", "LONG_TEXT", "ما الذي يجب أن يبقى في المقرر؟", required=False),
                        Q("change", "LONG_TEXT", "ما الذي يجب أن يتغير؟", required=False),
                    ),
                ),
            ),
        )
    },
)

# ---------------------------------------------------------------- needs
NEEDS_ASSESSMENT = Template(
    code="needs_assessment",
    category="training",
    sector="CORPORATE",
    icon="clipboard-list",
    name=("تحليل الاحتياجات التدريبية", "Training needs assessment"),
    description=(
        "قبل تصميم برنامج: مستوى الثقة الحالي في المهارات وأولويات التدريب والطريقة المفضلة.",
        "Before designing a program: current confidence in key skills, training priorities and preferred format.",
    ),
    plan={
        "project_title": "تحليل الاحتياجات التدريبية",
        "measurement_type": "NEEDS_ASSESSMENT",
        "secondary_types": ["PERCEPTION"],
        "target_population": "الفئة المستهدفة بالتدريب",
        "purpose": "تحديد المهارات الأكثر حاجة إلى التدريب والطريقة المناسبة لتقديمه قبل تصميم البرنامج.",
        "understanding_summary": "تحليل احتياجات يسبق تصميم برنامج تدريبي.",
        "measurement_type_rationale": "الهدف تحديد الاحتياج قبل التدخل، لا تقييم أثر.",
        "objectives": [
            {"key": "o1", "title": "تحديد مستوى الثقة الحالي في المهارات الأساسية"},
            {"key": "o2", "title": "ترتيب أولويات التدريب والطريقة المفضلة"},
        ],
        "dimensions": [
            {
                "key": "skill_confidence",
                "name": "الثقة في المهارات الحالية",
                "description": "تقدير الفرد لمستواه الحالي",
                "objective_key": "o1",
            },
            {
                "key": "need",
                "name": "الحاجة إلى التدريب",
                "description": "مدى الحاجة إلى تدريب في كل مجال",
                "objective_key": "o2",
            },
        ],
        "indicators": [
            _ind("IND-01", "نسبة من يحتاجون تدريبًا في المهارات الرقمية", "need", "PERCENTAGE", "للمتابعة", None),
            _ind("IND-02", "متوسط الثقة في المهارات الحالية", "skill_confidence", "AVERAGE_SCORE", "للمتابعة", None),
        ],
        "recommended_design": "POST_ONLY",
        "design_rationale": "قياس واحد يصف الاحتياج الحالي ليُبنى عليه البرنامج.",
        "waves": [{"wave_type": "SINGLE", "name": "تحليل الاحتياج", "timing": "قبل تصميم البرنامج"}],
        "baseline_required": False,
        "post_measurement_required": False,
        "follow_up_recommended": False,
        "recommended_questions_count": 10,
        "estimated_completion_minutes": 4,
        "methodology_notes": ["عدّل قائمة المهارات لتناسب مجال عمل الفئة المستهدفة قبل النشر."],
        "clarifying_questions": [],
    },
    surveys={
        "SINGLE": SurveySpec(
            "تحليل الاحتياجات التدريبية",
            "نود معرفة احتياجاتك التدريبية لتصميم برنامج يناسبك — نحو 4 دقائق.",
            (
                Section(
                    "confidence",
                    "مستواك الحالي",
                    (
                        Q(
                            "conf_digital",
                            "LIKERT",
                            "أنا واثق من مهاراتي الرقمية في العمل.",
                            "skill_confidence",
                            "IND-02",
                        ),
                        Q(
                            "conf_communication",
                            "LIKERT",
                            "أنا واثق من مهاراتي في التواصل والعرض.",
                            "skill_confidence",
                            "IND-02",
                        ),
                        Q(
                            "conf_planning",
                            "LIKERT",
                            "أنا واثق من قدرتي على تخطيط المهام وإدارة الوقت.",
                            "skill_confidence",
                            "IND-02",
                        ),
                    ),
                ),
                Section(
                    "needs",
                    "احتياجاتك",
                    (
                        Q("need_digital", "LIKERT", "أحتاج إلى تدريب في المهارات الرقمية.", "need", "IND-01"),
                        Q("need_communication", "LIKERT", "أحتاج إلى تدريب في التواصل والعرض.", "need"),
                        Q("need_planning", "LIKERT", "أحتاج إلى تدريب في التخطيط وإدارة الوقت.", "need"),
                        Q(
                            "format",
                            "MULTIPLE_CHOICE",
                            "ما طرق التدريب التي تناسبك؟",
                            options=("ورش حضورية", "جلسات عن بعد", "محتوى ذاتي التعلم", "إرشاد فردي"),
                        ),
                        Q("other_need", "LONG_TEXT", "ما مهارة أخرى تحتاج إلى تدريب فيها؟", required=False),
                    ),
                ),
            ),
        )
    },
)

TEMPLATES: dict[str, Template] = {
    t.code: t
    for t in (
        TRAINING_IMPACT,
        CUSTOMER_SATISFACTION,
        EVENT_EVALUATION,
        EMPLOYEE_PULSE,
        COURSE_FEEDBACK,
        NEEDS_ASSESSMENT,
    )
}


TEMPLATE_PREFIX = "template:"


def _from_prompt(prompt: str) -> Template | None:
    return TEMPLATES.get(prompt.removeprefix(TEMPLATE_PREFIX)) if prompt.startswith(TEMPLATE_PREFIX) else None


def source_label(prompt: str, lang: str = "ar") -> str:
    """What to show as the plan's origin: the user's request, or the template's name."""
    t = _from_prompt(prompt)
    if t is None:
        return prompt
    return f"قالب: {t.name[0]}" if lang == "ar" else f"Template: {t.name[1]}"


def request_text(prompt: str) -> str:
    """The request the Measurement Architect sees when improving a plan."""
    t = _from_prompt(prompt)
    return f"{t.name[0]}: {t.description[0]} {t.plan['purpose']}" if t else prompt
