"use client";

import { Button, Skeleton } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useProjectContext } from "@/components/layout/shell-context";
import { SurveyBuilder } from "@/components/survey/builder/builder";
import { ApiError } from "@/lib/api/client";
import { projectApi, surveyApi } from "@/lib/api/endpoints";

export default function SurveyBuilderPage() {
  const { surveyId } = useParams<{ surveyId: string }>();
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const survey = useQuery({
    queryKey: ["survey", surveyId],
    queryFn: () => surveyApi.get(surveyId),
    // Local edits are the source of truth while the builder is open.
    refetchOnWindowFocus: false,
  });
  const projectId = survey.data?.survey.project_id;
  const overview = useQuery({
    queryKey: ["project", projectId, "overview"],
    queryFn: () => projectApi.overview(projectId!),
    enabled: !!projectId,
  });
  useProjectContext(overview.data?.project);

  if (survey.error) {
    const missing = survey.error instanceof ApiError && survey.error.status === 404;
    return (
      <div className="mx-auto grid max-w-md place-items-center gap-3 py-16 text-center">
        <p className="font-medium">{missing ? t("notFound") : tc("error")}</p>
        <Button asChild variant="outline">
          <Link href="/surveys">{t("listTitle")}</Link>
        </Button>
      </div>
    );
  }
  if (!survey.data || (projectId && overview.isLoading)) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-5 lg:grid-cols-[13rem_1fr_22rem]">
          <Skeleton className="hidden h-96 rounded-2xl lg:block" />
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="hidden h-96 rounded-2xl lg:block" />
        </div>
      </div>
    );
  }
  // Remount the builder when the survey changes so local state never leaks between surveys.
  return (
    <SurveyBuilder key={survey.data.survey.id} detail={survey.data} plan={overview.data?.plan ?? null} />
  );
}
