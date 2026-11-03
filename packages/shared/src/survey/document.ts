/**
 * Survey document types — mirror of apps/api/app/domain/survey/document.py.
 * The API validates and normalizes; these types/schemas drive the builder and renderer.
 */
import { z } from "zod";

import { QUESTION_TYPES, type QuestionType } from "../enums";

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/;

export const ANSWERABLE_TYPES: ReadonlySet<QuestionType> = new Set(
  QUESTION_TYPES.filter((t) => t !== "INFORMATION" && t !== "SECTION"),
);
export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "DROPDOWN",
]);
export const NUMERIC_TYPES: ReadonlySet<QuestionType> = new Set([
  "RATING",
  "STAR",
  "LIKERT",
  "SLIDER",
  "NPS",
  "CSAT",
  "CES",
  "NUMBER",
]);
export const SCALE_TYPES: ReadonlySet<QuestionType> = new Set(
  [...NUMERIC_TYPES].filter((t) => t !== "NUMBER"),
);
export const FIXED_SCALES: Partial<Record<QuestionType, [number, number]>> = {
  NPS: [0, 10],
  CSAT: [1, 5],
  CES: [1, 7],
};

const key = z.string().regex(KEY_PATTERN);

export const optionDocSchema = z.object({
  value: z.string().min(1).max(60),
  label: z.string().max(300).default(""),
  score: z.number().nullable().optional(),
  is_other: z.boolean().default(false),
  is_exclusive: z.boolean().default(false),
});

export const scaleDocSchema = z.object({
  min: z.number().int().default(1),
  max: z.number().int().default(5),
  step: z.number().positive().default(1),
  min_label: z.string().max(120).default(""),
  max_label: z.string().max(120).default(""),
  reverse_scored: z.boolean().default(false),
});

export const validationDocSchema = z.object({
  min_length: z.number().int().nullable().optional(),
  max_length: z.number().int().nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  min_choices: z.number().int().nullable().optional(),
  max_choices: z.number().int().nullable().optional(),
  pattern: z.string().max(200).nullable().optional(),
  date_min: z.string().nullable().optional(),
  date_max: z.string().nullable().optional(),
});

export const questionDocSchema = z.object({
  key,
  type: z.enum(QUESTION_TYPES),
  text: z.string().max(1000).default(""),
  description: z.string().max(2000).default(""),
  required: z.boolean().default(false),
  dimension_id: z.string().nullable().optional(),
  indicator_id: z.string().nullable().optional(),
  options: z.array(optionDocSchema).default([]),
  scale: scaleDocSchema.nullable().optional(),
  validation: validationDocSchema.default({}),
  settings: z
    .object({
      randomize_options: z.boolean().default(false),
      rows: z.array(z.object({ key, text: z.string().max(500).default("") })).default([]),
      placeholder: z.string().max(200).default(""),
      ai_followup: z.boolean().default(false),
      is_profile: z.boolean().default(false),
      /** Customer experience: the outcome (loyalty/satisfaction) or a driver of it. */
      cx_role: z.enum(["outcome", "driver"]).nullable().optional(),
      /** Phone/e-mail typed only to be called back; moved to the follow-up case, never stored as an answer. */
      contact_field: z.enum(["phone", "email"]).nullable().optional(),
    })
    .default({ randomize_options: false, rows: [], placeholder: "", ai_followup: false, is_profile: false }),
  scoring: z
    .object({
      weight: z.number().default(1),
      correct_values: z.array(z.string()).default([]),
      points: z.number().nullable().optional(),
    })
    .default({ weight: 1, correct_values: [] }),
  ai_generated: z.boolean().default(false),
  lineage_id: z.string().nullable().optional(),
});

export const sectionDocSchema = z.object({
  key,
  title: z.string().max(300).default(""),
  description: z.string().max(2000).default(""),
  randomize_questions: z.boolean().default(false),
  questions: z.array(questionDocSchema).default([]),
});

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { question: string; op: Operator; value?: unknown; row?: string }
  | Record<string, never>;

