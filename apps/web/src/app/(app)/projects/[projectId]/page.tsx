"use client";

import { Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  LayersIcon,
  ListChecksIcon,
  RulerIcon,
  WavesIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { DesignFlow } from "@/components/measurement/design-flow";
import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { surveyApi } from "@/lib/api/endpoints";

export default function ProjectOverviewPage() {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const arrow = useLocale() === "ar" ? "←" : "→";
  const projectId = useProjectId();
  const overview = useProjectOverview();
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });

  if (overview.isLoading || !overview.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }
  const { plan, counts } = overview.data;
  const stats = [
    { label: t("stats.dimensions"), value: counts.dimensions ?? 0, icon: LayersIcon },
    { label: t("stats.indicators"), value: counts.indicators ?? 0, icon: RulerIcon },
    { label: t("stats.waves"), value: counts.waves ?? 0, icon: WavesIcon },
    { label: t("stats.questions"), value: plan.recommended_questions_count ?? "—", icon: ListChecksIcon },
  ];
  const hasBaseline = plan.waves.some((w) => w.wave_type === "BASELINE");
  const live = (surveys.data ?? []).filter((s) => s.status !== "ARCHIVED");
  const hasWaveSurvey = (type: string) => live.some((s) => s.wave_type === type);
  const surveysHref = `/projects/${projectId}/surveys`;
  const steps: Array<{ label: string; done: boolean; phase: number | null; href?: string }> = [
    { label: t("steps.plan"), done: plan.status === "ACCEPTED" || counts.dimensions > 0, phase: null },
    ...(hasBaseline
      ? [
          {
            label: t("steps.baselineSurvey"),
            done: hasWaveSurvey("BASELINE"),
            phase: null,
            href: surveysHref,
          },
          { label: t("steps.postSurvey"), done: hasWaveSurvey("POST"), phase: null, href: surveysHref },
        ]
      : [{ label: t("steps.survey"), done: live.length > 0, phase: null, href: surveysHref }]),
    { label: t("steps.publish"), done: (counts.published_surveys ?? 0) > 0, phase: null, href: surveysHref },
    { label: t("steps.analyze"), done: false, phase: 5 },
    { label: t("steps.report"), done: false, phase: 7 },
  ];
  const chain = [
    "goal",
    "objectives",
    "dimensions",
    "indicators",
    "questions",
    "responses",
    "insights",
    "recommendations",
  ] as const;
  const chainDone = new Set<string>(["goal", "objectives", "dimensions", "indicators"]);
  if (live.some((s) => s.question_count > 0)) chainDone.add("questions");

  return (
    <div className="grid gap-6">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <li key={s.label} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <s.icon className="size-5" aria-hidden="true" />
            </span>
            <span className="grid">
              <span className="text-2xl font-bold tabular-nums">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-6">
          {plan.goal ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("goal")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <p className="leading-relaxed">{plan.goal.statement}</p>
                {plan.understanding_summary ? (
                  <p className="text-sm text-muted-foreground">{plan.understanding_summary}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("chain")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-wrap items-center gap-2 text-sm">
                {chain.map((step, i) => (
                  <li key={step} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1",
                        chainDone.has(step)
                          ? "border-primary/30 bg-primary/8 font-medium text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {t(`chainSteps.${step}`)}
                    </span>
                    {i < chain.length - 1 ? (
                      <span className="text-muted-foreground" aria-hidden="true">
                        {arrow}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("nextSteps")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2">
                {steps.map((step) => (
                  <li
                    key={step.label}
                    className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
                  >
                    {step.done ? (
                      <CheckCircle2Icon className="size-5 text-success" aria-hidden="true" />
                    ) : (
                      <CircleDashedIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                    )}
                    {step.href && !step.done ? (
                      <Link href={step.href} className="flex-1 hover:underline">
                        {step.label}
                      </Link>
                    ) : (
                      <span className={cn("flex-1", step.done && "font-medium")}>{step.label}</span>
                    )}
                    {!step.done && step.phase ? (
                      <span className="text-xs text-muted-foreground">{tc("phase", { n: step.phase })}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("timeline")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DesignFlow
                design={plan.recommended_design}
                evidence={plan.evidence_level}
                waves={plan.waves}
                compact
              />
            </CardContent>
          </Card>
          {plan.source_prompt ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{t("sourceRequest")}</CardTitle>
              </CardHeader>
              <CardContent>
                <blockquote className="border-s-2 border-primary/30 ps-3 text-sm">
                  «{plan.source_prompt}»
                </blockquote>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
