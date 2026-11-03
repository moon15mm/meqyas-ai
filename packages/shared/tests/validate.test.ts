import { describe, expect, it } from "vitest";

import fixtures from "../../../tests/fixtures/answer-cases.json";
import { questionDocSchema, type QuestionDoc } from "../src/survey/document";
import { validateAnswer } from "../src/survey/validate";

const questions = Object.fromEntries(
  Object.entries(fixtures.questions).map(([key, raw]) => [key, questionDocSchema.parse(raw) as QuestionDoc]),
);

describe("answer validation parity (shared fixtures)", () => {
  for (const c of fixtures.cases) {
    it(`${c.q} ← ${JSON.stringify(c.value)} → ${c.expected ?? "ok"}`, () => {
      const error = validateAnswer(questions[c.q]!, c.value);
      expect(error?.code ?? null).toBe(c.expected);
    });
  }
});
