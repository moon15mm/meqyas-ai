"use client";

import type { OptionDoc, QuestionDoc } from "@meqyas/shared";
import { Button, Input, Label } from "@meqyas/ui";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

function nextValue(options: OptionDoc[]): string {
  const numeric = options.map((o) => Number(o.value)).filter((n) => Number.isFinite(n));
  let candidate = numeric.length ? Math.max(...numeric) + 1 : options.length + 1;
  const used = new Set(options.map((o) => o.value));
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

export function OptionsEditor({
  question,
  onChange,
  advanced,
  allowFlags = true,
  fixedCount = false,
  label,
}: {
  question: QuestionDoc;
  onChange: (options: OptionDoc[]) => void;
  advanced: boolean;
  allowFlags?: boolean;
  /** Likert/Matrix columns: labels editable, count tied to the scale. */
  fixedCount?: boolean;
  label: string;
}) {
  const t = useTranslations("survey.builder");
  const options = question.options;
  const set = (i: number, patch: Partial<OptionDoc>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <ol className="grid gap-2">
        {options.map((o, i) => (
          <li key={i} className="grid gap-1.5 rounded-lg border bg-card p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <Input
                aria-label={`${t("optionLabel")} ${i + 1}`}
                value={o.label}
                onChange={(e) => set(i, { label: e.target.value })}
                className="h-9"
              />
              {!fixedCount ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveUp")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveDown")}
                    disabled={i === options.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t("delete")} ${o.label}`}
                    disabled={options.length <= 2}
                    onClick={() => onChange(options.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </>
              ) : null}
            </div>
            {advanced || allowFlags ? (
              <div className="flex flex-wrap items-center gap-3 ps-6 text-xs">
                {advanced ? (
                  <>
                    <label className="flex items-center gap-1.5">
                      {t("optionValue")}
                      <Input
                        value={o.value}
                        onChange={(e) => set(i, { value: e.target.value.trim().slice(0, 60) || o.value })}
                        className="h-7 w-20 text-xs"
                        dir="ltr"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      {t("optionScore")}
                      <Input
                        inputMode="decimal"
                        value={o.score ?? ""}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          set(i, { score: e.target.value === "" || !Number.isFinite(n) ? null : n });
                        }}
                        className="h-7 w-16 text-xs"
                        dir="ltr"
                      />
                    </label>
                  </>
                ) : null}
                {allowFlags && !fixedCount ? (
                  <>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={o.is_other}
                        onChange={(e) => set(i, { is_other: e.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      {t("other")}
                    </label>
                    {question.type === "MULTIPLE_CHOICE" ? (
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={o.is_exclusive}
                          onChange={(e) => set(i, { is_exclusive: e.target.checked })}
                          className="accent-[var(--primary)]"
                        />
                        {t("exclusive")}
                      </label>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {!fixedCount ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            onChange([
              ...options,
              {
                value: nextValue(options),
                label: `${t("optionLabel")} ${options.length + 1}`,
                score: null,
                is_other: false,
                is_exclusive: false,
              },
            ])
          }
        >
          <PlusIcon aria-hidden="true" />
          {t("addOption")}
        </Button>
      ) : null}
    </fieldset>
  );
}

export function RowsEditor({
  question,
  onChange,
}: {
  question: QuestionDoc;
  onChange: (rows: QuestionDoc["settings"]["rows"]) => void;
}) {
  const t = useTranslations("survey.builder");
  const rows = question.settings.rows;
  const nextKey = () => {
    const used = new Set(rows.map((r) => r.key));
    let i = rows.length + 1;
    while (used.has(`r${i}`)) i += 1;
    return `r${i}`;
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{t("rows")}</legend>
      <ol className="grid gap-1.5">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-1.5">
            <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <Label htmlFor={`row-${r.key}`} className="visually-hidden">
              {t("rows")} {i + 1}
            </Label>
            <Input
              id={`row-${r.key}`}
              value={r.text}
              onChange={(e) =>
                onChange(rows.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))
              }
              className="h-9"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("delete")} ${r.text}`}
              disabled={rows.length <= 1}
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...rows, { key: nextKey(), text: `${t("rows")} ${rows.length + 1}` }])}
      >
        <PlusIcon aria-hidden="true" />
        {t("addRow")}
      </Button>
    </fieldset>
  );
}
