"use client";

import {
  DESIGN_LABELS,
  EVIDENCE_LABELS,
  label,
  type EvidenceLevel,
  type MeasurementDesign,
  type WaveType,
} from "@meqyas/shared";
import { Badge, cn } from "@meqyas/ui";
import {
  ArrowDownIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  FlagIcon,
  RepeatIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

const WAVE_ICON: Record<WaveType, typeof FlagIcon> = {
  BASELINE: FlagIcon,
  MIDLINE: ClipboardListIcon,
  POST: ClipboardListIcon,
  FOLLOW_UP: CalendarClockIcon,
  SINGLE: ClipboardListIcon,
  ROUND: RepeatIcon,
};

export interface FlowWave {
  wave_type: WaveType;
  name: string;
  timing: string;
}

/** Visual measurement design: قبل البرنامج ↓ بعد البرنامج ↓ متابعة بعد 30 يومًا */
export function DesignFlow({
  design,
  evidence,
  waves,
  compact = false,
}: {
  design: MeasurementDesign | null;
  evidence: EvidenceLevel | null;
  waves: FlowWave[];
  compact?: boolean;
}) {
  const locale = useLocale() as "ar" | "en";
  const t = useTranslations("plan");
  return (
    <div className="grid gap-4">
      {design ? <p className="text-lg font-semibold">{label(DESIGN_LABELS, design, locale)}</p> : null}
      <ol className="grid gap-0" aria-label={t("design")}>
        {waves.map((wave, i) => {
          const Icon = WAVE_ICON[wave.wave_type];
          return (
            <li key={`${wave.wave_type}-${i}`} className="grid justify-items-start">
              <div
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-card px-3.5",
                  compact ? "py-2.5" : "py-3",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{wave.name}</span>
                  {wave.timing ? <span className="text-xs text-muted-foreground">{wave.timing}</span> : null}
                </span>
              </div>
              {i < waves.length - 1 ? (
                <span
                  className="flex h-7 w-9 items-center justify-center text-muted-foreground"
                  aria-hidden="true"
                >
                  <ArrowDownIcon className="size-4" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {evidence ? (
        <div className="grid gap-1.5 rounded-xl border border-evidence/30 bg-evidence/6 p-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheckIcon className="size-4 text-evidence" aria-hidden="true" />
            {t("evidenceLevel")}:<Badge variant="evidence">{label(EVIDENCE_LABELS, evidence, locale)}</Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            {locale === "ar" ? EVIDENCE_LABELS[evidence].hint_ar : EVIDENCE_LABELS[evidence].hint_en}
          </p>
        </div>
      ) : null}
    </div>
  );
}
