"use client";

import {
  surveyDocSchema,
  type AnswerError,
  type Availability,
  type InvitationState,
  type PublicSurvey as PublicSurveyData,
  type SurveyDoc,
} from "@meqyas/shared";
import { Badge, Button } from "@meqyas/ui";
import {
  BellOffIcon,
  CalendarClockIcon,
  CircleCheckBigIcon,
  CircleSlashIcon,
  HistoryIcon,
  Link2OffIcon,
  PauseCircleIcon,
  TimerOffIcon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { ApiError } from "@/lib/api/client";
import { publicApi } from "@/lib/api/endpoints";

import { PulseRenderer } from "../pulse/pulse-renderer";
import {
  SubmissionError,
  SurveyRenderer,
  type FollowupProvider,
  type RendererState,
  type SubmissionPayload,
} from "../renderer/survey-renderer";

const FOLLOWUP_TIMEOUT_MS = 8000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode / blocked storage: the survey still works, just without resume
  }
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const UNAVAILABLE_ICONS: Record<Exclude<Availability, "OPEN">, typeof PauseCircleIcon> = {
  PAUSED: PauseCircleIcon,
  CLOSED: CircleSlashIcon,
  NOT_STARTED: CalendarClockIcon,
  FULL: UsersIcon,
};

export function SurveyUnavailable({ title, availability }: { title: string; availability: Availability }) {
  const t = useTranslations("public");
  const state = availability === "OPEN" ? "CLOSED" : availability;
  const Icon = UNAVAILABLE_ICONS[state];
  return (
    <section className="grid place-items-center gap-4 rounded-3xl border bg-card px-6 py-16 text-center shadow-sm">
      <Icon className="size-12 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-bold text-balance">{title}</h1>
      <p className="max-w-md text-muted-foreground">{t(`unavailable.${state}`)}</p>
    </section>
  );
}

const INVITATION_ICONS: Record<Exclude<InvitationState, "valid">, typeof PauseCircleIcon> = {
  used: CircleCheckBigIcon,
  expired: TimerOffIcon,
  closed: CircleSlashIcon,
  invalid: Link2OffIcon,
};

/** A store rating link that can no longer open the form (already answered, expired, cancelled…). */
export function InvitationUnavailable({
  title,
  state,
}: {
  title: string;
  state: Exclude<InvitationState, "valid">;
}) {
  const t = useTranslations("public.invitation");
  const Icon = INVITATION_ICONS[state];
  return (
    <section className="grid place-items-center gap-4 rounded-3xl border bg-card px-6 py-16 text-center shadow-sm">
      <Icon className="size-12 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-bold text-balance">{t(`${state}.title`)}</h1>
      <p className="max-w-md text-muted-foreground">{t(`${state}.body`, { title })}</p>
    </section>
  );
}

function OptOut({ publicId, invitation, store }: { publicId: string; invitation: string; store: string }) {
  const t = useTranslations("public.invitation");
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "failed">("idle");
  if (state === "done") {
    return (
      <p role="status" className="text-center text-xs text-muted-foreground">
        {t("optOutDone")}
      </p>
    );
  }
  return (
    <div className="grid justify-items-center gap-1">
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs text-muted-foreground"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await publicApi.optOut(publicId, invitation);
            setState("done");
          } catch {
            setState("failed");
          }
        }}
      >
        <BellOffIcon className="size-3.5" aria-hidden="true" />
        {t("optOut", { store })}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("optOutFailed")}
        </p>
      ) : null}
    </div>
  );
}

