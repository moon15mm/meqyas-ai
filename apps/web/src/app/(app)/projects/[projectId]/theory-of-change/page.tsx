"use client";

import type { IndicatorStatus, TheoryOfChange, TocIndicator, TocOutcome } from "@meqyas/shared";
import { EVIDENCE_LABELS } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  HourglassIcon,
  CircleXIcon,
  GitBranchIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { Num, useStatFormat } from "@/components/analytics/format";
import { indicatorText } from "@/components/measurement/indicator-value";
import { useProjectId } from "@/components/measurement/use-project";
import { impactApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

type ListKey = "inputs" | "activities" | "outputs" | "assumptions" | "risks";
type OutcomeKey = "short_term_outcomes" | "medium_term_outcomes" | "long_term_impact";
const CHAIN: Array<ListKey | OutcomeKey> = [
  "inputs",
  "activities",
  "outputs",
  "short_term_outcomes",
  "medium_term_outcomes",
  "long_term_impact",
];
const OUTCOMES: OutcomeKey[] = ["short_term_outcomes", "medium_term_outcomes", "long_term_impact"];
const isOutcome = (k: string): k is OutcomeKey => (OUTCOMES as string[]).includes(k);

const EMPTY: TheoryOfChange = {
  inputs: [],
  activities: [],
  outputs: [],
  short_term_outcomes: [],
  medium_term_outcomes: [],
  long_term_impact: [],
  assumptions: [],
  risks: [],
};

const STATUS: Record<IndicatorStatus, { icon: LucideIcon; className: string }> = {
  ACHIEVED: { icon: CircleCheckIcon, className: "text-success" },
  ON_TRACK: { icon: TrendingUpIcon, className: "text-success" },
  AT_RISK: { icon: TriangleAlertIcon, className: "text-warning-foreground dark:text-warning" },
  OFF_TRACK: { icon: CircleXIcon, className: "text-destructive" },
  NOT_STARTED: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  COLLECTING: { icon: HourglassIcon, className: "text-muted-foreground" },
};

function IndicatorLine({ ind }: { ind: TocIndicator }) {
  const t = useTranslations("toc");
  const fmt = useStatFormat();
  const meta = STATUS[ind.status];
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 text-xs">
      <meta.icon className={cn("mt-0.5 size-3.5", meta.className)} aria-hidden="true" />
      <span className="grid gap-0.5">
        <span className="text-foreground">
          <bdi dir="ltr" className="font-mono">
            {ind.code}
          </bdi>{" "}
          · {ind.name}
        </span>
        <span className="text-muted-foreground">
          {ind.last_computed_at ? (
            <Num>{indicatorText(ind.indicator_type, ind.unit, ind.current_value, fmt)}</Num>
          ) : (
            t("notComputed")
          )}{" "}
          · {t(`status.${ind.status}`)}
        </span>
      </span>
    </li>
  );
}

function Column({
  column,
  theory,
  indicators,
  last,
}: {
  column: ListKey | OutcomeKey;
  theory: TheoryOfChange;
  indicators: Map<string, TocIndicator>;
  last: boolean;
}) {
  const t = useTranslations("toc");
  const items: Array<string | TocOutcome> = theory[column];
  return (
    <div className="relative grid content-start gap-2">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">{t(`columns.${column}.title`)}</h3>
        <p className="text-xs text-muted-foreground text-pretty">{t(`columns.${column}.hint`)}</p>
      </div>
      <ul className="grid gap-2">
        {items.length ? (
          items.map((item, i) => {
            const text = typeof item === "string" ? item : item.text;
            const linked =
              typeof item === "string" ? [] : item.indicator_ids.flatMap((id) => indicators.get(id) ?? []);
            return (
              <li
                key={i}
                className={cn(
                  "grid gap-2 rounded-xl border bg-card p-3 text-sm text-pretty",
                  isOutcome(column) && "border-primary/30 bg-primary/[0.03]",
                )}
              >
                <span>{text}</span>
                {linked.length ? (
                  <ul className="grid gap-1.5 border-t pt-2">
                    {linked.map((ind) => (
                      <IndicatorLine key={ind.id} ind={ind} />
                    ))}
                  </ul>
                ) : isOutcome(column) ? (
                  <span className="text-xs text-muted-foreground">{t("noIndicator")}</span>
                ) : null}
              </li>
            );
          })
        ) : (
          <li className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            {t("emptyColumn")}
          </li>
        )}
      </ul>
      {!last ? (
        <ChevronLeftIcon
          className="absolute top-1 -end-3.5 hidden size-4 text-muted-foreground ltr:rotate-180 xl:block"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function ListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const t = useTranslations("toc");
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item}
            maxLength={300}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeItem")}
            onClick={() => onChange(items.filter((_, k) => k !== i))}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...items, ""])}
      >
        <PlusIcon aria-hidden="true" />
        {t("addItem")}
      </Button>
    </fieldset>
  );
}

