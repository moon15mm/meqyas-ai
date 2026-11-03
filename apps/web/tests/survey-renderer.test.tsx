import type { SurveyDoc } from "@meqyas/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import ar from "../messages/ar.json";
import { NumericInput } from "@/components/common/numeric-input";
import {
  buildPages,
  SurveyRenderer,
  type SubmissionPayload,
} from "@/components/survey/renderer/survey-renderer";

const likert = (key: string, text: string) => ({
  key,
  type: "LIKERT" as const,
  text,
  description: "",
  required: true,
  options: [1, 2, 3, 4, 5].map((n) => ({
    value: String(n),
    label: `خيار ${n}`,
    score: n,
    is_other: false,
    is_exclusive: false,
  })),
  scale: { min: 1, max: 5, step: 1, min_label: "", max_label: "", reverse_scored: false },
  validation: {},
  settings: { randomize_options: false, rows: [], placeholder: "", ai_followup: false, is_profile: false },
  scoring: { weight: 1, correct_values: [] },
  ai_generated: false,
});

const DOC: SurveyDoc = {
  title: "استبيان تجريبي",
  introduction: "",
  thank_you_message: "شكرًا لمشاركتك",
  language: "ar",
  sections: [
    {
      key: "s1",
      title: "الرضا",
      description: "",
      randomize_questions: false,
      questions: [
        likert("sat", "ما مدى رضاك؟"),
        {
          ...likert("why", "ما سبب عدم رضاك؟"),
          type: "LONG_TEXT",
          required: false,
          options: [],
          scale: null,
        },
      ],
    },
  ],
  logic: [
    {
      id: "r1",
      type: "DISPLAY",
      target_key: "why",
      condition: { question: "sat", op: "lte", value: 2 },
      enabled: true,
    },
  ],
  settings: {
    one_question_per_page: false,
    show_progress: true,
    allow_back: true,
    anonymity_mode: "ANONYMOUS",
    collect_respondent_code: false,
    ai_followup_enabled: false,
    ai_followup_max: 2,
    experience: "standard",
    reward_text: "",
    closed_loop: false,
  },
};

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("buildPages", () => {
  it("applies display logic to the visible questions", () => {
    expect(buildPages(DOC, {}, 1).pages[0]!.questions.map((q) => q.key)).toEqual(["sat"]);
    expect(buildPages(DOC, { sat: "1" }, 1).pages[0]!.questions.map((q) => q.key)).toEqual(["sat", "why"]);
    expect(buildPages(DOC, { sat: "5" }, 1).pages[0]!.questions.map((q) => q.key)).toEqual(["sat"]);
  });

  it("splits pages per question when configured", () => {
    const doc = { ...DOC, settings: { ...DOC.settings, one_question_per_page: true } };
    expect(buildPages(doc, { sat: "1" }, 1).pages.map((p) => p.key)).toEqual(["sat", "why"]);
  });
});

describe("SurveyRenderer", () => {
  it("validates required answers, reveals logic and submits only visible answers", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(payload: SubmissionPayload) => Promise<void>>(async () => undefined);
    renderAr(<SurveyRenderer doc={DOC} mode="live" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "إرسال" }));
    expect(screen.getByRole("alert")).toHaveTextContent("هذا السؤال مطلوب.");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "خيار 1" }));
    expect(screen.getByRole("group", { name: "ما سبب عدم رضاك؟" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "خيار 4" }));
    expect(screen.queryByRole("group", { name: "ما سبب عدم رضاك؟" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "إرسال" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].answers).toEqual({ sat: 4 }); // scale answers are numeric
    expect(await screen.findByText("شكرًا لمشاركتك")).toBeInTheDocument();
  });
});

describe("NumericInput", () => {
  it("keeps partial input and accepts Arabic-Indic digits", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<NumericInput aria-label="n" value={null} onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "n" });
    await user.type(input, "٣٫");
    expect(input).toHaveValue("٣٫"); // not normalised away while typing
    expect(onValueChange).toHaveBeenLastCalledWith(3, "٣٫");
    await user.type(input, "٥");
    expect(onValueChange).toHaveBeenLastCalledWith(3.5, "٣٫٥");
  });
});
