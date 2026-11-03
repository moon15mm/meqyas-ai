"use client";

import {
  ANSWERABLE_TYPES,
  CHOICE_TYPES,
  NUMERIC_TYPES,
  type Condition,
  type LogicRuleDoc,
  type Operator,
  type QuestionDoc,
  type SurveyDoc,
} from "@meqyas/shared";
import { Button, Input } from "@meqyas/ui";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

type Leaf = { question: string; op: Operator; value?: unknown; row?: string };

const selectClass = "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm";

export function opsFor(q: QuestionDoc): Operator[] {
  if (q.type === "MULTIPLE_CHOICE") return ["contains", "not_contains", "answered", "not_answered"];
  if (CHOICE_TYPES.has(q.type)) return ["eq", "neq", "in", "not_in", "answered", "not_answered"];
  if (NUMERIC_TYPES.has(q.type) || q.type === "MATRIX")
    return ["eq", "neq", "gt", "gte", "lt", "lte", "answered", "not_answered"];
  if (q.type === "SHORT_TEXT" || q.type === "LONG_TEXT")
    return ["contains", "not_contains", "answered", "not_answered"];
  return ["answered", "not_answered"];
}

function scalePoints(q: QuestionDoc): { value: number; label: string }[] | null {
  if (q.type === "LIKERT" || q.type === "MATRIX")
    return q.options.map((o) => ({ value: Number(o.value), label: o.label }));
  const s = q.scale;
  if (!s || s.max - s.min > 10) return null;
  return Array.from({ length: s.max - s.min + 1 }, (_, i) => ({
    value: s.min + i,
    label: String(s.min + i),
  }));
}

function defaultLeaf(q: QuestionDoc): Leaf {
  const op = opsFor(q)[0]!;
  if (CHOICE_TYPES.has(q.type)) return { question: q.key, op, value: q.options[0]?.value };
  const points = scalePoints(q);
  if (points?.length)
    return {
      question: q.key,
      op,
      value: points[0]!.value,
      row: q.type === "MATRIX" ? q.settings.rows[0]?.key : undefined,
    };
  if (NUMERIC_TYPES.has(q.type)) return { question: q.key, op, value: 0 };
  return { question: q.key, op, value: "" };
}

function leavesOf(condition: Condition | undefined): { mode: "all" | "any"; leaves: Leaf[] } {
  const c = (condition ?? {}) as Record<string, unknown>;
  if (Array.isArray(c.all)) return { mode: "all", leaves: (c.all as Leaf[]).filter((x) => "question" in x) };
  if (Array.isArray(c.any)) return { mode: "any", leaves: (c.any as Leaf[]).filter((x) => "question" in x) };
  if ("question" in c) return { mode: "all", leaves: [c as unknown as Leaf] };
  return { mode: "all", leaves: [] };
}

function buildCondition(mode: "all" | "any", leaves: Leaf[]): Condition {
  return (mode === "all" ? { all: leaves } : { any: leaves }) as Condition;
}

