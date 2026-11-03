"use client";

import type { QuestionStats } from "@meqyas/shared";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { waveName } from "./overview";

export const META_SEGMENTS = ["wave", "device", "channel"] as const;
/** Only meaningful when answers came through store invitations. */
export const STORE_SEGMENTS = ["product", "store"] as const;

/** Variables a question can be broken down by: single-choice questions (profile first) and response metadata. */
export function useSegmentOptions(
  questions: QuestionStats[] | undefined,
  { store = false }: { store?: boolean } = {},
) {
  const t = useTranslations("analytics.filters");
  return React.useMemo(() => {
    const choice = (questions ?? []).filter((q) => q.type === "SINGLE_CHOICE" || q.type === "DROPDOWN");
    choice.sort((a, b) => Number(b.is_profile) - Number(a.is_profile));
    const meta = [...(store ? STORE_SEGMENTS : []), ...META_SEGMENTS];
    return {
      questions: choice.map((q) => ({ value: q.key, label: q.text })),
      meta: meta.map((m) => ({ value: m, label: t(`meta.${m}`) })),
    };
  }, [questions, t, store]);
}

/** Localized label of one value of a segment variable (metadata values arrive as codes). */
export function useSegmentValueLabel() {
  const locale = useLocale() as "ar" | "en";
  const tr = useTranslations("responses");
  return React.useCallback(
    (segment: string | null | undefined, value: string, fallback: string) => {
      if (segment === "wave") return waveName(value, locale);
      if (segment === "device" || segment === "channel") {
        const key = `${segment}.${value}`;
        return tr.has(key) ? tr(key) : value;
      }
      return fallback;
    },
    [locale, tr],
  );
}
