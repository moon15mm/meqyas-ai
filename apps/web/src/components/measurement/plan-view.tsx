"use client";

import {
  FREQUENCY_LABELS,
  INDICATOR_TYPE_LABELS,
  label,
  MEASUREMENT_TYPE_LABELS,
  OUTCOME_LEVEL_LABELS,
  REACTION_TYPES,
  type MeasurementPlanDraft,
} from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meqyas/ui";
import {
  AlertTriangleIcon,
  BookOpenCheckIcon,
  GaugeIcon,
  HelpCircleIcon,
  InfoIcon,
  LayersIcon,
  ListChecksIcon,
  TargetIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { DesignFlow } from "./design-flow";

/** The label already says «فهمنا أنك تريد:», so drop the same opening from the AI summary. */
export function stripUnderstandingPrefix(summary: string): string {
  const cleaned = summary.replace(
    /^\s*(فهمنا أنك تريد|فهمنا أنكِ تريدين|we understand (that )?you want( to)?)\s*[:،,]?\s*/i,
    "",
  );
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : summary;
}

/** Notes that state the limits of causal claims get the "evidence" treatment. */
function isCausalityNote(note: string): boolean {
  return /سبب|يثبت|caus|prove/i.test(note);
}

export function PlanUnderstanding({ draft, request }: { draft: MeasurementPlanDraft; request: string }) {
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-sm font-medium text-primary">{t("weUnderstood")}</p>
        <p className="text-xl leading-relaxed font-semibold text-balance sm:text-2xl">
          {stripUnderstandingPrefix(draft.understanding_summary)}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1 rounded-xl border bg-card/70 p-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GaugeIcon className="size-3.5" aria-hidden="true" />
            {t("measurementType")}
          </dt>
          <dd className="font-semibold">{label(MEASUREMENT_TYPE_LABELS, draft.measurement_type, locale)}</dd>
        </div>
        <div className="grid gap-1 rounded-xl border bg-card/70 p-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TargetIcon className="size-3.5" aria-hidden="true" />
            {t("targetPopulation")}
          </dt>
          <dd className="font-semibold">{draft.target_population}</dd>
        </div>
        <div className="grid gap-1 rounded-xl border bg-card/70 p-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ListChecksIcon className="size-3.5" aria-hidden="true" />
            {t("estimate")}
          </dt>
          <dd className="font-semibold">
            {t("estimateValue", {
              questions: tc("questions", { n: draft.recommended_questions_count }),
              minutes: tc("minutes", { n: draft.estimated_completion_minutes }),
            })}
          </dd>
        </div>
      </dl>
      <figure className="grid gap-1 border-s-2 border-primary/30 ps-3">
        <figcaption className="text-xs text-muted-foreground">{t("yourRequest")}</figcaption>
        <blockquote className="text-sm text-foreground/80">«{request}»</blockquote>
      </figure>
    </div>
  );
}

