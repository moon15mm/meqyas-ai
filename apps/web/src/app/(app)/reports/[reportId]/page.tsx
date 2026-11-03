"use client";

import type { ReportEditInput, ReportTone } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@meqyas/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  HistoryIcon,
  PencilIcon,
  PrinterIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useStatFormat } from "@/components/analytics/format";
import { selectClass } from "@/components/analytics/viz";
import { ReportDocument, type SectionDraft } from "@/components/reports/report-document";
import { reportsApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const TONES: ReportTone[] = ["FORMAL", "PLAIN", "ANALYTICAL"];

function RefreshDialog({
  open,
  onOpenChange,
  tone,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone: ReportTone;
  onConfirm: (data: { tone: ReportTone; use_ai: boolean }) => void;
  pending: boolean;
}) {
  const t = useTranslations("reports");
  const [value, setValue] = React.useState(tone);
  const [useAi, setUseAi] = React.useState(true);
  React.useEffect(() => {
    if (open) setValue(tone);
  }, [open, tone]);
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("refresh.title")}</DialogTitle>
          <DialogDescription>{t("refresh.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="refresh-tone">{t("new.tone")}</Label>
            <select
              id="refresh-tone"
              className={selectClass}
              value={value}
              onChange={(e) => setValue(e.target.value as ReportTone)}
            >
              {TONES.map((v) => (
                <option key={v} value={v}>
                  {t(`tones.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-start justify-between gap-4 rounded-xl border p-3">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("new.useAi")}</span>
              <span className="text-xs text-muted-foreground text-pretty">{t("new.useAiHint")}</span>
            </span>
            <Switch checked={useAi} onCheckedChange={setUseAi} aria-label={t("new.useAi")} />
          </label>
        </div>
        <DialogFooter>
          {pending ? (
            <p className="me-auto text-xs text-muted-foreground" role="status">
              {t("new.working")}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => onConfirm({ tone: value, use_ai: useAi })} disabled={pending}>
            <RefreshCwIcon className={pending ? "animate-spin" : ""} aria-hidden="true" />
            {t("refresh.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toPatch(drafts: Record<string, SectionDraft>): ReportEditInput["sections"] {
  return Object.entries(drafts).map(([key, d]) => ({
    key,
    ...(d.hidden !== undefined ? { hidden: d.hidden } : {}),
    ...(d.paragraphs !== undefined
      ? {
          paragraphs: d.paragraphs
            .split(/\n\s*\n/)
            .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
            .filter(Boolean),
        }
      : {}),
    ...(d.bullets !== undefined
      ? {
          bullets: d.bullets
            .split("\n")
            .map((b) => b.trim())
            .filter(Boolean),
        }
      : {}),
  }));
}

export default function ReportPage() {
  const t = useTranslations("reports");
  const locale = useLocale();
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const can = useCan();
  const fmt = useStatFormat();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [version, setVersion] = React.useState<number | undefined>(undefined);
  const [editing, setEditing] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Record<string, SectionDraft>>({});
  const [title, setTitle] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);

  const report = useQuery({
    queryKey: ["report", reportId, version ?? "current"],
    queryFn: () => reportsApi.get(reportId, version),
    placeholderData: keepPreviousData,
  });
  const versions = useQuery({
    queryKey: ["report-versions", reportId],
    queryFn: () => reportsApi.versions(reportId),
  });
  const data = report.data;

  const settle = (fresh: NonNullable<typeof data>) => {
    queryClient.setQueryData(["report", reportId, "current"], fresh);
    void queryClient.invalidateQueries({ queryKey: ["report-versions", reportId] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    setVersion(undefined);
  };
  const save = useMutation({
    mutationFn: () =>
      reportsApi.edit(reportId, {
        ...(data && title.trim() && title.trim() !== data.title ? { title: title.trim() } : {}),
        sections: toPatch(drafts),
      }),
    onSuccess: (fresh) => {
      settle(fresh);
      setEditing(false);
      setDrafts({});
      toast.success(t("saved", { n: fresh.current_version }));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const refresh = useMutation({
    mutationFn: (body: { tone: ReportTone; use_ai: boolean }) => reportsApi.regenerate(reportId, body),
    onSuccess: (fresh) => {
      settle(fresh);
      setRefreshing(false);
      const ai = fresh.version.content.ai;
      if (ai.requested && !ai.used) toast.warning(t("aiFallback"));
      else toast.success(t("refreshed", { n: fresh.current_version }));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => reportsApi.remove(reportId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("deleted"));
      router.push(data ? `/projects/${data.project_id}/reports` : "/reports");
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const print = () => {
    const previous = document.title;
    if (data) document.title = data.title; // the browser suggests it as the PDF file name
    window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    window.print();
  };

  if (report.isLoading || !data) {
    return report.isError ? (
      <Alert variant="destructive">
        <AlertDescription>{toMessage(report.error)}</AlertDescription>
      </Alert>
    ) : (
      <Skeleton className="mx-auto h-[70dvh] w-full max-w-[860px] rounded-2xl" />
    );
  }

  const content = data.version.content;
  const current = data.version.version_number === data.current_version;
  const ai = content.ai;
  const dirty = Object.keys(drafts).length > 0 || (title.trim() !== "" && title.trim() !== data.title);
  const backArrow = locale === "ar" ? "" : "rotate-180";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-3 print:hidden">
        <Link
          href={`/projects/${data.project_id}/reports`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRightIcon className={`size-4 ${backArrow}`} aria-hidden="true" />
          {t("back", { project: data.project_title })}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <HistoryIcon className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("versions")}</span>
            <select
              className={selectClass}
              value={data.version.version_number}
              disabled={editing}
              onChange={(e) => {
                const n = Number(e.target.value);
                setVersion(n === data.current_version ? undefined : n);
              }}
            >
              {(
                versions.data ?? [
                  {
                    version_number: data.version.version_number,
                    reason: data.version.reason,
                    created_at: data.version.created_at,
                  },
                ]
              ).map((v) => (
                <option key={v.version_number} value={v.version_number}>
                  {t("versionOption", {
                    n: v.version_number,
                    reason: t(`reasons.${v.reason}`),
                    date: fmt.date(v.created_at),
                  })}
                  {v.version_number === data.current_version ? ` · ${t("currentTag")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setDrafts({});
                    setTitle("");
                  }}
                  disabled={save.isPending}
                >
                  {t("cancel")}
                </Button>
                <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                  <SaveIcon aria-hidden="true" />
                  {t("saveVersion")}
                </Button>
              </>
            ) : (
              <>
                {can.report && current ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTitle(data.title);
                        setEditing(true);
                      }}
                    >
                      <PencilIcon aria-hidden="true" />
                      {t("edit")}
                    </Button>
                    <Button variant="outline" onClick={() => setRefreshing(true)}>
                      <RefreshCwIcon aria-hidden="true" />
                      {t("refresh.button")}
                    </Button>
                  </>
                ) : null}
                <Button onClick={print}>
                  <PrinterIcon aria-hidden="true" />
                  {t("print")}
                </Button>
                {can.report ? (
                  <Button
                    variant="ghost"
                    aria-label={t("delete")}
                    onClick={() => {
                      if (window.confirm(t("deleteConfirm"))) remove.mutate();
                    }}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {!current ? (
          <Alert>
            <HistoryIcon aria-hidden="true" />
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {t("oldVersion", { n: data.version.version_number, current: data.current_version })}
              <Button size="sm" variant="outline" onClick={() => setVersion(undefined)}>
                {t("showCurrent")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {ai.requested && !ai.used ? (
          <Alert>
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>{t("aiFallbackLong")}</AlertDescription>
          </Alert>
        ) : ai.used && ai.rejected.length ? (
          <Alert>
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>{t("aiPartial", { count: ai.rejected.length })}</AlertDescription>
          </Alert>
        ) : null}
        {editing ? (
          <div className="grid gap-1.5">
            <Label htmlFor="report-title-edit">{t("new.titleField")}</Label>
            <Input
              id="report-title-edit"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("editHint")}</p>
          </div>
        ) : null}
      </div>

      <div
        className={
          report.isFetching && !report.isLoading ? "opacity-60 transition-opacity" : "transition-opacity"
        }
      >
        <ReportDocument
          content={content}
          version={data.version.version_number}
          editing={editing}
          drafts={drafts}
          onDraft={(key, patch) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }))}
        />
      </div>

      <RefreshDialog
        open={refreshing}
        onOpenChange={setRefreshing}
        tone={data.tone}
        onConfirm={(body) => refresh.mutate(body)}
        pending={refresh.isPending}
      />
    </div>
  );
}
