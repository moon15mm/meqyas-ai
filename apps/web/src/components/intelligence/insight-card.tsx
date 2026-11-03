"use client";

import type { IndicatorStatus, Insight, InsightKind, Severity } from "@meqyas/shared";
import { Badge, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@meqyas/ui";
import {
  ArrowDownIcon,
  CircleCheckIcon,
  EyeIcon,
  InfoIcon,
  MessageSquareWarningIcon,
  PinIcon,
  PinOffIcon,
  RepeatIcon,
  ShieldAlertIcon,
  StarIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { Num, useStatFormat } from "@/components/analytics/format";
import { IndicatorStatusBadge, waveName } from "@/components/analytics/overview";

export const KIND_ICON: Record<InsightKind, LucideIcon> = {
  STRENGTH: StarIcon,
  WEAKNESS: ArrowDownIcon,
  IMPROVEMENT: TrendingUpIcon,
  DECLINE: TrendingDownIcon,
  PERSISTENCE: RepeatIcon,
  RISK: TriangleAlertIcon,
  SUCCESS: CircleCheckIcon,
  GAP: UsersIcon,
  ATTENTION: EyeIcon,
  PAIN_POINT: MessageSquareWarningIcon,
  DATA_QUALITY: ShieldAlertIcon,
  SAMPLE: InfoIcon,
};
const SEVERITY_VARIANT: Record<Severity, "destructive" | "warning" | "outline" | "soft"> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "outline",
  INFO: "soft",
};

/** "from → to" in reading order: the arrow points forward in both directions of text. */
export function waveSpan(from: string, to: string, locale: "ar" | "en"): string {
  return `${waveName(from, locale)} ${locale === "ar" ? "←" : "→"} ${waveName(to, locale)}`;
}

function EvidenceChips({ insight }: { insight: Insight }) {
  const t = useTranslations("intelligence.evidence");
  const locale = useLocale() as "ar" | "en";
  const fmt = useStatFormat();
  const e = insight.evidence;
  // Numbers sit in an LTR isolate; wave names follow the page direction.
  const chips: { text: string; numeric: boolean }[] = [];
  if (e.n != null) chips.push({ text: `n = ${e.n}`, numeric: true });
  if (e.wave) chips.push({ text: waveName(e.wave, locale), numeric: false });
  if (e.from_wave && e.to_wave)
    chips.push({ text: waveSpan(e.from_wave, e.to_wave, locale), numeric: false });
  if (e.p_value != null) chips.push({ text: `p ${fmt.p(e.p_value)}`, numeric: true });
  if (e.effect_size != null) chips.push({ text: `d = ${fmt.num(e.effect_size)}`, numeric: true });
  if (e.paired != null) chips.push({ text: e.paired ? t("paired") : t("independent"), numeric: false });
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
      {chips.map((c) => (
        <li key={c.text} className="rounded-full border px-2 py-0.5">
          {c.numeric ? <Num>{c.text}</Num> : c.text}
        </li>
      ))}
    </ul>
  );
}

export function InsightCard({
  insight,
  projectId,
  canAct,
  onStatus,
}: {
  insight: Insight;
  projectId: string;
  canAct: boolean;
  onStatus: (status: Insight["status"]) => void;
}) {
  const t = useTranslations("intelligence");
  const Icon = KIND_ICON[insight.kind];
  const [open, setOpen] = React.useState(false);
  const pinned = insight.status === "PINNED";
  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted"
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline">{t(`kinds.${insight.kind}`)}</Badge>
            <Badge variant={SEVERITY_VARIANT[insight.severity]}>{t(`severity.${insight.severity}`)}</Badge>
            <span className="text-muted-foreground">{t(`confidence.${insight.confidence}`)}</span>
            {pinned ? (
              <Badge variant="soft">
                <PinIcon aria-hidden="true" />
                {t("pinned")}
              </Badge>
            ) : null}
            {!insight.current ? <Badge variant="outline">{t("notCurrent")}</Badge> : null}
          </div>
          <h3 className="font-semibold text-pretty">{insight.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{insight.body}</p>
          <EvidenceChips insight={insight} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t("showEvidence")}
        </Button>
        {canAct ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => onStatus(pinned ? "NEW" : "PINNED")}>
              {pinned ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />}
              {pinned ? t("unpin") : t("pin")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onStatus("DISMISSED")}>
              <XIcon aria-hidden="true" />
              {t("dismiss")}
            </Button>
          </>
        ) : null}
      </div>
      <EvidenceSheet insight={insight} projectId={projectId} open={open} onOpenChange={setOpen} />
    </li>
  );
}

