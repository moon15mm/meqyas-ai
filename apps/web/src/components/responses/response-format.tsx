"use client";

import type { QualityStatus } from "@meqyas/shared";
import { Badge } from "@meqyas/ui";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

const QUALITY_VARIANT: Record<QualityStatus, "success" | "warning" | "destructive"> = {
  VALID: "success",
  SUSPICIOUS: "warning",
  LOW_QUALITY: "destructive",
};

export function QualityBadge({ status, score }: { status: QualityStatus; score?: number }) {
  const t = useTranslations("responses.quality");
  return (
    <Badge variant={QUALITY_VARIANT[status]} className="tabular-nums">
      {t(status)}
      {score !== undefined ? <span className="opacity-80">· {score}</span> : null}
    </Badge>
  );
}

/** Locale-aware date/duration formatting with Latin digits (consistent with the rest of the app). */
export function useFormatters() {
  const locale = useLocale();
  const t = useTranslations("responses");
  return React.useMemo(() => {
    const dt = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return {
      dateTime: (iso: string | null) => (iso ? dt.format(new Date(iso)) : "—"),
      duration: (seconds: number | null) => {
        if (seconds === null || seconds === undefined) return "—";
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m ? t("minutes", { m, s }) : t("seconds", { s });
      },
    };
  }, [locale, t]);
}
