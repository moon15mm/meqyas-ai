"use client";

import { label, WAVE_LABELS } from "@meqyas/shared";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumnIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { ComparisonView } from "@/components/analytics/comparison";
import { CrosstabView } from "@/components/analytics/crosstab";
import {
  CausalityBanner,
  DimensionChart,
  IndicatorGrid,
  KpiTiles,
  ResponsesTrend,
  StrengthProblem,
} from "@/components/analytics/overview";
import { QuestionsView } from "@/components/analytics/questions";
import { useProjectId } from "@/components/measurement/use-project";
import { analyticsApi, surveyApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";

const VIEWS = ["overview", "compare", "questions", "crosstab"] as const;
type View = (typeof VIEWS)[number];

function ExportMenu({ projectId, includeFlagged }: { projectId: string; includeFlagged: boolean }) {
  const t = useTranslations("analytics.export");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const withData = (surveys.data ?? []).filter((s) => s.response_count > 0);
  const [busy, setBusy] = React.useState(false);

  const download = async (surveyId: string, publicId: string, format: "csv" | "xlsx") => {
    setBusy(true);
    try {
      const blob = await analyticsApi.exportResponses(surveyId, format, includeFlagged);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meqyas-${publicId}-responses.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(toMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!withData.length || busy}>
          <DownloadIcon aria-hidden="true" />
          {t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {withData.map((s, i) => (
          <React.Fragment key={s.id}>
            {i ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="grid gap-0.5">
                <span className="line-clamp-1">{s.title}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {s.wave_type ? `${label(WAVE_LABELS, s.wave_type, locale)} · ` : ""}
                  {t("responses", { count: s.response_count })}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void download(s.id, s.public_id, "xlsx")}>
                <FileSpreadsheetIcon aria-hidden="true" />
                {t("xlsx")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void download(s.id, s.public_id, "csv")}>
                <FileTextIcon aria-hidden="true" />
                {t("csv")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {t(includeFlagged ? "noteFlagged" : "note")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const projectId = useProjectId();
  const can = useCan();
  const exportsAllowed = useFeature("exports");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("view");
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : "overview";
  const [includeFlagged, setIncludeFlagged] = React.useState(false);

  const summary = useQuery({
    queryKey: ["analytics", projectId, "summary", { includeFlagged }],
    queryFn: () => analyticsApi.summary(projectId, { include_flagged: includeFlagged }),
    placeholderData: keepPreviousData,
  });

  const setView = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    if (next === "overview") sp.delete("view");
    else sp.set("view", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const data = summary.data;
  const busy = summary.isFetching && !summary.isLoading;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        {can.exportResponses && exportsAllowed ? (
          <ExportMenu projectId={projectId} includeFlagged={includeFlagged} />
        ) : null}
      </div>

      {summary.isLoading || !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : data.counts.total === 0 ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <ChartNoAxesColumnIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("empty.hint")}</p>
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/surveys`}>{t("empty.goToSurveys")}</Link>
          </Button>
        </Card>
      ) : (
        <Tabs value={view} onValueChange={setView} className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="scroll-x-hidden max-w-full min-w-0 justify-start overflow-x-auto">
              {VIEWS.map((v) => (
                <TabsTrigger key={v} value={v}>
                  {t(`views.${v}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="include-flagged" checked={includeFlagged} onCheckedChange={setIncludeFlagged} />
              <label htmlFor="include-flagged">{t("filters.includeFlagged")}</label>
            </div>
          </div>

          {data.counts.included === 0 ? (
            <Card className="grid place-items-center gap-2 p-10 text-center">
              <p className="font-medium">{t("empty.noneIncluded")}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t("empty.noneIncludedHint")}</p>
            </Card>
          ) : (
            <>
              <TabsContent value="overview" className="grid grid-cols-[minmax(0,1fr)] gap-5">
                <CausalityBanner summary={data} />
                <KpiTiles summary={data} />
                <StrengthProblem summary={data} />
                <DimensionChart summary={data} busy={busy} />
                <IndicatorGrid summary={data} busy={busy} />
                <ResponsesTrend summary={data} busy={busy} />
              </TabsContent>
              <TabsContent value="compare">
                <ComparisonView projectId={projectId} summary={data} includeFlagged={includeFlagged} />
              </TabsContent>
              <TabsContent value="questions">
                <QuestionsView
                  projectId={projectId}
                  summary={data}
                  includeFlagged={includeFlagged}
                  canReadText={can.readResponses}
                />
              </TabsContent>
              <TabsContent value="crosstab">
                <CrosstabView projectId={projectId} summary={data} includeFlagged={includeFlagged} />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  );
}
