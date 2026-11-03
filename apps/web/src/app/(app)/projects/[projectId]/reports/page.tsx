"use client";

import { Button } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { useProjectId } from "@/components/measurement/use-project";
import { NewReportDialog } from "@/components/reports/new-report-dialog";
import { ReportList, ReportsEmpty } from "@/components/reports/report-list";
import { reportsApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";

export default function ProjectReportsPage() {
  const t = useTranslations("reports");
  const projectId = useProjectId();
  const can = useCan();
  const [open, setOpen] = React.useState(false);
  const reports = useQuery({
    queryKey: ["reports", projectId],
    queryFn: () => reportsApi.forProject(projectId),
  });
  const add = can.report ? (
    <Button onClick={() => setOpen(true)}>
      <PlusIcon aria-hidden="true" />
      {t("new.button")}
    </Button>
  ) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        {reports.data?.length ? add : null}
      </div>
      <ReportList reports={reports.data} loading={reports.isLoading} empty={<ReportsEmpty action={add} />} />
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      <NewReportDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </div>
  );
}
