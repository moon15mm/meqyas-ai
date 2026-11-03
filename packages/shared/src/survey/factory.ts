/** Builders for new survey elements with complete defaults (so client state matches the server). */
import type { QuestionType } from "../enums";
import type { OptionDoc, QuestionDoc, ScaleDoc, SectionDoc, SurveyDoc } from "./document";
import { CHOICE_TYPES, FIXED_SCALES, SCALE_TYPES } from "./document";

export const LIKERT_LABELS: Record<"ar" | "en", string[]> = {
  ar: ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"],
  en: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
};

export type LikertPreset =
  | "agreement"
  | "knowledge"
  | "quality"
  | "satisfaction"
  | "importance"
  | "effectiveness"
  | "frequency";

export const LIKERT_PRESETS: Record<
  LikertPreset,
  Record<"ar" | "en", { name: string; labels: string[] }>
> = {
  agreement: {
    ar: { name: "موافقة", labels: ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"] },
    en: { name: "Agreement", labels: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] },
  },
  knowledge: {
    ar: { name: "معرفة / مدى", labels: ["منعدمة (لا أعرف)", "منخفضة (معرفة بسيطة)", "متوسطة", "عالية (معرفة جيدة)", "تامة (أعرف بالكامل)"] },
    en: { name: "Knowledge", labels: ["None (No knowledge)", "Low (Basic knowledge)", "Moderate", "High (Good knowledge)", "Complete (Thorough knowledge)"] },
  },
  quality: {
    ar: { name: "تقييم / جودة", labels: ["ضعيف جداً", "ضعيف", "متوسط", "جيد", "ممتاز"] },
    en: { name: "Quality", labels: ["Very poor", "Poor", "Average", "Good", "Excellent"] },
  },
  satisfaction: {
    ar: { name: "رضا", labels: ["غير راضٍ بشدة", "غير راضٍ", "محايد", "راضٍ", "راضٍ بشدة"] },
    en: { name: "Satisfaction", labels: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"] },
  },
  importance: {
    ar: { name: "أهمية", labels: ["غير مهم إطلاقاً", "قليل الأهمية", "متوسط الأهمية", "مهم", "مهم جداً"] },
    en: { name: "Importance", labels: ["Not at all important", "Slightly important", "Moderately important", "Important", "Very important"] },
  },
  effectiveness: {
    ar: { name: "فاعلية / أثر", labels: ["غير فعال إطلاقاً", "قليل الفاعلية", "متوسط الفاعلية", "فعال", "فعال جداً"] },
    en: { name: "Effectiveness", labels: ["Not effective at all", "Slightly effective", "Moderately effective", "Effective", "Highly effective"] },
  },
  frequency: {
    ar: { name: "تكرار", labels: ["أبداً", "نادراً", "أحياناً", "غالباً", "دائماً"] },
    en: { name: "Frequency", labels: ["Never", "Rarely", "Sometimes", "Often", "Always"] },
  },
};

export type QuestionGroup = "text" | "choice" | "scale" | "other";

export const QUESTION_GROUPS: Record<QuestionGroup, QuestionType[]> = {
  text: ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "DATE"],
  choice: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN", "RANKING"],
  scale: ["LIKERT", "RATING", "STAR", "SLIDER", "MATRIX", "NPS", "CSAT", "CES"],
  other: ["FILE", "INFORMATION", "SECTION"],
};

function randomId(len = 6): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function newKey(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let key = `${prefix}_${randomId()}`;
  while (used.has(key)) key = `${prefix}_${randomId()}`;
  return key;
}

export function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

export function likertOptions(
  scale: Pick<ScaleDoc, "min" | "max">,
  language: "ar" | "en",
  preset: LikertPreset = "agreement",
): OptionDoc[] {
  const points = scale.max - scale.min + 1;
  const labels = LIKERT_PRESETS[preset]?.[language]?.labels ?? LIKERT_LABELS[language];
  return Array.from({ length: points }, (_, i) => ({
    value: String(scale.min + i),
    label: points === labels.length ? labels[i]! : String(scale.min + i),
    score: scale.min + i,
    is_other: false,
    is_exclusive: false,
  }));
}

