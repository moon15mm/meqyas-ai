/**
 * Shared measurement vocabulary — mirrors packages/ai/meqyas_ai/domain/enums.py.
 * Parity is enforced by tests/fixtures/enums.json (checked by both test suites).
 */

export type Locale = "ar" | "en";
type Labels = Record<Locale, string>;

export const MEASUREMENT_TYPES = [
  "SATISFACTION",
  "PERCEPTION",
  "EXPERIENCE",
  "NEEDS_ASSESSMENT",
  "AWARENESS",
  "KNOWLEDGE",
  "SKILLS",
  "BEHAVIOR",
  "ENGAGEMENT",
  "PROGRAM_EVALUATION",
  "TRAINING_EVALUATION",
  "OUTCOME",
  "IMPACT",
  "PRE_POST",
  "LONGITUDINAL",
  "EVENT_EVALUATION",
  "EMPLOYEE_PULSE",
  "CUSTOMER_FEEDBACK",
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export const MEASUREMENT_DESIGNS = [
  "POST_ONLY",
  "RETROSPECTIVE_PRE_POST",
  "PRE_POST",
  "PRE_POST_FOLLOW_UP",
  "REPEATED",
  "COMPARISON_GROUP",
] as const;
export type MeasurementDesign = (typeof MEASUREMENT_DESIGNS)[number];

export const WAVE_TYPES = ["BASELINE", "MIDLINE", "POST", "FOLLOW_UP", "SINGLE", "ROUND"] as const;
export type WaveType = (typeof WAVE_TYPES)[number];

export const EVIDENCE_LEVELS = [
  "DESCRIPTIVE",
  "PERCEIVED_CHANGE",
  "CHANGE",
  "CHANGE_PERSISTENCE",
  "TREND",
  "CONTRIBUTION",
  "ATTRIBUTION",
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const OUTCOME_LEVELS = [
  "REACTION",
  "NEED",
  "LEARNING",
  "BEHAVIOR",
  "RESULTS",
  "COMPOSITE",
  "DESIGN",
] as const;
export type OutcomeLevel = (typeof OUTCOME_LEVELS)[number];

export const INDICATOR_TYPES = [
  "PERCENTAGE",
  "AVERAGE_SCORE",
  "COUNT",
  "RATE",
  "CHANGE",
  "DIFFERENCE",
  "EFFECT_SIZE",
  "CUSTOM",
] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

export const INDICATOR_FREQUENCIES = [
  "ONCE",
  "PER_WAVE",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "CONTINUOUS",
] as const;
export type IndicatorFrequency = (typeof INDICATOR_FREQUENCIES)[number];

export const INDICATOR_DIRECTIONS = ["HIGHER_IS_BETTER", "LOWER_IS_BETTER"] as const;
export type IndicatorDirection = (typeof INDICATOR_DIRECTIONS)[number];

export const INDICATOR_STATUSES = [
  "NOT_STARTED",
  "COLLECTING",
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "ACHIEVED",
] as const;
export type IndicatorStatus = (typeof INDICATOR_STATUSES)[number];

export const QUESTION_TYPES = [
  "SHORT_TEXT",
  "LONG_TEXT",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "DROPDOWN",
  "RATING",
  "STAR",
  "LIKERT",
  "MATRIX",
  "RANKING",
  "SLIDER",
  "NPS",
  "CSAT",
  "CES",
  "NUMBER",
  "DATE",
  "FILE",
  "INFORMATION",
  "SECTION",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ROLES = ["OWNER", "ADMIN", "EDITOR", "ANALYST", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const SECTORS = [
  "EDUCATION",
  "CORPORATE",
  "NONPROFIT",
  "GOVERNMENT",
  "INITIATIVE",
  "EVENTS",
  "HR",
  "CUSTOMER",
  "OTHER",
] as const;
export type Sector = (typeof SECTORS)[number];

// ------------------------------------------------------------------ labels
export const MEASUREMENT_TYPE_LABELS: Record<MeasurementType, Labels> = {
  SATISFACTION: { ar: "قياس الرضا", en: "Satisfaction" },
  PERCEPTION: { ar: "قياس الانطباعات", en: "Perception" },
  EXPERIENCE: { ar: "قياس التجربة", en: "Experience" },
  NEEDS_ASSESSMENT: { ar: "قياس الاحتياجات", en: "Needs assessment" },
  AWARENESS: { ar: "قياس الوعي", en: "Awareness" },
  KNOWLEDGE: { ar: "قياس المعرفة", en: "Knowledge" },
  SKILLS: { ar: "قياس المهارات", en: "Skills" },
  BEHAVIOR: { ar: "قياس السلوك", en: "Behavior" },
  ENGAGEMENT: { ar: "قياس الانخراط", en: "Engagement" },
  PROGRAM_EVALUATION: { ar: "تقييم برنامج", en: "Program evaluation" },
  TRAINING_EVALUATION: { ar: "تقييم تدريب", en: "Training evaluation" },
  OUTCOME: { ar: "قياس النتائج", en: "Outcome" },
  IMPACT: { ar: "قياس الأثر", en: "Impact" },
  PRE_POST: { ar: "قياس قبلي/بعدي", en: "Pre/Post" },
  LONGITUDINAL: { ar: "قياس طولي", en: "Longitudinal" },
  EVENT_EVALUATION: { ar: "تقييم فعالية", en: "Event evaluation" },
  EMPLOYEE_PULSE: { ar: "نبض الموظفين", en: "Employee pulse" },
  CUSTOMER_FEEDBACK: { ar: "آراء العملاء", en: "Customer feedback" },
};

export const OUTCOME_LEVEL_LABELS: Record<OutcomeLevel, Labels> = {
  REACTION: { ar: "مستوى ردّ الفعل", en: "Reaction level" },
  NEED: { ar: "مستوى الاحتياج", en: "Needs level" },
  LEARNING: { ar: "مستوى التعلّم", en: "Learning level" },
  BEHAVIOR: { ar: "مستوى السلوك", en: "Behavior level" },
  RESULTS: { ar: "مستوى النتائج والأثر", en: "Results & impact level" },
  COMPOSITE: { ar: "تقييم مركّب", en: "Composite evaluation" },
  DESIGN: { ar: "تصميم زمني", en: "Time-based design" },
};

export const DESIGN_LABELS: Record<MeasurementDesign, Labels> = {
  POST_ONLY: { ar: "قياس واحد", en: "Single measurement" },
  RETROSPECTIVE_PRE_POST: { ar: "قبلي/بعدي استرجاعي", en: "Retrospective pre/post" },
  PRE_POST: { ar: "قبلي / بعدي", en: "Pre / Post" },
  PRE_POST_FOLLOW_UP: { ar: "قبلي / بعدي / متابعة", en: "Pre / Post / Follow-up" },
  REPEATED: { ar: "قياسات متكررة", en: "Repeated measurements" },
  COMPARISON_GROUP: { ar: "مجموعة مقارنة", en: "Comparison group" },
};

export const WAVE_LABELS: Record<WaveType, Labels> = {
  BASELINE: { ar: "القياس القبلي", en: "Baseline" },
  MIDLINE: { ar: "القياس المرحلي", en: "Midline" },
  POST: { ar: "القياس البعدي", en: "Post" },
  FOLLOW_UP: { ar: "قياس المتابعة", en: "Follow-up" },
  SINGLE: { ar: "القياس", en: "Measurement" },
  ROUND: { ar: "جولة قياس", en: "Round" },
};

export const EVIDENCE_LABELS: Record<EvidenceLevel, Labels & { hint_ar: string; hint_en: string }> = {
  DESCRIPTIVE: {
    ar: "دليل وصفي",
    en: "Descriptive",
    hint_ar: "يصف الآراء والمستوى الحالي ولا يقيس تغيرًا.",
    hint_en: "Describes current views and levels; does not measure change.",
  },
  PERCEIVED_CHANGE: {
    ar: "تغير مُدرَك",
    en: "Perceived change",
    hint_ar: "التغير كما يراه المشاركون أنفسهم.",
    hint_en: "Change as perceived by participants.",
  },
  CHANGE: {
    ar: "تغير ملحوظ",
    en: "Observed change",
    hint_ar: "مقارنة قبل وبعد — تُظهر التغير ولا تثبت السبب.",
    hint_en: "Before vs after — shows change, not its cause.",
  },
  CHANGE_PERSISTENCE: {
    ar: "تغير واستمرارية",
    en: "Change & persistence",
    hint_ar: "قبل وبعد ومتابعة — تُظهر التغير واستمراره ولا تثبت السبب.",
    hint_en: "Before, after and follow-up — shows change and persistence, not cause.",
  },
  TREND: {
    ar: "اتجاه زمني",
    en: "Trend",
    hint_ar: "اتجاه المؤشرات عبر الزمن.",
    hint_en: "Direction of indicators over time.",
  },
  CONTRIBUTION: {
    ar: "إسهام",
    en: "Contribution",
    hint_ar: "مقارنة بمجموعة غير مشاركة تقوّي الاستنتاج.",
    hint_en: "Comparison with non-participants strengthens conclusions.",
  },
  ATTRIBUTION: {
    ar: "إسناد سببي",
    en: "Attribution",
    hint_ar: "تصميم تجريبي عشوائي.",
    hint_en: "Randomized experimental design.",
  },
};

export const INDICATOR_TYPE_LABELS: Record<IndicatorType, Labels> = {
  PERCENTAGE: { ar: "نسبة مئوية", en: "Percentage" },
  AVERAGE_SCORE: { ar: "متوسط درجة", en: "Average score" },
  COUNT: { ar: "عدد", en: "Count" },
  RATE: { ar: "معدل", en: "Rate" },
  CHANGE: { ar: "تغير", en: "Change" },
  DIFFERENCE: { ar: "فرق", en: "Difference" },
  EFFECT_SIZE: { ar: "حجم الأثر", en: "Effect size" },
  CUSTOM: { ar: "مخصص", en: "Custom" },
};

export const FREQUENCY_LABELS: Record<IndicatorFrequency, Labels> = {
  ONCE: { ar: "مرة واحدة", en: "Once" },
  PER_WAVE: { ar: "في كل قياس", en: "Per wave" },
  WEEKLY: { ar: "أسبوعي", en: "Weekly" },
  MONTHLY: { ar: "شهري", en: "Monthly" },
  QUARTERLY: { ar: "ربع سنوي", en: "Quarterly" },
  CONTINUOUS: { ar: "مستمر", en: "Continuous" },
};

export const INDICATOR_STATUS_LABELS: Record<IndicatorStatus, Labels> = {
  NOT_STARTED: { ar: "لم يبدأ", en: "Not started" },
  COLLECTING: { ar: "قيد الجمع", en: "Collecting" },
  ON_TRACK: { ar: "على المسار", en: "On track" },
  AT_RISK: { ar: "معرض للخطر", en: "At risk" },
  OFF_TRACK: { ar: "خارج المسار", en: "Off track" },
  ACHIEVED: { ar: "تحقق", en: "Achieved" },
};

export const ROLE_LABELS: Record<Role, Labels> = {
  OWNER: { ar: "مالك", en: "Owner" },
  ADMIN: { ar: "مدير", en: "Admin" },
  EDITOR: { ar: "محرر", en: "Editor" },
  ANALYST: { ar: "محلل", en: "Analyst" },
  VIEWER: { ar: "مشاهد", en: "Viewer" },
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, Labels> = {
  DRAFT: { ar: "مسودة", en: "Draft" },
  ACTIVE: { ar: "نشط", en: "Active" },
  COMPLETED: { ar: "مكتمل", en: "Completed" },
  ARCHIVED: { ar: "مؤرشف", en: "Archived" },
};

export const SECTOR_LABELS: Record<Sector, Labels> = {
  EDUCATION: { ar: "التعليم", en: "Education" },
  CORPORATE: { ar: "الشركات", en: "Corporate" },
  NONPROFIT: { ar: "الجمعيات", en: "Non-profit" },
  GOVERNMENT: { ar: "جهة حكومية", en: "Government" },
  INITIATIVE: { ar: "المبادرات", en: "Initiatives" },
  EVENTS: { ar: "الفعاليات", en: "Events" },
  HR: { ar: "الموارد البشرية", en: "HR" },
  CUSTOMER: { ar: "العملاء", en: "Customers" },
  OTHER: { ar: "أخرى", en: "Other" },
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, Labels> = {
  SHORT_TEXT: { ar: "نص قصير", en: "Short text" },
  LONG_TEXT: { ar: "نص طويل", en: "Long text" },
  SINGLE_CHOICE: { ar: "اختيار واحد", en: "Single choice" },
  MULTIPLE_CHOICE: { ar: "اختيار متعدد", en: "Multiple choice" },
  DROPDOWN: { ar: "قائمة منسدلة", en: "Dropdown" },
  RATING: { ar: "تقييم رقمي", en: "Rating" },
  STAR: { ar: "تقييم بالنجوم", en: "Stars" },
  LIKERT: { ar: "مقياس ليكرت", en: "Likert" },
  MATRIX: { ar: "مصفوفة", en: "Matrix" },
  RANKING: { ar: "ترتيب", en: "Ranking" },
  SLIDER: { ar: "مؤشر منزلق", en: "Slider" },
  NPS: { ar: "صافي نقاط الترويج NPS", en: "NPS" },
  CSAT: { ar: "رضا العملاء CSAT", en: "CSAT" },
  CES: { ar: "سهولة الجهد CES", en: "CES" },
  NUMBER: { ar: "رقم", en: "Number" },
  DATE: { ar: "تاريخ", en: "Date" },
  FILE: { ar: "ملف", en: "File" },
  INFORMATION: { ar: "نص معلوماتي", en: "Information" },
  SECTION: { ar: "قسم", en: "Section" },
};

// ------------------------------------------------------- subscriptions (SUBSCRIPTIONS.md)
export const SUBSCRIPTION_STATES = ["PENDING", "TRIAL", "ACTIVE", "EXPIRED", "SUSPENDED"] as const;
export type SubscriptionStateCode = (typeof SUBSCRIPTION_STATES)[number];

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionStateCode, Labels> = {
  PENDING: { ar: "بانتظار التفعيل", en: "Awaiting activation" },
  TRIAL: { ar: "تجريبي", en: "Trial" },
  ACTIVE: { ar: "نشط", en: "Active" },
  EXPIRED: { ar: "منتهٍ", en: "Expired" },
  SUSPENDED: { ar: "موقوف", en: "Suspended" },
};

/** Modules a plan can include (everything else is in every plan). */
export const PLAN_FEATURES = ["cx", "integrations", "exports", "ai_analysis", "ai_followup"] as const;
export type PlanFeatureCode = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeatureCode, Labels> = {
  cx: { ar: "تجربة العملاء والفروع", en: "Customer experience & branches" },
  integrations: { ar: "تكامل المتاجر", en: "Store integrations" },
  exports: { ar: "تصدير البيانات", en: "Data exports" },
  ai_analysis: { ar: "التحليل بالذكاء الاصطناعي", en: "AI analysis" },
  ai_followup: { ar: "أسئلة المتابعة الذكية", en: "AI follow-up questions" },
};

export function label<T extends string>(
  table: Record<T, Labels>,
  value: T | null | undefined,
  locale: Locale,
): string {
  if (!value) return "";
  return table[value]?.[locale] ?? value;
}

/** Reaction-level types never claim change; used by UI copy ("هذا أقرب إلى قياس الرضا"). */
export const REACTION_TYPES: ReadonlySet<MeasurementType> = new Set<MeasurementType>([
  "SATISFACTION",
  "PERCEPTION",
  "EXPERIENCE",
  "EVENT_EVALUATION",
  "CUSTOMER_FEEDBACK",
  "EMPLOYEE_PULSE",
]);
