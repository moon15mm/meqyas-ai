"use client";

import type { QualityAxis, QualityNote, ReviewIssue, SurveyDetail } from "@meqyas/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, cn, Progress, Spinner } from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  GitBranchIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { surveyApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

import type { Builder } from "./use-builder";

const KNOWN_NOTES = new Set([
  "no_questions",
  "long_questions",
  "duplicate_questions",
  "open_review_issues",
  "unlinked_questions",
  "no_measure_questions",
  "leading_wording",
  "unlabeled_scale_ends",
  "length_off_target",
  "too_long",
  "indicators_without_questions",
  "dimensions_under_covered",
  "no_dimensions",
  "mixed_scales",
  "open_items_on_indicators",
  "no_linked_measures",
  "logic_issues",
  "many_open_questions",
]);

/** Minutes and other measures arrive as floats; notes read better with whole numbers. */
function noteParams(params: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number")
      out[key] = Number.isInteger(value) ? value : Math.max(1, Math.round(value));
    else if (typeof value === "string") out[key] = value;
  }
  return out;
}

function band(ratio: number): "success" | "warning" | "destructive" {
  if (ratio >= 0.8) return "success";
  if (ratio >= 0.6) return "warning";
  return "destructive";
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const tone = band(score / 100);
  return (
    <div className="relative size-24 shrink-0" role="img" aria-label={`${label}: ${score}/100`}>
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700",
            tone === "success" && "stroke-success",
            tone === "warning" && "stroke-warning",
            tone === "destructive" && "stroke-destructive",
          )}
        />
      </svg>
      <span
        className="absolute inset-0 grid place-items-center text-2xl font-bold tabular-nums"
        aria-hidden="true"
      >
        {score}
      </span>
    </div>
  );
}

