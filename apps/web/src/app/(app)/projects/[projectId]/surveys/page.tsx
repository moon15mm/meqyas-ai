"use client";

import { label, WAVE_LABELS, type SurveyMeta, type Wave } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CopyIcon, FilePlus2Icon, InfoIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { SurveyStatusBadge } from "@/components/survey/question-type-meta";
import { GenerateSurveyDialog } from "@/components/survey/generate-dialog";
import { impactApi, surveyApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const REPEATED = new Set(["POST", "FOLLOW_UP", "MIDLINE", "ROUND"]);

function CopyDialog({
  wave,
  sources,
  onOpenChange,
  onCopy,
  pending,
}: {
  wave: Wave | null;
  sources: SurveyMeta[];
  onOpenChange: (open: boolean) => void;
  onCopy: (sourceId: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("survey.copy");
  const tc = useTranslations("common");
  const [source, setSource] = React.useState("");
  React.useEffect(() => {
    if (wave) setSource(sources[0]?.id ?? "");
  }, [wave, sources]);
  return (
    <Dialog open={Boolean(wave)} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { wave: wave?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t("source")}</legend>
          {sources.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 has-checked:border-primary has-checked:bg-primary/5"
            >
              <input
                type="radio"
                name="copy-source"
                value={s.id}
                checked={source === s.id}
                onChange={() => setSource(s.id)}
                className="accent-primary"
              />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground">
                  {tc("questions", { n: s.question_count })}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => source && onCopy(source)} disabled={!source || pending}>
            <CopyIcon aria-hidden="true" />
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SurveyRow({ survey }: { survey: SurveyMeta }) {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="grid min-w-0 gap-1">
        <Link href={`/surveys/${survey.id}`} className="truncate font-medium hover:underline">
          {survey.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <SurveyStatusBadge status={survey.status} label={t(`status.${survey.status}`)} />
          <span>{tc("questions", { n: survey.question_count })}</span>
          {survey.published_version_number ? (
            <span>· {t("responsesCount", { n: survey.response_count })}</span>
          ) : null}
          {survey.current_version ? (
            <span className="tabular-nums">
              · {t("version", { n: survey.current_version.version_number })}
            </span>
          ) : null}
          {survey.has_unpublished_changes ? <Badge variant="warning">{t("unpublishedChanges")}</Badge> : null}
          {survey.ai_generated ? <Badge variant="secondary">{t("aiBadge")}</Badge> : null}
          {survey.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
        </div>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href={`/surveys/${survey.id}`}>
          {t("open")}
          <ArrowLeftIcon className="ltr:-scale-x-100" aria-hidden="true" />
        </Link>
      </Button>
    </li>
  );
}

export default function ProjectSurveysPage() {
  const t = useTranslations("survey");
  const tp = useTranslations("project.tabs");
  const locale = useLocale() as "ar" | "en";
  const projectId = useProjectId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const can = useCan();
  const overview = useProjectOverview();
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const [generateFor, setGenerateFor] = React.useState<{ wave: Wave | null } | null>(null);
  const [copyFor, setCopyFor] = React.useState<Wave | null>(null);
  const copy = useMutation({
    mutationFn: ({ sourceId, wave }: { sourceId: string; wave: Wave }) =>
      impactApi.copySurvey(sourceId, { wave_id: wave.id }),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.setQueryData(["survey", detail.survey.id], detail);
      setCopyFor(null);
      toast.success(t("copy.done"));
      router.push(`/surveys/${detail.survey.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const createBlank = useMutation({
    mutationFn: (wave: Wave | null) =>
      surveyApi.create(projectId, {
        title:
          `${overview.data?.project.title ?? ""} — ${wave ? wave.name || label(WAVE_LABELS, wave.wave_type, locale) : t("survey")}`.slice(
            0,
            300,
          ),
        wave_id: wave?.id ?? null,
      }),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.setQueryData(["survey", detail.survey.id], detail);
      router.push(`/surveys/${detail.survey.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (overview.isLoading || surveys.isLoading || !overview.data) {
    return (
      <div className="grid gap-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    );
  }

  const { plan } = overview.data;
  const all = surveys.data ?? [];
  const waves = [...plan.waves].sort((a, b) => a.sort_order - b.sort_order);
  const baselineReady = all.some((s) => s.wave_type === "BASELINE" && s.status !== "ARCHIVED");
  const hasBaselineWave = waves.some((w) => w.wave_type === "BASELINE");
  const slots: Array<{ wave: Wave | null; surveys: SurveyMeta[] }> = waves.length
    ? waves.map((wave) => ({ wave, surveys: all.filter((s) => s.wave_id === wave.id) }))
    : [{ wave: null, surveys: all.filter((s) => !s.wave_id) }];
  const unassigned = waves.length
    ? all.filter((s) => !s.wave_id || !waves.some((w) => w.id === s.wave_id))
    : [];

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{tp("surveys")}</h2>
        <p className="text-sm text-muted-foreground">{t("projectSubtitle")}</p>
      </div>

      <ol className="grid gap-4">
        {slots.map(({ wave, surveys: list }, i) => {
          const waveLabel = wave ? wave.name || label(WAVE_LABELS, wave.wave_type, locale) : t("noWave");
          const needsBaselineFirst =
            !!wave && REPEATED.has(wave.wave_type) && hasBaselineWave && !baselineReady;
          const active = list.filter((s) => s.status !== "ARCHIVED");
          return (
            <li key={wave?.id ?? "none"}>
              <Card className="gap-4">
                <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary tabular-nums">
                      {i + 1}
                    </span>
                    <div className="grid gap-1">
                      <CardTitle>{waveLabel}</CardTitle>
                      {wave?.timing ? <CardDescription>{wave.timing}</CardDescription> : null}
                    </div>
                  </div>
                  {can.write && active.length === 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setGenerateFor({ wave })}>
                        <SparklesIcon aria-hidden="true" />
                        {t("generate")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => createBlank.mutate(wave)}
                        disabled={createBlank.isPending}
                      >
                        <FilePlus2Icon aria-hidden="true" />
                        {t("createBlank")}
                      </Button>
                      {wave && all.some((s) => s.status !== "ARCHIVED") ? (
                        <Button variant="outline" onClick={() => setCopyFor(wave)}>
                          <CopyIcon aria-hidden="true" />
                          {t("copy.button")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </CardHeader>
                <div className="grid gap-3 px-6 pb-6">
                  {needsBaselineFirst && active.length === 0 ? (
                    <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {t("baselineFirst")}
                    </p>
                  ) : wave && REPEATED.has(wave.wave_type) && baselineReady && active.length === 0 ? (
                    <p className="flex items-start gap-2 rounded-xl bg-evidence/8 p-3 text-sm">
                      <InfoIcon className="mt-0.5 size-4 shrink-0 text-evidence" aria-hidden="true" />
                      {t("repeatedNote")}
                    </p>
                  ) : null}
                  {list.length ? (
                    <ul className="grid gap-2">
                      {list.map((s) => (
                        <SurveyRow key={s.id} survey={s} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("noSurveyYet")}</p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      {unassigned.length ? (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t("otherSurveys")}</CardTitle>
          </CardHeader>
          <ul className="grid gap-2 px-6 pb-6">
            {unassigned.map((s) => (
              <SurveyRow key={s.id} survey={s} />
            ))}
          </ul>
        </Card>
      ) : null}

      <CopyDialog
        wave={copyFor}
        sources={all.filter((s) => s.status !== "ARCHIVED")}
        onOpenChange={(o) => !o && setCopyFor(null)}
        onCopy={(sourceId) => copyFor && copy.mutate({ sourceId, wave: copyFor })}
        pending={copy.isPending}
      />

      {generateFor ? (
        <GenerateSurveyDialog
          projectId={projectId}
          plan={plan}
          wave={generateFor.wave}
          baselineReady={baselineReady}
          open
          onOpenChange={(o) => !o && setGenerateFor(null)}
        />
      ) : null}
    </div>
  );
}
