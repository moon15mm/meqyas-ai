"use client";

import type { PlanFeature } from "@meqyas/shared";
import { label, PLAN_FEATURE_LABELS } from "@meqyas/shared";
import { Button, Card, cn } from "@meqyas/ui";
import { BanIcon, GiftIcon, InfoIcon, LockIcon, LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { useAuth } from "@/lib/auth/auth-provider";

import { subscriptionNotices, useSubscription } from "./subscription";

/** Dates in the person's language, Gregorian calendar, Latin digits (like the rest of the app). */
export function useDateFormat(): (iso: string | null | undefined) => string {
  const locale = useLocale();
  return React.useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
      dateStyle: "medium",
    });
    return (iso) => (iso ? fmt.format(new Date(iso)) : "—");
  }, [locale]);
}

/** Trial, ending soon, ended, or at a limit: what the workspace needs to know, in one calm strip. */
export function SubscriptionBanner() {
  const t = useTranslations("subscription");
  const date = useDateFormat();
  const notices = subscriptionNotices(useSubscription());
  if (!notices.length) return null;
  const warning = notices.some((n) => n.tone === "warning");
  const lines = notices.map((n) => {
    const v = n.values;
    switch (n.key) {
      case "trial":
        return [
          t("trialTitle"),
          Number(v.limit) >= 0 ? t("trialSurveys", { used: v.used, limit: v.limit }) : null,
          Number(v.days) >= 0 ? t("daysLeft", { days: v.days }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "expired":
        return t("expired", { date: date(String(v.date)), until: date(String(v.until)) });
      case "expiredClosed":
        return t("expiredClosed", { date: date(String(v.date)) });
      case "endingSoon":
        return t("endingSoon", { days: v.days, date: date(String(v.date)) });
      case "surveysFull":
        return t("surveysFull", { limit: v.limit });
      case "responsesFull":
        return t("responsesFull", { limit: v.limit, date: date(String(v.date)) });
      case "responsesNear":
        return t("responsesNear", { used: v.used, limit: v.limit });
    }
  });
  const Icon = warning ? TriangleAlertIcon : notices[0]?.key === "trial" ? GiftIcon : InfoIcon;
  return (
    <div
      role="status"
      className={cn(
        "mb-5 flex items-start gap-3 rounded-xl border px-4 py-2.5 text-sm",
        warning ? "border-warning/50 bg-warning/10" : "border-primary/25 bg-primary/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          warning ? "text-warning-foreground dark:text-warning" : "text-primary",
        )}
        aria-hidden="true"
      />
      <div className="grid gap-0.5">
        {lines.map((line, i) => (
          <p
            key={notices[i]!.key}
            className={cn("text-pretty", i === 0 ? "font-medium" : "text-muted-foreground")}
          >
            {line}
          </p>
        ))}
        {warning ? <p className="text-muted-foreground">{t("contact")}</p> : null}
      </div>
    </div>
  );
}

/** A module outside the workspace's plan (the API refuses it too). */
export function FeatureLocked({ feature }: { feature: PlanFeature }) {
  const t = useTranslations("subscription");
  const locale = useLocale() as "ar" | "en";
  return (
    <Card className="mx-auto grid max-w-xl place-items-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted">
        <LockIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="text-lg font-semibold text-balance">
        {t("lockedTitle", { feature: label(PLAN_FEATURE_LABELS, feature, locale) })}
      </p>
      <p className="max-w-md text-sm text-muted-foreground text-pretty">{t("lockedBody")}</p>
    </Card>
  );
}

/** The whole workspace is closed: suspended by the platform's administrators. */
export function SuspendedScreen() {
  const t = useTranslations("subscription");
  const tn = useTranslations("nav");
  const { memberships, logout } = useAuth();
  return (
    <Card className="mx-auto mt-10 grid max-w-xl place-items-center gap-4 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-destructive/10">
        <BanIcon className="size-6 text-destructive" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-bold text-balance">{t("suspendedTitle")}</h1>
      <p className="text-sm text-muted-foreground text-pretty">{t("suspendedBody")}</p>
      {memberships.length > 1 ? (
        <p className="text-sm text-pretty">{t("switchHint")}</p>
      ) : (
        <Button variant="outline" onClick={() => void logout()}>
          <LogOutIcon aria-hidden="true" />
          {tn("logout")}
        </Button>
      )}
    </Card>
  );
}