export function PlanRationale({ draft, advanced }: { draft: MeasurementPlanDraft; advanced: boolean }) {
  const t = useTranslations("plan");
  const locale = useLocale() as "ar" | "en";
  const reaction = REACTION_TYPES.has(draft.measurement_type);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircleIcon className="size-4 text-primary" aria-hidden="true" />
          {t("whyThisType")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {reaction && !draft.baseline_required ? (
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription className="text-foreground">{t("reactionNote")}</AlertDescription>
          </Alert>
        ) : null}
        <p className="leading-relaxed text-pretty">{draft.measurement_type_rationale}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t("purpose")}: </span>
          {draft.purpose}
        </p>
        {advanced ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">
              {t("outcomeLevel")}: {label(OUTCOME_LEVEL_LABELS, draft.outcome_level, locale)}
            </Badge>
            {draft.secondary_types.length ? (
              <>
                <span className="text-muted-foreground">{t("secondaryTypes")}:</span>
                {draft.secondary_types.map((s) => (
                  <Badge key={s} variant="secondary">
                    {label(MEASUREMENT_TYPE_LABELS, s, locale)}
                  </Badge>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PlanDimensions({ draft, advanced }: { draft: MeasurementPlanDraft; advanced: boolean }) {
  const t = useTranslations("plan");
  const ti = useTranslations("indicators");
  const locale = useLocale() as "ar" | "en";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayersIcon className="size-4 text-primary" aria-hidden="true" />
          {t("dimensions")}
        </CardTitle>
        <CardDescription>{t("dimensionsHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {draft.dimensions.map((dim, i) => {
            const indicators = draft.indicators.filter((ind) => ind.dimension_key === dim.key);
            return (
              <li key={dim.key} className="grid gap-3 rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <div className="grid gap-0.5">
                    <h4 className="font-semibold">{dim.name}</h4>
                    {dim.description ? (
                      <p className="text-sm text-muted-foreground">{dim.description}</p>
                    ) : null}
                  </div>
                </div>
                {indicators.length ? (
                  <ul className="grid gap-2 ps-11" aria-label={t("indicators")}>
                    {indicators.map((ind) => (
                      <li key={ind.code} className="grid gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                            {ind.code}
                          </span>
                          <span className="font-medium">{ind.name}</span>
                          <Badge variant="soft" className="ms-auto">
                            {label(INDICATOR_TYPE_LABELS, ind.indicator_type, locale)}
                          </Badge>
                        </div>
                        {ind.target ? (
                          <p className="text-xs text-muted-foreground">
                            {ti("target")}: <span className="font-medium text-foreground">{ind.target}</span>
                          </p>
                        ) : null}
                        {advanced ? (
                          <p className="text-xs text-muted-foreground">
                            {ind.formula ? (
                              <>
                                {ti("formula")}: {ind.formula} ·{" "}
                              </>
                            ) : null}
                            {ti("frequency")}: {label(FREQUENCY_LABELS, ind.frequency, locale)}
                            {ind.unit ? ` · ${ti("unit")}: ${ind.unit}` : ""}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ps-11 text-xs text-muted-foreground">{t("noIndicators")}</p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export function PlanObjectives({ draft }: { draft: MeasurementPlanDraft }) {
  const t = useTranslations("plan");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TargetIcon className="size-4 text-primary" aria-hidden="true" />
          {t("objectives")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid list-decimal gap-2 ps-5 marker:text-muted-foreground">
          {draft.objectives.map((o) => (
            <li key={o.key} className="ps-1 leading-relaxed">
              {o.title}
              {o.description ? (
                <span className="block text-sm text-muted-foreground">{o.description}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function PlanDesignCard({ draft }: { draft: MeasurementPlanDraft }) {
  const t = useTranslations("plan");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("design")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <DesignFlow design={draft.recommended_design} evidence={draft.evidence_level} waves={draft.waves} />
        {draft.design_rationale ? (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t("designRationale")}</p>
            <p className="text-sm leading-relaxed">{draft.design_rationale}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PlanNotes({ draft, advanced }: { draft: MeasurementPlanDraft; advanced: boolean }) {
  const t = useTranslations("plan");
  return (
    <>
      {draft.warnings.length ? (
        <Alert variant="warning">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p className="font-medium">{t("warnings")}</p>
            <ul className="list-disc ps-4">
              {draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheckIcon className="size-4 text-evidence" aria-hidden="true" />
            {t("methodologyNotes")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2.5">
            {draft.methodology_notes.map((note) => (
              <li
                key={note}
                className={
                  isCausalityNote(note)
                    ? "rounded-lg border border-evidence/30 bg-evidence/6 p-3 text-sm leading-relaxed"
                    : "flex gap-2 text-sm leading-relaxed"
                }
              >
                {isCausalityNote(note) ? null : (
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                )}
                <span>{note}</span>
              </li>
            ))}
          </ul>
          {advanced && draft.rules_applied.length ? (
            <div className="mt-4 grid gap-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">{t("rulesApplied")}</p>
              <div className="flex flex-wrap gap-1.5" dir="ltr">
                {draft.rules_applied.map((r) => (
                  <Badge key={r} variant="outline" className="font-mono text-[10px]">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {draft.clarifying_questions.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircleIcon
                className="size-4 text-warning-foreground dark:text-warning"
                aria-hidden="true"
              />
              {t("clarifyingQuestions")}
            </CardTitle>
            <CardDescription>{t("clarifyingHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid list-disc gap-1.5 ps-5 text-sm">
              {draft.clarifying_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
