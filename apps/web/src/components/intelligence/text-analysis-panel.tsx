"use client";

import type { SentimentLabel, TextQuestionAnalysis } from "@meqyas/shared";
import { Badge, Button } from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useStatFormat } from "@/components/analytics/format";
import { BarList, Legend, StackedBar } from "@/components/analytics/viz";
import { intelligenceApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";

/** Negative → positive reading order; mixed answers carry criticism, so they sit on the negative side. */
const SENTIMENT_ORDER: SentimentLabel[] = ["NEGATIVE", "MIXED", "NEUTRAL", "POSITIVE"];
const SENTIMENT_COLOR: Record<SentimentLabel, string> = {
  NEGATIVE: "var(--viz-neg-2)",
  MIXED: "var(--viz-neg-1)",
  NEUTRAL: "var(--viz-mid)",
  POSITIVE: "var(--viz-pos-2)",
};
const CATEGORY_VARIANT = {
  PAIN_POINT: "destructive",
  STRENGTH: "success",
  SUGGESTION: "soft",
  TOPIC: "outline",
} as const;

export function TextAnalysisPanel({
  projectId,
  analysis,
  canAnalyze,
}: {
  projectId: string;
  analysis: TextQuestionAnalysis | undefined;
  canAnalyze: boolean;
}) {
  const t = useTranslations("intelligence.text");
  const fmt = useStatFormat();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  // Without the AI analysis module the keywords are still computed (no sentiment or themes).
  const aiAllowed = useFeature("ai_analysis");
  const run = useMutation({
    mutationFn: () => intelligenceApi.analyzeText(projectId, analysis!.question_key, aiAllowed),
    onSuccess: (fresh) => {
      queryClient.setQueryData<TextQuestionAnalysis[]>(["text-analysis", projectId], (prev) =>
        (prev ?? []).map((a) => (a.question_key === fresh.question_key ? fresh : a)),
      );
      const failed = Object.values(fresh.parts).find((p) => p && p.ok === false);
      if (failed) toast.warning(t("partial", { error: failed.error ?? "" }));
      else toast.success(t("done"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (!analysis || analysis.answers === 0) return null;
  if (analysis.masked) return <p className="text-xs text-muted-foreground">{t("masked")}</p>;

  const s = analysis.sentiment;
  const segments = s
    ? SENTIMENT_ORDER.map((label) => ({
        key: label,
        label: t(`sentiment.${label}`),
        pct: s.pct[label] ?? 0,
        count: s.counts[label] ?? 0,
        color: SENTIMENT_COLOR[label],
      }))
    : [];

  return (
    <div className="grid gap-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("title")}</p>
        {canAnalyze ? (
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            <SparklesIcon aria-hidden="true" />
            {run.isPending ? t("running") : analysis.analyzed_at ? t("rerun") : t("run")}
          </Button>
        ) : null}
      </div>

      {s ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t("sentimentTitle", { count: s.rated })}</p>
          <StackedBar
            segments={segments}
            label={t("sentimentTitle", { count: s.rated })}
            formatPct={(v) => fmt.pct(v, 0)}
          />
          <Legend
            items={segments.map((x) => ({
              key: x.key,
              label: `${x.label} ${fmt.pct(x.pct, 0)}`,
              color: x.color,
            }))}
          />
        </div>
      ) : null}

      {analysis.themes.length ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t("themesTitle")}</p>
          <BarList
            max={100}
            rows={analysis.themes.map((th) => ({
              key: th.key,
              label: th.name,
              value: th.share,
              display: `${fmt.pct(th.share, 0)} (${th.count})`,
              note: th.description,
              tip: [{ key: "n", label: t("mentions"), value: String(th.count) }],
            }))}
          />
          <ul className="grid gap-2">
            {analysis.themes.map((th) => (
              <li key={th.key} className="grid gap-1 text-xs">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={CATEGORY_VARIANT[th.category]}>{t(`category.${th.category}`)}</Badge>
                  <span className="font-medium text-foreground">{th.name}</span>
                  <span className="text-muted-foreground">— {th.description}</span>
                </span>
                {th.samples?.length ? (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer">{t("samples")}</summary>
                    <ul className="mt-1 grid gap-1">
                      {th.samples.map((x, i) => (
                        <li key={i} className="rounded-lg bg-muted/50 px-2 py-1 text-pretty">
                          {x}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.keywords.length ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t("keywordsTitle")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {analysis.keywords.slice(0, 12).map((k) => (
              <li key={k.term} className="rounded-full border px-2 py-0.5 text-xs">
                {k.term} <span className="text-muted-foreground">({k.answers})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!analysis.analyzed_at ? <p className="text-xs text-muted-foreground">{t("notYet")}</p> : null}
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
