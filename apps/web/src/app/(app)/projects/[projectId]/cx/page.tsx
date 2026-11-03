"use client";

import { Alert, AlertDescription, Button, Card, Skeleton, Spinner } from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshakeIcon, MessageSquareTextIcon, SparklesIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { CasesPanel } from "@/components/cx/cases";
import { BranchTable, ChannelSplit, CxKpis, DriverMatrix, WeeklyTrend } from "@/components/cx/dashboard";
import { useProjectId } from "@/components/measurement/use-project";
import { cxApi, storeApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";
import { FeatureLocked } from "@/components/subscription/subscription-banner";

function StartCard({ projectId }: { projectId: string }) {
  const t = useTranslations("cx.empty");
  const can = useCan();
  const router = useRouter();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => storeApi.surveyFromTemplate(projectId, "store_visit"),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys", { projectId }] });
      toast.success(t("created"));
      router.push(`/surveys/${detail.survey.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <Card className="grid gap-6 p-6 text-center sm:p-8">
      <HeartHandshakeIcon className="mx-auto size-10 text-primary" aria-hidden="true" />
      <div className="grid gap-2">
        <p className="text-lg font-semibold">{t("title")}</p>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground text-pretty">{t("body")}</p>
      </div>
      <ul className="grid gap-3 text-start sm:grid-cols-3">
        {(["nps", "csat", "ces"] as const).map((m) => (
          <li key={m} className="grid gap-1 rounded-xl border p-4">
            <span className="font-medium">{t(`models.${m}.title`)}</span>
            <span className="text-sm text-muted-foreground text-pretty">{t(`models.${m}.body`)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        {can.write ? (
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner className="size-4" /> : <SparklesIcon aria-hidden="true" />}
            {t("visit")}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={`/projects/${projectId}/integrations`}>
            <StoreIcon aria-hidden="true" />
            {t("stores")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function CxDashboard() {
  const t = useTranslations("cx");
  const projectId = useProjectId();
  const toMessage = useErrorMessage();
  const dashboard = useQuery({
    queryKey: ["cx", projectId, "dashboard"],
    queryFn: () => cxApi.dashboard(projectId),
  });
  const data = dashboard.data;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        {data?.has_cx ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}/integrations?view=branches`}>
                <StoreIcon aria-hidden="true" />
                {t("links.branches")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}/insights`}>
                <MessageSquareTextIcon aria-hidden="true" />
                {t("links.voices")}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {dashboard.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{toMessage(dashboard.error)}</AlertDescription>
        </Alert>
      ) : dashboard.isLoading || !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : !data.has_cx ? (
        <StartCard projectId={projectId} />
      ) : data.overall.n === 0 ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <p className="font-medium">{t("noResponses.title")}</p>
          <p className="max-w-md text-sm text-muted-foreground text-pretty">
            {t("noResponses.body", { k: data.k_anonymity })}
          </p>
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/integrations?view=branches`}>{t("links.branches")}</Link>
          </Button>
        </Card>
      ) : (
        <>
          <CxKpis data={data} />
          <CasesPanel projectId={projectId} summary={data.cases} />
          <DriverMatrix data={data} />
          <BranchTable data={data} />
          <ChannelSplit data={data} />
          <WeeklyTrend data={data} />
        </>
      )}

      {data?.has_cx ? <p className="text-xs text-muted-foreground text-pretty">{t("trademark")}</p> : null}
    </div>
  );
}

export default function CxPage() {
  // Customer experience is a plan module (SUBSCRIPTIONS.md §3).
  return useFeature("cx") ? <CxDashboard /> : <FeatureLocked feature="cx" />;
}
