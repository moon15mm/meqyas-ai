"use client";

import {
  label,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURES,
  SUBSCRIPTION_STATE_LABELS,
  type SubscriptionState,
  type SubscriptionSummary,
} from "@meqyas/shared";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "@meqyas/ui";
import { CheckIcon, MinusIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { useDateFormat } from "./subscription-banner";

export const STATE_VARIANT: Record<
  SubscriptionState,
  "soft" | "success" | "warning" | "outline" | "destructive"
> = {
  PENDING: "outline",
  TRIAL: "soft",
  ACTIVE: "success",
  EXPIRED: "warning",
  SUSPENDED: "destructive",
};

export function StateBadge({ state }: { state: SubscriptionState }) {
  const locale = useLocale() as "ar" | "en";
  return <Badge variant={STATE_VARIANT[state]}>{label(SUBSCRIPTION_STATE_LABELS, state, locale)}</Badge>;
}

export function planName(
  sub: Pick<SubscriptionSummary, "plan_name_ar" | "plan_name_en">,
  locale: string,
): string {
  return locale === "en" ? sub.plan_name_en : sub.plan_name_ar;
}

/** Used / limit of the period, the month and the team (a bar only when there is a limit). */
export function UsageMeters({ sub }: { sub: SubscriptionSummary }) {
  const t = useTranslations("subscription.usage");
  const format = useFormatter();
  const rows = [
    { key: "surveys", used: sub.usage.surveys, limit: sub.limits.surveys },
    { key: "responses", used: sub.usage.responses_this_month, limit: sub.limits.responses_per_month },
    { key: "members", used: sub.usage.members, limit: sub.limits.members },
  ] as const;
  return (
    <dl className="grid gap-4">
      {rows.map((row) => {
        const full = row.limit !== null && row.used >= row.limit;
        return (
          <div key={row.key} className="grid gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{t(row.key)}</dt>
              <dd
                className={
                  full
                    ? "font-semibold tabular-nums text-warning-foreground dark:text-warning"
                    : "font-medium tabular-nums"
                }
              >
                {row.limit === null
                  ? t("unlimitedUsed", { used: format.number(row.used) })
                  : t("used", { used: format.number(row.used), limit: format.number(row.limit) })}
              </dd>
            </div>
            {row.limit !== null ? (
              <Progress
                value={row.limit > 0 ? Math.min(100, (row.used / row.limit) * 100) : 100}
                aria-label={t(row.key)}
              />
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

/** The workspace's own view of its subscription (settings). */
export function PlanSummaryCard({ sub }: { sub: SubscriptionSummary }) {
  const t = useTranslations("subscription");
  const locale = useLocale();
  const date = useDateFormat();
  const included = new Set(sub.features);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("cardTitle")}</CardTitle>
          <StateBadge state={sub.state} />
        </div>
        <CardDescription>
          {t("planLine", { plan: planName(sub, locale) })} ·{" "}
          {sub.period_ends_at
            ? t("periodEnds", { date: date(sub.period_ends_at) })
            : sub.state === "PENDING"
              ? t("periodPending")
              : t("periodOpen")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <UsageMeters sub={sub} />
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">{t("modules")}</p>
          <ul className="grid gap-1.5 text-sm">
            {PLAN_FEATURES.map((feature) => (
              <li
                key={feature}
                className={
                  included.has(feature)
                    ? "flex items-center gap-2"
                    : "flex items-center gap-2 text-muted-foreground"
                }
              >
                {included.has(feature) ? (
                  <CheckIcon className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <MinusIcon className="size-4" aria-hidden="true" />
                )}
                <span>{label(PLAN_FEATURE_LABELS, feature, locale as "ar" | "en")}</span>
                <span className="visually-hidden">
                  {included.has(feature) ? t("included") : t("notIncluded")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground text-pretty">{t("contactToChange")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
