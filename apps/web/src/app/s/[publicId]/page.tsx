import type { PublicSurvey as PublicSurveyData } from "@meqyas/shared";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { cache } from "react";

import { BrandMark } from "@/components/common/brand";
import {
  InvitationUnavailable,
  PublicSurvey,
  SurveyUnavailable,
} from "@/components/survey/public/public-survey";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
const PUBLIC_ID = /^[A-Za-z0-9_-]{4,16}$/;
const INVITATION = /^[A-Za-z0-9_-]{8,64}$/;
const LOCATION = /^[A-Za-z0-9_-]{1,24}$/;

/** One API call per request (metadata + page share it, so only one session is issued). */
const loadSurvey = cache(
  async (
    publicId: string,
    invitation: string | null,
    location: string | null,
  ): Promise<PublicSurveyData | null> => {
    if (!PUBLIC_ID.test(publicId)) return null;
    const incoming = await headers();
    const forwarded = incoming.get("x-forwarded-for");
    const qs = invitation
      ? `?inv=${encodeURIComponent(invitation)}`
      : location
        ? `?loc=${encodeURIComponent(location)}`
        : "";
    const res = await fetch(`${API}/api/v1/public/surveys/${publicId}${qs}`, {
      cache: "no-store",
      headers: { Accept: "application/json", ...(forwarded ? { "X-Forwarded-For": forwarded } : {}) },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Survey service unavailable (${res.status})`);
    return (await res.json()) as PublicSurveyData;
  },
);

async function messagesFor(locale: "ar" | "en") {
  const all = (await import(`../../../../messages/${locale}.json`)).default;
  // Only what the respondent page needs.
  return {
    survey: { renderer: all.survey.renderer, preview: all.survey.preview, pulse: all.survey.pulse },
    public: all.public,
    common: all.common,
  };
}

type Params = Promise<{ publicId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

function invitationOf(search: Record<string, string | string[] | undefined>): string | null {
  const value = typeof search.inv === "string" ? search.inv : null;
  return value && INVITATION.test(value) ? value : null;
}

function locationOf(search: Record<string, string | string[] | undefined>): string | null {
  const value = typeof search.loc === "string" ? search.loc : null;
  return value && LOCATION.test(value) ? value : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const { publicId } = await params;
  const search = await searchParams;
  const survey = await loadSurvey(publicId, invitationOf(search), locationOf(search));
  return {
    title: survey?.title ?? "—",
    // Survey links are shared deliberately; they should never appear in search results.
    robots: { index: false, follow: false },
  };
}

export default async function PublicSurveyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { publicId } = await params;
  const search = await searchParams;
  const invitation = invitationOf(search);
  const survey = await loadSurvey(publicId, invitation, locationOf(search));
  if (!survey) notFound();
  const invitationState = survey.invitation?.state ?? null;
  const locale = survey.language === "en" ? "en" : "ar";
  const dir = locale === "ar" ? "rtl" : "ltr";
  const kiosk = search.kiosk === "1";
  const channel = kiosk ? "KIOSK" : search.c === "qr" ? "QR" : "LINK";

  return (
    <NextIntlClientProvider locale={locale} messages={await messagesFor(locale)} timeZone="Asia/Riyadh">
      <div dir={dir} lang={locale} className="min-h-dvh bg-muted/30">
        <main id="content" className="mx-auto grid w-full max-w-2xl gap-6 px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
          {invitationState && invitationState !== "valid" ? (
            <InvitationUnavailable title={survey.title} state={invitationState} />
          ) : survey.availability === "OPEN" && survey.doc && survey.session ? (
            <PublicSurvey
              data={survey}
              channel={channel}
              invitation={invitationState === "valid" ? invitation : null}
              kiosk={kiosk}
            />
          ) : (
            <SurveyUnavailable title={survey.title} availability={survey.availability} />
          )}
        </main>
        <footer className="flex items-center justify-center gap-2 pb-8 text-xs text-muted-foreground">
          <BrandMark className="size-5" />
          <span dir="auto">مِقياس AI</span>
        </footer>
      </div>
    </NextIntlClientProvider>
  );
}
