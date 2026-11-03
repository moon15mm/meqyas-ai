import type { AnalyticsSummary, QuestionStats } from "@meqyas/shared";
import { TooltipProvider } from "@meqyas/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import ar from "../messages/ar.json";
import { DimensionChart, fillDays, IndicatorGrid } from "@/components/analytics/overview";
import { QuestionCard } from "@/components/analytics/question-card";
import { divergingColors, ordinalColors } from "@/components/analytics/viz";

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      <TooltipProvider>
        <div dir="rtl">{ui}</div>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe("chart colors", () => {
  it("spreads waves over the validated ordinal ramp, earliest first", () => {
    expect(ordinalColors(1)).toEqual(["var(--viz-seq-3)"]);
    expect(ordinalColors(3)).toEqual(["var(--viz-seq-1)", "var(--viz-seq-3)", "var(--viz-seq-5)"]);
    expect(new Set(ordinalColors(5)).size).toBe(5);
  });

  it("builds a diverging scale with a neutral midpoint only for odd scales", () => {
    expect(divergingColors(5)).toEqual([
      "var(--viz-neg-2)",
      "var(--viz-neg-1)",
      "var(--viz-mid)",
      "var(--viz-pos-1)",
      "var(--viz-pos-2)",
    ]);
    expect(divergingColors(4)).not.toContain("var(--viz-mid)");
    const seven = divergingColors(7);
    expect(seven[0]).toBe("var(--viz-neg-3)");
    expect(seven[6]).toBe("var(--viz-pos-3)");
  });
});

describe("responses over time", () => {
  it("fills the days without responses so gaps are not hidden", () => {
    const days = fillDays([
      { date: "2026-10-01", count: 3 },
      { date: "2026-10-04", count: 1 },
    ]);
    expect(days.map((d) => d.count)).toEqual([3, 0, 0, 1]);
  });

  it("switches to weekly sums for long ranges without losing responses", () => {
    const days = fillDays([
      { date: "2026-01-01", count: 2 },
      { date: "2026-06-30", count: 5 },
    ]);
    expect(days.length).toBeLessThan(30);
    expect(days.reduce((a, d) => a + d.count, 0)).toBe(7);
  });
});

const likert: QuestionStats = {
  key: "know_tools",
  text: "أعرف أدوات الذكاء الاصطناعي المناسبة لمادتي.",
  type: "LIKERT",
  section: "المعرفة",
  dimension_id: null,
  indicator_id: null,
  is_profile: false,
  n: 35,
  masked: false,
  describe: {
    suitable: true,
    reason: null,
    n: 35,
    mean: 3.8,
    median: 4,
    sd: 0.9,
    min: 2,
    max: 5,
    q1: 3,
    q3: 4,
    modes: [4],
  },
  ci: { suitable: true, reason: null, estimate: 3.8, low: 3.51, high: 4.09, level: 0.95 },
  top_box: {
    suitable: true,
    reason: null,
    estimate: 0.714,
    low: 0.55,
    high: 0.84,
    level: 0.95,
    threshold: 4,
  },
  distribution: {
    n: 35,
    suitable: true,
    categories: [
      { value: "1", label: "لا أوافق بشدة", count: 0, pct: 0 },
      { value: "2", label: "لا أوافق", count: 3, pct: 8.6 },
      { value: "3", label: "محايد", count: 7, pct: 20 },
      { value: "4", label: "أوافق", count: 19, pct: 54.3 },
      { value: "5", label: "أوافق بشدة", count: 6, pct: 17.1 },
    ],
  },
};

describe("question card", () => {
  it("shows a Likert question as a diverging 100% bar with its legend and a table twin", () => {
    renderAr(<QuestionCard q={likert} canReadText segmentLabel={null} k={5} />);
    // Top-box is a proportion (0–1) shown as a percentage.
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /أوافق: 54%/ })).toBeInTheDocument();
    expect(screen.getByText("أوافق بشدة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "عرض كجدول" }));
    expect(screen.getByRole("columnheader", { name: "النسبة" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "أوافق" })).toBeInTheDocument();
  });

  it("hides every statistic of a question answered by fewer than K people", () => {
    renderAr(<QuestionCard q={{ ...likert, n: 3, masked: true }} canReadText segmentLabel={null} k={5} />);
    expect(screen.getByText(/مخفي حمايةً للخصوصية: 3 إجابات فقط/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عرض كجدول" })).not.toBeInTheDocument();
  });

  it("tells viewers that raw text is not available to their role", () => {
    const text: QuestionStats = {
      ...likert,
      key: "best_part",
      type: "LONG_TEXT",
      describe: undefined,
      ci: undefined,
      top_box: undefined,
      distribution: undefined,
      text_count: 12,
    };
    renderAr(<QuestionCard q={text} canReadText={false} segmentLabel={null} k={5} />);
    expect(screen.getByText("12 إجابة نصية")).toBeInTheDocument();
    expect(screen.getByText(/عدد الإجابات النصية فقط/)).toBeInTheDocument();
  });
});

describe("dimension chart", () => {
  it("separates waves without data from waves hidden for privacy", () => {
    const summary = {
      waves: [
        { wave: "BASELINE", name: null, n: 40, survey_ids: [] },
        { wave: "POST", name: null, n: 35, survey_ids: [] },
      ],
      k_anonymity: 5,
      dimensions: [
        {
          id: "d1",
          key: "satisfaction",
          name: "الرضا",
          items: 2,
          waves: [
            {
              wave: "BASELINE",
              n: 0,
              masked: false,
              mean: null,
              scale_min: null,
              scale_max: null,
              score: null,
              ci_low: null,
              ci_high: null,
              top_box: null,
              alpha: null,
              alpha_label: null,
            },
            {
              wave: "POST",
              n: 3,
              masked: true,
              mean: null,
              scale_min: null,
              scale_max: null,
              score: null,
              ci_low: null,
              ci_high: null,
              top_box: null,
              alpha: null,
              alpha_label: null,
            },
          ],
        },
      ],
    } as unknown as AnalyticsSummary;
    renderAr(<DimensionChart summary={summary} />);
    expect(screen.getByText("لا توجد بيانات لهذا البُعد في القياس القبلي")).toBeInTheDocument();
    expect(screen.getByText(/مخفي حمايةً للخصوصية: 3 إجابات فقط/)).toBeInTheDocument();
  });
});

describe("indicator cards", () => {
  it("shows an indicator below the privacy minimum as collecting, with how many answers arrived", () => {
    const indicator = {
      id: "i2",
      code: "IND-02",
      name: "نسبة الود الإيجابي",
      indicator_type: "PERCENTAGE",
      unit: "%",
      direction: "HIGHER_IS_BETTER",
      target_value: 75,
      method: "top_box_pct",
      items: 2,
      items_from: "dimension",
      waves: [{ wave: "SINGLE", value: null, n: 1, reason: "below_k_anonymity" }],
      current_value: null,
      baseline_value: null,
      status: "COLLECTING",
    };
    const summary = { k_anonymity: 5, indicators: [indicator] } as unknown as AnalyticsSummary;
    renderAr(<IndicatorGrid summary={summary} />);
    expect(screen.getByText("قيد الجمع")).toBeInTheDocument();
    expect(screen.queryByText("لم يبدأ")).not.toBeInTheDocument();
    expect(screen.getByText(/تظهر القيمة بعد 5 إجابات على الأقل/)).toHaveTextContent("إجابة واحدة");
    expect(screen.getByText("يُحسب من أسئلة البُعد (سؤالان).")).toBeInTheDocument();
  });
});
