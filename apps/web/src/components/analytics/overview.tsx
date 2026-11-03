"use client";

import {
  EVIDENCE_LABELS,
  INDICATOR_STATUS_LABELS,
  label,
  WAVE_LABELS,
  type AnalyticsSummary,
  type DimensionResult,
  type IndicatorResult,
  type IndicatorStatus,
  type WaveType,
} from "@meqyas/shared";
import { Alert, AlertDescription, AlertTitle, Badge } from "@meqyas/ui";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  HourglassIcon,
  InfoIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";

import { Num, useStatFormat, type StatFormat } from "./format";
import { ChartCard, DataTable, Legend, MaskedNote, Mark, ordinalColors, TipRows } from "./viz";

type Locale = "ar" | "en";

export function waveName(wave: string, locale: Locale): string {
  // Repeated rounds are numbered by the analytics engine: ROUND-2 → «جولة قياس 2».
  const [base, number] = wave.split("-") as [string, string | undefined];
  const name = label(WAVE_LABELS, base as WaveType, locale) || base;
  return number ? `${name} ${number}` : name;
}

/** Color follows the wave (its position among all collected waves), never the current selection. */
export function useWaveColors(waves: string[]): Record<string, string> {
  return React.useMemo(() => {
    const colors = ordinalColors(waves.length);
    return Object.fromEntries(waves.map((w, i) => [w, colors[i]!]));
  }, [waves]);
}