function ConditionRow({
  leaf,
  candidates,
  onChange,
  onRemove,
}: {
  leaf: Leaf;
  candidates: QuestionDoc[];
  onChange: (leaf: Leaf) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("survey.builder");
  const q = candidates.find((c) => c.key === leaf.question) ?? candidates[0];
  if (!q) return null;
  const ops = opsFor(q);
  const valueless = leaf.op === "answered" || leaf.op === "not_answered";
  const points = scalePoints(q);

  let valueInput: React.ReactNode = null;
  if (!valueless) {
    if (CHOICE_TYPES.has(q.type) && (leaf.op === "in" || leaf.op === "not_in")) {
      const selected = Array.isArray(leaf.value) ? (leaf.value as string[]) : [];
      valueInput = (
        <div className="grid gap-1 rounded-lg border p-2">
          {q.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange({
                    ...leaf,
                    value: e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value),
                  })
                }
                className="accent-[var(--primary)]"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    } else if (CHOICE_TYPES.has(q.type)) {
      valueInput = (
        <select
          aria-label={t("conditionValue")}
          className={selectClass}
          value={String(leaf.value ?? "")}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        >
          {q.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    } else if (points) {
      valueInput = (
        <select
          aria-label={t("conditionValue")}
          className={selectClass}
          value={String(leaf.value ?? "")}
          onChange={(e) => onChange({ ...leaf, value: Number(e.target.value) })}
        >
          {points.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label === String(p.value) ? p.label : `${p.value} — ${p.label}`}
            </option>
          ))}
        </select>
      );
    } else if (NUMERIC_TYPES.has(q.type)) {
      valueInput = (
        <Input
          aria-label={t("conditionValue")}
          inputMode="decimal"
          dir="ltr"
          className="h-9"
          value={String(leaf.value ?? "")}
          onChange={(e) => onChange({ ...leaf, value: Number(e.target.value) || 0 })}
        />
      );
    } else {
      valueInput = (
        <Input
          aria-label={t("conditionValue")}
          className="h-9"
          value={String(leaf.value ?? "")}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        />
      );
    }
  }

  return (
    <li className="grid gap-1.5 rounded-lg border bg-card p-2">
      <div className="flex items-center gap-1.5">
        <select
          aria-label={t("conditionQuestion")}
          className={selectClass}
          value={q.key}
          onChange={(e) => {
            const next = candidates.find((c) => c.key === e.target.value);
            if (next) onChange(defaultLeaf(next));
          }}
        >
          {candidates.map((c) => (
            <option key={c.key} value={c.key}>
              {c.text || c.key}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon-sm" aria-label={t("removeRule")} onClick={onRemove}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      {q.type === "MATRIX" ? (
        <select
          aria-label={t("rows")}
          className={selectClass}
          value={leaf.row ?? ""}
          onChange={(e) => onChange({ ...leaf, row: e.target.value })}
        >
          {q.settings.rows.map((r) => (
            <option key={r.key} value={r.key}>
              {r.text}
            </option>
          ))}
        </select>
      ) : null}
      <select
        aria-label={t("conditionOperator")}
        className={selectClass}
        value={leaf.op}
        onChange={(e) => {
          const op = e.target.value as Operator;
          let value = leaf.value;
          if ((op === "in" || op === "not_in") && !Array.isArray(value))
            value = value !== undefined ? [value] : [];
          if (op !== "in" && op !== "not_in" && Array.isArray(value)) value = value[0];
          onChange({ ...leaf, op, value });
        }}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {t(`ops.${op}`)}
          </option>
        ))}
      </select>
      {valueInput}
    </li>
  );
}

