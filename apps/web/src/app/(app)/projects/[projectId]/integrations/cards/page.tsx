"use client";

import type { StoreLocation, SurveyMeta } from "@meqyas/shared";
import { Alert, AlertDescription, Button, Skeleton } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, InfoIcon, PrinterIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";

import { useBranchQr, useBranchSurvey } from "@/components/cx/branches";
import { useProjectId } from "@/components/measurement/use-project";
import { cxApi, surveyApi } from "@/lib/api/endpoints";
import { useFeature } from "@/components/subscription/subscription";
import { FeatureLocked } from "@/components/subscription/subscription-banner";

/** One table-tent card: 88 × 125 mm, so four fit on an A4 page with print margins. */
function BranchCard({
  survey,
  location,
  host,
}: {
  survey: SurveyMeta;
  location: StoreLocation;
  host: string;
}) {
  const t = useTranslations("integrations.branches.cards");
  const qr = useBranchQr(survey, location.code);
  return (
    <li className="paper-light grid content-between justify-items-center gap-3 rounded-3xl border-2 border-primary/30 p-6 text-center break-inside-avoid print:h-[125mm] print:w-[88mm] print:rounded-[6mm] print:p-[7mm]">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-primary">{t("kicker")}</p>
        <p className="text-2xl font-bold leading-tight text-balance">{t("headline")}</p>
        <p className="text-sm text-muted-foreground text-pretty">{t("sub")}</p>
      </div>
      <div className="grid size-48 place-items-center rounded-2xl bg-white p-2 print:size-[52mm]">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img src={qr} alt={t("qrAlt", { name: location.name })} className="size-full" />
        ) : (
          <Skeleton className="size-full" />
        )}
      </div>
      <div className="grid gap-0.5">
        <p className="text-lg font-semibold text-balance">{location.name}</p>
        <p className="text-xs text-muted-foreground">{t("scan")}</p>
        <p dir="ltr" className="font-mono text-[10px] text-muted-foreground">
          {host}/s/{survey.public_id}?loc={location.code}
        </p>
      </div>
    </li>
  );
}

function BranchCards() {
  const t = useTranslations("integrations.branches.cards");
  const projectId = useProjectId();
  const params = useSearchParams();
  const [host, setHost] = React.useState("");
  React.useEffect(() => setHost(window.location.host), []);

  const locations = useQuery({
    queryKey: ["locations", projectId],
    queryFn: () => cxApi.locations(projectId),
  });
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const { survey: fallback, live } = useBranchSurvey(projectId, surveys.data);
  const survey = live.find((s) => s.id === params.get("survey")) ?? fallback;
  const active = (locations.data ?? []).filter((l) => l.is_active);

  const print = () => {
    const previous = document.title;
    document.title = t("fileName");
    window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    window.print();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="grid gap-1">
          <Link
            href={`/projects/${projectId}/integrations?view=branches`}
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRightIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
            {t("back")}
          </Link>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
        </div>
        <Button onClick={print} disabled={!survey || !active.length}>
          <PrinterIcon aria-hidden="true" />
          {t("print")}
        </Button>
      </div>

      {locations.isLoading || surveys.isLoading ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : !survey || !active.length ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{survey ? t("noBranches") : t("noSurvey")}</AlertDescription>
        </Alert>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-[repeat(2,88mm)] print:justify-center print:gap-x-[6mm] print:gap-y-[8mm]">
          {active.map((loc) => (
            <BranchCard key={loc.id} survey={survey} location={loc} host={host} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BranchCardsPage() {
  return useFeature("cx") ? <BranchCards /> : <FeatureLocked feature="cx" />;
}