// ------------------------------------------------------------------ causality
export function CausalityBanner({ summary }: { summary: AnalyticsSummary }) {
  const t = useTranslations("analytics.causality");
  const locale = useLocale() as Locale;
  const note = summary.causality.note ?? "descriptive_only";
  const evidence = EVIDENCE_LABELS[summary.evidence_level];
  return (
    <Alert variant="evidence">
      <InfoIcon aria-hidden="true" />
      <AlertTitle>{t("title", { level: label(EVIDENCE_LABELS, summary.evidence_level, locale) })}</AlertTitle>
      <AlertDescription>
        <p>{t(note)}</p>
        {evidence ? (
          <p className="mt-1 text-xs">{locale === "ar" ? evidence.hint_ar : evidence.hint_en}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------- KPIs
function Tile({
  label: name,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <li className="grid content-start gap-1 rounded-2xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">{name}</span>
      <span className="text-2xl font-semibold leading-tight">{value}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </li>
  );
}

export function KpiTiles({ summary }: { summary: AnalyticsSummary }) {
  const t = useTranslations("analytics.kpi");
  const tr = useTranslations("responses");
  const fmt = useStatFormat();
  const c = summary.counts;
  const left = c.total - c.included;
  const duration = summary.median_duration_seconds;
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label={t("responses")}
        value={fmt.int(c.included)}
        detail={left > 0 ? t("responsesDetail", { total: c.total, left }) : t("responsesAll")}
      />
      <Tile
        label={t("overall")}
        value={
          summary.overall_score === null ? (
            "—"
          ) : (
            <>
              {fmt.num(summary.overall_score, 0)}
              <span className="text-sm font-normal text-muted-foreground"> / 100</span>
            </>
          )
        }
        detail={
          summary.overall_score !== null
            ? t("overallHint")
            : summary.dimensions.some((d) => d.items > 0)
              ? t("overallMasked", { k: summary.k_anonymity })
              : t("overallNone")
        }
      />
      {summary.nps ? (
        <Tile
          label={t("nps")}
          value={<Num>{fmt.signed(summary.nps.score, 0)}</Num>}
          detail={t(summary.nps.suitable ? "npsDetail" : "npsSmall", { n: summary.nps.n })}
        />
      ) : summary.csat ? (
        <Tile label={t("csat")} value={fmt.share(summary.csat.estimate, 0)} detail={t("csatDetail")} />
      ) : (
        <Tile label={t("waves")} value={fmt.int(summary.waves.length)} detail={t("wavesDetail")} />
      )}
      <Tile
        label={t("medianTime")}
        value={
          duration === null
            ? "—"
            : duration >= 60
              ? tr("minutes", { m: Math.floor(duration / 60), s: duration % 60 })
              : tr("seconds", { s: duration })
        }
        detail={
          summary.last_response_at
            ? t("lastResponse", { date: fmt.date(summary.last_response_at) })
            : undefined
        }
      />
    </ul>
  );
}

export function StrengthProblem({ summary }: { summary: AnalyticsSummary }) {
  const t = useTranslations("analytics.kpi");
  const fmt = useStatFormat();
  if (!summary.top_strength || !summary.top_problem) return null;
  const items = [
    { key: "strength", title: t("strength"), item: summary.top_strength },
    { key: "problem", title: t("problem"), item: summary.top_problem },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(({ key, title, item }) => (
        <li key={key} className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm text-muted-foreground">{title}</span>
            <span className="font-semibold text-pretty">{item.name}</span>
          </div>
          <span className="shrink-0 text-xl font-semibold">
            {fmt.num(item.score, 0)}
            <span className="text-sm font-normal text-muted-foreground"> / 100</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------- dimensions
function dimensionTip(
  d: DimensionResult,
  locale: Locale,
  fmt: StatFormat,
  colors: Record<string, string>,
  meanLabel: string,
) {
  return d.waves.map((w) => ({
    key: w.wave,
    label: `${waveName(w.wave, locale)} · n=${w.n}`,
    value:
      w.masked || w.score === null
        ? "—"
        : `${fmt.num(w.score, 0)} / 100${w.mean !== null ? ` · ${meanLabel} ${fmt.num(w.mean)}` : ""}`,
    color: colors[w.wave],
  }));
}

export function DimensionChart({ summary, busy }: { summary: AnalyticsSummary; busy?: boolean }) {
  const t = useTranslations("analytics.dimensions");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  const waves = React.useMemo(() => summary.waves.map((w) => w.wave), [summary.waves]);
  const colors = useWaveColors(waves);
  const dims = summary.dimensions.filter((d) => d.items > 0);

  if (!dims.length) {
    return (
      <ChartCard title={t("title")} description={t("description")}>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={t("title")}
      head={[t("dimension"), t("wave"), t("score"), t("mean"), t("ci"), t("topBox"), t("alpha"), "n"]}
      rows={dims.flatMap((d) =>
        d.waves.map((w) => ({
          key: `${d.id}-${w.wave}`,
          cells: [
            d.name,
            waveName(w.wave, locale),
            w.masked ? t("maskedShort") : fmt.num(w.score, 1),
            w.mean !== null && w.scale_min !== null ? (
              <Num>
                {fmt.num(w.mean)} ({fmt.int(w.scale_min)}–{fmt.int(w.scale_max)})
              </Num>
            ) : (
              "—"
            ),
            w.ci_low !== null ? (
              <Num>
                {fmt.num(w.ci_low, 1)}–{fmt.num(w.ci_high, 1)}
              </Num>
            ) : (
              "—"
            ),
            w.top_box?.estimate != null ? fmt.share(w.top_box.estimate, 0) : "—",
            w.alpha !== null ? (
              <span>
                {fmt.num(w.alpha)}{" "}
                <span className="text-xs text-muted-foreground">
                  ({t(`alphaLabels.${w.alpha_label ?? "poor"}`)})
                </span>
              </span>
            ) : (
              "—"
            ),
            fmt.int(w.n),
          ],
        })),
      )}
    />
  );

  return (
    <ChartCard title={t("title")} description={t("description")} table={table} busy={busy}>
      <div className="grid gap-4">
        {waves.length > 1 ? (
          <Legend items={waves.map((w) => ({ key: w, label: waveName(w, locale), color: colors[w]! }))} />
        ) : null}
        <ul className="grid gap-5">
          {dims.map((d) => (
            <li key={d.id} className="grid gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-medium text-pretty">{d.name}</span>
                <span className="text-xs text-muted-foreground">{t("items", { count: d.items })}</span>
              </div>
              <Mark
                label={`${d.name}: ${dimensionTip(d, locale, fmt, colors, t("meanShort"))
                  .map((r) => `${r.label} ${r.value}`)
                  .join("، ")}`}
                tip={<TipRows title={d.name} rows={dimensionTip(d, locale, fmt, colors, t("meanShort"))} />}
                className="grid gap-1.5"
              >
                {d.waves.map((w) => (
                  <div key={w.wave} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2">
                    {w.masked ? (
                      <MaskedNote n={w.n} k={summary.k_anonymity} />
                    ) : w.score === null ? (
                      <p className="text-xs text-muted-foreground">
                        {t("noData", { wave: waveName(w.wave, locale) })}
                      </p>
                    ) : (
                      <div className="flex h-2.5 items-stretch">
                        <span
                          className="block min-w-[2px] rounded-e-[4px] transition-[filter] group-hover/mark:brightness-110"
                          style={{
                            width: `${Math.max(0, Math.min(100, w.score))}%`,
                            background: colors[w.wave],
                          }}
                        />
                      </div>
                    )}
                    <span className="text-end text-sm font-medium tabular-nums">
                      {w.masked || w.score === null ? "" : fmt.num(w.score, 0)}
                    </span>
                  </div>
                ))}
              </Mark>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("scoreNote")}</p>
      </div>
    </ChartCard>
  );
}

// --------------------------------------------------------------- indicators
const STATUS_META: Record<
  IndicatorStatus,
  { icon: LucideIcon; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  ACHIEVED: { icon: CircleCheckIcon, variant: "success" },
  ON_TRACK: { icon: TrendingUpIcon, variant: "success" },
  AT_RISK: { icon: TriangleAlertIcon, variant: "warning" },
  OFF_TRACK: { icon: CircleXIcon, variant: "destructive" },
  NOT_STARTED: { icon: CircleDashedIcon, variant: "outline" },
  COLLECTING: { icon: HourglassIcon, variant: "outline" },
};

export function IndicatorStatusBadge({ status }: { status: IndicatorStatus }) {
  const locale = useLocale() as Locale;
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant}>
      <meta.icon aria-hidden="true" />
      {label(INDICATOR_STATUS_LABELS, status, locale)}
    </Badge>
  );
}

/** A wave's own value: the level the indicator is computed from (for change/effect types, the mean). */
function waveValue(ind: IndicatorResult, value: number | null, fmt: StatFormat): string {
  if (value === null) return "—";
  if (ind.indicator_type === "PERCENTAGE") return fmt.pct(value, 1);
  if (ind.indicator_type === "COUNT") return fmt.int(value);
  return fmt.num(value);
}

function indicatorValue(ind: IndicatorResult, value: number | null, fmt: StatFormat): string {
  if (value === null) return "—";
  switch (ind.indicator_type) {
    case "PERCENTAGE":
      return fmt.pct(value, 1);
    case "COUNT":
      return fmt.int(value);
    case "CHANGE":
    case "DIFFERENCE":
      return fmt.signed(value);
    case "EFFECT_SIZE":
      return `d = ${fmt.num(value)}`;
    default:
      return fmt.num(value);
  }
}

export function IndicatorGrid({ summary, busy }: { summary: AnalyticsSummary; busy?: boolean }) {
  const t = useTranslations("analytics.indicators");
  const te = useTranslations("analytics.compare.effectLabels");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  if (!summary.indicators.length) return null;
  return (
    <section
      aria-labelledby="indicators-title"
      className={busy ? "grid gap-3 opacity-60 transition-opacity" : "grid gap-3 transition-opacity"}
    >
      <div className="grid gap-1">
        <h3 id="indicators-title" className="font-semibold">
          {t("title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {summary.indicators.map((ind) => {
          // "no_data" only means a wave did not ask this indicator's questions: not worth a note.
          const reasonWave = ind.waves.find((w) => w.reason && w.reason !== "no_data");
          const reason = reasonWave?.reason ?? null;
          const waves = ind.waves.filter((w) => w.reason !== "no_data");
          const effect = ind.comparison?.test.effect_label;
          return (
            <li key={ind.id} className="grid content-start gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-0.5">
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {ind.code}
                  </span>
                  <span className="font-medium text-pretty">{ind.name}</span>
                </div>
                <IndicatorStatusBadge status={ind.status} />
              </div>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <div className="grid gap-0.5">
                  <span className="text-xs text-muted-foreground">{t("current")}</span>
                  <span className="text-2xl font-semibold">
                    <Num>{indicatorValue(ind, ind.current_value, fmt)}</Num>
                    {effect ? (
                      <span className="ms-1 text-sm font-normal text-muted-foreground">({te(effect)})</span>
                    ) : null}
                  </span>
                </div>
                {ind.indicator_type !== "CHANGE" &&
                ind.indicator_type !== "EFFECT_SIZE" &&
                ind.baseline_value !== null ? (
                  <div className="grid gap-0.5">
                    <span className="text-xs text-muted-foreground">{t("baseline")}</span>
                    <span className="font-medium">
                      <Num>{indicatorValue(ind, ind.baseline_value, fmt)}</Num>
                    </span>
                  </div>
                ) : null}
                {ind.target_value !== null ? (
                  <div className="grid gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t(ind.direction === "LOWER_IS_BETTER" ? "targetMax" : "target")}
                    </span>
                    <span className="font-medium">
                      <Num>{indicatorValue(ind, ind.target_value, fmt)}</Num>
                    </span>
                  </div>
                ) : null}
                {ind.change?.suitable && ind.change.absolute !== null && ind.indicator_type !== "CHANGE" ? (
                  <div className="grid gap-0.5">
                    <span className="text-xs text-muted-foreground">{t("change")}</span>
                    <span className="font-medium">
                      <Num>
                        {fmt.signed(ind.change.absolute, ind.indicator_type === "PERCENTAGE" ? 1 : 2)}
                      </Num>
                      {ind.indicator_type === "PERCENTAGE" ? (
                        <span className="text-xs font-normal text-muted-foreground"> {t("pp")}</span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </div>
              {waves.length > 1 ? (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {waves.map((w) => (
                    <li key={w.wave}>
                      {waveName(w.wave, locale)}:{" "}
                      <span className="font-medium text-foreground">
                        <Num>{waveValue(ind, w.value, fmt)}</Num>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {reason === "below_k_anonymity" ? (
                <p className="text-xs text-muted-foreground text-pretty">
                  {t("reasons.below_k_anonymity_count", { k: summary.k_anonymity, n: reasonWave?.n ?? 0 })}
                </p>
              ) : reason ? (
                <p className="text-xs text-muted-foreground">{t(`reasons.${reason}`)}</p>
              ) : null}
              {ind.items_from === "dimension" ? (
                <p className="text-xs text-muted-foreground">{t("fromDimension", { n: ind.items })}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --------------------------------------------------------------------- trend
const DAY = 86_400_000;

/** Daily counts with the empty days filled in (weekly once the range is long). */
export function fillDays(days: AnalyticsSummary["responses_by_day"]): Array<{ date: string; count: number }> {
  if (!days.length) return [];
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const start = Date.parse(`${days[0]!.date}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]!.date}T00:00:00Z`);
  const span = Math.round((end - start) / DAY) + 1;
  const step = span > 120 ? 7 : 1;
  const out: Array<{ date: string; count: number }> = [];
  for (let t = start; t <= end; t += step * DAY) {
    let count = 0;
    for (let i = 0; i < step; i++) count += counts.get(new Date(t + i * DAY).toISOString().slice(0, 10)) ?? 0;
    out.push({ date: new Date(t).toISOString().slice(0, 10), count });
  }
  return out;
}

export function ResponsesTrend({ summary, busy }: { summary: AnalyticsSummary; busy?: boolean }) {
  const t = useTranslations("analytics.trend");
  const locale = useLocale() as Locale;
  const rtl = locale === "ar";
  const fmt = useStatFormat();
  const data = React.useMemo(() => fillDays(summary.responses_by_day), [summary.responses_by_day]);
  const weekly = data.length > 1 && Date.parse(data[1]!.date) - Date.parse(data[0]!.date) > DAY;
  if (!data.length) return null;
  const table = (
    <DataTable
      caption={t("title")}
      head={[t(weekly ? "week" : "date"), t("responses")]}
      rows={data
        .filter((d) => d.count > 0)
        .map((d) => ({ key: d.date, cells: [fmt.day(d.date), fmt.int(d.count)] }))}
    />
  );
  return (
    <ChartCard
      title={t("title")}
      description={t(weekly ? "descriptionWeekly" : "description")}
      table={table}
      busy={busy}
    >
      <div className="h-56 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              reversed={rtl}
              tickFormatter={(d: string) => fmt.day(d)}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              minTickGap={24}
            />
            <YAxis
              orientation={rtl ? "right" : "left"}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={32}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <ChartTooltip
              cursor={{ fill: "var(--viz-wash)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { date: string; count: number } | undefined;
                if (!active || !p) return null;
                return (
                  <div
                    dir={rtl ? "rtl" : "ltr"}
                    className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md"
                  >
                    <TipRows
                      title={weekly ? t("weekOf", { date: fmt.day(p.date) }) : fmt.day(p.date)}
                      rows={[
                        { key: "n", label: t("responses"), value: fmt.int(p.count), color: "var(--viz-1)" },
                      ]}
                    />
                  </div>
                );
              }}
            />
            <Bar
              dataKey="count"
              fill="var(--viz-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
