"use client";

import type { ReportSummary } from "@meqyas/shared";
import { Badge, Card, Skeleton } from "@meqyas/ui";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useStatFormat } from "@/components/analytics/format";

import { REPORT_TYPES } from "./new-report-dialog";

export function ReportList({
  reports,
  loading,
  showProject = false,
  empty,
}: {
  reports: ReportSummary[] | undefined;
  loading: boolean;
  showProject?: boolean;
  empty: React.ReactNode;
}) {
  const t = useTranslations("reports");
  const fmt = useStatFormat();
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!reports?.length) return <>{empty}</>;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {reports.map((r) => {
        const Icon = REPORT_TYPES.find((x) => x.type === r.report_type)?.icon ?? FileTextIcon;
        return (
          <li key={r.id}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <Link
                href={`/reports/${r.id}`}
                className="grid h-full gap-2 rounded-[inherit] p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-start gap-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="grid min-w-0 gap-1">
                    <span className="font-semibold text-pretty">{r.title}</span>
                    {showProject ? (
                      <span className="text-xs text-muted-foreground">{r.project_title}</span>
                    ) : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">{t(`types.${r.report_type}.name`)}</Badge>
                  <Badge variant="soft">{t("versionN", { n: r.current_version })}</Badge>
                  <span>{r.language === "en" ? "English" : "العربية"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t("updated", { date: fmt.date(r.updated_at) })}</span>
                </span>
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportsEmpty({ action }: { action?: React.ReactNode }) {
  const t = useTranslations("reports");
  return (
    <Card className="grid place-items-center gap-3 p-10 text-center">
      <FileTextIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{t("empty")}</p>
      <p className="max-w-md text-sm text-muted-foreground text-pretty">{t("emptyHint")}</p>
      {action}
    </Card>
  );
}
