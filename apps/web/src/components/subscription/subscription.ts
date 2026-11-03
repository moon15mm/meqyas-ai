"use client";

import type { PlanFeature, SubscriptionSummary } from "@meqyas/shared";

import { useAuth } from "@/lib/auth/auth-provider";

const DAY = 86_400_000;

/** The active workspace's subscription — the freshest copy (reloaded after each publish). */
export function useSubscription(): SubscriptionSummary | null {
  const { memberships, activeOrg } = useAuth();
  const org = memberships.find((m) => m.organization_id === activeOrg?.organization_id) ?? activeOrg;
  return org?.subscription ?? null;
}

/** The module is part of the workspace's plan (the API decides; this only shapes the UI). */
export function useFeature(feature: PlanFeature): boolean {
  const sub = useSubscription();
  return !sub || sub.features.includes(feature);
}

export interface SubscriptionNotice {
  key:
    "trial" | "expired" | "expiredClosed" | "endingSoon" | "surveysFull" | "responsesNear" | "responsesFull";
  tone: "info" | "warning";
  values: Record<string, string | number>;
}

export function daysUntil(iso: string, now: number): number {
  return Math.ceil((Date.parse(iso) - now) / DAY);
}

/** What the banner says about the workspace's subscription, most important first. */
export function subscriptionNotices(
  sub: SubscriptionSummary | null,
  now: number = Date.now(),
): SubscriptionNotice[] {
  if (!sub || sub.state === "PENDING" || sub.state === "SUSPENDED") return [];
  const notices: SubscriptionNotice[] = [];
  const { limits, usage } = sub;
  if (sub.state === "EXPIRED") {
    const closed = sub.collection_ends_at ? Date.parse(sub.collection_ends_at) <= now : false;
    notices.push({
      key: closed ? "expiredClosed" : "expired",
      tone: "warning",
      values: { date: sub.period_ends_at ?? "", until: sub.collection_ends_at ?? "" },
    });
  } else if (sub.state === "TRIAL") {
    notices.push({
      key: "trial",
      tone: "info",
      values: {
        used: usage.surveys,
        limit: limits.surveys ?? -1,
        days: sub.period_ends_at ? Math.max(0, daysUntil(sub.period_ends_at, now)) : -1,
      },
    });
  } else if (sub.period_ends_at && daysUntil(sub.period_ends_at, now) <= 14) {
    notices.push({
      key: "endingSoon",
      tone: "info",
      values: { days: Math.max(0, daysUntil(sub.period_ends_at, now)), date: sub.period_ends_at },
    });
  }
  if (sub.state !== "EXPIRED" && limits.surveys !== null && usage.surveys >= limits.surveys) {
    notices.push({ key: "surveysFull", tone: "warning", values: { limit: limits.surveys } });
  }
  if (limits.responses_per_month !== null && sub.state !== "EXPIRED") {
    if (usage.responses_this_month >= limits.responses_per_month) {
      notices.push({
        key: "responsesFull",
        tone: "warning",
        values: { limit: limits.responses_per_month, date: sub.month_resets_at },
      });
    } else if (usage.responses_this_month >= 0.8 * limits.responses_per_month) {
      notices.push({
        key: "responsesNear",
        tone: "info",
        values: { used: usage.responses_this_month, limit: limits.responses_per_month },
      });
    }
  }
  return notices;
}
