import type { SubscriptionSummary } from "@meqyas/shared";
import { describe, expect, it } from "vitest";

import { parsePeople, resultsCsv } from "@/components/admin/bulk";
import { subscriptionNotices } from "@/components/subscription/subscription";

const NOW = Date.parse("2026-10-17T09:00:00Z");
const DAY = 86_400_000;

function sub(overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    plan_code: "basic",
    plan_name_ar: "أساسية",
    plan_name_en: "Basic",
    is_trial: false,
    state: "ACTIVE",
    period_started_at: "2026-01-01T00:00:00Z",
    period_ends_at: null,
    pending_days: null,
    collection_ends_at: null,
    month_resets_at: "2026-11-01T00:00:00+03:00",
    limits: { surveys: 10, responses_per_month: 1000, members: 3, ai_daily_tokens: 500000 },
    usage: { surveys: 2, responses_this_month: 100, members: 1 },
    features: ["exports"],
    ...overrides,
  };
}

describe("subscription banner", () => {
  it("says nothing when all is well, or for a closed workspace (it has its own screen)", () => {
    expect(subscriptionNotices(sub(), NOW)).toEqual([]);
    expect(subscriptionNotices(sub({ state: "SUSPENDED" }), NOW)).toEqual([]);
    expect(subscriptionNotices(null, NOW)).toEqual([]);
  });

  it("shows a trial with its surveys and days left", () => {
    const [notice] = subscriptionNotices(
      sub({ state: "TRIAL", is_trial: true, period_ends_at: new Date(NOW + 12 * DAY).toISOString() }),
      NOW,
    );
    expect(notice).toEqual({ key: "trial", tone: "info", values: { used: 2, limit: 10, days: 12 } });
  });

  it("warns before and after the end, then once collection stopped", () => {
    const soon = subscriptionNotices(sub({ period_ends_at: new Date(NOW + 5 * DAY).toISOString() }), NOW);
    expect(soon.map((n) => n.key)).toEqual(["endingSoon"]);
    const ended = sub({
      state: "EXPIRED",
      period_ends_at: new Date(NOW - DAY).toISOString(),
      collection_ends_at: new Date(NOW + 6 * DAY).toISOString(),
    });
    expect(subscriptionNotices(ended, NOW).map((n) => [n.key, n.tone])).toEqual([["expired", "warning"]]);
    const closed = { ...ended, collection_ends_at: new Date(NOW - DAY).toISOString() };
    expect(subscriptionNotices(closed, NOW)[0]?.key).toBe("expiredClosed");
  });

  it("flags used-up surveys and the month's responses (80% first, then the limit)", () => {
    const usage = (surveys: number, responses: number) => ({
      surveys,
      responses_this_month: responses,
      members: 1,
    });
    expect(subscriptionNotices(sub({ usage: usage(10, 100) }), NOW).map((n) => n.key)).toEqual([
      "surveysFull",
    ]);
    expect(subscriptionNotices(sub({ usage: usage(2, 800) }), NOW).map((n) => n.key)).toEqual([
      "responsesNear",
    ]);
    expect(subscriptionNotices(sub({ usage: usage(2, 1000) }), NOW)).toEqual([
      { key: "responsesFull", tone: "warning", values: { limit: 1000, date: "2026-11-01T00:00:00+03:00" } },
    ]);
    const unlimited = sub({
      limits: { surveys: null, responses_per_month: null, members: null, ai_daily_tokens: 1 },
    });
    expect(subscriptionNotices({ ...unlimited, usage: usage(500, 50000) }, NOW)).toEqual([]);
  });
});

describe("people pasted for bulk accounts", () => {
  it("reads tab-separated rows from Excel, finds the e-mail in any column and skips the header", () => {
    const text =
      "الاسم\tالبريد\tالمساحة\nمدرسة أ\tA@Schools.example\tمدرسة أ الابتدائية\nb@schools.example\tمدرسة ب";
    expect(parsePeople(text)).toEqual({
      rows: [
        { name: "مدرسة أ", email: "a@schools.example", organization_name: "مدرسة أ الابتدائية" },
        { name: "مدرسة ب", email: "b@schools.example", organization_name: "" },
      ],
      skipped: 0,
    });
  });

  it("reads CSV with quotes and Arabic commas, and counts lines without an e-mail", () => {
    const text = '\uFEFFname,email\n"Al-Noor, Riyadh",noor@x.example\nسارة، sara@x.example\nلا بريد هنا';
    const { rows, skipped } = parsePeople(text);
    expect(rows.map((r) => [r.name, r.email])).toEqual([
      ["Al-Noor, Riyadh", "noor@x.example"],
      ["سارة", "sara@x.example"],
    ]);
    expect(skipped).toBe(1);
  });

  it("writes a CSV Excel opens in Arabic (BOM, quoted cells)", () => {
    const csv = resultsCsv(["الاسم", "الرابط"], [["سارة, أ", "https://x/activate/abc"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"سارة, أ",https://x/activate/abc');
  });

  it("never lets a cell run as an Excel formula", () => {
    expect(resultsCsv(["name"], [["=HYPERLINK(1)"], [5]])).toBe("\uFEFFname\n'=HYPERLINK(1)\n5\n");
  });
});
