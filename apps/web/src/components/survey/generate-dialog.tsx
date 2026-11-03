"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { label, parseLocaleNumber, WAVE_LABELS, type ProjectPlan, type Wave } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Switch,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RepeatIcon, ServerCogIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useAIStatus } from "@/components/measurement/architect-composer";
import { ThinkingSteps } from "@/components/measurement/thinking-steps";
import { surveyApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

const REPEATED = new Set(["POST", "FOLLOW_UP", "MIDLINE", "ROUND"]);

const schema = z.object({
  question_count: z.preprocess(
    (v) => (typeof v === "string" ? (parseLocaleNumber(v) ?? v) : v),
    z.number().int().min(3).max(60),
  ),
  include_open_questions: z.boolean(),
  include_profile_questions: z.boolean(),
  extra_instructions: z.string().max(1000),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

/** «أنشئ الاستبيان بالذكاء الاصطناعي» for one wave of the accepted plan. */
export function GenerateSurveyDialog({
  projectId,
  plan,
  wave,
  baselineReady,
  open,
  onOpenChange,
}: {
  projectId: string;
  plan: ProjectPlan;
  wave: Wave | null;
  /** A baseline survey exists, so repeated waves reuse its items verbatim. */
  baselineReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const tt = useTranslations("survey.thinking");
  const locale = useLocale() as "ar" | "en";
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const ai = useAIStatus();
  const abortRef = React.useRef<AbortController | null>(null);
  const repeated = !!wave && REPEATED.has(wave.wave_type) && baselineReady;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      question_count: plan.recommended_questions_count ?? 12,
      include_open_questions: true,
      include_profile_questions: !repeated,
      extra_instructions: "",
    },
  });

  const generate = useMutation({
    mutationFn: (values: FormOut) => {
      abortRef.current = new AbortController();
      return surveyApi.generate(
        projectId,
        {
          wave_id: wave?.id ?? null,
          question_count: values.question_count,
          include_open_questions: values.include_open_questions,
          include_profile_questions: values.include_profile_questions,
          extra_instructions: values.extra_instructions.trim() || null,
        },
        abortRef.current.signal,
      );
    },
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.setQueryData(["survey", detail.survey.id], detail);
      router.push(`/surveys/${detail.survey.id}`);
    },
    onError: (e) => {
      if (abortRef.current?.signal.aborted) return;
      toast.error(toMessage(e));
    },
  });

  const stop = () => {
    abortRef.current?.abort();
    generate.reset();
  };

  const notConfigured = ai.data && !ai.data.configured;
  const waveLabel = wave ? wave.name || label(WAVE_LABELS, wave.wave_type, locale) : t("noWave");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && generate.isPending) stop();
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={tc("close")} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("generateTitle")}</DialogTitle>
          <DialogDescription>
            {t("generateDescription")} <span className="font-medium text-foreground">({waveLabel})</span>
          </DialogDescription>
        </DialogHeader>

        {generate.isPending ? (
          <ThinkingSteps
            title={t("generating")}
            note={t("generatingNote")}
            steps={["read", "items", "scales", "logic", "check"].map((k) => tt(k as "read"))}
            onStop={stop}
            stopLabel={t("stop")}
          />
        ) : (
          <form
            id="generate-survey"
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) => generate.mutate(v))}
            noValidate
          >
            {notConfigured ? (
              <Alert variant="warning">
                <ServerCogIcon aria-hidden="true" />
                <AlertDescription>{t("aiNotConfigured")}</AlertDescription>
              </Alert>
            ) : null}
            {repeated ? (
              <Alert variant="evidence">
                <RepeatIcon aria-hidden="true" />
                <AlertDescription>{t("repeatedNote")}</AlertDescription>
              </Alert>
            ) : null}
            <Field
              id="gen-count"
              label={t("questionCount")}
              hint={repeated ? t("questionCountRepeatedHint") : undefined}
              error={form.formState.errors.question_count ? t("questionCountError") : undefined}
            >
              <Input
                inputMode="numeric"
                dir="ltr"
                className="max-w-32 text-start"
                autoComplete="off"
                {...form.register("question_count")}
              />
            </Field>
            <div className="grid gap-3 rounded-xl border p-3">
              <Controller
                control={form.control}
                name="include_open_questions"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="gen-open">{t("includeOpen")}</Label>
                    <Switch id="gen-open" checked={field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
              <Controller
                control={form.control}
                name="include_profile_questions"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="gen-profile">{t("includeProfile")}</Label>
                    <Switch
                      id="gen-profile"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={repeated}
                    />
                  </div>
                )}
              />
            </div>
            <Field
              id="gen-extra"
              label={t("extraInstructions")}
              error={form.formState.errors.extra_instructions ? t("extraTooLong") : undefined}
            >
              <Textarea
                rows={3}
                maxLength={1000}
                placeholder={t("extraPlaceholder")}
                {...form.register("extra_instructions")}
              />
            </Field>
          </form>
        )}

        {!generate.isPending ? (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" form="generate-survey" disabled={!!notConfigured}>
              <SparklesIcon aria-hidden="true" />
              {t("generate")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
