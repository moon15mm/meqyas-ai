"use client";

import type { AnalyticsSummary, QuestionStats } from "@meqyas/shared";
import { Skeleton } from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { analyticsApi, intelligenceApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";

import { genericText } from "./format";
import { waveName } from "./overview";
import { QuestionCard } from "./question-card";
import { useSegmentOptions } from "./segments";
import { selectClass } from "./viz";

type Locale = "ar" | "en";

export function QuestionsView({
  projectId,
  summary,
  includeFlagged,
  canReadText,
}: {
  projectId: string;
  summary: AnalyticsSummary;
  includeFlagged: boolean;
  canReadText: boolean;
}) {
  const t = useTranslations("analytics.questions");
  const tf = useTranslations("analytics.filters");
  const locale = useLocale() as Locale;
  const [wave, setWave] = React.useState("");
  const [segment, setSegment] = React.useState("");

  const page = useQuery({
    queryKey: ["analytics", projectId, "questions", { wave, segment, includeFlagged }],
    queryFn: () =>
      analyticsApi.questions(projectId, {
        wave: wave || undefined,
        segment: segment || undefined,
        include_flagged: includeFlagged,
      }),
    placeholderData: keepPreviousData,
  });
  const questions = React.useMemo(
    () =>
      (page.data?.questions ?? []).map((q) => ({
        ...q,
        text: genericText(q.text, locale),
        rows: q.rows?.map((r) => ({ ...r, text: genericText(r.text, locale) })),
      })),
    [page.data, locale],
  );
  const options = useSegmentOptions(questions, { store: (summary.channels?.STORE ?? 0) > 0 });
  const can = useCan();
  const text = useQuery({
    queryKey: ["text-analysis", projectId],
    queryFn: () => intelligenceApi.textAnalysis(projectId),
  });
  const textByKey = React.useMemo(
    () => new Map((text.data ?? []).map((a) => [a.question_key, a])),
    [text.data],
  );
  const segmentLabel =
    [...options.questions, ...options.meta].find((o) => o.value === segment)?.label ?? null;

  const sections = React.useMemo(() => {
    const out = new Map<string, QuestionStats[]>();
    for (const q of questions) {
      const list = out.get(q.section) ?? [];
      list.push(q);
      out.set(q.section, list);
    }
    return [...out.entries()];
  }, [questions]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{tf("wave")}</span>
          <select className={selectClass} value={wave} onChange={(e) => setWave(e.target.value)}>
            <option value="">{tf("allWaves")}</option>
            {summary.waves.map((w) => (
              <option key={w.wave} value={w.wave}>
                {waveName(w.wave, locale)} ({w.n})
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          <span className="text-muted-foreground">{tf("breakdown")}</span>
          <select
            className={`${selectClass} max-w-80`}
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
          >
            <option value="">{tf("noBreakdown")}</option>
            {options.questions.length ? (
              <optgroup label={tf("byQuestion")}>
                {options.questions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label={tf("byResponse")}>
              {options.meta.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {page.data ? (
          <p className="pb-2 text-sm text-muted-foreground">{t("basedOn", { count: page.data.n })}</p>
        ) : null}
      </div>

      {page.isLoading || !page.data ? (
        <div className="grid gap-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : !page.data.questions.length ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        sections.map(([section, questions]) => (
          <section key={section || "_"} className="grid gap-3" aria-label={section || t("untitledSection")}>
            {section ? <h3 className="text-sm font-semibold text-muted-foreground">{section}</h3> : null}
            <div className="grid gap-4 xl:grid-cols-2">
              {questions.map((q) => (
                <QuestionCard
                  key={q.key}
                  q={q}
                  canReadText={canReadText}
                  segmentLabel={segment ? segmentLabel : null}
                  k={summary.k_anonymity}
                  busy={page.isFetching}
                  projectId={projectId}
                  textAnalysis={textByKey.get(q.key)}
                  canAnalyze={can.analyze}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
