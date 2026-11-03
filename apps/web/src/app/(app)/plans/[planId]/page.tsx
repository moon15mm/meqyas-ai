"use client";

import type { ArchitectOutput } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, FolderOpenIcon, PencilIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { PlanEditor } from "@/components/measurement/plan-editor";
import {
  PlanDesignCard,
  PlanDimensions,
  PlanNotes,
  PlanObjectives,
  PlanRationale,
  PlanUnderstanding,
} from "@/components/measurement/plan-view";
import { ThinkingSteps } from "@/components/measurement/thinking-steps";
import { planApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useAdvancedMode } from "@/lib/preferences";

const SUGGESTION_KEYS = ["shorter", "followUp", "dimension", "simpler"] as const;

export default function PlanReviewPage() {
  const { planId } = useParams<{ planId: string }>();
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const can = useCan();
  const [advanced, setAdvanced] = useAdvancedMode();
  const [editing, setEditing] = React.useState(false);
  const [improveOpen, setImproveOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");

  const plan = useQuery({ queryKey: ["plan", planId], queryFn: () => planApi.get(planId) });

  const save = useMutation({
    mutationFn: (draft: ArchitectOutput) => planApi.update(planId, draft),
    onSuccess: (updated) => {
      queryClient.setQueryData(["plan", planId], updated);
      setEditing(false);
      toast.success(t("savedToast"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const regenerate = useMutation({
    mutationFn: (text: string) => planApi.regenerate(planId, text),
    onSuccess: (updated) => {
      queryClient.setQueryData(["plan", planId], updated);
      setFeedback("");
      toast.success(t("regeneratedToast"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const accept = useMutation({
    mutationFn: () => planApi.accept(planId),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("acceptedToast"));
      router.push(`/projects/${project.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (plan.isLoading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-5">
        <Skeleton className="h-48 rounded-2xl" />
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (plan.isError || !plan.data) {
    return (
      <div className="mx-auto grid max-w-xl gap-4 py-16 text-center">
        <p className="text-lg font-semibold">{t("notFound")}</p>
        <Button asChild variant="outline" className="justify-self-center">
          <Link href="/">{tc("back")}</Link>
        </Button>
      </div>
    );
  }

  const data = plan.data;
  const draft = data.draft;
  const accepted = data.status === "ACCEPTED";

  if (regenerate.isPending) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="p-6">
          <ThinkingSteps title={t("regenerating")} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={accepted ? "success" : "soft"} className="gap-1.5">
            {accepted ? <CheckCircle2Icon aria-hidden="true" /> : <SparklesIcon aria-hidden="true" />}
            {accepted ? t("acceptedBadge") : t("draftBadge")}
          </Badge>
          {data.generation_count > 1 ? (
            <Badge variant="outline">{t("generation", { n: data.generation_count })}</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Switch id="advanced-mode" checked={advanced} onCheckedChange={setAdvanced} />
          <Label htmlFor="advanced-mode" className="text-sm text-muted-foreground">
            {tc("advancedMode")}
          </Label>
        </div>
      </header>

      <h1 className="visually-hidden">{draft.project_title}</h1>

      <Card className="hero-surface gap-0 border-primary/15 p-5 sm:p-7">
        <PlanUnderstanding draft={draft} request={data.source_prompt} />
      </Card>

      {accepted ? (
        <Alert variant="evidence">
          <CheckCircle2Icon aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-foreground">
            <span>{t("alreadyAccepted")}</span>
            {data.project_id ? (
              <Button asChild size="sm" variant="evidence">
                <Link href={`/projects/${data.project_id}`}>
                  <FolderOpenIcon aria-hidden="true" />
                  {t("goToProject")}
                </Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <PlanEditor
          draft={draft}
          saving={save.isPending}
          onSave={(v) => save.mutate(v)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="grid gap-6">
            <PlanRationale draft={draft} advanced={advanced} />
            <PlanDimensions draft={draft} advanced={advanced} />
            <PlanObjectives draft={draft} />
          </div>
          <div className="grid gap-6 lg:sticky lg:top-20">
            <PlanDesignCard draft={draft} />
            <PlanNotes draft={draft} advanced={advanced} />
          </div>
        </div>
      )}

      {!accepted && !editing && can.write ? (
        <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border bg-background/90 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <PencilIcon aria-hidden="true" />
            {t("editPlan")}
          </Button>
          <Button variant="outline" onClick={() => setImproveOpen(true)} disabled={!can.useAI}>
            <WandSparklesIcon aria-hidden="true" />
            {t("improve")}
          </Button>
          <Button size="lg" onClick={() => accept.mutate()} disabled={accept.isPending}>
            {accept.isPending ? <Spinner /> : <CheckCircle2Icon aria-hidden="true" />}
            {accept.isPending ? t("accepting") : t("accept")}
          </Button>
        </div>
      ) : null}

      <Dialog open={improveOpen} onOpenChange={setImproveOpen}>
        <DialogContent closeLabel={tc("close")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (feedback.trim().length < 3) return;
              setImproveOpen(false);
              regenerate.mutate(feedback.trim());
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("improveTitle")}</DialogTitle>
              <DialogDescription>{t("improveDescription")}</DialogDescription>
            </DialogHeader>
            <Label htmlFor="improve-feedback" className="visually-hidden">
              {t("improveTitle")}
            </Label>
            <Textarea
              id="improve-feedback"
              rows={4}
              maxLength={1500}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t("improvePlaceholder")}
            />
            <ul className="flex flex-wrap gap-2">
              {[
                ...SUGGESTION_KEYS.map((k) => t(`improveSuggestions.${k}`)),
                ...draft.clarifying_questions,
              ].map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 text-xs hover:border-primary/40 hover:text-primary"
                    onClick={() => setFeedback((f) => (f ? `${f}\n${s}` : s))}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setImproveOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={feedback.trim().length < 3}>
                <WandSparklesIcon aria-hidden="true" />
                {t("regenerate")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
