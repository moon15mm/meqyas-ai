import type { CxDashboard } from "@meqyas/shared";
import { TooltipProvider } from "@meqyas/ui";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import ar from "../messages/ar.json";
import { BranchTable, CxKpis, DriverMatrix, metricsOf } from "@/components/cx/dashboard";

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      <TooltipProvider>
        <div dir="rtl">{ui}</div>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

const nps = (score: number, n: number) => ({
  score,
  promoters: 50,
  passives: 30,
  detractors: 20,
  n,
  ci_low: score - 10,
  ci_high: score + 10,
  suitable: n >= 10,
});

const DATA: CxDashboard = {
  has_cx: true,
  overall: { n: 64, nps: nps(30, 64), csat: { pct: 81.2, mean: 4.1, n: 64 } },
  locations: [
    { id: "a", name: "فرع الحمراء", n: 30, nps: nps(12, 30), csat: { pct: 70, mean: 3.8, n: 30 } },
    { id: "b", name: "فرع العليا", n: 31, nps: nps(48, 31), csat: { pct: 90, mean: 4.4, n: 31 } },
    { id: "c", name: "فرع جديد", n: 3, nps: { masked: true, n: 3 }, csat: { masked: true, n: 3 } },
  ],
  channels: { branch: { n: 64 } },
  weekly: [],
  drivers: {
    outcome: { key: "visit_nps", text: "هل توصي بنا؟", type: "NPS", min: 0, max: 10 },
    min_pairs: 30,
    items: [
      {
        key: "staff",
        text: "الموظفون",
        n: 64,
        pairs: 64,
        masked: false,
        performance: 74,
        mean: 4,
        importance: 0.71,
        p_value: 0.001,
        quadrant: "keep",
      },
      {
        key: "checkout",
        text: "سرعة المحاسبة",
        n: 64,
        pairs: 64,
        masked: false,
        performance: 55,
        mean: 3.2,
        importance: 0.6,
        p_value: 0.001,
        quadrant: "fix",
      },
      {
        key: "clean",
        text: "النظافة",
        n: 64,
        pairs: 64,
        masked: false,
        performance: 88,
        mean: 4.5,
        importance: 0.1,
        p_value: 0.4,
        quadrant: "maintain",
      },
      {
        key: "value",
        text: "القيمة مقابل السعر",
        n: 20,
        pairs: 20,
        masked: false,
        performance: 60,
        mean: 3.4,
        importance: null,
        p_value: null,
      },
    ],
  },
  cases: { open: 2, overdue: 1, resolved: 5, within_sla_pct: 80, median_hours: 20.5 },
  k_anonymity: 5,
};

describe("CX dashboard", () => {
  it("shows the measures the project collects, and only those", () => {
    expect(metricsOf(DATA.overall)).toEqual(["nps", "csat"]);
    renderAr(<CxKpis data={DATA} />);
    expect(screen.getByText("صافي نقاط الترويج (NPS)")).toBeInTheDocument();
    expect(screen.getByText("81%")).toBeInTheDocument();
    expect(screen.queryByText("سهولة التعامل (CES)")).not.toBeInTheDocument();
  });

  it("ranks branches by NPS and never shows a masked value", () => {
    renderAr(<BranchTable data={DATA} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "فرع العليا",
      "فرع الحمراء",
      "فرع جديد",
    ]);
    expect(within(rows[0]!).getByText("+48")).toBeInTheDocument();
    expect(within(rows[2]!).getAllByText("مخفي حمايةً للخصوصية (أقل من 5 تقييمات)")).toHaveLength(2);
  });

  it("puts each driver in its quadrant and waits for enough pairs", () => {
    renderAr(<DriverMatrix data={DATA} />);
    const fix = screen.getByText("أصلح أولًا").closest("li")!;
    expect(within(fix).getByText("سرعة المحاسبة")).toBeInTheDocument();
    expect(within(screen.getByText("حافظ عليه").closest("li")!).getByText("الموظفون")).toBeInTheDocument();
    expect(screen.getByText("بانتظار تقييمات كافية")).toBeInTheDocument();
    expect(screen.getByText("20 من 30")).toBeInTheDocument();
    expect(screen.getByText(/الارتباط لا يعني السببية/)).toBeInTheDocument();
  });
});
