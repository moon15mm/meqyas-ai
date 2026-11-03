"use client";

import type { AnalyticsSummary, ComparisonResult, StatsTest } from "@meqyas/shared";
import { Alert, AlertDescription, Button, Skeleton } from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeftRightIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { analyticsApi } from "@/lib/api/endpoints";

import { genericText, Num, useStatFormat, type StatFormat } from "./format";
import { useWaveColors, waveName } from "./overview";
import { ChartCard, DataTable, Legend, MaskedNote, Mark, selectClass, TipRows } from "./viz";

type Locale = "ar" | "en";
type Row = ComparisonResult & { id: string; name: string };

function significance(test: StatsTest, t: (key: string) => string): string {
  if (!test.suitable || test.p_value === null) return "";
  return test.p_value < 0.05 ? t("significant") : t("notSignificant");
}

export function ComparisonView({
  projectId,
  summary,
  includeFlagged,
}: {
  projectId: string;
  summary: AnalyticsSummary;
  includeFlagged: boolean;
}) {
  const t = useTranslations("analytics.compare");
  const tf = useTranslations("analytics.filters");
  const tc = useTranslations("analytics.causality");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  const waves = React.useMemo(() => summary.waves.map((w) => w.wave), [summary.waves]);
  const colors = useWaveColors(waves);
  const [fromChoice, setFrom] = React.useState("");
  const [toChoice, setTo] = React.useState("");
  const [showItems, setShowItems] = React.useState(false);
  // Defaults: first vs latest wave; a choice that no longer exists falls back to them.
  const from = waves.includes(fromChoice) ? fromChoice : (waves[0] ?? "");
  const to =
    waves.includes(toChoice) && toChoice !== from ? toChoice : (waves.findLast((w) => w !== from) ?? "");

  const ready = waves.length >= 2 && from !== to;
  const compare = useQuery({
    queryKey: ["analytics", projectId, "compare", { from, to, includeFlagged }],
    queryFn: () => analyticsApi.compare(projectId, from, to, includeFlagged),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  if (waves.length < 2) {
    return (
      <div className="grid place-items-center gap-2 rounded-2xl border bg-card p-10 text-center">
        <ArrowLeftRightIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t("needTwoWaves")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("needTwoWavesHint")}</p>
      </div>
    );
  }

  const data = compare.data;
  const rows: Row[] = (data?.dimensions ?? []).map((d) => ({ ...d, id: d.dimension_id, name: d.name }));
  const items: Row[] = (data?.questions ?? []).map((q) => ({
    ...q,
    id: q.key,
    name: genericText(q.text, locale),
  }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{tf("from")}</span>
          <select className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)}>
            {waves.map((w) => (
              <option key={w} value={w} disabled={w === to}>
                {waveName(w, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{tf("to")}</span>
          <select className={selectClass} value={to} onChange={(e) => setTo(e.target.value)}>
            {waves.map((w) => (
              <option key={w} value={w} disabled={w === from}>
                {waveName(w, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data?.causality ? (
        <Alert variant="evidence">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="col-start-2 text-foreground">{tc(data.causality)}</AlertDescription>
        </Alert>
      ) : null}

      {compare.isLoading || !data ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : !rows.length ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">{t("noDimensions")}</p>
      ) : (
        <ChartCard
          title={t("title", { from: waveName(data.from_wave, locale), to: waveName(data.to_wave, locale) })}
          description={t("description")}
          busy={compare.isFetching}
          table={
            <ComparisonTable
              rows={rows}
              fmt={fmt}
              caption={t("title", {
                from: waveName(data.from_wave, locale),
                to: waveName(data.to_wave, locale),
              })}
            />
          }
        >
          <div className="grid gap-4">
            <Legend
              shape="dot"
              items={[
                { key: "from", label: waveName(data.from_wave, locale), color: colors[data.from_wave]! },
                { key: "to", label: waveName(data.to_wave, locale), color: colors[data.to_wave]! },
              ]}
            />
            <ul className="grid gap-5">
              {rows.map((r) => (
                <DumbbellRow
                  key={r.id}
                  row={r}
                  fmt={fmt}
                  fromColor={colors[data.from_wave]!}
                  toColor={colors[data.to_wave]!}
                  k={summary.k_anonymity}
                />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t("methodNote")}</p>
          </div>
        </ChartCard>
      )}

      {items.length ? (
        <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="item-compare">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <h3 id="item-compare" className="font-semibold">
                {t("itemsTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("itemsDescription", { count: items.length })}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showItems}
              onClick={() => setShowItems((v) => !v)}
            >
              {showItems ? t("hideItems") : t("showItems")}
            </Button>
          </div>
          {showItems ? (
            <div className="min-w-0 overflow-x-auto">
              <ComparisonTable rows={items} fmt={fmt} caption={t("itemsTitle")} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function DumbbellRow({
  row,
  fmt,
  fromColor,
  toColor,
  k,
}: {
  row: Row;
  fmt: StatFormat;
  fromColor: string;
  toColor: string;
  k: number;
}) {
  const t = useTranslations("analytics.compare");
  const span = row.scale_max - row.scale_min || 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - row.scale_min) / span) * 100));
  const test = row.test;
  const digits = row.scale === "native" ? 2 : 1;
  if (row.masked || row.from_mean === null || row.to_mean === null) {
    return (
      <li className="grid gap-1.5">
        <span className="font-medium text-pretty">{row.name}</span>
        <MaskedNote n={Math.min(row.n_from, row.n_to)} k={k} />
      </li>
    );
  }
  const a = pos(row.from_mean);
  const b = pos(row.to_mean);
  const effect = test.effect_label ? t(`effectLabels.${test.effect_label}`) : "";
  const sig = significance(test, t);
  const tipRows = [
    { key: "from", label: t("fromMean"), value: fmt.num(row.from_mean, digits), color: fromColor },
    { key: "to", label: t("toMean"), value: fmt.num(row.to_mean, digits), color: toColor },
    { key: "change", label: t("change"), value: fmt.signed(row.change.absolute, digits) },
    ...(test.suitable
      ? [
          { key: "p", label: t("p"), value: fmt.p(test.p_value) },
          { key: "d", label: t("effect"), value: `${fmt.num(test.effect_size)} (${effect})` },
        ]
      : []),
    {
      key: "n",
      label: row.paired ? t("pairs") : t("groups"),
      value: row.paired ? fmt.int(row.n_pairs) : `${row.n_from} / ${row.n_to}`,
    },
  ];
  return (
    <li className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium text-pretty">{row.name}</span>
        <span className="text-sm">
          <Num className="font-semibold">{fmt.signed(row.change.absolute, digits)}</Num>
          {test.suitable ? (
            <span className="text-xs text-muted-foreground">
              {" "}
              · {effect} · {sig}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {" "}
              · {t(`reasons.${test.reason ?? "n_too_small"}`)}
            </span>
          )}
        </span>
      </div>
      <Mark
        label={`${row.name}: ${tipRows.map((r) => `${r.label} ${r.value}`).join("، ")}`}
        tip={<TipRows title={row.name} rows={tipRows} />}
      >
        <div className="relative h-6">
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/60"
            style={{ insetInlineStart: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
          />
          {[
            { key: "from", at: a, color: fromColor },
            { key: "to", at: b, color: toColor },
          ].map((dot) => (
            <span
              key={dot.key}
              aria-hidden="true"
              className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-transform group-hover/mark:scale-110"
              style={{
                insetInlineStart: `calc(${dot.at}% - 6px)`,
                background: dot.color,
                boxShadow: "0 0 0 2px var(--card)",
              }}
            />
          ))}
        </div>
      </Mark>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>{fmt.num(row.scale_min, 0)}</span>
        <span>{fmt.num(row.scale_max, 0)}</span>
      </div>
    </li>
  );
}

function ComparisonTable({ rows, fmt, caption }: { rows: Row[]; fmt: StatFormat; caption: string }) {
  const t = useTranslations("analytics.compare");
  return (
    <DataTable
      caption={caption}
      head={[
        t("item"),
        t("fromMean"),
        t("toMean"),
        t("change"),
        t("test"),
        t("p"),
        t("effect"),
        t("ciDiff"),
        "n",
      ]}
      rows={rows.map((r) => {
        const digits = r.scale === "native" ? 2 : 1;
        const test = r.test;
        return {
          key: r.id,
          cells: [
            <span key="name" className="line-clamp-2">
              {r.name}
            </span>,
            fmt.num(r.from_mean, digits),
            fmt.num(r.to_mean, digits),
            <Num key="change">{fmt.signed(r.change.absolute, digits)}</Num>,
            r.masked
              ? t("maskedShort")
              : test.suitable
                ? t(test.test === "paired_t" ? "pairedT" : "welchT")
                : t(`reasons.${test.reason ?? "n_too_small"}`),
            <Num key="p">{test.suitable ? fmt.p(test.p_value) : "—"}</Num>,
            test.suitable && test.effect_size !== null ? (
              <span key="d">
                <Num>{fmt.num(test.effect_size)}</Num>{" "}
                <span className="text-xs text-muted-foreground">
                  ({t(`effectLabels.${test.effect_label ?? "negligible"}`)})
                </span>
              </span>
            ) : (
              "—"
            ),
            test.suitable && test.ci_low !== null ? (
              <Num key="ci">
                {fmt.signed(test.ci_low, digits)} … {fmt.signed(test.ci_high, digits)}
              </Num>
            ) : (
              "—"
            ),
            r.paired ? `${r.n_pairs} ${t("pairsShort")}` : `${r.n_from} / ${r.n_to}`,
          ],
        };
      })}
    />
  );
}
