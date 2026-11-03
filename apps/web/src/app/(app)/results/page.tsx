"use client";

import {
  EVIDENCE_LABELS,
  label,
  MEASUREMENT_TYPE_LABELS,
  WAVE_LABELS,
  type ProjectResultsStatus,
} from "@meqyas/shared";
import { Badge, Button, Card, Skeleton } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ChartNoAxesColumnIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { useStatFormat } from "@/components/analytics/format";
import { analyticsApi } from "@/lib/api/endpoints";

type Locale = "ar" | "en";

function ProjectRow({ p }: { p: ProjectResultsStatus }) {
  const t = useTranslations("results");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const fmt = useStatFormat();
  const left = p.responses_total - p.responses_included;
  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${p.id}/analytics`} className="font-semibold text-pretty hover:underline">
            {p.title}
          </Link>
          {p.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {p.measurement_type ? (
            <Badge variant="soft">{label(MEASUREMENT_TYPE_LABELS, p.measurement_type, locale)}</Badge>
          ) : null}
          {p.evidence_level ? (
            <Badge variant="evidence">{label(EVIDENCE_LABELS, p.evidence_level, locale)}</Badge>
          ) : null}
          {p.waves.map((w) => (
            <Badge key={w} variant="outline">
              {label(WAVE_LABELS, w, locale)}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("responses", { count: p.responses_included })}
          {left > 0 ? ` · ${t("left", { count: left })}` : ""}
          {p.last_response_at ? ` · ${t("last", { date: fmt.date(p.last_response_at) })}` : ""}
        </p>
      </div>
      <Button asChild variant="outline" className="justify-self-start sm:justify-self-end">
        <Link href={`/projects/${p.id}/analytics`}>
          {t("open")}
          <ArrowLeftIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
        </Link>
      </Button>
    </li>
  );
}

export default function ResultsPage() {
  const t = useTranslations("results");
  const tn = useTranslations("nav");
  const portfolio = useQuery({
    queryKey: ["analytics", "portfolio"],
    queryFn: () => analyticsApi.portfolio(),
  });
  const items = portfolio.data?.items ?? [];
  const withData = items.filter((p) => p.responses_total > 0);
  const waiting = items.filter((p) => p.responses_total === 0);

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{tn("results")}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
      </div>

      {portfolio.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : !withData.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <ChartNoAxesColumnIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button asChild variant="outline">
            <Link href="/surveys">{t("goToSurveys")}</Link>
          </Button>
        </Card>
      ) : (
        <section aria-labelledby="with-data" className="grid gap-3">
          <h2 id="with-data" className="text-sm font-semibold text-muted-foreground">
            {t("withData")}
          </h2>
          <ul className="grid gap-3">
            {withData.map((p) => (
              <ProjectRow key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      {waiting.length ? (
        <section aria-labelledby="waiting" className="grid gap-3">
          <h2 id="waiting" className="text-sm font-semibold text-muted-foreground">
            {t("waiting")}
          </h2>
          <ul className="grid gap-2">
            {waiting.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-3"
              >
                <span className="min-w-0 text-sm font-medium text-pretty">{p.title}</span>
                <Button asChild variant="link" className="h-auto p-0 text-sm">
                  <Link href={`/projects/${p.id}/surveys`}>
                    {p.published_surveys ? t("shareSurvey") : t("createSurvey")}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
