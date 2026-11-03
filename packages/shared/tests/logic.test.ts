import { describe, expect, it } from "vitest";

import fixtures from "../../../tests/fixtures/logic-cases.json";
import type { Condition, SurveyDoc } from "../src/survey/document";
import { computePath, evaluate, pipe } from "../src/survey/logic";

const doc = fixtures.survey as unknown as SurveyDoc;
// The API fills default Likert labels; mirror that for the fixture document.
const likert = doc.sections[1]!.questions.find((q) => q.key === "satisfaction")!;
likert.options = ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"].map((label, i) => ({
  value: String(i + 1),
  label,
  score: i + 1,
  is_other: false,
  is_exclusive: false,
}));
for (const q of doc.sections.flatMap((s) => s.questions)) q.options ??= [];

describe("logic engine parity (shared fixtures)", () => {
  for (const c of fixtures.conditions) {
    it(`condition: ${c.name}`, () => {
      expect(evaluate(c.condition as Condition, c.answers as Record<string, unknown>)).toBe(c.expected);
    });
  }

  for (const p of fixtures.paths) {
    it(`path: ${p.name}`, () => {
      const result = computePath(doc, p.answers as Record<string, unknown>);
      expect(result.visible).toEqual(p.expected_visible);
      expect(result.endedBy).toBe(p.expected_ended_by);
    });
  }

  for (const p of fixtures.piping) {
    it(`piping: ${p.text}`, () => {
      expect(pipe(p.text, doc, p.answers as Record<string, unknown>)).toBe(p.expected);
    });
  }
});
