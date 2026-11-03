import type { MeasurementPlanDraft } from "@meqyas/shared";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import ar from "../messages/ar.json";
import { isActive } from "@/components/layout/nav-config";
import { DesignFlow } from "@/components/measurement/design-flow";
import { PlanDimensions, PlanNotes, PlanRationale } from "@/components/measurement/plan-view";

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      <div dir="rtl">{ui}</div>
    </NextIntlClientProvider>,
  );
}

const draft: MeasurementPlanDraft = {
  project_title: "قياس رضا الطالبات",
  measurement_type: "SATISFACTION",
  secondary_types: [],
  target_population: "طالبات المرحلة الثانوية",
  purpose: "معرفة مستوى الرضا لتحسين البرنامج",
  understanding_summary: "فهمنا أنك تريد قياس رضا الطالبات عن البرنامج التدريبي.",
  measurement_type_rationale: "الطلب عن الرضا وليس عن التغير.",
  objectives: [{ key: "o1", title: "قياس الرضا العام", description: "" }],
  dimensions: [
    { key: "content", name: "المحتوى", description: "", objective_key: "o1" },
    { key: "trainer", name: "المدربة", description: "", objective_key: "o1" },
  ],
  indicators: [
    {
      code: "IND-01",
      name: "نسبة الراضيات عن المحتوى",
      description: "",
      dimension_key: "content",
      indicator_type: "PERCENTAGE",
      unit: "%",
      target: "80% أو أكثر",
      target_value: 80,
      formula: "",
      frequency: "ONCE",
      direction: "HIGHER_IS_BETTER",
    },
  ],
  recommended_design: "POST_ONLY",
  design_rationale: "",
  waves: [{ wave_type: "SINGLE", name: "القياس", timing: "بعد البرنامج", offset_days: null }],
  baseline_required: false,
  post_measurement_required: false,
  follow_up_recommended: false,
  follow_up_days: null,
  recommended_questions_count: 10,
  estimated_completion_minutes: 4,
  methodology_notes: ["احرص على سرية الإجابات.", "النتائج تصف الآراء ولا تثبت أن البرنامج هو السبب."],
  clarifying_questions: [],
  language: "ar",
  evidence_level: "DESCRIPTIVE",
  outcome_level: "REACTION",
  rules_applied: ["R2_flags_from_design"],
  warnings: [],
};

describe("plan review components", () => {
  it("explains that satisfaction is not impact (reaction-level note)", () => {
    renderAr(<PlanRationale draft={draft} advanced={false} />);
    expect(screen.getByText(/هذا أقرب إلى قياس الرضا والانطباع، وليس قياس أثر/)).toBeInTheDocument();
  });

  it("nests indicators under their dimension", () => {
    renderAr(<PlanDimensions draft={draft} advanced={false} />);
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("h4"));
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("نسبة الراضيات عن المحتوى")).toBeInTheDocument();
    expect(within(items[1]!).getByText("لا توجد مؤشرات لهذا البعد")).toBeInTheDocument();
  });

  it("renders the measurement design flow in order with evidence level", () => {
    renderAr(
      <DesignFlow
        design="PRE_POST_FOLLOW_UP"
        evidence="CHANGE_PERSISTENCE"
        waves={[
          { wave_type: "BASELINE", name: "القياس القبلي", timing: "قبل البرنامج" },
          { wave_type: "POST", name: "القياس البعدي", timing: "بعد البرنامج" },
          { wave_type: "FOLLOW_UP", name: "قياس المتابعة", timing: "بعد 30 يومًا" },
        ]}
      />,
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps[0]).toContain("القياس القبلي");
    expect(steps[2]).toContain("بعد 30 يومًا");
    expect(screen.getByText("تغير واستمرارية")).toBeInTheDocument();
  });

  it("highlights causality caveats and shows applied rules only in advanced mode", () => {
    const { rerender } = renderAr(<PlanNotes draft={draft} advanced={false} />);
    expect(screen.queryByText("R2_flags_from_design")).not.toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
        <PlanNotes draft={draft} advanced />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("R2_flags_from_design")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("matches active routes", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/projects/123", "/projects")).toBe(true);
    expect(isActive("/projects", "/")).toBe(false);
    expect(isActive("/project-types", "/projects")).toBe(false);
  });
});
