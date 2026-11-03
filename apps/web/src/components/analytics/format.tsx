"use client";

import { useLocale } from "next-intl";
import * as React from "react";

/**
 * Number formatting for statistics: Latin digits (consistent with the rest of the app),
 * fixed decimals, a real minus sign, and "< 0.001" for tiny p-values. Values that mix
 * signs or symbols are wrapped in <Num> so the bidi algorithm never flips them in RTL.
 */
export function useStatFormat() {
  const locale = useLocale();
  return React.useMemo(() => {
    const tag = locale === "ar" ? "ar-SA-u-nu-latn" : "en-US";
    const cache = new Map<number, Intl.NumberFormat>();
    const fixed = (value: number, digits: number) => {
      let f = cache.get(digits);
      if (!f) {
        f = new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        cache.set(digits, f);
      }
      return f.format(value);
    };
    const day = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
      dateStyle: "medium",
    });
    const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
    return {
      num: (v: number | null | undefined, digits = 2) => (isNum(v) ? fixed(v, digits) : "—"),
      int: (v: number | null | undefined) => (isNum(v) ? fixed(v, 0) : "—"),
      pct: (v: number | null | undefined, digits = 0) => (isNum(v) ? `${fixed(v, digits)}%` : "—"),
      /** A proportion (0–1, e.g. top-box or a Wilson interval bound) as a percentage. */
      share: (v: number | null | undefined, digits = 0) => (isNum(v) ? `${fixed(v * 100, digits)}%` : "—"),
      signed: (v: number | null | undefined, digits = 2) =>
        isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), digits)}` : "—",
      p: (v: number | null | undefined) => (isNum(v) ? (v < 0.001 ? "< 0.001" : fixed(v, 3)) : "—"),
      day: (iso: string) => day.format(new Date(`${iso}T00:00:00Z`)),
      date: (iso: string | null | undefined) => (iso ? date.format(new Date(iso)) : "—"),
    };
  }, [locale]);
}

export type StatFormat = ReturnType<typeof useStatFormat>;

const GENERIC = {
  ar: { store: "المتجر", product: "المنتج", branch: "فرعنا" },
  en: { store: "the store", product: "the product", branch: "our branch" },
} as const;

/** Store-survey placeholders read generically in aggregate views («المنتج», «المتجر», «فرعنا»). */
export function genericText(text: string, locale: string): string {
  const words = GENERIC[locale === "en" ? "en" : "ar"];
  return text.replace(
    /\{\{\s*(store|product|branch)\s*\}\}/g,
    (_, key: "store" | "product" | "branch") => words[key],
  );
}

/** A number isolated from the surrounding text direction (signs, ranges, p-values). */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
