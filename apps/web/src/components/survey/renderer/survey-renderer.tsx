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
import { Button, cn, Input, Progress, Spinner, Textarea } from "@meqyas/ui";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  MessageCircleQuestionIcon,
  SendIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { QuestionInput } from "./question-input";

/** Everything needed to resume a respondent exactly where they stopped. */
export interface RendererState {
  seed: number;
  started: boolean;
  answers: Answers;
  otherTexts: Record<string, string>;
  respondentCode: string;
  respondentName: string;
  respondentEmail: string;
  /** question key → follow-up answer */
  followups: Record<string, string>;
  /** question key → follow-up prompt ("" = asked, no follow-up needed) */
  followupPrompts: Record<string, string>;
  pageKey: string | null;
  history: string[];
}

export interface SubmissionPayload {
  answers: Answers;
  otherTexts: Record<string, string>;
  followups: Record<string, string>;
  respondentCode: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  startedAt: string;
  completedAt: string;
}

/** Thrown by `onSubmit` when the server rejects the submission. */
export class SubmissionError extends Error {
  readonly fieldErrors: Record<string, AnswerError>;

  constructor(message: string, fieldErrors: Record<string, AnswerError> = {}) {
    super(message);
    this.name = "SubmissionError";
    this.fieldErrors = fieldErrors;
  }
}

export type FollowupProvider = (
  question: QuestionDoc,
  value: unknown,
  otherText?: string,
) => Promise<string | null>;

interface Page {
  key: string;
  title: string;
  description: string;
  questions: QuestionDoc[];
}

