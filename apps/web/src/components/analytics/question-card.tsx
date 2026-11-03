"use client";

import {
  label,
  QUESTION_TYPE_LABELS,
  type DistributionResult,
  type QuestionStats,
  type QuestionStatsCore,
  type TextQuestionAnalysis,
} from "@meqyas/shared";
import { Badge } from "@meqyas/ui";
import { LockIcon, MessageSquareTextIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { TextAnalysisPanel } from "@/components/intelligence/text-analysis-panel";

import { Num, useStatFormat, type StatFormat } from "./format";
import { useSegmentValueLabel } from "./segments";
import {
  BarList,
  ChartCard,
  DataTable,
  divergingColors,
  Legend,
  MaskedNote,
  MAX_STACK_CATEGORIES,
  ordinalColors,
  StackedBar,
  type Segment,
} from "./viz";

type Locale = "ar" | "en";

/** Agreement/satisfaction/effort scales read as two-sided (diverging); ratings and stars as one-sided. */
const BIPOLAR = new Set(["LIKERT", "CSAT", "CES", "MATRIX"]);
const SCALE = new Set(["LIKERT", "CSAT", "CES", "RATING", "STAR", "MATRIX"]);
const CHOICE = new Set(["SINGLE_CHOICE", "DROPDOWN"]);
const TEXT = new Set(["SHORT_TEXT", "LONG_TEXT"]);

/** How an ordered distribution is colored, or null when it should not be stacked. */
function scaleColors(type: string, k: number): string[] | null {
  if (!SCALE.has(type) || k < 2 || k > MAX_STACK_CATEGORIES) return null;
  if (BIPOLAR.has(type)) return divergingColors(k);
  return k <= 5 ? ordinalColors(k) : null;
}

function segmentsOf(dist: DistributionResult, colors: string[]): Segment[] {
  return dist.categories.map((c, i) => ({
    key: c.value,
    label: c.label,
    pct: c.pct,
    count: c.count,
    color: colors[i]!,
  }));
}

function distributionTable(
  dist: DistributionResult,
  caption: string,
  fmt: StatFormat,
  t: (k: string) => string,
) {
  return (
    <DataTable
      caption={caption}
      head={[t("category"), t("count"), t("percent")]}
      rows={dist.categories.map((c) => ({
        key: c.value,
        cells: [c.label, fmt.int(c.count), fmt.pct(c.pct, 1)],
      }))}
    />
  );
}

function MeanLine({
  stats,
  fmt,
  scaleMax,
}: {
  stats: QuestionStats | QuestionStatsCore;
  fmt: StatFormat;
  scaleMax?: number;
}) {
  const t = useTranslations("analytics.questions");
  const d = stats.describe;
  if (!d || d.mean === null) return null;
  const ci = "ci" in stats ? stats.ci : undefined;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>
        {t("mean")}:{" "}
        <span className="font-semibold text-foreground">
          <Num>
            {fmt.num(d.mean)}
            {scaleMax ? ` / ${fmt.num(scaleMax, 0)}` : ""}
          </Num>
        </span>
        {ci?.suitable && ci.low !== null ? (
          <span className="text-xs">
            {" "}
            ({t("ci95")} <Num>{`${fmt.num(ci.low)}–${fmt.num(ci.high)}`}</Num>)
          </span>
        ) : null}
      </span>
      {stats.top_box?.estimate != null ? (
        <span>
          {t("topBox")}:{" "}
          <span className="font-semibold text-foreground">{fmt.share(stats.top_box.estimate, 0)}</span>
        </span>
      ) : null}
    </p>
  );
}