const EVIDENCE_ROWS = [
  "metric",
  "dimension",
  "indicator",
  "question",
  "segment_question",
  "theme",
  "value",
  "unit",
  "target",
  "status",
  "from_value",
  "to_value",
  "change",
  "effect_size",
  "effect_label",
  "p_value",
  "test",
  "n",
  "count",
] as const;

function EvidenceSheet({
  insight,
  projectId,
  open,
  onOpenChange,
}: {
  insight: Insight;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("intelligence.evidence");
  const tc = useTranslations("common");
  const ta = useTranslations("analytics.compare");
  const locale = useLocale() as "ar" | "en";
  const fmt = useStatFormat();
  const e = insight.evidence;
  const show = (k: (typeof EVIDENCE_ROWS)[number]): React.ReactNode => {
    const v = e[k];
    if (k === "metric") return t(`metrics.${String(v)}`);
    if (k === "status") return <IndicatorStatusBadge status={v as IndicatorStatus} />;
    if (k === "test") return v === "paired_t" ? ta("pairedT") : v === "welch_t" ? ta("welchT") : String(v);
    if (k === "effect_label") return ta(`effectLabels.${String(v) as "small"}`);
    if (typeof v !== "number") return String(v);
    if (k === "change") return <Num>{fmt.signed(v)}</Num>;
    if (k === "p_value") return <Num>{fmt.p(v)}</Num>;
    if (k === "n" || k === "count") return <Num>{fmt.int(v)}</Num>;
    return <Num>{fmt.num(v)}</Num>;
  };
  const view =
    e.metric === "dimension_change"
      ? "compare"
      : e.question_key
        ? "questions"
        : e.metric === "segment_gap"
          ? "questions"
          : "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" closeLabel={tc("close")} className="w-[min(96vw,32rem)] overflow-y-auto p-0">
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle className="text-pretty">{insight.title}</SheetTitle>
          <SheetDescription>{t("subtitle")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-5 pb-6">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {EVIDENCE_ROWS.filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== "").map((k) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground">{t(`fields.${k}`)}</dt>
                <dd className="font-medium break-words">{show(k)}</dd>
              </React.Fragment>
            ))}
            {e.from_wave && e.to_wave ? (
              <>
                <dt className="text-muted-foreground">{t("fields.waves")}</dt>
                <dd className="font-medium">{waveSpan(e.from_wave, e.to_wave, locale)}</dd>
              </>
            ) : e.wave ? (
              <>
                <dt className="text-muted-foreground">{t("fields.wave")}</dt>
                <dd className="font-medium">{waveName(e.wave, locale)}</dd>
              </>
            ) : null}
            {e.data_range ? (
              <>
                <dt className="text-muted-foreground">{t("fields.data_range")}</dt>
                <dd className="font-medium">
                  <Num>
                    {e.data_range.from} — {e.data_range.to}
                  </Num>
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("fields.filters")}</dt>
            <dd className="font-medium">
              {e.filters?.include_flagged ? t("withFlagged") : t("acceptedOnly")}
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">{t("computed")}</p>
          {view ? (
            <Button asChild variant="outline" className="justify-self-start">
              <Link href={`/projects/${projectId}/analytics?view=${view}`}>{t("openAnalytics")}</Link>
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