/** Deterministic PRNG so randomized orders are stable during one session. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildPages(
  doc: SurveyDoc,
  answers: Answers,
  seed: number,
): { pages: Page[]; endedBy: string | null } {
  const path = computePath(doc, answers);
  const visible = new Set(path.visible);
  const pages: Page[] = [];
  for (const section of doc.sections) {
    let questions = section.questions.filter((q) => visible.has(q.key));
    if (section.randomize_questions) questions = shuffled(questions, seed ^ hash(section.key));
    if (!questions.length) continue;
    if (doc.settings.one_question_per_page) {
      for (const q of questions)
        pages.push({ key: q.key, title: section.title, description: "", questions: [q] });
    } else {
      pages.push({ key: section.key, title: section.title, description: section.description, questions });
    }
  }
  if (path.endedBy) {
    const cut = pages.findIndex((p) => p.questions.some((q) => q.key === path.endedBy));
    if (cut >= 0) pages.splice(cut + 1);
  }
  return { pages, endedBy: path.endedBy };
}

function orderedOptions(q: QuestionDoc, seed: number): OptionDoc[] {
  if (!q.settings.randomize_options) return q.options;
  const fixed = q.options.filter((o) => o.is_other || o.is_exclusive);
  const free = q.options.filter((o) => !o.is_other && !o.is_exclusive);
  return [...shuffled(free, seed ^ hash(q.key)), ...fixed];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SurveyRenderer({
  doc,
  mode = "preview",
  onSubmit,
  className,
  dir: dirOverride,
  initialState,
  onStateChange,
  followup,
}: {
  doc: SurveyDoc;
  mode?: "preview" | "live";
  onSubmit?: (payload: SubmissionPayload) => Promise<void>;
  className?: string;
  /** Preview can force a direction to check mixed-language layouts. */
  dir?: "rtl" | "ltr";
  /** Resume a saved session (live mode autosave). */
  initialState?: Partial<RendererState>;
  onStateChange?: (state: RendererState) => void;
  /** Bounded AI follow-up (live mode, when the survey enables it). */
  followup?: FollowupProvider;
}) {
  const t = useTranslations("survey.renderer");
  const tp = useTranslations("survey.preview");
  const needsCode = doc.settings.anonymity_mode === "PSEUDONYMOUS" && doc.settings.collect_respondent_code;
  const needsIdentity = doc.settings.anonymity_mode === "IDENTIFIED";
  const hasIntro = !!doc.introduction || needsCode || needsIdentity;

  const [seed] = React.useState(() => initialState?.seed ?? Math.floor(Math.random() * 2 ** 31));
  const [started, setStarted] = React.useState(initialState?.started ?? !hasIntro);
  const [answers, setAnswers] = React.useState<Answers>(initialState?.answers ?? {});
  const [otherTexts, setOtherTexts] = React.useState<Record<string, string>>(initialState?.otherTexts ?? {});
  const [respondentCode, setRespondentCode] = React.useState(initialState?.respondentCode ?? "");
  const [respondentName, setRespondentName] = React.useState(initialState?.respondentName ?? "");
  const [respondentEmail, setRespondentEmail] = React.useState(initialState?.respondentEmail ?? "");
  const [followups, setFollowups] = React.useState<Record<string, string>>(initialState?.followups ?? {});
  const [followupPrompts, setFollowupPrompts] = React.useState<Record<string, string>>(
    initialState?.followupPrompts ?? {},
  );
  const [pageKey, setPageKey] = React.useState<string | null>(initialState?.pageKey ?? null);
  const [history, setHistory] = React.useState<string[]>(initialState?.history ?? []);
  const [errors, setErrors] = React.useState<Record<string, AnswerError>>({});
  const [introErrors, setIntroErrors] = React.useState<{ code?: string; name?: string; email?: string }>({});
  const [activeFollowup, setActiveFollowup] = React.useState<{ key: string; prompt: string } | null>(null);
  const [followupText, setFollowupText] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [startedAt] = React.useState(() => new Date().toISOString());
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dir = dirOverride ?? (doc.language === "ar" ? "rtl" : "ltr");

  const { pages, endedBy } = React.useMemo(() => buildPages(doc, answers, seed), [doc, answers, seed]);
  const index = Math.max(
    0,
    pages.findIndex((p) => p.key === pageKey),
  );
  const page = pages[index];
  const isLast = index >= pages.length - 1 || (!!endedBy && !!page?.questions.some((q) => q.key === endedBy));
  const progress = pages.length ? Math.round((index / pages.length) * 100) : 0;

  React.useEffect(() => {
    if (done) return;
    onStateChange?.({
      seed,
      started,
      answers,
      otherTexts,
      respondentCode,
      respondentName,
      respondentEmail,
      followups,
      followupPrompts,
      pageKey,
      history,
    });
  }, [
    seed,
    started,
    answers,
    otherTexts,
    respondentCode,
    respondentName,
    respondentEmail,
    followups,
    followupPrompts,
    pageKey,
    history,
    done,
    onStateChange,
  ]);

  const setAnswer = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const focusTop = () => containerRef.current?.focus();

  const start = () => {
    const found: typeof introErrors = {};
    if (needsCode && respondentCode.trim().length < 3) found.code = "required";
    if (needsIdentity && !respondentName.trim()) found.name = "required";
    if (needsIdentity && respondentEmail.trim() && !EMAIL_RE.test(respondentEmail.trim()))
      found.email = "invalid";
    setIntroErrors(found);
    const first = found.code
      ? "respondent-code"
      : found.name
        ? "respondent-name"
        : found.email
          ? "respondent-email"
          : null;
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setStarted(true);
  };

  const validatePage = (): boolean => {
    if (!page) return true;
    const found: Record<string, AnswerError> = {};
    for (const q of page.questions) {
      const error = validateAnswer(q, answers[q.key]);
      if (error) found[q.key] = error;
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) document.getElementById(`question-${first}`)?.focus();
    return !first;
  };

  const submit = async (extraFollowups: Record<string, string> = {}) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const visible = new Set(computePath(doc, answers).visible);
      const clean = Object.fromEntries(
        Object.entries(answers).filter(([k, v]) => visible.has(k) && isAnswered(v)),
      );
      const allFollowups = { ...followups, ...extraFollowups };
      await onSubmit?.({
        answers: clean,
        otherTexts: Object.fromEntries(
          Object.entries(otherTexts).filter(([k, v]) => visible.has(k) && v.trim()),
        ),
        followups: Object.fromEntries(
          Object.entries(allFollowups).filter(([k, v]) => visible.has(k) && v.trim()),
        ),
        respondentCode: needsCode ? respondentCode.trim() || null : null,
        respondentName: needsIdentity ? respondentName.trim() || null : null,
        respondentEmail: needsIdentity ? respondentEmail.trim() || null : null,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      setDone(true);
      focusTop();
    } catch (err) {
      if (err instanceof SubmissionError) {
        const fields = err.fieldErrors;
        if (fields._respondent_code || fields._respondent_name) {
          setIntroErrors({ code: fields._respondent_code?.code, name: fields._respondent_name?.code });
          setStarted(false);
        } else if (Object.keys(fields).length) {
          setErrors(fields);
          const target = pages.find((p) => p.questions.some((q) => fields[q.key]));
          if (target) setPageKey(target.key);
        }
        setSubmitError(err.message);
      } else {
        setSubmitError(t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const advance = async (extraFollowups: Record<string, string> = {}) => {
    const nextPage = pages[index + 1];
    if (isLast || !nextPage) return submit(extraFollowups);
    setHistory((h) => [...h, page!.key]);
    setPageKey(nextPage.key);
    focusTop();
  };

  /** Ask the AI for one follow-up on this page's opted-in questions (bounded, never blocking). */
  const maybeFollowup = async (): Promise<boolean> => {
    if (!followup || mode !== "live" || !doc.settings.ai_followup_enabled || !page) return false;
    const askedSoFar = Object.values(followupPrompts).filter(Boolean).length;
    if (askedSoFar >= doc.settings.ai_followup_max) return false;
    for (const q of page.questions) {
      if (!q.settings.ai_followup || followupPrompts[q.key] !== undefined || !isAnswered(answers[q.key]))
        continue;
      setThinking(true);
      let prompt: string | null = null;
      try {
        prompt = await followup(q, answers[q.key], otherTexts[q.key]);
      } catch {
        prompt = null;
      } finally {
        setThinking(false);
      }
      setFollowupPrompts((p) => ({ ...p, [q.key]: prompt ?? "" }));
      if (prompt) {
        setActiveFollowup({ key: q.key, prompt });
        setFollowupText(followups[q.key] ?? "");
        focusTop();
        return true;
      }
    }
    return false;
  };

  const next = async () => {
    if (activeFollowup) {
      const extra = { [activeFollowup.key]: followupText.trim() };
      setFollowups((f) => ({ ...f, ...extra }));
      setActiveFollowup(null);
      return advance(extra);
    }
    if (!validatePage()) return;
    if (await maybeFollowup()) return;
    return advance();
  };

  const back = () => {
    if (activeFollowup) {
      setActiveFollowup(null);
      focusTop();
      return;
    }
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setPageKey(previous);
    setErrors({});
    focusTop();
  };

  const rootClass = cn("@container grid gap-6 outline-none", className);

  if (done) {
    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        dir={dir}
        lang={doc.language}
        className={cn(rootClass, "place-items-center gap-4 py-16 text-center")}
      >
        <CircleCheckBigIcon className="size-14 text-success" aria-hidden="true" />
        <h2 className="text-2xl font-bold">{t("thanks")}</h2>
        <p className="max-w-md text-muted-foreground">{doc.thank_you_message || t("defaultThanks")}</p>
      </div>
    );
  }

  if (!started) {
    const errorText = (code?: string) => (code === "invalid" ? t("errors.invalid") : t("errors.required"));
    return (
      <div ref={containerRef} tabIndex={-1} dir={dir} lang={doc.language} className={rootClass}>
        <header className="grid gap-3">
          <h1 className="text-2xl font-bold text-balance">{doc.title}</h1>
          {doc.introduction ? (
            <p className="leading-relaxed whitespace-pre-line text-muted-foreground">{doc.introduction}</p>
          ) : null}
        </header>
        {needsIdentity ? (
          <div className="grid max-w-md gap-4">
            <div className="grid gap-2">
              <label htmlFor="respondent-name" className="text-sm font-medium">
                {t("respondentName")} <span className="text-destructive">*</span>
              </label>
              <Input
                id="respondent-name"
                value={respondentName}
                onChange={(e) => setRespondentName(e.target.value)}
                autoComplete="name"
                maxLength={200}
                aria-invalid={!!introErrors.name || undefined}
                aria-describedby={introErrors.name ? "respondent-name-error" : undefined}
              />
              {introErrors.name ? (
                <p id="respondent-name-error" role="alert" className="text-sm font-medium text-destructive">
                  {errorText(introErrors.name)}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <label htmlFor="respondent-email" className="text-sm font-medium">
                {t("respondentEmail")}
              </label>
              <Input
                id="respondent-email"
                type="email"
                dir="ltr"
                value={respondentEmail}
                onChange={(e) => setRespondentEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                className="text-start"
                aria-invalid={!!introErrors.email || undefined}
                aria-describedby={introErrors.email ? "respondent-email-error" : "respondent-email-hint"}
              />
              <p id="respondent-email-hint" className="text-xs text-muted-foreground">
                {t("respondentEmailHint")}
              </p>
              {introErrors.email ? (
                <p id="respondent-email-error" role="alert" className="text-sm font-medium text-destructive">
                  {errorText(introErrors.email)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {needsCode ? (
          <div className="grid gap-2">
            <label htmlFor="respondent-code" className="text-sm font-medium">
              {t("respondentCode")} <span className="text-destructive">*</span>
            </label>
            <p id="respondent-code-hint" className="text-xs text-muted-foreground">
              {t("respondentCodeHint")}
            </p>
            <Input
              id="respondent-code"
              value={respondentCode}
              onChange={(e) => setRespondentCode(e.target.value)}
              aria-describedby={
                introErrors.code ? "respondent-code-hint respondent-code-error" : "respondent-code-hint"
              }
              aria-invalid={!!introErrors.code || undefined}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              dir="ltr"
              className="max-w-xs text-start"
            />
            {introErrors.code ? (
              <p id="respondent-code-error" role="alert" className="text-sm font-medium text-destructive">
                {errorText(introErrors.code)}
              </p>
            ) : null}
          </div>
        ) : null}
        <Button size="lg" className="justify-self-start" onClick={start}>
          {t("start")}
        </Button>
        {mode === "preview" ? <p className="text-xs text-muted-foreground">{tp("note")}</p> : null}
      </div>
    );
  }

  if (!page) {
    return (
      <div dir={dir} className={cn(rootClass, "py-12 text-center text-muted-foreground")}>
        {t("endedEarly")}
      </div>
    );
  }

  const nav = (
    <>
      {submitError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/6 p-3 text-sm text-destructive"
        >
          {submitError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        {activeFollowup || (doc.settings.allow_back && history.length) ? (
          <Button variant="ghost" onClick={back} disabled={submitting}>
            <ArrowRightIcon className="ltr:-scale-x-100" aria-hidden="true" />
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="lg"
          onClick={() => void next()}
          disabled={submitting || thinking}
          aria-busy={submitting || thinking}
        >
          {submitting || thinking ? <Spinner className="size-4" /> : null}
          {isLast && !thinking ? t("submit") : t("next")}
          {!submitting && !thinking ? (
            isLast ? (
              <SendIcon className="rtl:-scale-x-100" aria-hidden="true" />
            ) : (
              <ArrowLeftIcon className="ltr:-scale-x-100" aria-hidden="true" />
            )
          ) : null}
        </Button>
      </div>
      {mode === "preview" ? <p className="text-center text-xs text-muted-foreground">{tp("note")}</p> : null}
    </>
  );

  if (activeFollowup) {
    return (
      <div ref={containerRef} tabIndex={-1} dir={dir} lang={doc.language} className={rootClass}>
        <div className="grid gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 @md:p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <MessageCircleQuestionIcon className="size-4" aria-hidden="true" />
            {t("followupLabel")}
          </p>
          <label htmlFor="followup-answer" className="text-base leading-relaxed font-semibold">
            {activeFollowup.prompt}
          </label>
          <Textarea
            id="followup-answer"
            rows={3}
            maxLength={2000}
            value={followupText}
            onChange={(e) => setFollowupText(e.target.value)}
            aria-describedby="followup-hint"
          />
          <p id="followup-hint" className="text-xs text-muted-foreground">
            {t("followupOptional")}
          </p>
        </div>
        {nav}
      </div>
    );
  }

  return (
    <div ref={containerRef} tabIndex={-1} dir={dir} lang={doc.language} className={rootClass}>
      {doc.settings.show_progress ? (
        <div className="grid gap-1.5">
          <Progress value={progress} aria-label={t("progress", { percent: progress })} />
          <p className="text-xs text-muted-foreground tabular-nums">{t("progress", { percent: progress })}</p>
        </div>
      ) : null}

      {page.title || page.description ? (
        <header className="grid gap-1">
          {page.title ? <h2 className="text-xl font-bold">{page.title}</h2> : null}
          {page.description ? <p className="text-sm text-muted-foreground">{page.description}</p> : null}
        </header>
      ) : null}

      <ol className="grid gap-5">
        {page.questions.map((q) => {
          const error = errors[q.key];
          const text = pipe(q.text, doc, answers);
          const description = q.description ? pipe(q.description, doc, answers) : "";
          const descId = description ? `desc-${q.key}` : undefined;
          const errId = error ? `err-${q.key}` : undefined;
          const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

          if (q.type === "INFORMATION") {
            return (
              <li
                key={q.key}
                className="rounded-xl bg-muted/60 p-4 text-sm leading-relaxed whitespace-pre-line"
              >
                {text}
              </li>
            );
          }
          if (q.type === "SECTION") {
            return (
              <li key={q.key}>
                <h3 className="border-b pb-2 text-lg font-semibold">{text}</h3>
              </li>
            );
          }
          return (
            <li key={q.key}>
              <fieldset
                id={`question-${q.key}`}
                tabIndex={-1}
                className={cn(
                  "grid gap-3 rounded-2xl border bg-card p-4 outline-none @md:p-5",
                  error && "border-destructive/60",
                )}
                aria-describedby={describedBy}
              >
                <legend className="sr-only">{text}</legend>
                <div className="grid gap-1" aria-hidden="true">
                  <p className="text-base leading-relaxed font-semibold">
                    {text}
                    {q.required ? <span className="ms-1 text-destructive">*</span> : null}
                  </p>
                </div>
                {description ? (
                  <p id={descId} className="-mt-2 text-sm text-muted-foreground">
                    {description}
                  </p>
                ) : null}
                <QuestionInput
                  question={q}
                  value={answers[q.key]}
                  onChange={(v) => setAnswer(q.key, v)}
                  options={orderedOptions(q, seed)}
                  describedBy={describedBy}
                  invalid={!!error}
                  otherText={otherTexts[q.key]}
                  onOtherText={(text2) => setOtherTexts((o) => ({ ...o, [q.key]: text2 }))}
                />
                {error ? (
                  <p id={errId} role="alert" className="text-sm font-medium text-destructive">
                    {t(
                      `errors.${error.code}`,
                      "min" in error ? { min: error.min } : "max" in error ? { max: error.max } : {},
                    )}
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {nav}
    </div>
  );
}
