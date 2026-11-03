"use client";

import type { PriorityLevel, Recommendation, RecommendationStatus } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecksIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useProjectId } from "@/components/measurement/use-project";
import { intelligenceApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useFeature } from "@/components/subscription/subscription";

const STATUSES: RecommendationStatus[] = ["PROPOSED", "ACCEPTED", "IN_PROGRESS", "DONE", "DISMISSED"];
const PRIORITIES: PriorityLevel[] = ["HIGH", "MEDIUM", "LOW"];
const PRIORITY_VARIANT = { HIGH: "destructive", MEDIUM: "warning", LOW: "outline" } as const;
const selectClass = "h-9 rounded-lg border border-input bg-card px-2 text-sm";

interface Draft {
  recommendation: string;
  problem: string;
  possible_cause: string;
  expected_outcome: string;
  priority: PriorityLevel;
  owner: string;
  timeframe: string;
  due_on: string;
}

const EMPTY: Draft = {
  recommendation: "",
  problem: "",
  possible_cause: "",
  expected_outcome: "",
  priority: "MEDIUM",
  owner: "",
  timeframe: "",
  due_on: "",
};

function RecommendationDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Draft;
  onSave: (draft: Draft) => void;
  saving: boolean;
}) {
  const t = useTranslations("intelligence.recommendations");
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const fields: Array<{ key: "problem" | "possible_cause" | "expected_outcome"; rows: number }> = [
    { key: "problem", rows: 2 },
    { key: "possible_cause", rows: 2 },
    { key: "expected_outcome", rows: 2 },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial.recommendation ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form
          id="rec-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.recommendation.trim().length >= 3) onSave(draft);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="rec-text">{t("fields.recommendation")}</Label>
            <Textarea
              id="rec-text"
              rows={3}
              required
              value={draft.recommendation}
              onChange={(e) => set("recommendation", e.target.value)}
            />
          </div>
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`rec-${f.key}`}>{t(`fields.${f.key}`)}</Label>
              <Textarea
                id={`rec-${f.key}`}
                rows={f.rows}
                value={draft[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rec-priority">{t("fields.priority")}</Label>
              <select
                id="rec-priority"
                className={`${selectClass} h-10`}
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value as PriorityLevel)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-owner">{t("fields.owner")}</Label>
              <Input
                id="rec-owner"
                value={draft.owner}
                maxLength={200}
                onChange={(e) => set("owner", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-timeframe">{t("fields.timeframe")}</Label>
              <Input
                id="rec-timeframe"
                value={draft.timeframe}
                maxLength={120}
                onChange={(e) => set("timeframe", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-due">{t("fields.due_on")}</Label>
              <Input
                id="rec-due"
                type="date"
                value={draft.due_on}
                onChange={(e) => set("due_on", e.target.value)}
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="rec-form" disabled={saving || draft.recommendation.trim().length < 3}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDraft(r: Recommendation): Draft {
  return {
    recommendation: r.recommendation,
    problem: r.problem,
    possible_cause: r.possible_cause,
    expected_outcome: r.expected_outcome,
    priority: r.priority,
    owner: r.owner,
    timeframe: r.timeframe,
    due_on: r.due_on ?? "",
  };
}

export default function RecommendationsPage() {
  const t = useTranslations("intelligence.recommendations");
  const projectId = useProjectId();
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = ["recommendations", projectId];
  const recs = useQuery({ queryKey: key, queryFn: () => intelligenceApi.recommendations(projectId) });
  const insights = useQuery({
    queryKey: ["insights", projectId],
    queryFn: () => intelligenceApi.insights(projectId),
  });
  const titles = new Map((insights.data ?? []).map((i) => [i.id, i.title]));
  const [editing, setEditing] = React.useState<Recommendation | null>(null);
  const [open, setOpen] = React.useState(false);

  const aiAllowed = useFeature("ai_analysis");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const generate = useMutation({
    mutationFn: () => intelligenceApi.generateRecommendations(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      toast.success(t("generated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const save = useMutation({
    mutationFn: async (draft: Draft) => {
      const body = { ...draft, due_on: draft.due_on || null };
      return editing
        ? intelligenceApi.updateRecommendation(editing.id, body)
        : intelligenceApi.createRecommendation(projectId, body);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecommendationStatus }) =>
      intelligenceApi.updateRecommendation(id, { status }),
    onSuccess: refresh,
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => intelligenceApi.deleteRecommendation(id),
    onSuccess: refresh,
    onError: (e) => toast.error(toMessage(e)),
  });

  const items = recs.data ?? [];
  const initial = React.useMemo(() => (editing ? toDraft(editing) : EMPTY), [editing]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        {can.analyze ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <PlusIcon aria-hidden="true" />
              {t("add")}
            </Button>
            {aiAllowed ? (
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                <SparklesIcon aria-hidden="true" />
                {generate.isPending ? t("generating") : t("generate")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {recs.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !items.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <ListChecksIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((r) => (
            <li
              key={r.id}
              className={`grid gap-3 rounded-2xl border bg-card p-4 ${r.status === "DONE" || r.status === "DISMISSED" ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant={PRIORITY_VARIANT[r.priority]}>{t(`priority.${r.priority}`)}</Badge>
                  <Badge variant="outline">{r.source === "AI" ? t("sourceAi") : t("sourceManual")}</Badge>
                  <span className="text-muted-foreground">{t(`confidence.${r.confidence}`)}</span>
                </span>
                {can.analyze ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("fields.status")}
                    <select
                      className={selectClass}
                      value={r.status}
                      onChange={(e) =>
                        update.mutate({ id: r.id, status: e.target.value as RecommendationStatus })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`status.${s}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <Badge variant="soft">{t(`status.${r.status}`)}</Badge>
                )}
              </div>
              <p className="font-semibold text-pretty">{r.recommendation}</p>
              <dl className="grid gap-2 text-sm">
                {(["problem", "possible_cause", "expected_outcome"] as const).map((f) =>
                  r[f] ? (
                    <div key={f} className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">{t(`fields.${f}`)}</dt>
                      <dd className="text-pretty">{r[f]}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
              {r.owner || r.timeframe || r.due_on ? (
                <p className="text-xs text-muted-foreground">
                  {[
                    r.owner && `${t("fields.owner")}: ${r.owner}`,
                    r.timeframe && `${t("fields.timeframe")}: ${r.timeframe}`,
                    r.due_on && `${t("fields.due_on")}: ${r.due_on}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {r.insight_ids.length ? (
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {r.insight_ids.map((id) => (
                    <li key={id} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {titles.get(id) ?? t("insightGone")}
                    </li>
                  ))}
                </ul>
              ) : null}
              {can.analyze ? (
                <div className="flex justify-end gap-1 border-t pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(r);
                      setOpen(true);
                    }}
                  >
                    <PencilIcon aria-hidden="true" />
                    {t("edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(t("deleteConfirm"))) remove.mutate(r.id);
                    }}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {t("delete")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("note")}</p>

      <RecommendationDialog
        open={open}
        onOpenChange={setOpen}
        initial={initial}
        onSave={(d) => save.mutate(d)}
        saving={save.isPending}
      />
    </div>
  );
}
