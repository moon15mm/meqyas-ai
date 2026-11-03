"use client";

import type { OptionDoc, QuestionDoc } from "@meqyas/shared";
import { cn, Input, Textarea } from "@meqyas/ui";
import { ChevronDownIcon, ChevronUpIcon, StarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { NumericInput } from "@/components/common/numeric-input";

interface InputProps {
  question: QuestionDoc;
  value: unknown;
  onChange: (value: unknown) => void;
  options: OptionDoc[];
  describedBy?: string;
  invalid: boolean;
  disabled?: boolean;
  /** Free text for an option flagged is_other. */
  otherText?: string;
  onOtherText?: (text: string) => void;
}

const choiceCard =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-start transition hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/6 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring";

function ScalePoints({
  name,
  points,
  value,
  onChange,
  labels,
  describedBy,
  compact = false,
}: {
  name: string;
  points: number[];
  value: unknown;
  onChange: (v: number) => void;
  labels?: Record<number, string>;
  describedBy?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")} role="presentation">
      {points.map((p) => {
        const id = `${name}-${p}`;
        const checked = Number(value) === p && value !== null && value !== undefined && value !== "";
        return (
          <label
            key={p}
            htmlFor={id}
            className={cn(
              "flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center rounded-xl border bg-card px-3 py-2 text-sm font-semibold tabular-nums transition hover:border-primary/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              checked && "border-primary bg-primary text-primary-foreground hover:border-primary",
              compact && "min-w-9 px-2",
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={p}
              checked={checked}
              onChange={() => onChange(p)}
              aria-describedby={describedBy}
              className="visually-hidden"
            />
            <span>{p}</span>
            {labels?.[p] ? (
              <span
                className={cn(
                  "mt-0.5 text-[11px] font-normal",
                  checked ? "text-primary-foreground/90" : "text-muted-foreground",
                )}
              >
                {labels[p]}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

function range(min: number, max: number, step = 1): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export function QuestionInput({
  question,
  value,
  onChange,
  options,
  describedBy,
  invalid,
  disabled,
  otherText,
  onOtherText,
}: InputProps) {
  const t = useTranslations("survey.renderer");
  const locale = useLocale();
  const name = `q-${question.key}`;
  const scale = question.scale;
  const selectedValues = Array.isArray(value)
    ? (value as string[])
    : typeof value === "string"
      ? [value]
      : [];
  const otherSelected = options.some((o) => o.is_other && selectedValues.includes(o.value));
  const otherInput =
    otherSelected && onOtherText ? (
      <Input
        value={otherText ?? ""}
        onChange={(e) => onOtherText(e.target.value)}
        placeholder={t("otherPlaceholder")}
        aria-label={t("otherPlaceholder")}
        maxLength={300}
        disabled={disabled}
      />
    ) : null;

  switch (question.type) {
    case "SHORT_TEXT":
      return (
        <Input
          name={name}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.settings.placeholder || undefined}
          maxLength={question.validation.max_length ?? 500}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
        />
      );
    case "LONG_TEXT":
      return (
        <Textarea
          name={name}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.settings.placeholder || undefined}
          maxLength={question.validation.max_length ?? 5000}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
        />
      );
    case "NUMBER":
      return (
        <NumericInput
          name={name}
          className="max-w-48 text-start"
          value={typeof value === "number" ? value : null}
          onValueChange={(n, raw) => onChange(n ?? (raw.trim() ? raw : null))}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
        />
      );
    case "DATE":
      return (
        <Input
          name={name}
          type="date"
          className="max-w-56"
          value={typeof value === "string" ? value : ""}
          min={question.validation.date_min ?? undefined}
          max={question.validation.date_max ?? undefined}
          onChange={(e) => onChange(e.target.value || null)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
        />
      );
    case "DROPDOWN":
      return (
        <select
          name={name}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="h-12 w-full max-w-md rounded-lg border border-input bg-card px-3 text-base md:text-sm"
        >
          <option value="">{t("selectPlaceholder")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "SINGLE_CHOICE":
      return (
        <div className="grid gap-2">
          {options.map((o) => (
            <label key={o.value} className={choiceCard}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                aria-describedby={describedBy}
                disabled={disabled}
                className="size-4 accent-[var(--primary)]"
              />
              <span>{o.label}</span>
            </label>
          ))}
          {otherInput}
        </div>
      );
    case "MULTIPLE_CHOICE": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (option: OptionDoc) => {
        if (option.is_exclusive) return onChange(selected.includes(option.value) ? [] : [option.value]);
        const exclusive = new Set(options.filter((o) => o.is_exclusive).map((o) => o.value));
        const base = selected.filter((v) => !exclusive.has(v));
        onChange(
          base.includes(option.value) ? base.filter((v) => v !== option.value) : [...base, option.value],
        );
      };
      return (
        <div className="grid gap-2">
          {options.map((o) => (
            <label key={o.value} className={choiceCard}>
              <input
                type="checkbox"
                name={name}
                value={o.value}
                checked={selected.includes(o.value)}
                onChange={() => toggle(o)}
                aria-describedby={describedBy}
                disabled={disabled}
                className="size-4 accent-[var(--primary)]"
              />
              <span>{o.label}</span>
            </label>
          ))}
          {otherInput}
        </div>
      );
    }
    case "LIKERT": {
      const isNumericOnly =
        options.length > 1 &&
        options.every((o) => /^\d+$/.test(o.label.trim()) || o.label.trim() === o.value.trim());

      const qText = `${question.text} ${question.description}`.toLowerCase();
      const isKnowledge =
        /معرفة|مدى|فهم|إلمام|قدرة|اطلاع|مهارة|knowledge|understand|familiar|extent/.test(qText);

      const getDescriptor = (idx: number, total: number) => {
        if (!isNumericOnly) return null;
        if (total === 5) {
          if (isKnowledge) {
            const descAr = ["منعدمة (لا أعرف)", "منخفضة (بسيطة)", "متوسطة", "عالية (جيدة)", "تامة (أعرف بالكامل)"];
            const descEn = ["None", "Low", "Moderate", "High", "Complete"];
            return locale === "ar" ? descAr[idx] : descEn[idx];
          }
          const descAr = ["الحد الأدنى (الأقل)", "منخفض", "متوسط", "مرتفع", "الحد الأعلى (الأفضل)"];
          const descEn = ["Lowest", "Low", "Moderate", "High", "Highest (Best)"];
          return locale === "ar" ? descAr[idx] : descEn[idx];
        }
        if (idx === 0) return locale === "ar" ? "الأقل (الحد الأدنى)" : "Lowest";
        if (idx === total - 1) return locale === "ar" ? "الأفضل (الحد الأعلى)" : "Best (Highest)";
        if (idx === Math.floor(total / 2)) return locale === "ar" ? "متوسط" : "Average";
        return null;
      };

      const scaleMinHint =
        scale?.min_label ||
        (isKnowledge
          ? locale === "ar" ? "1: منعدمة / لا أعرف إطلاقاً (الأقل)" : "1: No knowledge (Lowest)"
          : locale === "ar" ? "1: الحد الأدنى (الأقل)" : "1: Lowest");

      const scaleMaxHint =
        scale?.max_label ||
        (isKnowledge
          ? locale === "ar" ? `${options.length}: معرفة تامة وشاملة (الأفضل)` : `${options.length}: Complete knowledge (Best)`
          : locale === "ar" ? `${options.length}: الحد الأعلى (الأفضل)` : `${options.length}: Highest (Best)`);

      return (
        <div className="grid gap-2.5">
          <div className="grid gap-2 @lg:grid-flow-col @lg:auto-cols-fr">
            {options.map((o, idx) => {
              const point = Number(o.value);
              const checked = value !== null && value !== undefined && Number(value) === point;
              const desc = getDescriptor(idx, options.length);
              return (
                <label
                  key={o.value}
                  className={cn(choiceCard, "@lg:flex-col @lg:justify-center @lg:text-center py-2.5 px-2")}
                >
                  <input
                    type="radio"
                    name={name}
                    value={o.value}
                    checked={checked}
                    onChange={() => onChange(point)}
                    aria-describedby={describedBy}
                    disabled={disabled}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className={cn("font-medium", isNumericOnly ? "text-base font-bold" : "text-sm")}>
                    {o.label}
                  </span>
                  {desc ? (
                    <span
                      className={cn(
                        "mt-0.5 text-[11px] leading-tight font-normal text-muted-foreground",
                        checked && "text-primary-foreground/90 font-medium",
                      )}
                    >
                      {desc}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1 pt-0.5 font-medium">
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span className="inline-block size-1.5 rounded-full bg-amber-500" />
              {scaleMinHint}
            </span>
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              {scaleMaxHint}
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            </span>
          </div>
        </div>
      );
    }
    case "RATING":
    case "CSAT":
    case "CES": {
      const min = scale?.min ?? 1;
      const max = scale?.max ?? 5;
      const minLabel = scale?.min_label || (locale === "ar" ? `${min} (الحد الأدنى / الأقل)` : `${min} (Lowest)`);
      const maxLabel = scale?.max_label || (locale === "ar" ? `${max} (الحد الأعلى / الأفضل)` : `${max} (Highest / Best)`);
      return (
        <div className="grid gap-2">
          <ScalePoints
            name={name}
            points={range(min, max)}
            value={value}
            onChange={onChange}
            describedBy={describedBy}
          />
          <div className="flex justify-between text-xs text-muted-foreground px-1 pt-0.5 font-medium">
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span className="inline-block size-1.5 rounded-full bg-amber-500" />
              {minLabel}
            </span>
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              {maxLabel}
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            </span>
          </div>
        </div>
      );
    }
    case "NPS":
      return (
        <div className="grid gap-2">
          <ScalePoints
            name={name}
            points={range(0, 10)}
            value={value}
            onChange={onChange}
            describedBy={describedBy}
            compact
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{scale?.min_label || t("npsLow")}</span>
            <span>{scale?.max_label || t("npsHigh")}</span>
          </div>
        </div>
      );
    case "STAR": {
      const max = scale?.max ?? 5;
      const current = Number(value) || 0;
      return (
        <div className="flex gap-1" role="radiogroup" aria-describedby={describedBy}>
          {range(1, max).map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-md p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={name}
                value={n}
                checked={current === n}
                onChange={() => onChange(n)}
                className="visually-hidden"
                disabled={disabled}
              />
              <StarIcon
                className={cn(
                  "size-8 transition",
                  n <= current ? "fill-warning text-warning" : "text-muted-foreground/50",
                )}
                aria-hidden="true"
              />
              <span className="visually-hidden">{t("starLabel", { n, max })}</span>
            </label>
          ))}
        </div>
      );
    }
    case "SLIDER": {
      const min = scale?.min ?? 0;
      const max = scale?.max ?? 10;
      const answered = value !== null && value !== undefined && value !== "";
      return (
        <div className="grid gap-2">
          <div className="flex items-center gap-4">
            <input
              type="range"
              name={name}
              min={min}
              max={max}
              step={scale?.step ?? 1}
              value={answered ? Number(value) : (min + max) / 2}
              onChange={(e) => onChange(Number(e.target.value))}
              aria-describedby={describedBy}
              disabled={disabled}
              className={cn("w-full accent-[var(--primary)]", !answered && "opacity-60")}
            />
            <output className="w-12 text-center text-lg font-bold tabular-nums" aria-live="polite">
              {answered ? String(value) : "–"}
            </output>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{scale?.min_label || min}</span>
            <span>{scale?.max_label || max}</span>
          </div>
        </div>
      );
    }
    case "MATRIX": {
      const rows = question.settings.rows;
      const current = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
        string,
        unknown
      >;
      const set = (row: string, v: number) => onChange({ ...current, [row]: v });
      return (
        <div className="grid gap-3">
          <table className="hidden w-full border-separate border-spacing-y-1 text-sm @2xl:table">
            <thead>
              <tr>
                <th scope="col" className="w-2/5" />
                {options.map((o) => (
                  <th
                    key={o.value}
                    scope="col"
                    className="px-1 pb-1 text-center text-xs font-medium text-muted-foreground"
                  >
                    {o.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="bg-muted/40">
                  <th scope="row" className="rounded-s-lg px-3 py-2.5 text-start font-medium">
                    {row.text}
                  </th>
                  {options.map((o, i) => (
                    <td
                      key={o.value}
                      className={cn("text-center", i === options.length - 1 && "rounded-e-lg")}
                    >
                      <input
                        type="radio"
                        name={`${name}-${row.key}`}
                        aria-label={`${row.text}: ${o.label}`}
                        checked={
                          current[row.key] !== undefined && Number(current[row.key]) === Number(o.value)
                        }
                        onChange={() => set(row.key, Number(o.value))}
                        disabled={disabled}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-3 @2xl:hidden">
            {rows.map((row) => (
              <fieldset key={row.key} className="grid gap-2 rounded-xl border p-3">
                <legend className="px-1 text-sm font-medium">{row.text}</legend>
                <div className="grid gap-1.5">
                  {options.map((o) => (
                    <label key={o.value} className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${name}-m-${row.key}`}
                        checked={
                          current[row.key] !== undefined && Number(current[row.key]) === Number(o.value)
                        }
                        onChange={() => set(row.key, Number(o.value))}
                        disabled={disabled}
                        className="size-4 accent-[var(--primary)]"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
      );
    }
    case "RANKING": {
      return <Ranking options={options} value={value} onChange={onChange} disabled={disabled} />;
    }
    case "FILE":
      return (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("fileSoon")}</p>
      );
    default:
      return null;
  }
}

function Ranking({
  options,
  value,
  onChange,
  disabled,
}: {
  options: OptionDoc[];
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("survey.renderer");
  const order = React.useMemo(() => {
    const current = Array.isArray(value) ? (value as string[]) : [];
    const valid = current.filter((v) => options.some((o) => o.value === v));
    return [...valid, ...options.map((o) => o.value).filter((v) => !valid.includes(v))];
  }, [value, options]);

  React.useEffect(() => {
    if (!Array.isArray(value)) onChange(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{t("rankingHint")}</p>
      <ol className="grid gap-2">
        {order.map((v, i) => (
          <li key={v} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1">{labelOf(v)}</span>
            <button
              type="button"
              className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
              onClick={() => move(i, -1)}
              disabled={disabled || i === 0}
              aria-label={t("rankUp", { label: labelOf(v) })}
            >
              <ChevronUpIcon className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
              onClick={() => move(i, 1)}
              disabled={disabled || i === order.length - 1}
              aria-label={t("rankDown", { label: labelOf(v) })}
            >
              <ChevronDownIcon className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
