import { describe, expect, it } from "vitest";

import { architectRequestSchema, measurementPlanDraftSchema } from "../src/schemas/plan";

const draft = {
  project_title: "قياس رضا الطالبات",
  measurement_type: "SATISFACTION",
  secondary_types: [],
  target_population: "طالبات المرحلة الثانوية",
  purpose: "معرفة مستوى الرضا",
  understanding_summary: "فهمنا أنك تريد قياس رضا الطالبات.",
  measurement_type_rationale: "طلب رضا وليس أثرًا.",
  objectives: [{ key: "o1", title: "قياس الرضا", description: "" }],
  dimensions: [
    { key: "content", name: "المحتوى", description: "", objective_key: "o1" },
    { key: "organization", name: "التنظيم", description: "", objective_key: "o1" },
  ],
  indicators: [
    {
      code: "IND-01",
      name: "نسبة الراضيات",
      description: "",
      dimension_key: "content",
      indicator_type: "PERCENTAGE",
      unit: "%",
      target: "80%",
      target_value: 80,
      formula: "",
      frequency: "ONCE",
      direction: "HIGHER_IS_BETTER",
    },
  ],
  recommended_design: "POST_ONLY",
  design_rationale: "",
  waves: [{ wave_type: "SINGLE", name: "القياس", timing: "", offset_days: null }],
  baseline_required: false,
  post_measurement_required: false,
  follow_up_recommended: false,
  follow_up_days: null,
  recommended_questions_count: 10,
  estimated_completion_minutes: 4,
  methodology_notes: [],
  clarifying_questions: [],
  language: "ar",
  evidence_level: "DESCRIPTIVE",
  outcome_level: "REACTION",
  rules_applied: [],
  warnings: [],
};

describe("measurement plan schema", () => {
  it("accepts a valid draft", () => {
    expect(measurementPlanDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects unknown enum values and too few dimensions", () => {
    expect(measurementPlanDraftSchema.safeParse({ ...draft, measurement_type: "MAGIC" }).success).toBe(false);
    expect(
      measurementPlanDraftSchema.safeParse({ ...draft, dimensions: [draft.dimensions[0]] }).success,
    ).toBe(false);
  });

  it("validates the composer request length", () => {
    expect(architectRequestSchema.safeParse({ request: "قصير" }).success).toBe(false);
    expect(architectRequestSchema.safeParse({ request: "أريد قياس رضا الطالبات عن البرنامج" }).success).toBe(
      true,
    );
  });
});
