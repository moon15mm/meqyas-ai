"use client";

import { cn } from "@meqyas/ui";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

const STEP_KEYS = ["read", "classify", "dimensions", "design", "review"] as const;

/**
 * Progress narration while an agent runs. It only describes the pipeline
 * stages (no fabricated content) and stays on the last stage until the real
 * response arrives. Defaults to the Measurement Architect stages.
 */
export function ThinkingSteps({
  title,
  onStop,
  stopLabel,
  steps,
  note,
}: {
  title: string;
  onStop?: () => void;
  stopLabel?: string;
  /** Already-translated stage labels. */
  steps?: string[];
  note?: string;
}) {
  const t = useTranslations("home");
  const labels = steps ?? STEP_KEYS.map((key) => t(`thinkingSteps.${key}`));
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((i) => Math.min(i + 1, labels.length - 1));
    }, 3200);
    return () => window.clearInterval(timer);
  }, [labels.length]);

  return (
    <div className="grid gap-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <span className="brand-gradient relative flex size-10 items-center justify-center rounded-xl text-white">
          <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        </span>
        <div className="grid">
          <p className="font-semibold" role="status">
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{note ?? t("thinkingNote")}</p>
        </div>
      </div>
      <ol className="grid gap-2.5">
        {labels.map((text, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li
              key={text}
              className={cn(
                "animate-step-in flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
                current && "border-primary/30 bg-primary/5 font-medium text-foreground",
                done && "text-muted-foreground",
                !done && !current && "opacity-50",
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  done && "border-success bg-success text-success-foreground",
                  current && "border-primary text-primary",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                ) : current ? (
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </span>
              {text}
            </li>
          );
        })}
      </ol>
      {onStop ? (
        <button
          type="button"
          onClick={onStop}
          className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {stopLabel}
        </button>
      ) : null}
    </div>
  );
}
