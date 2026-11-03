"use client";

import type { CxDashboard, CxDriver, CxMasked, CxNps, CxQuadrant, CxShare, CxTrio } from "@meqyas/shared";
import { cn } from "@meqyas/ui";
import {
  EyeIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparkleIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { genericText, Num, useStatFormat, type StatFormat } from "@/components/analytics/format";
import { NpsBlock } from "@/components/analytics/question-card";
import { ChartCard, DataTable, MaskedNote, TipRows } from "@/components/analytics/viz";

/*
 * Customer-experience views (CX.md). Every number is computed by the API (never by a model);
 * values below the k-anonymity threshold arrive masked and are shown as such, never guessed.
 */

export type Metric = "nps" | "csat" | "ces";
const METRICS: Metric[] = ["nps", "csat", "ces"];

export function shown<T extends CxNps | CxShare>(v: T | CxMasked | undefined): v is T {
  return !!v && !v.masked;
}

/** The CX measures this project actually collects (from the overall figures). */
export function metricsOf(trio: CxTrio): Metric[] {
  return METRICS.filter((m) => trio[m] !== undefined);
}

function metricValue(trio: CxTrio, m: Metric): number | null {
  const v = trio[m];
  if (!shown<CxNps | CxShare>(v)) return null;
  return "score" in v ? v.score : v.pct;
}

function formatMetric(fmt: StatFormat, m: Metric, value: number | null): string {
  if (value === null) return "—";
  return m === "nps" ? fmt.signed(value, 0) : fmt.pct(value, 0);
}

// ---------------------------------------------------------------- KPI tiles
function Tile({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("grid content-start gap-2 rounded-2xl border bg-card p-4", className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground text-pretty">{hint}</span> : null}
    </li>
  );
}

function ShareTile({
  label,
  value,
  hint,
  k,
}: {
  label: string;
  value: CxShare | CxMasked;
  hint: (v: CxShare) => string;
  k: number;
}) {
  const fmt = useStatFormat();
  return (
    <Tile label={label} hint={shown(value) ? hint(value) : undefined}>
      {shown(value) ? (
        <span className="text-3xl font-semibold leading-tight">{fmt.pct(value.pct, 0)}</span>
      ) : (
        <MaskedNote n={value.n} k={k} />
      )}
    </Tile>
  );
}

export function CxKpis({ data }: { data: CxDashboard }) {
  const t = useTranslations("cx.kpi");
  const fmt = useStatFormat();
  const o = data.overall;
  const k = data.k_anonymity;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {o.nps ? (
        <Tile label={t("nps")} hint={t("npsHint")} className="sm:col-span-2">
          {shown(o.nps) ? <NpsBlock nps={o.nps} fmt={fmt} /> : <MaskedNote n={o.nps.n} k={k} />}
        </Tile>
      ) : null}
      {o.csat ? (
        <ShareTile
          label={t("csat")}
          value={o.csat}
          k={k}
          hint={(v) => t("csatHint", { mean: fmt.num(v.mean, 1), n: v.n })}
        />
      ) : null}
      {o.ces ? (
        <ShareTile
          label={t("ces")}
          value={o.ces}
          k={k}
          hint={(v) => t("cesHint", { mean: fmt.num(v.mean, 1), n: v.n })}
        />
      ) : null}
      {!o.csat || !o.ces ? (
        <Tile label={t("responses")} hint={t("responsesHint")}>
          <span className="text-3xl font-semibold leading-tight">{fmt.int(o.n)}</span>
        </Tile>
      ) : null}
    </ul>
  );
}

// ------------------------------------------------------------- comparisons
/** A −100…100 track with the bar growing from zero (decoration: the number carries the value). */
function NpsTrack({ score }: { score: number }) {
  const width = Math.min(50, (Math.abs(score) / 100) * 50);
  return (
    <span aria-hidden="true" className="relative block h-2 w-24 rounded-full bg-muted">
      <span className="absolute inset-y-[-2px] start-1/2 w-px bg-border" />
      <span
        className="absolute inset-y-0 rounded-[4px]"
        style={{
          insetInlineStart: score >= 0 ? "50%" : `${50 - width}%`,
          width: `${Math.max(width, 1)}%`,
          background: score >= 0 ? "var(--viz-pos-2)" : "var(--viz-neg-2)",
        }}
      />
    </span>
  );
}

function MetricCell({ trio, metric, k }: { trio: CxTrio; metric: Metric; k: number }) {
  const t = useTranslations("cx");
  const fmt = useStatFormat();
  const v = trio[metric];
  if (!v || v.n === 0) return <span className="text-muted-foreground">—</span>;
  if (!shown<CxNps | CxShare>(v)) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" title={t("maskedCell", { k })}>
        <ShieldIcon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{t("maskedCell", { k })}</span>—
      </span>
    );
  }
  if ("score" in v) {
    return (
      <span className="inline-flex items-center gap-2">
        <Num className="w-9 font-semibold">{fmt.signed(v.score, 0)}</Num>
        <NpsTrack score={v.score} />
        {!v.suitable ? <span className="text-xs text-muted-foreground">{t("small")}</span> : null}
      </span>
    );
  }
  return <span className="font-semibold">{fmt.pct(v.pct, 0)}</span>;
}

