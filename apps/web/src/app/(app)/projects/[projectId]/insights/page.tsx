"use client";

import type { Insight } from "@meqyas/shared";
import { Button, Card, Skeleton } from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LightbulbIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { AnalystChat } from "@/components/intelligence/analyst-chat";
import { InsightCard } from "@/components/intelligence/insight-card";
import { useProjectId } from "@/components/measurement/use-project";
import { intelligenceApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";

export default function InsightsPage() {
  const t = useTranslations("intelligence");
  const projectId = useProjectId();
  const can = useCan();
  const aiAllowed = useFeature("ai_analysis");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = ["insights", projectId];
  const insights = useQuery({ queryKey: key, queryFn: () => intelligenceApi.insights(projectId) });

  const generate = useMutation({
    mutationFn: () => intelligenceApi.generateInsights(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      toast.success(t("generated", { count: data.length }));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Insight["status"] }) =>
      intelligenceApi.setInsightStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(toMessage(e)),
  });

  const items = insights.data ?? [];
  const pinned = items.filter((i) => i.status === "PINNED");
  const rest = items.filter((i) => i.status !== "PINNED");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        {can.analyze ? (
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            <RefreshCwIcon className={generate.isPending ? "animate-spin" : ""} aria-hidden="true" />
            {items.length ? t("refresh") : t("generate")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid min-w-0 gap-4">
          {insights.isLoading ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : !items.length ? (
            <Card className="grid place-items-center gap-3 p-10 text-center">
              <LightbulbIcon className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">{t("empty")}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
            </Card>
          ) : (
            <>
              {pinned.length ? (
                <section aria-labelledby="pinned-title" className="grid gap-3">
                  <h3 id="pinned-title" className="text-sm font-semibold text-muted-foreground">
                    {t("pinnedTitle")}
                  </h3>
                  <ul className="grid gap-3">
                    {pinned.map((i) => (
                      <InsightCard
                        key={i.id}
                        insight={i}
                        projectId={projectId}
                        canAct={can.analyze}
                        onStatus={(status) => setStatus.mutate({ id: i.id, status })}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
              <ul className="grid gap-3">
                {rest.map((i) => (
                  <InsightCard
                    key={i.id}
                    insight={i}
                    projectId={projectId}
                    canAct={can.analyze}
                    onStatus={(status) => setStatus.mutate({ id: i.id, status })}
                  />
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t("rulesNote")}</p>
            </>
          )}
        </div>
        {can.analyze && aiAllowed ? (
          <aside className="min-w-0 lg:sticky lg:top-20">
            <AnalystChat projectId={projectId} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