function AxisRow({ axis }: { axis: QualityAxis }) {
  const t = useTranslations("survey.quality");
  const ratio = axis.max ? axis.score / axis.max : 0;
  const noteText = (note: QualityNote) =>
    KNOWN_NOTES.has(note.code)
      ? t(`notes.${note.code}` as "notes.no_questions", noteParams(note.params))
      : note.code;
  return (
    <li className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{t(`axes.${axis.key}`)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round(axis.score * 10) / 10} / {axis.max}
        </span>
      </div>
      <Progress
        value={ratio * 100}
        aria-label={t(`axes.${axis.key}`)}
        className={cn(
          band(ratio) === "warning" && "[&>div]:bg-warning",
          band(ratio) === "destructive" && "[&>div]:bg-destructive",
          band(ratio) === "success" && "[&>div]:bg-success",
        )}
      />
      {axis.notes.length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {axis.notes.map((note, i) => (
            <li key={`${note.code}-${i}`}>• {noteText(note)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IssueCard({
  issue,
  editable,
  busy,
  onAccept,
  onReject,
  onEdit,
}: {
  issue: ReviewIssue;
  editable: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("survey.quality");
  const open = issue.status === "open";
  // Reviews stored before fixes were typed carry no `fix`: they were rewrites.
  const fix = issue.fix ?? "REWRITE";
  return (
    <li className={cn("grid gap-2 rounded-xl border bg-card p-3 text-sm", !open && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={
            issue.severity === "HIGH" ? "destructive" : issue.severity === "MEDIUM" ? "warning" : "secondary"
          }
        >
          {t(`issueTypes.${issue.type}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">{t(`severity.${issue.severity}`)}</span>
        {!open ? (
          <Badge variant="outline" className="ms-auto font-normal">
            {t(`issueStatus.${issue.status}`)}
          </Badge>
        ) : null}
      </div>
      <blockquote className="border-s-2 ps-2.5 text-muted-foreground">{issue.question_text}</blockquote>
      <dl className="grid gap-1.5">
        <div>
          <dt className="text-xs font-semibold">{t("problem")}</dt>
          <dd>{issue.problem}</dd>
        </div>
        {issue.reason ? (
          <div>
            <dt className="text-xs font-semibold">{t("reason")}</dt>
            <dd className="text-muted-foreground">{issue.reason}</dd>
          </div>
        ) : null}
        {fix === "REMOVE" ? (
          <div className="rounded-lg bg-destructive/6 p-2">
            <dt className="text-xs font-semibold text-destructive">{t("suggestion")}</dt>
            <dd>{t("fixRemoveHint")}</dd>
          </div>
        ) : issue.suggestion || issue.suggested_options.length ? (
          <div className="rounded-lg bg-success/8 p-2">
            <dt className="text-xs font-semibold text-success">
              {fix === "NONE"
                ? t("suggestion")
                : fix === "OPTIONS"
                  ? t("suggestedOptions")
                  : t("suggestedText")}
            </dt>
            {issue.suggestion ? <dd>{issue.suggestion}</dd> : null}
            {issue.suggested_options.length ? (
              <dd className="mt-1 text-xs text-muted-foreground">{issue.suggested_options.join(" · ")}</dd>
            ) : null}
          </div>
        ) : null}
      </dl>
      {open && editable ? (
        <div className="flex flex-wrap gap-1.5">
          {fix !== "NONE" ? (
            <Button
              size="sm"
              variant={fix === "REMOVE" ? "destructive" : "default"}
              onClick={onAccept}
              disabled={busy}
            >
              {fix === "REMOVE" ? <Trash2Icon aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
              {t(`fixAction.${fix}`)}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <PencilIcon aria-hidden="true" />
            {t("edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
            <XIcon aria-hidden="true" />
            {t("reject")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function QualityPanel({
  detail,
  builder,
  editable,
  onEditQuestion,
}: {
  detail: SurveyDetail;
  builder: Builder;
  editable: boolean;
  onEditQuestion: (key: string) => void;
}) {
  const t = useTranslations("survey.quality");
  const tb = useTranslations("survey.builder");
  const tc = useTranslations("common");
  const tl = useTranslations("survey.logicCodes");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const surveyId = detail.survey.id;
  const { quality, review, logic_issues: logicIssues } = detail;

  const adopt = (fresh: SurveyDetail) => {
    queryClient.setQueryData(["survey", surveyId], fresh);
    builder.reset(fresh);
  };

  const runReview = useMutation({
    mutationFn: async () => {
      await builder.flush();
      return surveyApi.review(surveyId);
    },
    onSuccess: adopt,
    onError: (e) => toast.error(toMessage(e)),
  });

  const act = useMutation({
    mutationFn: async ({ issue, action }: { issue: ReviewIssue; action: "accept" | "reject" }) => {
      await builder.flush();
      return surveyApi.reviewAction(surveyId, issue.id, action);
    },
    onSuccess: adopt,
    onError: (e) => toast.error(toMessage(e)),
  });

  const openIssues = review.issues.filter((i) => i.status === "open");
  const closedIssues = review.issues.filter((i) => i.status !== "open");
  const knownLogicCodes = new Set([
    "unknown_question",
    "not_answerable",
    "unknown_operator",
    "missing_value",
    "unknown_row",
    "unknown_option",
    "unknown_target",
    "self_reference",
    "forward_reference",
    "unknown_source",
    "backward_skip",
    "randomized_target",
    "empty_condition",
    "missing_limit",
    "empty_group",
  ]);

  return (
    <div className="grid content-start gap-6">
      <section aria-labelledby="quality-heading" className="grid gap-4">
        <h2 id="quality-heading" className="text-sm font-semibold">
          {t("title")}
        </h2>
        <div className="flex items-center gap-4">
          <ScoreRing score={quality.total} label={t("score")} />
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {tb("estimated", { minutes: Math.max(1, Math.round(quality.estimated_minutes)) })}
              </dt>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{tc("questions", { n: quality.answerable_count })}</dt>
            </div>
            {builder.saveState === "dirty" || builder.saveState === "saving" ? (
              <div className="text-xs text-muted-foreground">{t("updatesAfterSave")}</div>
            ) : null}
          </dl>
        </div>
        <ul className="grid gap-4">
          {quality.axes.map((axis) => (
            <AxisRow key={axis.key} axis={axis} />
          ))}
        </ul>
      </section>

      {logicIssues.length ? (
        <Alert variant="warning">
          <GitBranchIcon aria-hidden="true" />
          <AlertTitle>{tb("logicIssues")}</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-0.5">
              {logicIssues.map((issue, i) => (
                <li key={i}>
                  • {knownLogicCodes.has(issue.code) ? tl(issue.code as "unknown_question") : issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="review-heading" className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="review-heading" className="text-sm font-semibold">
            {t("issues")}
          </h2>
          {editable ? (
            <Button
              size="sm"
              variant="soft"
              onClick={() => runReview.mutate()}
              disabled={runReview.isPending || quality.answerable_count === 0}
            >
              {runReview.isPending ? <Spinner className="size-3.5" /> : <SparklesIcon aria-hidden="true" />}
              {review.ran_at ? t("rerunReview") : t("runReview")}
            </Button>
          ) : null}
        </div>
        <div aria-live="polite" className="grid gap-3">
          {runReview.isPending ? (
            <p className="flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t("reviewing")}
            </p>
          ) : !review.ran_at ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("notReviewed")}
            </p>
          ) : (
            <>
              {review.overall_comment ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{review.overall_comment}</p>
              ) : null}
              {openIssues.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl bg-success/8 p-3 text-sm">
                  <CheckIcon className="size-4 text-success" aria-hidden="true" />
                  {t("noIssues")}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden="true" />
                  {t("openCount", { n: openIssues.length })}
                </p>
              )}
            </>
          )}
        </div>
        <ul className="grid gap-2">
          {[...openIssues, ...closedIssues].map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              editable={editable}
              busy={act.isPending}
              onAccept={() => act.mutate({ issue, action: "accept" })}
              onReject={() => act.mutate({ issue, action: "reject" })}
              onEdit={() => onEditQuestion(issue.question_key)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
