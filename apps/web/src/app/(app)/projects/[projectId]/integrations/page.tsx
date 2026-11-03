"use client";

import type { StoreConnection, StoreConnectionCreated } from "@meqyas/shared";
import { Badge, Button, Card, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartColumnIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlugZapIcon,
  PlusIcon,
  SettingsIcon,
  ShoppingBagIcon,
  StoreIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useStatFormat } from "@/components/analytics/format";
import { BranchesPanel } from "@/components/cx/branches";
import { ConnectionFormDialog, PLATFORMS } from "@/components/integrations/connection-form";
import { ConnectionSheet } from "@/components/integrations/connection-sheet";
import { useProjectId } from "@/components/measurement/use-project";
import { useFormatters } from "@/components/responses/response-format";
import { storeApi, surveyApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";
import { FeatureLocked } from "@/components/subscription/subscription-banner";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl bg-muted/50 p-2.5">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const VIEWS = ["online", "branches"] as const;
type View = (typeof VIEWS)[number];

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  const projectId = useProjectId();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("view");
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : "online";
  const setView = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    if (next === "online") sp.delete("view");
    else sp.set("view", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const can = useCan();
  const fmt = useFormatters();
  const stat = useStatFormat();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<StoreConnection | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);

  // Store integrations and branches are plan modules (SUBSCRIPTIONS.md §3).
  const integrationsAllowed = useFeature("integrations");
  const cxAllowed = useFeature("cx");
  const connections = useQuery({
    queryKey: ["store-connections", projectId],
    queryFn: () => storeApi.list(projectId),
    enabled: integrationsAllowed,
  });
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const surveyName = (id: string | null) =>
    id ? ((surveys.data ?? []).find((s) => s.id === id)?.title ?? "—") : null;
  const items = connections.data ?? [];
  const opened = items.find((c) => c.id === openId) ?? null;

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "PAUSED" }) =>
      storeApi.update(id, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["store-connections", projectId] }),
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => storeApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store-connections", projectId] });
      toast.success(t("deleted"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const onSaved = (saved: StoreConnection | StoreConnectionCreated, created: boolean) => {
    if (created) {
      setSecret("secret" in saved ? saved.secret : null);
      setOpenId(saved.id);
      toast.success(t("created"));
    } else {
      toast.success(t("saved"));
    }
  };

  const addButton = can.manageIntegrations ? (
    <Button
      onClick={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <PlusIcon aria-hidden="true" />
      {t("add")}
    </Button>
  ) : null;

  return (
    <Tabs value={view} onValueChange={setView} className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t("hubTitle")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("hubSubtitle")}</p>
      </div>
      <TabsList className="scroll-x-hidden max-w-full min-w-0 justify-start justify-self-start overflow-x-auto">
        <TabsTrigger value="online">
          <ShoppingBagIcon aria-hidden="true" />
          {t("views.online")}
        </TabsTrigger>
        <TabsTrigger value="branches">
          <StoreIcon aria-hidden="true" />
          {t("views.branches")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="branches" className="grid grid-cols-[minmax(0,1fr)]">
        {cxAllowed ? <BranchesPanel projectId={projectId} /> : <FeatureLocked feature="cx" />}
      </TabsContent>

      <TabsContent value="online" className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {!integrationsAllowed ? (
          <FeatureLocked feature="integrations" />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <h3 className="font-semibold">{t("title")}</h3>
                <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
              </div>
              {items.length ? addButton : null}
            </div>

            {connections.isLoading ? (
              <Skeleton className="h-48 rounded-2xl" />
            ) : !items.length ? (
              <Card className="grid gap-6 p-6 sm:p-8">
                <div className="grid gap-2 text-center">
                  <ShoppingBagIcon className="mx-auto size-10 text-primary" aria-hidden="true" />
                  <p className="text-lg font-semibold">{t("empty.title")}</p>
                  <p className="mx-auto max-w-xl text-sm text-muted-foreground text-pretty">
                    {t("empty.body")}
                  </p>
                </div>
                <ol className="grid gap-3 sm:grid-cols-3">
                  {(["connect", "invite", "analyze"] as const).map((step, i) => (
                    <li key={step} className="grid gap-1 rounded-xl border p-4">
                      <span className="text-xs font-semibold text-primary">
                        {t("empty.step", { n: i + 1 })}
                      </span>
                      <span className="font-medium">{t(`empty.steps.${step}.title`)}</span>
                      <span className="text-sm text-muted-foreground text-pretty">
                        {t(`empty.steps.${step}.body`)}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {PLATFORMS.map((p) => (
                    <Badge key={p} variant="outline">
                      {t(`platforms.${p}.name`)}
                    </Badge>
                  ))}
                </div>
                <div className="flex justify-center">
                  {addButton ?? <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>}
                </div>
              </Card>
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {items.map((c) => {
                  const s = c.stats;
                  return (
                    <li key={c.id} className="grid content-start gap-4 rounded-2xl border bg-card p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid min-w-0 gap-1">
                          <span className="font-semibold text-pretty">{c.name}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs">
                            <Badge variant="soft">{t(`platforms.${c.platform}.name`)}</Badge>
                            <Badge variant={c.status === "ACTIVE" ? "success" : "outline"}>
                              {c.status === "ACTIVE" ? (
                                <PlugZapIcon aria-hidden="true" />
                              ) : (
                                <PauseIcon aria-hidden="true" />
                              )}
                              {t(`status.${c.status}`)}
                            </Badge>
                            <Badge variant="outline">{t(`delivery.${c.delivery}.short`)}</Badge>
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSecret(null);
                            setOpenId(c.id);
                          }}
                        >
                          <SettingsIcon aria-hidden="true" />
                          {t("open")}
                        </Button>
                      </div>
                      <dl className="grid gap-1 text-sm">
                        {c.store_survey_id ? (
                          <div className="flex gap-2">
                            <dt className="text-muted-foreground">{t("storeSurvey")}:</dt>
                            <dd className="min-w-0 truncate">{surveyName(c.store_survey_id)}</dd>
                          </div>
                        ) : null}
                        {c.product_survey_id ? (
                          <div className="flex gap-2">
                            <dt className="text-muted-foreground">{t("productSurvey")}:</dt>
                            <dd className="min-w-0 truncate">{surveyName(c.product_survey_id)}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label={t("stats.invitations")} value={stat.int(s.invitations)} />
                        <Stat label={t("stats.opened")} value={stat.int(s.opened)} />
                        <Stat label={t("stats.responded")} value={stat.int(s.responded)} />
                        <Stat
                          label={t("stats.rate")}
                          value={s.response_rate === null ? "—" : stat.pct(s.response_rate, 0)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.last_event_at
                          ? t("lastEvent", { date: fmt.dateTime(c.last_event_at) })
                          : t("noEvents")}
                        {c.events_rejected ? ` · ${t("rejected", { count: c.events_rejected })}` : ""}
                        {s.pending_email ? ` · ${t("pendingEmail", { count: s.pending_email })}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-2 border-t pt-3">
                        {s.responded ? (
                          <Button asChild variant="link" size="sm" className="h-auto px-0">
                            <Link href={`/projects/${projectId}/analytics?view=questions`}>
                              <ChartColumnIcon aria-hidden="true" />
                              {t("results")}
                            </Link>
                          </Button>
                        ) : null}
                        {can.manageIntegrations ? (
                          <span className="ms-auto flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                update.mutate({
                                  id: c.id,
                                  status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                                })
                              }
                            >
                              {c.status === "ACTIVE" ? (
                                <PauseIcon aria-hidden="true" />
                              ) : (
                                <PlayIcon aria-hidden="true" />
                              )}
                              {c.status === "ACTIVE" ? t("pause") : t("resume")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${t("edit")} ${c.name}`}
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${t("delete")} ${c.name}`}
                              onClick={() => {
                                if (window.confirm(t("deleteConfirm"))) remove.mutate(c.id);
                              }}
                            >
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </TabsContent>

      <ConnectionFormDialog
        projectId={projectId}
        connection={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={onSaved}
      />
      <ConnectionSheet
        connection={opened}
        secret={secret}
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null);
            setSecret(null);
          }
        }}
      />
    </Tabs>
  );
}
