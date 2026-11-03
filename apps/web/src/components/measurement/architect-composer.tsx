"use client";

import { architectRequestSchema } from "@meqyas/shared";
import { Alert, AlertDescription, AlertTitle, Button, cn, Textarea } from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeftIcon, ServerCogIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { aiApi, planApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

import { ThinkingSteps } from "./thinking-steps";

const MAX = 2000;
export const EXAMPLE_KEYS = [
  "studentSatisfaction",
  "teacherSatisfaction",
  "parentSatisfaction",
  "eventEvaluation",
  "initiativeImpact",
  "trainingImpact",
  "studentNeeds",
  "beneficiaryExperience",
] as const;

export function useAIStatus() {
  return useQuery({ queryKey: ["ai-status"], queryFn: () => aiApi.status(), staleTime: 60_000 });
}

/**
 * «ماذا تريد أن تقيس؟» — the entry point of the core journey.
 * Sends the request to the Measurement Architect agent and opens the plan review.
 */
export function ArchitectComposer({
  variant = "hero",
  autoFocus = false,
  onDone,
  inputRef,
}: {
  variant?: "hero" | "compact";
  autoFocus?: boolean;
  onDone?: () => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const t = useTranslations("home");
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const can = useCan();
  const status = useAIStatus();
  const [text, setText] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const id = React.useId();

  const mutation = useMutation({
    mutationFn: (request: string) => {
      abortRef.current = new AbortController();
      return planApi.architect({ request }, abortRef.current.signal);
    },
    onSuccess: (plan) => {
      queryClient.setQueryData(["plan", plan.id], plan);
      onDone?.();
      router.push(`/plans/${plan.id}`);
    },
    onError: (error) => {
      if ((error as Error)?.name === "AbortError") return;
      toast.error(toMessage(error));
    },
  });

  const valid = architectRequestSchema.safeParse({ request: text }).success;
  const showError = touched && !valid;

  const submit = () => {
    setTouched(true);
    if (!valid || mutation.isPending) return;
    mutation.mutate(text.trim());
  };

  if (mutation.isPending) {
    return (
      <ThinkingSteps
        title={t("thinkingTitle")}
        stopLabel={t("stop")}
        onStop={() => {
          abortRef.current?.abort();
          mutation.reset();
        }}
      />
    );
  }

  const notConfigured = status.data && !status.data.configured;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className={cn(variant === "hero" ? "visually-hidden" : "text-sm font-medium")}>
        {t("inputLabel")}
      </label>
      <div className="relative">
        <Textarea
          id={id}
          ref={inputRef}
          name="request"
          value={text}
          autoFocus={autoFocus}
          maxLength={MAX}
          rows={variant === "hero" ? 4 : 3}
          placeholder={t("placeholder")}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text && setTouched(true)}
          onKeyDown={(e) => {
            // IME-safe: never submit while an Arabic/CJK composition is in progress.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(
            "resize-y",
            variant === "hero" && "min-h-36 rounded-xl px-4 py-3.5 text-base leading-loose md:text-[17px]",
          )}
        />
        <span
          dir="ltr"
          className="pointer-events-none absolute end-3 bottom-2.5 text-xs text-muted-foreground tabular-nums"
          aria-hidden="true"
        >
          {t("charCount", { count: text.length, max: MAX })}
        </span>
      </div>
      {showError ? (
        <p id={`${id}-error`} role="alert" className="-mt-2 text-xs font-medium text-destructive">
          {t("tooShort")}
        </p>
      ) : null}

      <div className="grid gap-2.5">
        <p className="text-xs font-medium text-muted-foreground">{t("quickExamples")}</p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLE_KEYS.map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => {
                  setText(t(`exampleTexts.${key}`));
                  setTouched(false);
                }}
                className="min-h-9 rounded-full border bg-card px-3.5 py-1.5 text-sm text-foreground/85 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                {t(`examples.${key}`)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {notConfigured ? (
        <Alert variant="warning">
          <ServerCogIcon aria-hidden="true" />
          <AlertTitle>{t("aiNotConfiguredTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("aiNotConfiguredBody")}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          {status.data?.configured && status.data.model_smart
            ? t("aiPoweredBy", {
                provider: status.data.provider_label ?? status.data.provider ?? "",
                model: status.data.model_smart,
              })
            : null}
        </p>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
            {t("submitHint")}
          </span>
          <Button
            type="submit"
            size={variant === "hero" ? "lg" : "default"}
            disabled={!can.useAI}
            className="gap-2"
          >
            <SparklesIcon aria-hidden="true" />
            {t("submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