function OutcomeEditor({
  label,
  items,
  indicators,
  onChange,
}: {
  label: string;
  items: TocOutcome[];
  indicators: TocIndicator[];
  onChange: (items: TocOutcome[]) => void;
}) {
  const t = useTranslations("toc");
  const set = (i: number, patch: Partial<TocOutcome>) =>
    onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="grid gap-2 rounded-xl border p-3">
          <div className="flex items-center gap-1.5">
            <Input
              value={item.text}
              maxLength={300}
              aria-label={`${label} ${i + 1}`}
              onChange={(e) => set(i, { text: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("removeItem")}
              onClick={() => onChange(items.filter((_, k) => k !== i))}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
          {indicators.length ? (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">{t("measuredBy")}</span>
              <div className="flex flex-wrap gap-1.5">
                {indicators.map((ind) => {
                  const on = item.indicator_ids.includes(ind.id);
                  return (
                    <button
                      key={ind.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set(i, {
                          indicator_ids: on
                            ? item.indicator_ids.filter((x) => x !== ind.id)
                            : [...item.indicator_ids, ind.id],
                        })
                      }
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs transition-colors",
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <bdi dir="ltr">{ind.code}</bdi> · {ind.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...items, { text: "", indicator_ids: [] }])}
      >
        <PlusIcon aria-hidden="true" />
        {t("addItem")}
      </Button>
    </fieldset>
  );
}

export default function TheoryOfChangePage() {
  const t = useTranslations("toc");
  const locale = useLocale() as "ar" | "en";
  const projectId = useProjectId();
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = ["theory", projectId];
  const view = useQuery({ queryKey: key, queryFn: () => impactApi.theory(projectId) });
  const [draft, setDraft] = React.useState<TheoryOfChange | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [notes, setNotes] = React.useState("");

  const save = useMutation({
    mutationFn: (data: TheoryOfChange) => impactApi.saveTheory(projectId, data),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      setDraft(null);
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const generate = useMutation({
    mutationFn: () => impactApi.generateTheory(projectId, notes),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      setGenerating(false);
      setDraft(null);
      toast.success(t("generated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (view.isLoading || !view.data) return <Skeleton className="h-96 rounded-2xl" />;
  const { theory, indicators, evidence_level, caveat } = view.data;
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const shown = draft ?? theory;
  const linkedIds = new Set(
    theory ? OUTCOMES.flatMap((c) => theory[c].flatMap((o) => o.indicator_ids)) : ([] as string[]),
  );
  const linked = indicators.filter((i) => linkedIds.has(i.id));
  const counts = linked.reduce<Record<string, number>>(
    (acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }),
    {},
  );
  const clean = (d: TheoryOfChange): TheoryOfChange => ({
    ...d,
    ...Object.fromEntries(
      (["inputs", "activities", "outputs", "assumptions", "risks"] as const).map((k) => [
        k,
        d[k].filter((x) => x.trim()),
      ]),
    ),
    ...Object.fromEntries(OUTCOMES.map((k) => [k, d[k].filter((o) => o.text.trim())])),
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>
                {t("cancel")}
              </Button>
              <Button onClick={() => save.mutate(clean(draft))} disabled={save.isPending}>
                <SaveIcon aria-hidden="true" />
                {t("save")}
              </Button>
            </>
          ) : (
            <>
              {can.useAI ? (
                <Button variant={theory ? "outline" : "default"} onClick={() => setGenerating(true)}>
                  <SparklesIcon aria-hidden="true" />
                  {theory ? t("regenerate") : t("generate")}
                </Button>
              ) : null}
              {can.write ? (
                <Button variant="outline" onClick={() => setDraft(structuredClone(theory ?? EMPTY))}>
                  <PencilIcon aria-hidden="true" />
                  {theory ? t("edit") : t("startManually")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {!shown ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <GitBranchIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground text-pretty">{t("emptyHint")}</p>
        </Card>
      ) : draft ? (
        <Card className="grid gap-6 p-5">
          <p className="text-sm text-muted-foreground">{t("editHint")}</p>
          <div className="grid gap-6 lg:grid-cols-2">
            {CHAIN.map((col) =>
              isOutcome(col) ? (
                <OutcomeEditor
                  key={col}
                  label={t(`columns.${col}.title`)}
                  items={draft[col]}
                  indicators={indicators}
                  onChange={(items) => setDraft({ ...draft, [col]: items })}
                />
              ) : (
                <ListEditor
                  key={col}
                  label={t(`columns.${col}.title`)}
                  items={draft[col]}
                  onChange={(items) => setDraft({ ...draft, [col]: items })}
                />
              ),
            )}
            <ListEditor
              label={t("assumptions")}
              items={draft.assumptions}
              onChange={(items) => setDraft({ ...draft, assumptions: items })}
            />
            <ListEditor
              label={t("risks")}
              items={draft.risks}
              onChange={(items) => setDraft({ ...draft, risks: items })}
            />
          </div>
        </Card>
      ) : (
        <>
          <Card className="grid gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{t("evidenceTitle")}</span>
              <Badge variant="evidence">{EVIDENCE_LABELS[evidence_level][locale]}</Badge>
              {theory?.ai_generated ? <Badge variant="outline">{t("aiDrafted")}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground text-pretty">{caveat}</p>
            <p className="text-xs text-muted-foreground">
              {t("linkedSummary", { linked: linked.length, total: indicators.length })}
              {(["ACHIEVED", "ON_TRACK", "AT_RISK", "OFF_TRACK", "COLLECTING", "NOT_STARTED"] as const)
                .filter((s) => counts[s])
                .map((s) => ` · ${t(`status.${s}`)}: ${counts[s]}`)
                .join("")}
            </p>
          </Card>

          <section aria-label={t("modelTitle")} className="grid gap-4 md:grid-cols-3 xl:grid-cols-6 xl:gap-6">
            {CHAIN.map((col, i) => (
              <Column key={col} column={col} theory={shown} indicators={byId} last={i === CHAIN.length - 1} />
            ))}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            {(["assumptions", "risks"] as const).map((col) => (
              <Card key={col} className="grid content-start gap-2 p-4">
                <h3 className="text-sm font-semibold">{t(col)}</h3>
                {shown[col].length ? (
                  <ul className="grid list-disc gap-1 ps-5 text-sm text-pretty">
                    {shown[col].map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("emptyColumn")}</p>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={generating} onOpenChange={(v) => !generate.isPending && setGenerating(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("generateTitle")}</DialogTitle>
            <DialogDescription>{t("generateHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="toc-notes">{t("notes")}</Label>
            <Textarea
              id="toc-notes"
              rows={4}
              maxLength={1500}
              value={notes}
              placeholder={t("notesPlaceholder")}
              onChange={(e) => setNotes(e.target.value)}
            />
            {theory ? (
              <p className="text-xs text-warning-foreground dark:text-warning">{t("replaceWarning")}</p>
            ) : null}
          </div>
          <DialogFooter>
            {generate.isPending ? (
              <p className="me-auto text-xs text-muted-foreground" role="status">
                {t("working")}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => setGenerating(false)} disabled={generate.isPending}>
              {t("cancel")}
            </Button>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              <SparklesIcon aria-hidden="true" />
              {t("generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