export function BranchTable({ data }: { data: CxDashboard }) {
  const t = useTranslations("cx.branches");
  const tm = useTranslations("cx.metrics");
  const fmt = useStatFormat();
  const metrics = metricsOf(data.overall);
  const lead = metrics[0];
  const rows = React.useMemo(
    () =>
      [...data.locations].sort((a, b) => {
        const va = lead ? metricValue(a, lead) : null;
        const vb = lead ? metricValue(b, lead) : null;
        if (va === null && vb === null) return b.n - a.n;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      }),
    [data.locations, lead],
  );
  if (!rows.length) return null;
  return (
    <ChartCard title={t("title")} description={t("description", { k: data.k_anonymity })}>
      <div className="min-w-0 overflow-x-auto">
        <DataTable
          caption={t("title")}
          head={[t("branch"), t("responses"), ...metrics.map((m) => tm(m))]}
          rows={rows.map((r) => ({
            key: r.id,
            cells: [
              <span key="name" className="font-medium">
                {r.name}
              </span>,
              fmt.int(r.n),
              ...metrics.map((m) => <MetricCell key={m} trio={r} metric={m} k={data.k_anonymity} />),
            ],
          }))}
        />
      </div>
    </ChartCard>
  );
}

export function ChannelSplit({ data }: { data: CxDashboard }) {
  const t = useTranslations("cx.channels");
  const tm = useTranslations("cx.metrics");
  const fmt = useStatFormat();
  const metrics = metricsOf(data.overall);
  const channels = (["branch", "online", "other"] as const).filter((c) => (data.channels[c]?.n ?? 0) > 0);
  if (channels.length < 2) return null;
  return (
    <ChartCard title={t("title")} description={t("description")}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {channels.map((c) => {
          const trio = data.channels[c]!;
          return (
            <li key={c} className="grid content-start gap-2 rounded-xl border p-3">
              <span className="font-medium">{t(c)}</span>
              <span className="text-xs text-muted-foreground">{t("responses", { n: trio.n })}</span>
              <dl className="grid gap-1 text-sm">
                {metrics.map((m) => (
                  <div key={m} className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{tm(m)}</dt>
                    <dd>
                      <Num className="font-semibold">{formatMetric(fmt, m, metricValue(trio, m))}</Num>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

// ------------------------------------------------------------------- trend
export function WeeklyTrend({ data }: { data: CxDashboard }) {
  const t = useTranslations("cx.trend");
  const tm = useTranslations("cx.metrics");
  const locale = useLocale();
  const rtl = locale === "ar";
  const fmt = useStatFormat();
  const metrics = metricsOf(data.overall);
  const [metric, setMetric] = React.useState<Metric>(metrics[0] ?? "nps");
  const active = metrics.includes(metric) ? metric : (metrics[0] ?? "nps");
  const points = data.weekly.map((w) => ({
    week: w.week,
    n: w.n,
    value: metricValue(w, active),
    masked: !!w[active]?.masked,
  }));
  const visible = points.filter((p) => p.value !== null).length;
  if (!data.weekly.length || !metrics.length) return null;
  const domain: [number, number] = active === "nps" ? [-100, 100] : [0, 100];

  const table = (
    <DataTable
      caption={t("title", { metric: tm(active) })}
      head={[t("week"), t("n"), tm(active)]}
      rows={points.map((p) => ({
        key: p.week,
        cells: [
          fmt.day(p.week),
          fmt.int(p.n),
          p.masked ? t("masked") : <Num key="v">{formatMetric(fmt, active, p.value)}</Num>,
        ],
      }))}
    />
  );
  const toggle =
    metrics.length > 1 ? (
      <div role="group" aria-label={t("metric")} className="inline-flex rounded-lg border bg-muted/40 p-0.5">
        {metrics.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={active === m}
            onClick={() => setMetric(m)}
            className={cn(
              "h-8 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground",
              active === m && "bg-card text-foreground shadow-sm",
            )}
          >
            {tm(`${m}Short`)}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <ChartCard
      title={t("title", { metric: tm(active) })}
      description={t("description", { k: data.k_anonymity })}
      actions={toggle}
      table={table}
    >
      {visible < 2 ? (
        <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">{t("notEnough")}</p>
      ) : (
        <div className="h-56 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="week"
                reversed={rtl}
                tickFormatter={(d: string) => fmt.day(d)}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis
                orientation={rtl ? "right" : "left"}
                domain={domain}
                ticks={active === "nps" ? [-100, -50, 0, 50, 100] : [0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => (active === "nps" ? fmt.signed(v, 0) : fmt.pct(v, 0))}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              {active === "nps" ? (
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
              ) : null}
              <ChartTooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
                content={({ active: on, payload }) => {
                  const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
                  if (!on || !p) return null;
                  return (
                    <div
                      dir={rtl ? "rtl" : "ltr"}
                      className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md"
                    >
                      <TipRows
                        title={t("weekOf", { date: fmt.day(p.week) })}
                        rows={[
                          {
                            key: "v",
                            label: tm(active),
                            value: p.masked ? "—" : formatMetric(fmt, active, p.value),
                            color: "var(--viz-1)",
                          },
                          { key: "n", label: t("n"), value: fmt.int(p.n) },
                        ]}
                        note={p.masked ? t("masked") : undefined}
                      />
                    </div>
                  );
                }}
              />
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--viz-1)"
                strokeWidth={2}
                dot={{ r: 4, fill: "var(--viz-1)", stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: "var(--viz-1)", stroke: "var(--card)", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ----------------------------------------------------------------- drivers
const QUADRANTS: Array<{ key: CxQuadrant; icon: LucideIcon; tone: string }> = [
  {
    key: "fix",
    icon: TriangleAlertIcon,
    tone: "border-warning/50 bg-warning/8 [&_svg]:text-warning-foreground dark:[&_svg]:text-warning",
  },
  { key: "keep", icon: ShieldCheckIcon, tone: "border-success/35 bg-success/6 [&_svg]:text-success" },
  { key: "monitor", icon: EyeIcon, tone: "[&_svg]:text-muted-foreground" },
  { key: "maintain", icon: SparkleIcon, tone: "[&_svg]:text-muted-foreground" },
];

export function DriverMatrix({ data }: { data: CxDashboard }) {
  const t = useTranslations("cx.drivers");
  const tq = useTranslations("cx.drivers.quadrants");
  const locale = useLocale();
  const fmt = useStatFormat();
  const { outcome, items } = data.drivers;
  const minPairs = data.drivers.min_pairs ?? 30;
  if (!outcome) return null;
  const text = (d: CxDriver) => genericText(d.text, locale);
  const scored = items.filter((d) => d.quadrant);
  const waiting = items.filter((d) => !d.quadrant);
  const outcomeText = genericText(outcome.text, locale);

  if (!items.length) {
    return (
      <ChartCard title={t("title")} description={t("none")}>
        {null}
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={t("title")}
      head={[t("factor"), t("performance"), t("importance"), "p", t("pairs"), t("group")]}
      rows={items.map((d) => ({
        key: d.key,
        cells: [
          text(d),
          d.masked ? t("masked") : `${fmt.num(d.performance, 0)} / 100`,
          d.importance === null || d.importance === undefined ? (
            "—"
          ) : (
            <Num key="r">{fmt.num(d.importance, 2)}</Num>
          ),
          <Num key="p">{fmt.p(d.p_value)}</Num>,
          fmt.int(d.pairs ?? d.n),
          d.quadrant ? tq(`${d.quadrant}.title`) : "—",
        ],
      }))}
    />
  );

  return (
    <ChartCard
      title={t("title")}
      description={t("description", { outcome: outcomeText, min: minPairs })}
      table={table}
    >
      {scored.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUADRANTS.map(({ key, icon: Icon, tone }) => {
            const members = scored
              .filter((d) => d.quadrant === key)
              .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
            return (
              <li key={key} className={cn("grid content-start gap-2 rounded-xl border p-3", tone)}>
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="grid gap-0.5">
                    <span className="font-semibold">{tq(`${key}.title`)}</span>
                    <span className="text-xs text-muted-foreground">{tq(`${key}.hint`)}</span>
                  </div>
                </div>
                {members.length ? (
                  <ul className="grid gap-1.5">
                    {members.map((d) => (
                      <li key={d.key} className="grid gap-0.5 rounded-lg bg-card/80 px-2.5 py-2 text-sm">
                        <span className="text-pretty">{text(d)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("itemStats", {
                            performance: fmt.num(d.performance, 0),
                            importance: fmt.num(d.importance, 2),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("emptyGroup")}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {waiting.length ? (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">{t("waitingTitle")}</p>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {waiting.map((d) => (
              <li key={d.key} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-pretty">{text(d)}</span>
                <span className="text-xs">
                  {d.masked ? t("masked") : t("waiting", { n: d.pairs ?? 0, min: minPairs })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground text-pretty">{t("note")}</p>
    </ChartCard>
  );
}