// -------------------------------------------------------------------- body
/** NPS headline, 95% interval and the detractor / passive / promoter split (also used by the CX page). */
export function NpsBlock({
  nps,
  fmt,
  compact,
}: {
  nps: Omit<NonNullable<QuestionStats["nps"]>, "reason">;
  fmt: StatFormat;
  compact?: boolean;
}) {
  const t = useTranslations("analytics.questions.nps");
  const segments: Segment[] = [
    {
      key: "detractors",
      label: t("detractors"),
      pct: nps.detractors ?? 0,
      count: 0,
      color: "var(--viz-neg-2)",
    },
    { key: "passives", label: t("passives"), pct: nps.passives ?? 0, count: 0, color: "var(--viz-mid)" },
    { key: "promoters", label: t("promoters"), pct: nps.promoters ?? 0, count: 0, color: "var(--viz-pos-2)" },
  ].map((s) => ({ ...s, count: Math.round((s.pct / 100) * nps.n) }));
  return (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={compact ? "text-lg font-semibold" : "text-3xl font-semibold"}>
          <Num>{fmt.signed(nps.score, 0)}</Num>
        </span>
        <span className="text-xs text-muted-foreground">
          {t("score")}
          {nps.ci_low !== null ? (
            <>
              {" · "}
              {t("ci")} <Num>{`${fmt.signed(nps.ci_low, 0)} … ${fmt.signed(nps.ci_high, 0)}`}</Num>
            </>
          ) : null}
          {!nps.suitable ? ` · ${t("small")}` : ""}
        </span>
      </p>
      <StackedBar segments={segments} label={t("score")} formatPct={(v) => fmt.pct(v, 0)} />
      {compact ? null : (
        <Legend
          items={segments.map((s) => ({
            key: s.key,
            label: `${s.label} ${fmt.pct(s.pct, 0)}`,
            color: s.color,
          }))}
        />
      )}
    </div>
  );
}