function defaultScale(type: QuestionType): ScaleDoc | null {
  const fixed = FIXED_SCALES[type];
  if (fixed)
    return { min: fixed[0], max: fixed[1], step: 1, min_label: "", max_label: "", reverse_scored: false };
  if (!SCALE_TYPES.has(type)) return null;
  const max = type === "SLIDER" ? 10 : 5;
  return {
    min: type === "SLIDER" ? 0 : 1,
    max,
    step: 1,
    min_label: "",
    max_label: "",
    reverse_scored: false,
  };
}

function defaultOptions(type: QuestionType, language: "ar" | "en"): OptionDoc[] {
  const t =
    language === "ar"
      ? ["الخيار الأول", "الخيار الثاني", "الخيار الثالث"]
      : ["Option 1", "Option 2", "Option 3"];
  if (CHOICE_TYPES.has(type) || type === "RANKING") {
    return t.map((label, i) => ({
      value: String(i + 1),
      label,
      score: null,
      is_other: false,
      is_exclusive: false,
    }));
  }
  if (type === "MATRIX") return likertOptions({ min: 1, max: 5 }, language);
  if (type === "LIKERT") return likertOptions({ min: 1, max: 5 }, language);
  return [];
}

const DEFAULT_TEXT: Partial<Record<QuestionType, Record<"ar" | "en", string>>> = {
  INFORMATION: { ar: "نص توضيحي للمشاركين", en: "Information for respondents" },
  SECTION: { ar: "عنوان فرعي", en: "Sub-heading" },
};

export function newQuestion(type: QuestionType, language: "ar" | "en", taken: Iterable<string>): QuestionDoc {
  const scale = defaultScale(type);
  return {
    key: newKey("q", taken),
    type,
    text: DEFAULT_TEXT[type]?.[language] ?? "",
    description: "",
    required: false,
    dimension_id: null,
    indicator_id: null,
    options: defaultOptions(type, language),
    scale,
    validation: {},
    settings: {
      randomize_options: false,
      rows:
        type === "MATRIX"
          ? [
              { key: "r1", text: language === "ar" ? "العبارة الأولى" : "Statement 1" },
              { key: "r2", text: language === "ar" ? "العبارة الثانية" : "Statement 2" },
            ]
          : [],
      placeholder: "",
      ai_followup: false,
      is_profile: false,
    },
    scoring: { weight: 1, correct_values: [] },
    ai_generated: false,
    lineage_id: newUuid(),
  };
}

export function newSection(language: "ar" | "en", taken: Iterable<string>): SectionDoc {
  return {
    key: newKey("s", taken),
    title: language === "ar" ? "قسم جديد" : "New section",
    description: "",
    randomize_questions: false,
    questions: [],
  };
}

export function allKeys(doc: Pick<SurveyDoc, "sections">): string[] {
  return doc.sections.flatMap((s) => [s.key, ...s.questions.map((q) => q.key)]);
}

/** Estimated completion time (minutes) — same weights as the API quality engine. */
const SECONDS: Partial<Record<QuestionType, number>> = {
  SHORT_TEXT: 30,
  LONG_TEXT: 60,
  SINGLE_CHOICE: 8,
  MULTIPLE_CHOICE: 12,
  DROPDOWN: 8,
  RATING: 6,
  STAR: 5,
  LIKERT: 7,
  MATRIX: 5,
  RANKING: 20,
  SLIDER: 7,
  NPS: 6,
  CSAT: 6,
  CES: 6,
  NUMBER: 10,
  DATE: 10,
  FILE: 30,
  INFORMATION: 5,
  SECTION: 0,
};

export function estimateMinutes(doc: Pick<SurveyDoc, "sections">): number {
  let seconds = 0;
  for (const q of doc.sections.flatMap((s) => s.questions)) {
    seconds += (SECONDS[q.type] ?? 10) + (q.type === "MATRIX" ? 6 * q.settings.rows.length : 0);
  }
  return seconds / 60;
}
