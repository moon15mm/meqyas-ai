"use client";

import type { AnalyticsSummary } from "@meqyas/shared";
import { Skeleton } from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Grid3x3Icon, ShieldIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { analyticsApi } from "@/lib/api/endpoints";

import { genericText, Num, useStatFormat } from "./format";
import { waveName } from "./overview";
import { useSegmentOptions, useSegmentValueLabel } from "./segments";
import { selectClass } from "./viz";

type Locale = "ar" | "en";

function strength(v: number): "negligible" | "weak" | "moderate" | "strong" {
  return v < 0.1 ? "negligible" : v < 0.3 ? "weak" : v < 0.5 ? "moderate" : "strong";
}

export function CrosstabView({
  projectId,
  summary,
  includeFlagged,
}: {
  projectId: string;
  summary: AnalyticsSummary;
  includeFlagged: boolean;
}) {
  const t = useTranslations("analytics.crosstab");
  const tf = useTranslations("analytics.filters");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  const questions = useQuery({
    queryKey: ["analytics", projectId, "questions", { wave: "", segment: "", includeFlagged }],
    queryFn: () => analyticsApi.questions(projectId, { include_flagged: includeFlagged }),
    placeholderData: keepPreviousData,
  });
  const plain = React.useMemo(
    () => questions.data?.questions.map((q) => ({ ...q, text: genericText(q.text, locale) })),
    [questions.data, locale],
  );
  const options = useSegmentOptions(plain, { store: (summary.channels?.STORE ?? 0) > 0 });
  const valueLabel = useSegmentValueLabel();
  const all = [...options.questions, ...options.meta];
  const [rowChoice, setRow] = React.useState("");
  const [colChoice, setCol] = React.useState("");
  // One wave by default: across waves the same people are counted once per wave.
  const [wave, setWave] = React.useState(() =>
    summary.waves.length > 1 ? summary.waves[summary.waves.length - 1]!.wave : "",
  );
  // Defaults: the first profile question against the first other variable.
  const row = all.some((o) => o.value === rowChoice) ? rowChoice : (options.questions[0]?.value ?? "wave");
  const col =
    all.some((o) => o.value === colChoice) && colChoice !== row
      ? colChoice
      : (all.find((o) => o.value !== row && o.value !== "device" && o.value !== "channel")?.value ?? "");

  const ct = useQuery({
    queryKey: ["analytics", projectId, "crosstab", { row, col, wave, includeFlagged }],
    queryFn: () =>
      analyticsApi.crosstab(projectId, row, col, {
        wave: wave || undefined,
        include_flagged: includeFlagged,
      }),
    enabled: Boolean(row && col && row !== col),
    placeholderData: keepPreviousData,
  });
  const labelOf = (key: string) => all.find((o) => o.value === key)?.label ?? key;
  const data = ct.data;

  const select = (id: string, value: string, onChange: (v: string) => void, exclude: string) => (
    <select
      id={id}
      className={`${selectClass} max-w-72`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.questions.length ? (
        <optgroup label={tf("byQuestion")}>
          {options.questions.map((o) => (
            <option key={o.value} value={o.value} disabled={o.value === exclude}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={tf("byResponse")}>
        {options.meta.map((o) => (
          <option key={o.value} value={o.value} disabled={o.value === exclude}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-sm" htmlFor="ct-row">
          <span className="text-muted-foreground">{tf("rows")}</span>
          {select("ct-row", row, setRow, col)}
        </label>
        <label className="grid min-w-0 gap-1 text-sm" htmlFor="ct-col">
          <span className="text-muted-foreground">{tf("columns")}</span>
          {select("ct-col", col, setCol, row)}
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{tf("wave")}</span>
          <select className={selectClass} value={wave} onChange={(e) => setWave(e.target.value)}>
            <option value="">{tf("allWaves")}</option>
            {summary.waves.map((w) => (
              <option key={w.wave} value={w.wave}>
                {waveName(w.wave, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!row || !col ? (
        <div className="grid place-items-center gap-2 rounded-2xl border bg-card p-10 text-center">
          <Grid3x3Icon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-md text-sm text-muted-foreground">{t("pickTwo")}</p>
        </div>
      ) : ct.isLoading || !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <section
          aria-labelledby="ct-title"
          aria-busy={ct.isFetching || undefined}
          className={`grid gap-4 rounded-2xl border bg-card p-4 transition-opacity sm:p-5 ${ct.isFetching ? "opacity-60" : ""}`}
        >
          <div className="grid gap-1">
            <h3 id="ct-title" className="font-semibold text-balance">
              {t("title", { row: labelOf(row), col: labelOf(col) })}
            </h3>
            <p className="text-sm text-muted-foreground">{t("description", { n: data.n })}</p>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <caption className="visually-hidden">
                {t("title", { row: labelOf(row), col: labelOf(col) })}
              </caption>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {labelOf(row)} \ {labelOf(col)}
                  </th>
                  {data.column_labels.map((c, i) => (
                    <th
                      key={data.columns[i]}
                      scope="col"
                      className="min-w-24 px-2 py-2 text-start font-medium"
                    >
                      {valueLabel(col, data.columns[i]!, c)}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    n
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.row_labels.map((r, i) => {
                  const counts = data.counts[i];
                  const pcts = data.row_percentages[i];
                  const total = counts?.reduce((a, b) => a + b, 0) ?? 0;
                  return (
                    <tr key={data.rows[i]} className="border-b last:border-0">
                      <th scope="row" className="max-w-60 py-2.5 pe-3 text-start font-normal">
                        {valueLabel(row, data.rows[i]!, r)}
                      </th>
                      {data.columns.map((c, j) =>
                        counts && pcts ? (
                          <td key={c} className="px-2 py-2.5 align-top">
                            <span className="font-medium tabular-nums">{fmt.pct(pcts[j], 0)}</span>{" "}
                            <span className="text-xs text-muted-foreground tabular-nums">({counts[j]})</span>
                            <span aria-hidden="true" className="mt-1 flex h-1.5 w-full max-w-20">
                              {pcts[j] ? (
                                <span
                                  className="block min-w-[2px] rounded-e-[3px]"
                                  style={{ width: `${pcts[j]}%`, background: "var(--viz-1)" }}
                                />
                              ) : null}
                            </span>
                          </td>
                        ) : (
                          <td key={c} className="px-2 py-2.5 text-muted-foreground">
                            —
                          </td>
                        ),
                      )}
                      <td className="px-2 py-2.5 tabular-nums">
                        {counts ? (
                          total
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <ShieldIcon className="size-3.5" aria-hidden="true" />
                            {t("maskedRow", { k: summary.k_anonymity })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("rowPercentNote")}</p>

          <div className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
            {data.suitable && data.chi2 !== null && data.cramers_v !== null ? (
              <>
                <p>
                  <Num>
                    χ²({data.df}) = {fmt.num(data.chi2)} · p = {fmt.p(data.p_value)}
                  </Num>{" "}
                  · {t("cramersV")} <Num>{fmt.num(data.cramers_v)}</Num> (
                  {t(`strength.${strength(data.cramers_v)}`)})
                </p>
                <p className="text-muted-foreground">
                  {data.p_value !== null && data.p_value < 0.05 ? t("associated") : t("notAssociated")}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                {t(`reasons.${data.reason ?? "not_enough_categories"}`)}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