/** Live respondent experience: resume, AI follow-up, idempotent submission. */
export function PublicSurvey({
  data,
  channel,
  invitation = null,
  kiosk = false,
}: {
  data: PublicSurveyData;
  channel: "LINK" | "QR" | "KIOSK";
  /** Valid store invitation token: answers are linked to that order/product (single use). */
  invitation?: string | null;
  /** A shared tablet at a branch: no saved progress, no device id, a fresh session per customer. */
  kiosk?: boolean;
}) {
  const t = useTranslations("public");
  const doc = React.useMemo(() => surveyDocSchema.parse(data.doc) as SurveyDoc, [data.doc]);
  const location = data.location?.code ?? null;
  const pulse = doc.settings.experience === "pulse";
  // Each invitation keeps its own progress (one customer may rate several products).
  const scope = invitation ? `${data.public_id}.inv.${invitation}` : data.public_id;
  const stateKey = `meqyas.survey.${scope}.v${data.version}`;
  const doneKey = `meqyas.survey.${scope}.done`;
  const clientKey = `meqyas.survey.${data.public_id}.client`;

  const sessionRef = React.useRef(data.session ?? "");
  const loaded = React.useRef(false);
  const [restored, setRestored] = React.useState<Partial<RendererState> | null>(null);
  const [previouslySubmitted, setPreviouslySubmitted] = React.useState(false);
  const [dismissedNotice, setDismissedNotice] = React.useState(false);
  const [mountKey, setMountKey] = React.useState("fresh");

  // Restore a saved session after hydration (server HTML always renders the fresh intro).
  React.useEffect(() => {
    const store = kiosk ? null : storage(); // a shared tablet never resumes someone else's answers
    if (store) {
      try {
        const saved = store.getItem(stateKey);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<RendererState> & { session?: string };
          // Keep the original session: its server-side start time measures the real answering time.
          if (parsed.session) sessionRef.current = parsed.session;
          setRestored(parsed);
          setMountKey("restored");
        }
      } catch {
        store.removeItem(stateKey);
      }
      setPreviouslySubmitted(!!store.getItem(doneKey));
    }
    loaded.current = true;
  }, [stateKey, doneKey, kiosk]);

  const saveTimer = React.useRef<number | null>(null);
  const onStateChange = React.useCallback(
    (state: RendererState) => {
      if (!loaded.current) return; // never overwrite a saved session with the initial render
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        storage()?.setItem(stateKey, JSON.stringify({ ...state, session: sessionRef.current }));
      }, 300);
    },
    [stateKey],
  );

  const restart = React.useCallback(async () => {
    try {
      const fresh = await publicApi.get(data.public_id, null, location);
      if (fresh.session) sessionRef.current = fresh.session;
    } catch {
      // keep the current session: a stale one is refreshed on the next submission
    }
    setMountKey(`kiosk-${Date.now()}`);
  }, [data.public_id, location]);

  const clientId = React.useCallback((): string => {
    const store = storage();
    let id = store?.getItem(clientKey) ?? null;
    if (!id) {
      id = randomId();
      store?.setItem(clientKey, id);
    }
    return id;
  }, [clientKey]);

  const send = async (payload: SubmissionPayload) =>
    publicApi.submit(data.public_id, {
      session: sessionRef.current,
      answers: payload.answers,
      other_texts: payload.otherTexts,
      followups: payload.followups,
      respondent_code: payload.respondentCode,
      respondent_name: payload.respondentName,
      respondent_email: payload.respondentEmail,
      client_id: kiosk ? null : clientId(),
      channel,
      locale: doc.language,
      invitation,
      location: invitation ? null : location,
    });

  const onSubmit = async (payload: SubmissionPayload) => {
    try {
      try {
        await send(payload);
      } catch (err) {
        // A session older than a day (or a republished survey): get a fresh one and retry once.
        if (!(err instanceof ApiError) || err.code !== "invalid_session") throw err;
        const fresh = await publicApi.get(data.public_id, invitation, location);
        if (!fresh.session) throw new ApiError(409, `survey_${fresh.availability.toLowerCase()}`, "closed");
        sessionRef.current = fresh.session;
        await send(payload);
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const store = kiosk ? null : storage();
      store?.removeItem(stateKey);
      store?.setItem(doneKey, new Date().toISOString());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_answers") {
          throw new SubmissionError(
            t("fixErrors"),
            (err.details.errors ?? {}) as Record<string, AnswerError>,
          );
        }
        if (err.code.startsWith("survey_")) throw new SubmissionError(t("closedWhileAnswering"));
        if (err.code === "invitation_used") throw new SubmissionError(t("invitation.usedWhileAnswering"));
        if (err.code.startsWith("invitation_"))
          throw new SubmissionError(t("invitation.closedWhileAnswering"));
        if (err.code === "rate_limited") throw new SubmissionError(t("rateLimited"));
        if (err.code === "network_error") throw new SubmissionError(t("networkError"));
      }
      throw new SubmissionError(t("submitFailed"));
    }
  };

  const followup: FollowupProvider | undefined = data.ai_followup
    ? async (question, value, otherText) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), FOLLOWUP_TIMEOUT_MS);
        try {
          const res = await publicApi.followup(
            data.public_id,
            { session: sessionRef.current, question_key: question.key, answer: value, other_text: otherText },
            controller.signal,
          );
          return res.ask ? res.question : null;
        } catch {
          return null; // AI problems never block the respondent
        } finally {
          window.clearTimeout(timer);
        }
      }
    : undefined;

  return (
    <div className="grid gap-4">
      {data.is_demo ? (
        <Badge variant="demo" className="justify-self-center">
          DEMO DATA
        </Badge>
      ) : null}
      {previouslySubmitted && !dismissedNotice && !restored && !invitation && !kiosk ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-sm"
        >
          <span className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("alreadySubmitted")}
          </span>
          <Button size="sm" variant="outline" onClick={() => setDismissedNotice(true)}>
            {t("newResponse")}
          </Button>
        </div>
      ) : null}
      <section className="rounded-3xl border bg-card p-5 shadow-sm sm:p-8" aria-label={data.title}>
        {pulse ? (
          <PulseRenderer
            key={mountKey}
            doc={doc}
            onSubmit={onSubmit}
            kiosk={kiosk}
            location={data.location?.name ?? null}
            onRestart={kiosk ? restart : undefined}
          />
        ) : (
          <SurveyRenderer
            key={mountKey}
            doc={doc}
            mode="live"
            initialState={restored ?? undefined}
            onStateChange={onStateChange}
            onSubmit={onSubmit}
            followup={followup}
          />
        )}
      </section>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {doc.settings.anonymity_mode === "ANONYMOUS"
          ? t("privacy.ANONYMOUS")
          : doc.settings.anonymity_mode === "PSEUDONYMOUS"
            ? t("privacy.PSEUDONYMOUS")
            : t("privacy.IDENTIFIED")}
      </p>
      {invitation ? (
        <OptOut publicId={data.public_id} invitation={invitation} store={data.invitation?.store ?? ""} />
      ) : null}
    </div>
  );
}
