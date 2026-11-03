/**
 * Answer validation for the survey renderer. The API re-validates every
 * submission with the same rules (apps/api/app/domain/survey/answers.py);
 * tests/fixtures/answer-cases.json keeps both implementations in parity.
 */
import type { QuestionDoc } from "./document";
import { ANSWERABLE_TYPES, CHOICE_TYPES, NUMERIC_TYPES } from "./document";
import { isAnswered } from "./logic";

export type AnswerError =
  | { code: "required" }
  | { code: "min_length"; min: number }
  | { code: "max_length"; max: number }
  | { code: "min"; min: number | string }
  | { code: "max"; max: number | string }
  | { code: "min_choices"; min: number }
  | { code: "max_choices"; max: number }
  | { code: "pattern" }
  | { code: "invalid" }
  | { code: "matrix_incomplete" };

export const SHORT_TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;
/** File uploads are not collected in V1: never block a respondent on them. */
export const UNCOLLECTED_TYPES: ReadonlySet<string> = new Set(["FILE"]);
const INTEGER_SCALES = new Set(["STAR", "NPS", "CSAT", "CES"]);

function toNumber(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optionNumbers(question: QuestionDoc): Set<number> {
  const out = new Set<number>();
  for (const o of question.options) {
    const n = toNumber(o.value);
    if (n !== null) out.add(n);
  }
  return out;
}

function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateAnswer(question: QuestionDoc, value: unknown): AnswerError | null {
  if (!ANSWERABLE_TYPES.has(question.type) || UNCOLLECTED_TYPES.has(question.type)) return null;
  const v = question.validation ?? {};
  if (!isAnswered(value)) return question.required ? { code: "required" } : null;

  if (question.type === "SHORT_TEXT" || question.type === "LONG_TEXT") {
    if (typeof value !== "string" && typeof value !== "number") return { code: "invalid" };
    const text = String(value);
    if (v.min_length && text.trim().length < v.min_length) return { code: "min_length", min: v.min_length };
    const max = v.max_length ?? (question.type === "SHORT_TEXT" ? SHORT_TEXT_MAX : LONG_TEXT_MAX);
    if (text.length > max) return { code: "max_length", max };
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern, "u").test(text)) return { code: "pattern" };
      } catch {
        return null;
      }
    }
    return null;
  }

  if (NUMERIC_TYPES.has(question.type)) {
    const n = toNumber(value);
    if (n === null) return { code: "invalid" };
    const min = v.min ?? question.scale?.min;
    const max = v.max ?? question.scale?.max;
    if (min !== undefined && min !== null && n < min) return { code: "min", min };
    if (max !== undefined && max !== null && n > max) return { code: "max", max };
    if (question.type === "LIKERT" && question.options.length && !optionNumbers(question).has(n))
      return { code: "invalid" };
    if (INTEGER_SCALES.has(question.type) && !Number.isInteger(n)) return { code: "invalid" };
    return null;
  }

  if (CHOICE_TYPES.has(question.type)) {
    let values: string[];
    if (question.type === "MULTIPLE_CHOICE") {
      if (!Array.isArray(value)) return { code: "invalid" };
      values = value.map(String);
    } else {
      if (typeof value === "object") return { code: "invalid" };
      values = [String(value)];
    }
    const valid = new Set(question.options.map((o) => o.value));
    if (values.some((x) => !valid.has(x)) || new Set(values).size !== values.length)
      return { code: "invalid" };
    if (question.type === "MULTIPLE_CHOICE") {
      const exclusive = new Set(question.options.filter((o) => o.is_exclusive).map((o) => o.value));
      if (values.length > 1 && values.some((x) => exclusive.has(x))) return { code: "invalid" };
      if (v.min_choices && values.length < v.min_choices) return { code: "min_choices", min: v.min_choices };
      if (v.max_choices && values.length > v.max_choices) return { code: "max_choices", max: v.max_choices };
    }
    return null;
  }

  if (question.type === "MATRIX") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { code: "invalid" };
    const answers = value as Record<string, unknown>;
    const rows = new Set(question.settings.rows.map((r) => r.key));
    const allowed = optionNumbers(question);
    for (const [row, cell] of Object.entries(answers)) {
      if (!rows.has(row)) return { code: "invalid" };
      if (!isAnswered(cell)) continue;
      const n = toNumber(cell);
      if (n === null || (allowed.size && !allowed.has(n))) return { code: "invalid" };
    }
    if (question.required && [...rows].some((r) => !isAnswered(answers[r])))
      return { code: "matrix_incomplete" };
    return null;
  }

  if (question.type === "RANKING") {
    if (!Array.isArray(value)) return { code: "invalid" };
    const values = value.map(String);
    const valid = new Set(question.options.map((o) => o.value));
    if (values.some((x) => !valid.has(x)) || new Set(values).size !== values.length)
      return { code: "invalid" };
    return null;
  }

  if (question.type === "DATE") {
    const text = String(value);
    if (!isCalendarDate(text)) return { code: "invalid" };
    if (v.date_min && text < v.date_min) return { code: "min", min: v.date_min };
    if (v.date_max && text > v.date_max) return { code: "max", max: v.date_max };
    return null;
  }
  return null;
}