function QuestionBody({ q, fmt, canReadText }: { q: QuestionStats; fmt: StatFormat; canReadText: boolean }) {
  const t = useTranslations("analytics.questions");
  const k = q.distribution?.categories.length ?? 0;
  const colors = q.distribution ? scaleColors(q.type, k) : null;

  if (q.type === "NPS" && q.nps) return <NpsBlock nps={q.nps} fmt={fmt} />;

  if (q.type === "MATRIX" && q.rows?.length) {
    const first = q.rows[0]!.distribution;
    const mColors = scaleColors("MATRIX", first.categories.length);
    return (
      <div className="grid gap-4">
        {mColors ? (
          <Legend
            items={first.categories.map((c, i) => ({ key: c.value, label: c.label, color: mColors[i]! }))}
          />
        ) : null}
        <ul className="grid gap-4">
          {q.rows.map((r) => (
            <li key={r.key} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="min-w-0 text-pretty">{r.text}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t("mean")} <Num className="font-medium text-foreground">{fmt.num(r.describe.mean)}</Num>
                </span>
              </div>
              {mColors ? (
                <StackedBar
                  segments={segmentsOf(r.distribution, mColors)}
                  label={r.text}
                  title={r.text}
                  formatPct={(v) => fmt.pct(v, 0)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (colors && q.distribution) {
    return (
      <div className="grid gap-3">
        <MeanLine stats={q} fmt={fmt} />
        <StackedBar
          segments={segmentsOf(q.distribution, colors)}
          label={q.text}
          formatPct={(v) => fmt.pct(v, 0)}
        />
        <Legend
          items={q.distribution.categories.map((c, i) => ({
            key: c.value,
            label: c.label,
            color: colors[i]!,
          }))}
        />
      </div>
    );
  }

  if (q.type === "MULTIPLE_CHOICE" && q.options) {
    return (
      <div className="grid gap-3">
        <BarList
          max={100}
          rows={q.options.map((o) => ({
            key: o.value,
            label: o.label,
            value: o.pct,
            display: fmt.pct(o.pct, 0),
            tip: [
              { key: "count", label: t("respondents"), value: fmt.int(o.count) },
              ...(o.ci.low !== null
                ? [
                    {
                      key: "ci",
                      label: t("ci95"),
                      value: `${fmt.share(o.ci.low, 0)}–${fmt.share(o.ci.high, 0)}`,
                    },
                  ]
                : []),
            ],
          }))}
        />
        <p className="text-xs text-muted-foreground">{t("multiNote")}</p>
      </div>
    );
  }

  if (q.type === "RANKING" && q.ranking) {
    return (
      <div className="grid gap-3">
        <BarList
          max={100}
          rows={q.ranking.map((r) => ({
            key: r.value,
            label: r.label,
            value: r.first_pct,
            display: fmt.pct(r.first_pct, 0),
            tip: [{ key: "rank", label: t("meanRank"), value: fmt.num(r.mean_rank) }],
          }))}
        />
        <p className="text-xs text-muted-foreground">{t("rankingNote")}</p>
      </div>
    );
  }

  if (TEXT.has(q.type)) {
    return (
      <div className="grid gap-3">
        <p className="flex items-center gap-2 text-sm">
          <MessageSquareTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("textCount", { count: q.text_count ?? 0 })}
        </p>
        {q.text_samples?.length ? (
          <ul className="grid gap-2">
            {q.text_samples.map((s, i) => (
              <li key={i} className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-pretty">
                {s}
              </li>
            ))}
          </ul>
        ) : !canReadText && (q.text_count ?? 0) > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockIcon className="size-3.5" aria-hidden="true" />
            {t("textLocked")}
          </p>
        ) : null}
      </div>
    );
  }

  // Choices, long scales (0–10), dates: one series, one color, defined order.
  const describe = q.describe;
  return (
    <div className="grid gap-3">
      {describe && describe.mean !== null ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {[
            { key: "mean", value: fmt.num(describe.mean) },
            { key: "median", value: fmt.num(describe.median) },
            { key: "sd", value: fmt.num(describe.sd) },
            { key: "range", value: `${fmt.num(describe.min, 0)}–${fmt.num(describe.max, 0)}` },
          ].map((s) => (
            <div key={s.key} className="grid">
              <dt className="text-xs text-muted-foreground">{t(s.key)}</dt>
              <dd className="font-semibold">
                <Num>{s.value}</Num>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {q.distribution?.categories.length ? (
        <BarList
          max={100}
          rows={q.distribution.categories.map((c) => ({
            key: c.value,
            label: c.label,
            value: c.pct,
            display: fmt.pct(c.pct, 0),
            tip: [{ key: "count", label: t("respondents"), value: fmt.int(c.count) }],
          }))}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ table twin
function questionTable(
  q: QuestionStats,
  fmt: StatFormat,
  t: (k: string) => string,
): React.ReactNode | undefined {
  if (q.type === "MATRIX" && q.rows?.length) {
    const cats = q.rows[0]!.distribution.categories;
    return (
      <DataTable
        caption={q.text}
        head={[t("row"), t("mean"), ...cats.map((c) => c.label)]}
        rows={q.rows.map((r) => ({
          key: r.key,
          cells: [
            r.text,
            fmt.num(r.describe.mean),
            ...r.distribution.categories.map((c) => fmt.pct(c.pct, 1)),
          ],
        }))}
      />
    );
  }
  if (q.type === "NPS" && q.nps) {
    return (
      <DataTable
        caption={q.text}
        head={[t("category"), t("percent")]}
        rows={[
          { key: "score", cells: [t("nps.score"), fmt.signed(q.nps.score, 0)] },
          { key: "promoters", cells: [t("nps.promoters"), fmt.pct(q.nps.promoters, 1)] },
          { key: "passives", cells: [t("nps.passives"), fmt.pct(q.nps.passives, 1)] },
          { key: "detractors", cells: [t("nps.detractors"), fmt.pct(q.nps.detractors, 1)] },
        ]}
      />
    );
  }
  if (q.type === "MULTIPLE_CHOICE" && q.options) {
    return (
      <DataTable
        caption={q.text}
        head={[t("category"), t("count"), t("percent"), t("ci95")]}
        rows={q.options.map((o) => ({
          key: o.value,
          cells: [
            o.label,
            fmt.int(o.count),
            fmt.pct(o.pct, 1),
            o.ci.low !== null ? `${fmt.share(o.ci.low, 0)}–${fmt.share(o.ci.high, 0)}` : "—",
          ],
        }))}
      />
    );
  }
  if (q.type === "RANKING" && q.ranking) {
    return (
      <DataTable
        caption={q.text}
        head={[t("category"), t("meanRank"), t("firstChoice")]}
        rows={q.ranking.map((r) => ({
          key: r.value,
          cells: [r.label, fmt.num(r.mean_rank), fmt.pct(r.first_pct, 1)],
        }))}
      />
    );
  }
  if (q.distribution?.categories.length) return distributionTable(q.distribution, q.text, fmt, t);
  return undefined;
}

// -------------------------------------------------------------------- segments
function SegmentBreakdown({
  q,
  fmt,
  segmentLabel,
  k,
}: {
  q: QuestionStats;
  fmt: StatFormat;
  segmentLabel: string;
  k: number;
}) {
  const t = useTranslations("analytics.questions");
  const valueLabel = useSegmentValueLabel();
  const segs = (q.segments ?? []).map((s) => ({ ...s, label: valueLabel(q.segment, s.value, s.label) }));
  if (!segs.length) return null;
  const firstStats = segs.find((s) => s.stats)?.stats;
  const dist = firstStats?.distribution;
  const colors = dist ? scaleColors(q.type, dist.categories.length) : null;

  let body: React.ReactNode;
  if (q.type === "NPS") {
    body = (
      <ul className="grid gap-3">
        {segs.map((s) => (
          <li key={s.value} className="grid gap-1">
            <SegmentHead label={s.label} n={s.n} />
            {s.stats?.nps ? <NpsBlock nps={s.stats.nps} fmt={fmt} compact /> : <MaskedNote n={s.n} k={k} />}
          </li>
        ))}
      </ul>
    );
  } else if (colors && dist) {
    body = (
      <ul className="grid gap-3">
        {segs.map((s) => (
          <li key={s.value} className="grid gap-1">
            <SegmentHead label={s.label} n={s.n} mean={s.stats?.describe?.mean ?? null} fmt={fmt} />
            {s.stats?.distribution ? (
              <StackedBar
                segments={segmentsOf(s.stats.distribution, colors)}
                label={`${s.label}`}
                title={s.label}
                formatPct={(v) => fmt.pct(v, 0)}
              />
            ) : (
              <MaskedNote n={s.n} k={k} />
            )}
          </li>
        ))}
      </ul>
    );
  } else if ((CHOICE.has(q.type) && dist) || q.type === "MULTIPLE_CHOICE") {
    const cats =
      q.type === "MULTIPLE_CHOICE"
        ? (firstStats?.options ?? []).map((o) => ({ value: o.value, label: o.label }))
        : (dist?.categories ?? []).map((c) => ({ value: c.value, label: c.label }));
    body = (
      <div className="min-w-0 overflow-x-auto">
        <DataTable
          caption={`${q.text} — ${segmentLabel}`}
          head={[segmentLabel, "n", ...cats.map((c) => c.label)]}
          rows={segs.map((s) => ({
            key: s.value,
            cells: [
              s.label,
              fmt.int(s.n),
              ...cats.map((c) => {
                if (!s.stats) return "—";
                const pct =
                  q.type === "MULTIPLE_CHOICE"
                    ? s.stats.options?.find((o) => o.value === c.value)?.pct
                    : s.stats.distribution?.categories.find((x) => x.value === c.value)?.pct;
                return fmt.pct(pct ?? 0, 0);
              }),
            ],
          }))}
        />
      </div>
    );
  } else if (q.type === "MATRIX") {
    const rows = firstStats?.rows ?? [];
    body = (
      <div className="min-w-0 overflow-x-auto">
        <DataTable
          caption={`${q.text} — ${segmentLabel}`}
          head={[segmentLabel, "n", ...rows.map((r) => r.text)]}
          rows={segs.map((s) => ({
            key: s.value,
            cells: [
              s.label,
              fmt.int(s.n),
              ...rows.map((r) => fmt.num(s.stats?.rows?.find((x) => x.key === r.key)?.describe.mean ?? null)),
            ],
          }))}
        />
      </div>
    );
  } else if (firstStats?.describe) {
    body = (
      <div className="min-w-0 overflow-x-auto">
        <DataTable
          caption={`${q.text} — ${segmentLabel}`}
          head={[segmentLabel, "n", t("mean"), t("median"), t("sd")]}
          rows={segs.map((s) => ({
            key: s.value,
            cells: [
              s.label,
              fmt.int(s.n),
              fmt.num(s.stats?.describe?.mean ?? null),
              fmt.num(s.stats?.describe?.median ?? null),
              fmt.num(s.stats?.describe?.sd ?? null),
            ],
          }))}
        />
      </div>
    );
  } else {
    return null;
  }

  return (
    <div className="grid gap-3 border-t pt-4">
      <p className="text-sm font-medium">{t("bySegment", { segment: segmentLabel })}</p>
      {body}
      {segs.some((s) => s.masked) ? (
        <p className="text-xs text-muted-foreground">{t("segmentsMasked", { k })}</p>
      ) : null}
    </div>
  );
}

function SegmentHead({
  label: name,
  n,
  mean,
  fmt,
}: {
  label: string;
  n: number;
  mean?: number | null;
  fmt?: StatFormat;
}) {
  const t = useTranslations("analytics.questions");
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span className="min-w-0 text-pretty">
        {name} <span className="text-xs text-muted-foreground">(n={n})</span>
      </span>
      {mean !== undefined && mean !== null && fmt ? (
        <span className="shrink-0 text-muted-foreground">
          {t("mean")} <Num className="font-medium text-foreground">{fmt.num(mean)}</Num>
        </span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------ card
export function QuestionCard({
  q,
  canReadText,
  segmentLabel,
  k,
  busy,
  projectId,
  textAnalysis,
  canAnalyze = false,
}: {
  q: QuestionStats;
  canReadText: boolean;
  segmentLabel: string | null;
  k: number;
  busy?: boolean;
  projectId?: string;
  textAnalysis?: TextQuestionAnalysis;
  canAnalyze?: boolean;
}) {
  const t = useTranslations("analytics.questions");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  const table = q.masked ? undefined : questionTable(q, fmt, t);
  return (
    <ChartCard
      busy={busy}
      headingLevel={4}
      title={q.text}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="soft">{label(QUESTION_TYPE_LABELS, q.type, locale)}</Badge>
          {q.is_profile ? <Badge variant="outline">{t("profile")}</Badge> : null}
          <span className="text-xs">{t("answered", { count: q.n })}</span>
        </span>
      }
      table={table}
    >
      {q.masked ? (
        <MaskedNote n={q.n} k={k} />
      ) : q.n === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noAnswers")}</p>
      ) : (
        <div className="grid gap-4">
          <QuestionBody q={q} fmt={fmt} canReadText={canReadText} />
          {projectId && (q.type === "SHORT_TEXT" || q.type === "LONG_TEXT") ? (
            <TextAnalysisPanel projectId={projectId} analysis={textAnalysis} canAnalyze={canAnalyze} />
          ) : null}
          {segmentLabel && q.segments ? (
            <SegmentBreakdown q={q} fmt={fmt} segmentLabel={segmentLabel} k={k} />
          ) : null}
        </div>
      )}
    </ChartCard>
  );
}
