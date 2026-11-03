/**
 * Survey logic engine — identical semantics to apps/api/app/domain/survey/logic.py.
 * Parity is enforced by tests/fixtures/logic-cases.json (run by both test suites).
 */
import type { Answers, Condition, LogicRuleDoc, QuestionDoc, SurveyDoc } from "./document";
import { canonicalOrder, questionsOf } from "./document";

const NUMERIC_OPS = new Set(["gt", "gte", "lt", "lte"]);
const PIPE_RE = /\{\{\s*answer:([a-z][a-z0-9_]{0,59})\s*\}\}/g;

export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function toNum(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function eq(a: unknown, b: unknown): boolean {
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a) === String(b);
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function compare(op: string, value: unknown, expected: unknown): boolean {
  const a = toNum(value);
  const b = toNum(expected);
  if (a === null || b === null) return false;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

export function evaluate(condition: Condition | null | undefined, answers: Answers): boolean {
  if (!condition || Object.keys(condition).length === 0) return true;
  const node = condition as Record<string, unknown>;
  if ("all" in node) return ((node.all as Condition[]) ?? []).every((c) => evaluate(c, answers));
  if ("any" in node) return ((node.any as Condition[]) ?? []).some((c) => evaluate(c, answers));
  if ("not" in node) return !evaluate((node.not as Condition) ?? {}, answers);

  const op = node.op as string;
  const expected = node.value;
  let value: unknown = answers[String(node.question ?? "")];
  if (node.row !== undefined && node.row !== null) {
    value =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)[String(node.row)]
        : undefined;
  }

  if (op === "answered") return isAnswered(value);
  if (op === "not_answered") return !isAnswered(value);
  if (!isAnswered(value)) return false;

  if (Array.isArray(value)) {
    if (op === "eq" || op === "contains") return value.some((v) => eq(v, expected));
    if (op === "neq" || op === "not_contains") return !value.some((v) => eq(v, expected));
    if (op === "in") return value.some((v) => asList(expected).some((e) => eq(v, e)));
    if (op === "not_in") return !value.some((v) => asList(expected).some((e) => eq(v, e)));
    if (NUMERIC_OPS.has(op)) return compare(op, value.length, expected);
    return false;
  }
  if (typeof value === "object") return false;
  switch (op) {
    case "eq":
      return eq(value, expected);
    case "neq":
      return !eq(value, expected);
    case "in":
      return asList(expected).some((e) => eq(value, e));
    case "not_in":
      return !asList(expected).some((e) => eq(value, e));
    case "contains":
      return String(value).toLowerCase().includes(String(expected).toLowerCase());
    case "not_contains":
      return !String(value).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return NUMERIC_OPS.has(op) ? compare(op, value, expected) : false;
  }
}

export interface PathResult {
  visible: string[];
  endedBy: string | null;
}

function groupRules(rules: LogicRuleDoc[]) {
  const display = new Map<string, LogicRuleDoc[]>();
  const skip = new Map<string, LogicRuleDoc[]>();
  const end = new Map<string, LogicRuleDoc[]>();
  const push = (map: Map<string, LogicRuleDoc[]>, k: string, r: LogicRuleDoc) =>
    map.set(k, [...(map.get(k) ?? []), r]);
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.type === "DISPLAY" && rule.target_key) push(display, rule.target_key, rule);
    else if (rule.type === "SKIP" && rule.source_key && rule.target_key) push(skip, rule.source_key, rule);
    else if (rule.type === "END" && rule.source_key) push(end, rule.source_key, rule);
  }
  return { display, skip, end };
}

/** Questions on the respondent's path that are visible, in canonical order. */
export function computePath(doc: Pick<SurveyDoc, "sections" | "logic">, answers: Answers): PathResult {
  const { display, skip, end } = groupRules(doc.logic ?? []);
  const order = canonicalOrder(doc);
  const index = new Map(order.map(([, q], i) => [q, i]));
  const sectionFirst = new Map<string, number>();
  const sectionAfter = new Map<string, number>();
  order.forEach(([s], i) => {
    if (!sectionFirst.has(s)) sectionFirst.set(s, i);
    sectionAfter.set(s, i + 1);
  });
  const shown = (k: string) => (display.get(k) ?? []).every((r) => evaluate(r.condition, answers));

  const visible: string[] = [];
  let i = 0;
  while (i < order.length) {
    const [sectionKey, key] = order[i]!;
    if (!shown(sectionKey)) {
      i = sectionAfter.get(sectionKey)!;
      continue;
    }
    if (shown(key)) {
      visible.push(key);
      if ((end.get(key) ?? []).some((r) => evaluate(r.condition, answers))) {
        return { visible, endedBy: key };
      }
      let jump: number | null = null;
      for (const rule of skip.get(key) ?? []) {
        if (evaluate(rule.condition, answers)) {
          const target = rule.target_key ?? "";
          const j = index.get(target) ?? sectionFirst.get(target);
          if (j !== undefined && j > i) {
            jump = j;
            break;
          }
        }
      }
      if (jump !== null) {
        i = jump;
        continue;
      }
    }
    i += 1;
  }
  return { visible, endedBy: null };
}

export function displayValue(
  question: QuestionDoc | undefined,
  value: unknown,
  language: "ar" | "en" = "ar",
): string {
  if (!question || !isAnswered(value)) return "";
  const labels = new Map(question.options.map((o) => [o.value, o.label]));
  if (Array.isArray(value)) {
    return value.map((v) => labels.get(String(v)) ?? String(v)).join(language === "ar" ? "، " : ", ");
  }
  if (typeof value === "object") return "";
  return labels.get(String(value)) ?? String(value);
}

/** Replace {{answer:key}} with the answer label (plain text — render as text, never HTML). */
export function pipe(text: string, doc: Pick<SurveyDoc, "sections" | "language">, answers: Answers): string {
  if (!text.includes("{{")) return text;
  const map = new Map(questionsOf(doc).map((q) => [q.key, q]));
  return text.replace(PIPE_RE, (_, key: string) => displayValue(map.get(key), answers[key], doc.language));
}
