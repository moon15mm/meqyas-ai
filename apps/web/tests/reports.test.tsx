import type { ReportContent } from "@meqyas/shared";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import ar from "../messages/ar.json";
import { ReportDocument, splitBidi } from "@/components/reports/report-document";

const ltr = (text: string) =>
  splitBidi(text)
    .filter((p) => p.ltr)
    .map((p) => p.text);

describe("bidi isolation in Arabic report text", () => {
  it("keeps statistics, signs and brackets together", () => {
    expect(ltr("ارتفعت الثقة من 2.73 إلى 3.60 (+0.87) مع d = 1.30 (p < 0.001)؛")).toEqual([
      "2.73",
      "3.60",
      "(+0.87)", // a separate item: it keeps the sentence's right-to-left order
      "d = 1.30 (p < 0.001)",
    ]);
    expect(ltr("بلغت النسبة 34.5 % مقابل 75 %")).toEqual(["34.5 %", "75 %"]);
  });

  it("leaves Arabic brackets and sentence punctuation outside the runs", () => {
    expect(ltr("حجم أثر 2.16 (أثر كبير).")).toEqual(["2.16"]);
    expect(ltr("(أثر كبير d = 1.3)")).toEqual(["d = 1.3"]);
    expect(splitBidi("نص عربي فقط")).toEqual([{ text: "نص عربي فقط", ltr: false }]);
    expect(splitBidi("Plain English 3.5")).toEqual([{ text: "Plain English 3.5", ltr: false }]);
  });

  it("reassembles to the original text", () => {
    const text = "سجّل IND-03 نسبة 34.5% مقابل مستهدف 75% (قياس المتابعة، n=29).";
    expect(
      splitBidi(text)
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });
});

const CONTENT: ReportContent = {
  schema: 1,
  title: "تقرير تنفيذي — برنامج تدريبي",
  type_label: "تقرير تنفيذي",
  project_title: "برنامج تدريبي",
  organization: "مدرسة تجريبية",
  language: "ar",
  tone: "FORMAL",
  audience: "مجلس الإدارة",
  generated_at: "2026-10-10T10:00:00Z",
  data_range: { from: "2026-08-25", to: "2026-10-08" },
  evidence_level: "CHANGE",
  evidence_label: "تغير ملحوظ",
  caveat: "هذا يصف التغير ولا يثبت السبب.",
  ai: { requested: true, used: true, error: null, rejected: [] },
  sections: [
    {
      key: "summary",
      kind: "narrative",
      title: "الملخص التنفيذي",
      hidden: false,
      paragraphs: ["ارتفعت المعرفة من 2.33 إلى 3.64."],
      bullets: [],
      evidence_ids: ["F3"],
      source: "AI",
    },
    {
      key: "key_figures",
      kind: "kpis",
      title: "أرقام رئيسية",
      hidden: true,
      items: [{ label: "إجابات في التحليل", value: "104", note: "من أصل 106" }],
    },
    {
      key: "indicators_table",
      kind: "table",
      title: "المؤشرات",
      hidden: false,
      columns: ["الرمز", "المؤشر", "الحالة"],
      rows: [["IND-03", "نسبة القادرين", "خارج المسار"]],
      status_column: 2,
      statuses: ["OFF_TRACK"],
    },
    {
      key: "appendix",
      kind: "facts",
      title: "ملحق: الأرقام المستشهد بها",
      hidden: false,
      items: [{ id: "F3", label: "تغير «المعرفة»", value: "2.33 → 3.64 (+1.31)", n: 29 }],
    },
  ],
};

describe("report document", () => {
  it("numbers visible sections, hides hidden ones and links sources to the appendix", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
        <ReportDocument content={CONTENT} version={3} />
      </NextIntlClientProvider>,
    );
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("تقرير تنفيذي — برنامج تدريبي");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["1. الملخص التنفيذي", "2. المؤشرات", "3. ملحق: الأرقام المستشهد بها"]);
    expect(screen.queryByText("أرقام رئيسية")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "F3" })).toHaveAttribute("href", "#fact-F3");
    expect(document.getElementById("fact-F3")).not.toBeNull();
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getByText("خارج المسار")).toBeInTheDocument(); // status shown with its label
  });

  it("shows hidden sections and text editors in edit mode", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
        <ReportDocument content={CONTENT} version={3} editing />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("أرقام رئيسية")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("ارتفعت المعرفة من 2.33 إلى 3.64.");
  });
});
