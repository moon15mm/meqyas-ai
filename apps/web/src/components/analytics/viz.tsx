"use client";

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@meqyas/ui";
import { ChartBarBigIcon, ShieldIcon, TableIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

/*
 * Chart kit for the analytics workspace. Colors come from the validated --viz-* tokens
 * (packages/ui/src/theme.css): one hue for a single series, a one-hue ordinal ramp for
 * ordered categories (waves), and a blue↔red diverging pair with a gray midpoint for
 * agreement/satisfaction scales. Text never wears a series color.
 */

const SEQ_STEPS: Record<number, number[]> = {
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
};

/** Ordinal ramp for n ordered classes (earliest/lowest first). */
export function ordinalColors(n: number): string[] {
  const steps = SEQ_STEPS[n];
  if (steps) return steps.map((s) => `var(--viz-seq-${s})`);
  return Array.from(
    { length: n },
    (_, i) =>
      `color-mix(in oklch, var(--viz-seq-1), var(--viz-seq-5) ${Math.round((i / Math.max(1, n - 1)) * 100)}%)`,
  );
}

/** Diverging colors for k ordered categories, most negative first (k ≤ 7). */
export function divergingColors(k: number): string[] {
  const arm = Math.floor(k / 2);
  const steps = arm <= 1 ? [2] : arm === 2 ? [1, 2] : [1, 2, 3];
  const neg = [...steps].reverse().map((s) => `var(--viz-neg-${s})`);
  const pos = steps.map((s) => `var(--viz-pos-${s})`);
  return k % 2 ? [...neg, "var(--viz-mid)", ...pos] : [...neg, ...pos];
}

export const MAX_STACK_CATEGORIES = 7;

export const selectClass = "h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm";

// ---------------------------------------------------------------- chart card
export function ChartCard({
  title,
  description,
  actions,
  table,
  busy,
  className,
  headingLevel = 3,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** The accessible twin of the chart; shown via the chart/table toggle. */
  table?: React.ReactNode;
  /** Refetching: keep the previous render, dimmed (no skeleton flash). */
  busy?: boolean;
  className?: string;
  headingLevel?: 3 | 4;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <section
      aria-labelledby={id}
      aria-busy={busy || undefined}
      className={cn(
        "grid min-w-0 content-start gap-4 rounded-2xl border bg-card p-4 transition-opacity sm:p-5",
        busy && "opacity-60",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <Heading id={id} className="font-semibold leading-snug text-balance">
            {title}
          </Heading>
          {description ? (
            <div className="text-sm text-muted-foreground text-pretty">{description}</div>
          ) : null}
        </div>
        {actions || table ? (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {table ? <ViewToggle value={view} onChange={setView} /> : null}
          </div>
        ) : null}
      </div>
      {view === "table" && table ? <div className="min-w-0 overflow-x-auto">{table}</div> : children}
    </section>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: "chart" | "table";
  onChange: (v: "chart" | "table") => void;
}) {
  const t = useTranslations("analytics.viz");
  const options = [
    { key: "chart" as const, icon: ChartBarBigIcon, label: t("showChart") },
    { key: "table" as const, icon: TableIcon, label: t("showTable") },
  ];
  return (
    <div role="group" aria-label={t("viewAs")} className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.key)}
          className={cn(
            "grid size-8 place-items-center rounded-md text-muted-foreground transition hover:text-foreground",
            value === o.key && "bg-card text-foreground shadow-sm",
          )}
        >
          <o.icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------- legend
export function Legend({
  items,
  shape = "rect",
  className,
}: {
  items: Array<{ key: string; label: string; color: string }>;
  shape?: "rect" | "dot" | "line";
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0",
              shape === "line"
                ? "h-0.5 w-3.5 rounded-full"
                : shape === "dot"
                  ? "size-2.5 rounded-full"
                  : "size-2.5 rounded-[3px]",
            )}
            style={{ background: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ tooltips
export interface TipRow {
  key: string;
  label: string;
  value: string;
  color?: string;
}

/** Tooltip body: values lead (strong), labels follow; series keyed by a short line. */
export function TipRows({ title, rows, note }: { title?: string; rows: TipRow[]; note?: string }) {
  return (
    <div className="grid min-w-36 gap-1 py-0.5">
      {title ? <p className="font-semibold">{title}</p> : null}
      <ul className="grid gap-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            {r.color ? (
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: r.color }}
              />
            ) : null}
            <bdi dir="ltr" className="font-semibold tabular-nums">
              {r.value}
            </bdi>
            <span className="opacity-80">{r.label}</span>
          </li>
        ))}
      </ul>
      {note ? <p className="opacity-80">{note}</p> : null}
    </div>
  );
}

