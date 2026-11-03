"use client";

import { INDICATOR_TYPE_LABELS, label, type Indicator } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { Num, useStatFormat } from "@/components/analytics/format";
import { IndicatorStatusBadge, waveName } from "@/components/analytics/overview";
import { IndicatorDialog } from "@/components/measurement/indicator-dialog";
import { indicatorText } from "@/components/measurement/indicator-value";
import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { impactApi, projectApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

export default function IndicatorsPage() {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const fmt = useStatFormat();
  const projectId = useProjectId();
  const overview = useProjectOverview();
  const can = useCan();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const [editing, setEditing] = React.useState<Indicator | null>(null);
  const [open, setOpen] = React.useState(false);
  const values = useQuery({
    queryKey: ["indicator-values", projectId],
    queryFn: () => impactApi.indicatorValues(projectId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => projectApi.deleteIndicator(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success(t("deletedToast"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const recompute = useMutation({
    mutationFn: () => impactApi.recomputeIndicators(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["indicator-values", projectId] });
      toast.success(t("recomputed"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (overview.isLoading || !overview.data) return <Skeleton className="h-80 rounded-2xl" />;
  const { indicators, dimensions } = overview.data.plan;
  const dimName = (id: string | null) => dimensions.find((d) => d.id === id)?.name ?? t("noDimension");
  const byIndicator = new Map<string, NonNullable<typeof values.data>>();
  for (const v of values.data ?? [])
    byIndicator.set(v.indicator_id, [...(byIndicator.get(v.indicator_id) ?? []), v]);
  const computedAt = indicators
    .map((i) => i.last_computed_at)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
          <p className="text-xs text-muted-foreground">
            {computedAt ? t("computedAt", { date: fmt.date(computedAt) }) : t("neverComputed")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.analyze ? (
            <Button variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
              <RefreshCwIcon className={recompute.isPending ? "animate-spin" : ""} aria-hidden="true" />
              {t("recompute")}
            </Button>
          ) : null}
          {can.write ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <PlusIcon aria-hidden="true" />
              {t("add")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <Table>
        <TableCaption className="visually-hidden">{t("title")}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("code")}</TableHead>
            <TableHead scope="col">{t("name")}</TableHead>
            <TableHead scope="col">{t("dimension")}</TableHead>
            <TableHead scope="col">{t("type")}</TableHead>
            <TableHead scope="col">{t("target")}</TableHead>
            <TableHead scope="col">{t("baseline")}</TableHead>
            <TableHead scope="col">{t("current")}</TableHead>
            <TableHead scope="col">{t("status")}</TableHead>
            {can.write ? <TableHead scope="col" className="w-24" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {indicators.map((ind) => {
            const waves = byIndicator.get(ind.id) ?? [];
            return (
              <TableRow key={ind.id}>
                <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {ind.code}
                </TableCell>
                <TableCell className="min-w-48 font-medium">{ind.name}</TableCell>
                <TableCell className="text-muted-foreground">{dimName(ind.dimension_id)}</TableCell>
                <TableCell>
                  <Badge variant="soft">{label(INDICATOR_TYPE_LABELS, ind.indicator_type, locale)}</Badge>
                </TableCell>
                <TableCell>{ind.target_label || ind.target_value || "—"}</TableCell>
                <TableCell className="tabular-nums">
                  <Num>{indicatorText(ind.indicator_type, ind.unit, ind.baseline_value, fmt)}</Num>
                </TableCell>
                <TableCell className="min-w-36">
                  {ind.last_computed_at ? (
                    <div className="grid gap-0.5">
                      <span className="font-medium tabular-nums">
                        <Num>{indicatorText(ind.indicator_type, ind.unit, ind.current_value, fmt)}</Num>
                      </span>
                      {waves.length > 1 ? (
                        <span className="text-xs text-muted-foreground">
                          {waves
                            .filter((w) => w.value !== null)
                            .map(
                              (w) =>
                                `${waveName(w.wave, locale)} ${ind.indicator_type === "PERCENTAGE" ? fmt.pct(w.value, 1) : fmt.num(w.value)}`,
                            )
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("notComputed")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <IndicatorStatusBadge status={ind.status} />
                </TableCell>
                {can.write ? (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${tc("edit")} ${ind.code}`}
                        onClick={() => {
                          setEditing(ind);
                          setOpen(true);
                        }}
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${tc("delete")} ${ind.code}`}
                        onClick={() => {
                          if (window.confirm(t("deleteConfirm"))) remove.mutate(ind.id);
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <IndicatorDialog
        projectId={projectId}
        indicator={editing}
        dimensions={dimensions}
        open={open}
        onOpenChange={setOpen}
      />
    </Card>
  );
}