/** "Show this question only if …" */
export function DisplayLogicEditor({
  doc,
  question,
  onRulesChange,
}: {
  doc: SurveyDoc;
  question: QuestionDoc;
  onRulesChange: (fn: (rules: LogicRuleDoc[]) => LogicRuleDoc[]) => void;
}) {
  const t = useTranslations("survey.builder");
  const order = doc.sections.flatMap((s) => s.questions);
  const index = order.findIndex((q) => q.key === question.key);
  const candidates = order.slice(0, index).filter((q) => ANSWERABLE_TYPES.has(q.type));
  const rule = doc.logic.find((r) => r.type === "DISPLAY" && r.target_key === question.key);
  const { mode, leaves } = leavesOf(rule?.condition);

  const write = (nextMode: "all" | "any", nextLeaves: Leaf[]) =>
    onRulesChange((rules) => {
      const others = rules.filter((r) => !(r.type === "DISPLAY" && r.target_key === question.key));
      if (!nextLeaves.length) return others;
      return [
        ...others,
        {
          id: rule?.id ?? `display_${question.key}`.slice(0, 60),
          type: "DISPLAY",
          source_key: null,
          target_key: question.key,
          condition: buildCondition(nextMode, nextLeaves),
          limit: null,
          enabled: true,
        },
      ];
    });

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t("displayLogic")}</p>
      {!candidates.length ? (
        <p className="text-xs text-muted-foreground">{t("noEarlierQuestions")}</p>
      ) : (
        <>
          {leaves.length > 1 ? (
            <select
              aria-label={t("displayLogic")}
              className={selectClass}
              value={mode}
              onChange={(e) => write(e.target.value as "all" | "any", leaves)}
            >
              <option value="all">{t("matchAll")}</option>
              <option value="any">{t("matchAny")}</option>
            </select>
          ) : null}
          <ul className="grid gap-2">
            {leaves.map((leaf, i) => (
              <ConditionRow
                key={i}
                leaf={leaf}
                candidates={candidates}
                onChange={(next) =>
                  write(
                    mode,
                    leaves.map((l, j) => (j === i ? next : l)),
                  )
                }
                onRemove={() =>
                  write(
                    mode,
                    leaves.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => write(mode, [...leaves, defaultLeaf(candidates[candidates.length - 1]!)])}
          >
            <PlusIcon aria-hidden="true" />
            {t("addCondition")}
          </Button>
        </>
      )}
    </div>
  );
}

/** "After this question: if … go to … / end the survey" */
export function SkipLogicEditor({
  doc,
  question,
  onRulesChange,
}: {
  doc: SurveyDoc;
  question: QuestionDoc;
  onRulesChange: (fn: (rules: LogicRuleDoc[]) => LogicRuleDoc[]) => void;
}) {
  const t = useTranslations("survey.builder");
  const order = doc.sections.flatMap((s) => s.questions.map((q) => ({ section: s, q })));
  const index = order.findIndex((x) => x.q.key === question.key);
  const candidates = order
    .slice(0, index + 1)
    .map((x) => x.q)
    .filter((q) => ANSWERABLE_TYPES.has(q.type));
  const ownSection = order[index]?.section.key;
  const laterQuestions = order.slice(index + 1).map((x) => x.q);
  const laterSections = doc.sections.filter(
    (s, i) => i > doc.sections.findIndex((x) => x.key === ownSection) && s.questions.length > 0,
  );
  const rules = doc.logic.filter(
    (r) => (r.type === "SKIP" || r.type === "END") && r.source_key === question.key,
  );

  const replace = (target: LogicRuleDoc, next: LogicRuleDoc | null) =>
    onRulesChange((all) => all.flatMap((r) => (r === target ? (next ? [next] : []) : [r])));

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t("skipLogic")}</p>
      <ul className="grid gap-3">
        {rules.map((rule, i) => {
          const { leaves } = leavesOf(rule.condition);
          const leaf = leaves[0] ?? defaultLeaf(question);
          const destination = rule.type === "END" ? "__end__" : (rule.target_key ?? "");
          return (
            <li key={rule.id ?? i} className="grid gap-2 rounded-xl border border-dashed p-2">
              <ul>
                <ConditionRow
                  leaf={leaf}
                  candidates={candidates}
                  onChange={(next) => replace(rule, { ...rule, condition: buildCondition("all", [next]) })}
                  onRemove={() => replace(rule, null)}
                />
              </ul>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("goTo")}
                <select
                  className={selectClass}
                  value={destination}
                  onChange={(e) => {
                    const value = e.target.value;
                    replace(
                      rule,
                      value === "__end__"
                        ? { ...rule, type: "END", target_key: null }
                        : { ...rule, type: "SKIP", target_key: value },
                    );
                  }}
                >
                  {laterSections.map((s) => (
                    <option key={s.key} value={s.key}>
                      § {s.title || s.key}
                    </option>
                  ))}
                  {laterQuestions.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.text || q.key}
                    </option>
                  ))}
                  <option value="__end__">{t("endSurvey")}</option>
                </select>
              </label>
            </li>
          );
        })}
      </ul>
      {candidates.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            onRulesChange((all) => [
              ...all,
              {
                id: `skip_${question.key}_${rules.length + 1}`.slice(0, 60),
                type: laterSections.length || laterQuestions.length ? "SKIP" : "END",
                source_key: question.key,
                target_key: laterSections[0]?.key ?? laterQuestions[0]?.key ?? null,
                condition: buildCondition("all", [
                  defaultLeaf(
                    ANSWERABLE_TYPES.has(question.type) ? question : candidates[candidates.length - 1]!,
                  ),
                ]),
                limit: null,
                enabled: true,
              },
            ])
          }
        >
          <PlusIcon aria-hidden="true" />
          {t("addSkip")}
        </Button>
      ) : null}
    </div>
  );
}
