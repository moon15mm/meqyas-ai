import type { QuestionDoc, SurveyDoc } from "@meqyas/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import ar from "../messages/ar.json";
import { PulseRenderer } from "@/components/survey/pulse/pulse-renderer";
import type { SubmissionPayload } from "@/components/survey/renderer/survey-renderer";

function question(over: Partial<QuestionDoc> & Pick<QuestionDoc, "key" | "type" | "text">): QuestionDoc {
  return {
    description: "",
    required: true,
    options: [],
    scale: null,
    validation: {},
    settings: { randomize_options: false, rows: [], placeholder: "", ai_followup: false, is_profile: false },
    scoring: { weight: 1, correct_values: [] },
    ai_generated: false,
    ...over,
  } as QuestionDoc;
}

const scale = (min: number, max: number) => ({
  min,
  max,
  step: 1,
  min_label: "",
  max_label: "",
  reverse_scored: false,
});

const DOC: SurveyDoc = {
  title: "قيّم زيارتك",
  introduction: "",
  thank_you_message: "شكرًا لك!",
  language: "ar",
  sections: [
    {
      key: "visit",
      title: "",
      description: "",
      randomize_questions: false,
      questions: [
        question({ key: "csat", type: "CSAT", text: "ما مدى رضاك عن زيارتك؟", scale: scale(1, 5) }),
        question({ key: "nps", type: "NPS", text: "هل توصي بنا؟", scale: scale(0, 10) }),
        question({
          key: "contact_ok",
          type: "SINGLE_CHOICE",
          text: "هل تود أن نتواصل معك؟",
          required: false,
          options: [
            { value: "yes", label: "نعم، تواصلوا معي", score: null, is_other: false, is_exclusive: false },
            { value: "no", label: "لا، شكرًا", score: null, is_other: false, is_exclusive: false },
          ],
        }),
        question({
          key: "phone",
          type: "SHORT_TEXT",
          text: "رقم الجوال للتواصل",
          settings: {
            randomize_options: false,
            rows: [],
            placeholder: "",
            ai_followup: false,
            is_profile: false,
            contact_field: "phone",
          },
        }),
      ],
    },
  ],
  logic: [
    {
      id: "r1",
      type: "DISPLAY",
      target_key: "contact_ok",
      condition: { question: "nps", op: "lte", value: 6 },
      enabled: true,
    },
    {
      id: "r2",
      type: "DISPLAY",
      target_key: "phone",
      condition: { question: "contact_ok", op: "eq", value: "yes" },
      enabled: true,
    },
  ],
  settings: {
    one_question_per_page: true,
    show_progress: true,
    allow_back: true,
    anonymity_mode: "ANONYMOUS",
    collect_respondent_code: false,
    ai_followup_enabled: false,
    ai_followup_max: 2,
    experience: "pulse",
    reward_text: "استخدم الكود SHUKRAN10 في زيارتك القادمة",
    closed_loop: true,
  },
};

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PulseRenderer", () => {
  it("moves on after a tap, waits for Next after a keyboard choice, and asks for a phone only on consent", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(payload: SubmissionPayload) => Promise<void>>(async () => undefined);
    renderAr(<PulseRenderer doc={DOC} onSubmit={onSubmit} />);

    expect(screen.getByRole("heading", { name: "ما مدى رضاك عن زيارتك؟" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "ممتاز" })); // a tap on a face…
    expect(await screen.findByRole("heading", { name: "هل توصي بنا؟" })).toBeInTheDocument(); // …moves on

    fireEvent.click(screen.getByRole("radio", { name: "3" })); // keyboard-style choice: no pointer
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByRole("heading", { name: "هل توصي بنا؟" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "التالي" }));

    // A detractor is offered a follow-up; the phone field appears only after "yes".
    await user.click(await screen.findByRole("radio", { name: "نعم، تواصلوا معي" }));
    const phone = await screen.findByRole("textbox", { name: "رقم الجوال للتواصل" });
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("dir", "ltr");
    await user.type(phone, "0551234567");
    await user.click(screen.getByRole("button", { name: "إرسال" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].answers).toEqual({
      csat: 5,
      nps: 3,
      contact_ok: "yes",
      phone: "0551234567",
    });
    expect(await screen.findByText("استخدم الكود SHUKRAN10 في زيارتك القادمة")).toBeInTheDocument();
  });

  it("starts a kiosk on a welcome screen", async () => {
    const user = userEvent.setup();
    renderAr(<PulseRenderer doc={DOC} kiosk location="فرع العليا" onRestart={() => undefined} />);
    expect(screen.getByText("فرع العليا")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ابدأ التقييم" }));
    expect(screen.getByRole("heading", { name: "ما مدى رضاك عن زيارتك؟" })).toBeInTheDocument();
  });
});