export const OPERATORS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "answered",
  "not_answered",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const logicRuleDocSchema = z.object({
  id: z.string().max(60).nullable().optional(),
  type: z.enum(["DISPLAY", "SKIP", "END", "QUOTA"]),
  source_key: z.string().nullable().optional(),
  target_key: z.string().nullable().optional(),
  condition: z.record(z.string(), z.unknown()).default({}),
  limit: z.number().int().nullable().optional(),
  enabled: z.boolean().default(true),
});

export const surveySettingsDocSchema = z.object({
  one_question_per_page: z.boolean().default(false),
  show_progress: z.boolean().default(true),
  allow_back: z.boolean().default(true),
  anonymity_mode: z.enum(["ANONYMOUS", "PSEUDONYMOUS", "IDENTIFIED"]).default("ANONYMOUS"),
  collect_respondent_code: z.boolean().default(false),
  ai_followup_enabled: z.boolean().default(false),
  ai_followup_max: z.number().int().min(0).max(3).default(2),
  /** "pulse": one tap per screen, faces, stars and auto-advance (customer experience). */
  experience: z.enum(["standard", "pulse"]).default("standard"),
  reward_text: z.string().max(300).default(""),
  closed_loop: z.boolean().default(false),
});

export const surveyDocSchema = z.object({
  title: z.string().max(300).default(""),
  introduction: z.string().max(5000).default(""),
  thank_you_message: z.string().max(2000).default(""),
  language: z.enum(["ar", "en"]).default("ar"),
  sections: z.array(sectionDocSchema).min(1),
  logic: z.array(logicRuleDocSchema).default([]),
  settings: surveySettingsDocSchema.default({
    one_question_per_page: false,
    show_progress: true,
    allow_back: true,
    anonymity_mode: "ANONYMOUS",
    collect_respondent_code: false,
    ai_followup_enabled: false,
    ai_followup_max: 2,
    experience: "standard",
    reward_text: "",
    closed_loop: false,
  }),
});

export type OptionDoc = z.infer<typeof optionDocSchema>;
export type ScaleDoc = z.infer<typeof scaleDocSchema>;
export type QuestionDoc = z.infer<typeof questionDocSchema>;
export type SectionDoc = z.infer<typeof sectionDocSchema>;
export type LogicRuleDoc = Omit<z.infer<typeof logicRuleDocSchema>, "condition"> & { condition: Condition };
export type SurveySettingsDoc = z.infer<typeof surveySettingsDocSchema>;
export type SurveyDoc = Omit<z.infer<typeof surveyDocSchema>, "logic"> & { logic: LogicRuleDoc[] };

/** Answer values keyed by question key (matrix → {row: value}, multi → string[]). */
export type Answers = Record<string, unknown>;

export function questionsOf(doc: Pick<SurveyDoc, "sections">): QuestionDoc[] {
  return doc.sections.flatMap((s) => s.questions);
}

export function canonicalOrder(doc: Pick<SurveyDoc, "sections">): Array<[string, string]> {
  return doc.sections.flatMap((s) => s.questions.map((q) => [s.key, q.key] as [string, string]));
}

export type CompletenessCode = "missing_title" | "missing_text" | "missing_option_label" | "missing_row_text";

/** Mirrors apps/api completeness_issues(): drafts may be incomplete, publishing may not. */
export function completenessIssues(
  doc: Pick<SurveyDoc, "title" | "sections">,
): Array<{ code: CompletenessCode; question_key: string }> {
  const issues: Array<{ code: CompletenessCode; question_key: string }> = [];
  if (!doc.title.trim()) issues.push({ code: "missing_title", question_key: "" });
  for (const q of questionsOf(doc)) {
    if (!q.text.trim()) issues.push({ code: "missing_text", question_key: q.key });
    if (ANSWERABLE_TYPES.has(q.type) && q.options.some((o) => !o.label.trim())) {
      issues.push({ code: "missing_option_label", question_key: q.key });
    }
    if (q.type === "MATRIX" && q.settings.rows.some((r) => !r.text.trim())) {
      issues.push({ code: "missing_row_text", question_key: q.key });
    }
  }
  return issues;
}