/** A focusable chart mark (or row of marks) carrying its own tooltip on hover and focus. */
export function Mark({
  label,
  tip,
  className,
  children,
}: {
  /** Accessible summary of everything the tooltip says. */
  label: string;
  tip: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          tabIndex={0}
          aria-label={label}
          className={cn(
            "group/mark rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            className,
          )}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

// ------------------------------------------------------------- stacked bar
export interface Segment {
  key: string;
  label: string;
  pct: number;
  count: number;
  color: string;
}

/**
 * A 100% stacked bar (part-to-whole of one ordered scale): thin, 2px surface gaps
 * between segments, rounded outer ends. Segments run lowest → highest in reading
 * order, so the bar mirrors itself in RTL.
 */
export function StackedBar({
  segments,
  label,
  title,
  formatPct,
  className,
}: {
  segments: Segment[];
  label: string;
  title?: string;
  formatPct: (v: number) => string;
  className?: string;
}) {
  const visible = segments.filter((s) => s.pct > 0);
  const summary = segments.map((s) => `${s.label}: ${formatPct(s.pct)}`).join("، ");
  return (
    <Mark
      label={`${label} — ${summary}`}
      className={className}
      tip={
        <TipRows
          title={title}
          rows={[...segments].reverse().map((s) => ({
            key: s.key,
            label: `${s.label} (${s.count})`,
            value: formatPct(s.pct),
            color: s.color,
          }))}
        />
      }
    >
      <div className="flex h-4 w-full gap-[2px]">
        {visible.map((s) => (
          <span
            key={s.key}
            className="h-full min-w-[2px] transition-[filter] first:rounded-s-[4px] last:rounded-e-[4px] group-hover/mark:brightness-105"
            style={{ flexGrow: s.pct, flexBasis: 0, background: s.color }}
          />
        ))}
      </div>
    </Mark>
  );
}

// ------------------------------------------------------------------ bar list
export interface BarRow {
  key: string;
  label: string;
  /** Bar length on the list's scale (e.g. a percentage). */
  value: number | null;
  display: string;
  tip?: TipRow[];
  note?: string;
}

/** Single-series horizontal bars (slot 1): label above, value at the end, thin marks. */
export function BarList({
  rows,
  max,
  color = "var(--viz-1)",
}: {
  rows: BarRow[];
  max?: number;
  color?: string;
}) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-pretty">{r.label}</span>
            <bdi dir="ltr" className="shrink-0 font-medium tabular-nums">
              {r.display}
            </bdi>
          </div>
          {r.value === null ? (
            <p className="text-xs text-muted-foreground">{r.note}</p>
          ) : (
            <Mark
              label={`${r.label}: ${r.display}`}
              tip={
                <TipRows
                  title={r.label}
                  rows={r.tip ?? [{ key: "v", label: "", value: r.display }]}
                  note={r.note}
                />
              }
            >
              <div className="flex h-2.5 w-full items-stretch">
                <span
                  className="block min-w-[2px] rounded-e-[4px] transition-[filter] group-hover/mark:brightness-110"
                  style={{
                    width: `${Math.max(0, Math.min(100, (r.value / top) * 100))}%`,
                    background: color,
                  }}
                />
              </div>
            </Mark>
          )}
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------- small pieces
export function MaskedNote({ n, k = 5, className }: { n: number; k?: number; className?: string }) {
  const t = useTranslations("analytics.viz");
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <ShieldIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {t("masked", { n, k })}
    </p>
  );
}

/** A compact data table used as every chart's accessible twin. */
export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: React.ReactNode[];
  rows: Array<{ key: string; cells: React.ReactNode[] }>;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={i} scope="col" className="px-2 py-2 text-start font-medium first:ps-0 last:pe-0">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-0">
            {r.cells.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="max-w-72 px-2 py-2 text-start font-normal first:ps-0">
                  {c}
                </th>
              ) : (
                <td key={i} className="px-2 py-2 tabular-nums last:pe-0">
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
