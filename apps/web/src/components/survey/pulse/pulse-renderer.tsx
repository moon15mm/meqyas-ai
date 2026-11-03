"use client";

import {
  computePath,
  isAnswered,
  pipe,
  type Answers,
  type AnswerError,
  type OptionDoc,
  type QuestionDoc,
  type SurveyDoc,
  validateAnswer,
} from "@meqyas/shared";
import { Button, cn, Input, Spinner, Textarea } from "@meqyas/ui";
import {
  AngryIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  FrownIcon,
  LaughIcon,
  type LucideIcon,
  MapPinIcon,
  MehIcon,
  SmileIcon,
  StarIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { QuestionInput } from "../renderer/question-input";
import { buildPages, SubmissionError, type SubmissionPayload } from "../renderer/survey-renderer";

/*
 * The "pulse" experience (CX.md §4): one tap per screen with auto-advance, faces, stars and a
 * colored 0–10 scale, about 30–45 seconds end to end. Keyboard users get the same flow with
 * an explicit Next button (auto-advance only follows a pointer tap, never an arrow key).
 * Kiosk mode starts each customer on a welcome screen and resets after the thank-you or
 * when the tablet is left idle.
 */

const AUTO_ADVANCE_MS = 260;
const KIOSK_IDLE_MS = 75_000;
const KIOSK_RESET_S = 8;
const FACES: LucideIcon[] = [AngryIcon, FrownIcon, MehIcon, SmileIcon, LaughIcon];
const FACE_TONE = [
  "var(--viz-neg-2)",
  "var(--viz-neg-1)",
  "var(--viz-mid)",
  "var(--viz-pos-1)",
  "var(--viz-pos-2)",
];
const AUTO_TYPES = new Set(["CSAT", "STAR", "NPS", "CES", "RATING", "LIKERT", "SINGLE_CHOICE", "DROPDOWN"]);

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Radio group of large tap targets; `onPick` reports whether the choice came from a pointer tap. */
function useTapSource() {
  const tapped = React.useRef(false);
  return {
    onPointerDown: () => {
      tapped.current = true;
    },
    take: () => {
      const was = tapped.current;
      tapped.current = false;
      return was;
    },
  };
}

function Faces({
  question,
  value,
  onPick,
}: {
  question: QuestionDoc;
  value: unknown;
  onPick: (v: number, tap: boolean) => void;
}) {
  const t = useTranslations("survey.pulse");
  const tap = useTapSource();
  const labels = t.raw("faces") as string[];
  const current = typeof value === "number" ? value : null;
  return (
    <div
      role="radiogroup"
      aria-label={question.text}
      className="grid grid-cols-5 gap-2"
      onPointerDown={tap.onPointerDown}
    >
      {range(1, 5).map((n, i) => {
        const Icon = FACES[i]!;
        const checked = current === n;
        const text =
          i === 0 && question.scale?.min_label
            ? question.scale.min_label
            : i === 4 && question.scale?.max_label
              ? question.scale.max_label
              : labels[i];
        return (
          <label
            key={n}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 border-transparent bg-muted/50 px-1 py-3 text-center transition-[background-color,border-color,scale] duration-150 hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring active:scale-95",
              checked && "border-current bg-card",
            )}
            style={checked ? { color: FACE_TONE[i] } : undefined}
          >
            <input
              type="radio"
              name={`pulse-${question.key}`}
              className="visually-hidden"
              checked={checked}
              onChange={() => onPick(n, tap.take())}
            />
            <Icon
              className={cn("size-9 sm:size-11", checked ? "" : "text-muted-foreground")}
              strokeWidth={checked ? 2.2 : 1.6}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-[11px] leading-tight sm:text-xs",
                checked ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {text}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Stars({
  question,
  value,
  onPick,
}: {
  question: QuestionDoc;
  value: unknown;
  onPick: (v: number, tap: boolean) => void;
}) {
  const t = useTranslations("survey.pulse");
  const tap = useTapSource();
  const max = question.scale?.max ?? 5;
  const current = typeof value === "number" ? value : 0;
  const [hover, setHover] = React.useState(0);
  const shown = hover || current;
  const words = t.raw("stars") as string[];
  return (
    <div className="grid justify-items-center gap-3">
      <div
        role="radiogroup"
        aria-label={question.text}
        className="flex gap-1.5"
        onPointerDown={tap.onPointerDown}
        onPointerLeave={() => setHover(0)}
      >
        {range(1, max).map((n) => (
          <label
            key={n}
            className="cursor-pointer rounded-xl p-1 transition-[scale] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring active:scale-90"
            onPointerEnter={() => setHover(n)}
          >
            <input
              type="radio"
              name={`pulse-${question.key}`}
              className="visually-hidden"
              checked={current === n}
              onChange={() => onPick(n, tap.take())}
            />
            <StarIcon
              className={cn(
                "size-11 transition-colors sm:size-12",
                n <= shown ? "fill-warning text-warning" : "text-muted-foreground/40",
              )}
              aria-hidden="true"
            />
            <span className="visually-hidden">{t("starLabel", { n, max })}</span>
          </label>
        ))}
      </div>
      <p className="h-5 text-sm font-medium text-muted-foreground" aria-hidden="true">
        {shown && max === 5 ? words[shown - 1] : ""}
      </p>
    </div>
  );
}

function Points({
  question,
  value,
  onPick,
  min,
  max,
  tone,
}: {
  question: QuestionDoc;
  value: unknown;
  onPick: (v: number, tap: boolean) => void;
  min: number;
  max: number;
  tone?: (n: number) => string | undefined;
}) {
  const tap = useTapSource();
  const current = typeof value === "number" ? value : null;
  const points = range(min, max);
  return (
    <div className="grid gap-2">
      <div
        role="radiogroup"
        aria-label={question.text}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        onPointerDown={tap.onPointerDown}
      >
        {points.map((n) => {
          const checked = current === n;
          const color = tone?.(n);
          return (
            <label
              key={n}
              className={cn(
                "flex h-12 cursor-pointer items-center justify-center rounded-xl border bg-card text-base font-semibold tabular-nums transition-[background-color,color,scale] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring active:scale-95 sm:h-14",
                checked && "border-transparent text-white",
              )}
              style={
                checked
                  ? { background: color ?? "var(--primary)" }
                  : color
                    ? { boxShadow: `inset 0 -3px 0 ${color}` }
                    : undefined
              }
            >
              <input
                type="radio"
                name={`pulse-${question.key}`}
                className="visually-hidden"
                checked={checked}
                onChange={() => onPick(n, tap.take())}
              />
              <bdi dir="ltr">{n}</bdi>
            </label>
          );
        })}
      </div>
      {question.scale?.min_label || question.scale?.max_label ? (
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{question.scale?.min_label}</span>
          <span className="text-end">{question.scale?.max_label}</span>
        </div>
      ) : null}
    </div>
  );
}

function Options({
  question,
  options,
  value,
  onPick,
}: {
  question: QuestionDoc;
  options: OptionDoc[];
  value: unknown;
  onPick: (v: string | number, tap: boolean) => void;
}) {
  const tap = useTapSource();
  const likert = question.type === "LIKERT";
  return (
    <div
      role="radiogroup"
      aria-label={question.text}
      className="grid gap-2"
      onPointerDown={tap.onPointerDown}
    >
      {options.map((o) => {
        const v = likert ? Number(o.value) : o.value;
        const checked = value !== undefined && value !== null && (likert ? Number(value) === v : value === v);
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-13 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 bg-card px-4 py-3 text-start text-base transition-[border-color,background-color,scale] duration-150 hover:border-primary/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring active:scale-[0.98]",
              checked ? "border-primary bg-primary/6 font-semibold" : "border-border",
            )}
          >
            <input
              type="radio"
              name={`pulse-${question.key}`}
              className="visually-hidden"
              checked={checked}
              onChange={() => onPick(v, tap.take())}
            />
            <span>{o.label}</span>
            {checked ? <CheckIcon className="size-5 text-primary" aria-hidden="true" /> : null}
          </label>
        );
      })}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: OptionDoc[];
  value: unknown;
  onChange: (v: string[]) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                o.is_exclusive
                  ? on
                    ? []
                    : [o.value]
                  : on
                    ? selected.filter((x) => x !== o.value)
                    : [...selected.filter((x) => !options.find((p) => p.value === x)?.is_exclusive), o.value],
              )
            }
            className={cn(
              "min-h-11 rounded-full border-2 px-4 text-sm transition-[border-color,background-color,scale] duration-150 active:scale-95",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Thanks({ doc, kiosk, onRestart }: { doc: SurveyDoc; kiosk: boolean; onRestart?: () => void }) {
  const t = useTranslations("survey.pulse");
  const [left, setLeft] = React.useState(KIOSK_RESET_S);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!kiosk || !onRestart) return;
    if (left <= 0) {
      onRestart();
      return;
    }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [kiosk, left, onRestart]);
  const reward = doc.settings.reward_text?.trim();
  return (
    <div className="grid place-items-center gap-5 py-10 text-center">
      <span className="pulse-pop grid size-20 place-items-center rounded-full bg-success/12 text-success">
        <CheckIcon className="size-10" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <h2 className="text-2xl font-bold text-balance">{t("thanks")}</h2>
      <p className="max-w-md text-muted-foreground text-pretty">
        {doc.thank_you_message || t("defaultThanks")}
      </p>
      {reward ? (
        <div className="grid w-full max-w-sm gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
          <p className="text-sm font-medium text-pretty">{reward}</p>
          {!kiosk ? (
            <Button
              variant="outline"
              size="sm"
              className="justify-self-center"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reward);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <CopyIcon aria-hidden="true" />
              {copied ? t("copied") : t("copy")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {kiosk && onRestart ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("kioskRestart", { s: left })}
          </p>
          <Button size="lg" onClick={onRestart}>
            {t("kioskStartNow")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PulseRenderer({
  doc,
  mode = "live",
  onSubmit,
  kiosk = false,
  location,
  onRestart,
  dir: dirOverride,
}: {
  doc: SurveyDoc;
  mode?: "preview" | "live";
  /** Builder preview can flip the direction; otherwise it follows the survey language. */
  dir?: "rtl" | "ltr";
  onSubmit?: (payload: SubmissionPayload) => Promise<void>;
  kiosk?: boolean;
  /** Branch shown above the questions (from the link's ?loc=). */
  location?: string | null;
  /** Kiosk: start over for the next customer (new session). */
  onRestart?: () => void;
}) {
  const t = useTranslations("survey.pulse");
  const tr = useTranslations("survey.renderer");
  const pulseDoc = React.useMemo(
    () => ({ ...doc, settings: { ...doc.settings, one_question_per_page: true } }),
    [doc],
  );
  const [seed] = React.useState(() => Math.floor(Math.random() * 2 ** 31));
  const [started, setStarted] = React.useState(!kiosk);
  const [answers, setAnswers] = React.useState<Answers>({});
  const [otherTexts, setOtherTexts] = React.useState<Record<string, string>>({});
  const [pageKey, setPageKey] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<string[]>([]);
  const [error, setError] = React.useState<{ key: string; error: AnswerError } | null>(null);
  const [done, setDone] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [startedAt, setStartedAt] = React.useState(() => new Date().toISOString());
  const timer = React.useRef<number | null>(null);
  const dir = dirOverride ?? (doc.language === "ar" ? "rtl" : "ltr");

  const { pages } = buildPages(pulseDoc, answers, seed);
  const index = Math.max(
    0,
    pages.findIndex((p) => p.key === pageKey),
  );
  const page = pages[index];
  const question = page?.questions[0];

  // Kiosk: a tablet left in the middle of a survey returns to the welcome screen.
  React.useEffect(() => {
    if (!kiosk || !started || done || !onRestart) return;
    let idle = window.setTimeout(onRestart, KIOSK_IDLE_MS);
    const reset = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(onRestart, KIOSK_IDLE_MS);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [kiosk, started, done, onRestart]);

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const submit = async (final: Answers) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const visible = new Set(computePath(doc, final).visible);
      await onSubmit?.({
        answers: Object.fromEntries(
          Object.entries(final).filter(([k, v]) => visible.has(k) && isAnswered(v)),
        ),
        otherTexts: Object.fromEntries(
          Object.entries(otherTexts).filter(([k, v]) => visible.has(k) && v.trim()),
        ),
        followups: {},
        respondentCode: null,
        respondentName: null,
        respondentEmail: null,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      setDone(true);
    } catch (err) {
      if (err instanceof SubmissionError) {
        const first = Object.entries(err.fieldErrors)[0];
        if (first) {
          const target = buildPages(pulseDoc, final, seed).pages.find((p) =>
            p.questions.some((q) => q.key === first[0]),
          );
          if (target) setPageKey(target.key);
          setError({ key: first[0], error: first[1] });
        }
        setSubmitError(err.message);
      } else {
        setSubmitError(tr("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = (current: Answers) => {
    if (!question) return;
    const err = validateAnswer(question, current[question.key]);
    if (err) {
      setError({ key: question.key, error: err });
      return;
    }
    setError(null);
    const fresh = buildPages(pulseDoc, current, seed).pages;
    const at = fresh.findIndex((p) => p.key === question.key);
    const next = fresh[at + 1];
    if (!next) return void submit(current);
    setHistory((h) => [...h, question.key]);
    setPageKey(next.key);
  };

  const pick = (value: unknown, tap: boolean) => {
    if (!question) return;
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    setError(null);
    if (timer.current) window.clearTimeout(timer.current);
    if (tap && AUTO_TYPES.has(question.type))
      timer.current = window.setTimeout(() => goNext(next), AUTO_ADVANCE_MS);
  };

  const back = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setPageKey(previous);
    setError(null);
  };

  const shell = (children: React.ReactNode) => (
    <div dir={dir} lang={doc.language} className="@container grid min-h-[26rem] content-start gap-6">
      {children}
    </div>
  );

  if (done) return shell(<Thanks doc={doc} kiosk={kiosk} onRestart={onRestart} />);

  if (!started) {
    return shell(
      <div className="grid place-items-center gap-6 py-12 text-center">
        {location ? (
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
            <MapPinIcon className="size-4" aria-hidden="true" />
            {location}
          </span>
        ) : null}
        <h1 className="text-3xl font-bold text-balance">{doc.title}</h1>
        <p className="max-w-md text-lg text-muted-foreground text-pretty">
          {doc.introduction || t("kioskIntro")}
        </p>
        <Button
          size="lg"
          className="h-14 px-10 text-lg"
          onClick={() => {
            setStartedAt(new Date().toISOString());
            setStarted(true);
          }}
        >
          {t("kioskStart")}
        </Button>
      </div>,
    );
  }

  if (!page || !question)
    return shell(<p className="py-12 text-center text-muted-foreground">{tr("endedEarly")}</p>);

  const text = pipe(question.text, doc, answers);
  const description = question.description ? pipe(question.description, doc, answers) : "";
  const value = answers[question.key];
  const manual = !AUTO_TYPES.has(question.type) || isAnswered(value);
  const isLast = index >= pages.length - 1;
  const contact = question.settings.contact_field;
  const errorText =
    error && error.key === question.key
      ? tr(
          `errors.${error.error.code}`,
          "min" in error.error
            ? { min: error.error.min }
            : "max" in error.error
              ? { max: error.error.max }
              : {},
        )
      : null;

  let input: React.ReactNode;
  if (
    question.type === "CSAT" ||
    (question.type === "RATING" && question.scale?.min === 1 && question.scale?.max === 5)
  ) {
    input = <Faces question={question} value={value} onPick={pick} />;
  } else if (question.type === "STAR") {
    input = <Stars question={question} value={value} onPick={pick} />;
  } else if (question.type === "NPS") {
    input = (
      <Points
        question={question}
        value={value}
        onPick={pick}
        min={0}
        max={10}
        tone={(n) => (n <= 6 ? "var(--viz-neg-1)" : n <= 8 ? "var(--viz-mid)" : "var(--viz-pos-1)")}
      />
    );
  } else if (question.type === "CES" || question.type === "RATING") {
    input = (
      <Points
        question={question}
        value={value}
        onPick={pick}
        min={question.scale?.min ?? 1}
        max={question.scale?.max ?? 7}
      />
    );
  } else if (
    question.type === "SINGLE_CHOICE" ||
    question.type === "DROPDOWN" ||
    question.type === "LIKERT"
  ) {
    input = <Options question={question} options={question.options} value={value} onPick={pick} />;
  } else if (question.type === "MULTIPLE_CHOICE") {
    input = <Chips options={question.options} value={value} onChange={(v) => pick(v, false)} />;
  } else if (question.type === "SHORT_TEXT" && contact) {
    input = (
      <Input
        dir="ltr"
        type={contact === "email" ? "email" : "tel"}
        inputMode={contact === "email" ? "email" : "tel"}
        autoComplete={contact === "email" ? "email" : "tel"}
        className="h-13 text-start text-lg"
        placeholder={question.settings.placeholder || undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => pick(e.target.value, false)}
        aria-label={text}
        aria-invalid={!!errorText || undefined}
      />
    );
  } else if (question.type === "LONG_TEXT") {
    input = (
      <Textarea
        rows={4}
        className="text-base"
        placeholder={question.settings.placeholder || t("textPlaceholder")}
        maxLength={question.validation.max_length ?? 2000}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => pick(e.target.value, false)}
        aria-label={text}
      />
    );
  } else {
    input = (
      <QuestionInput
        question={question}
        value={value}
        onChange={(v) => pick(v, false)}
        options={question.options}
        invalid={!!errorText}
        otherText={otherTexts[question.key]}
        onOtherText={(x) => setOtherTexts((o) => ({ ...o, [question.key]: x }))}
      />
    );
  }

  return shell(
    <>
      <div className="flex items-center gap-3">
        {doc.settings.allow_back && history.length ? (
          <Button variant="ghost" size="icon-sm" onClick={back} aria-label={tr("back")}>
            <ArrowRightIcon className="ltr:-scale-x-100" aria-hidden="true" />
          </Button>
        ) : null}
        {doc.settings.show_progress ? (
          <div
            className="flex flex-1 gap-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={pages.length}
            aria-valuenow={index + 1}
            aria-label={t("progress", { n: index + 1, total: pages.length })}
          >
            {pages.map((p, i) => (
              <span
                key={p.key}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  i <= index ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {location ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <MapPinIcon className="size-3.5" aria-hidden="true" />
            {location}
          </span>
        ) : null}
      </div>

      <section
        key={question.key}
        className="pulse-step grid gap-5"
        aria-labelledby={`pulse-q-${question.key}`}
      >
        <div className="grid gap-1.5">
          <h2
            id={`pulse-q-${question.key}`}
            className="text-xl leading-snug font-bold text-balance sm:text-2xl"
          >
            {text}
          </h2>
          {description ? <p className="text-sm text-muted-foreground text-pretty">{description}</p> : null}
        </div>
        {input}
        {errorText ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorText}
          </p>
        ) : null}
      </section>

      {submitError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/6 p-3 text-sm text-destructive"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {!question.required && !isAnswered(value) ? (
          <Button variant="ghost" onClick={() => goNext(answers)} disabled={submitting}>
            {t("skip")}
          </Button>
        ) : null}
        {manual ? (
          <Button size="lg" onClick={() => goNext(answers)} disabled={submitting} aria-busy={submitting}>
            {submitting ? <Spinner className="size-4" /> : null}
            {isLast ? tr("submit") : tr("next")}
          </Button>
        ) : null}
      </div>
      {mode === "preview" ? (
        <p className="text-center text-xs text-muted-foreground">{t("previewNote")}</p>
      ) : null}
    </>,
  );
}
