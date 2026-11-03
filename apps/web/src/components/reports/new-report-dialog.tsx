"use client";

import type { ReportTone, ReportType } from "@meqyas/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
  Switch,
} from "@meqyas/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusinessIcon,
  FileTextIcon,
  GraduationCapIcon,
  type LucideIcon,
  TrendingUpIcon,
  ZapIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { selectClass } from "@/components/analytics/viz";
import { projectApi, reportsApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

export const REPORT_TYPES: Array<{ type: ReportType; icon: LucideIcon }> = [
  { type: "EXECUTIVE", icon: ZapIcon },
  { type: "DETAILED", icon: FileTextIcon },
  { type: "IMPACT", icon: TrendingUpIcon },
  { type: "MANAGEMENT", icon: BriefcaseBusinessIcon },
  { type: "ACADEMIC", icon: GraduationCapIcon },
];
const TONES: ReportTone[] = ["FORMAL", "PLAIN", "ANALYTICAL"];

export function NewReportDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted on the organization-wide page: the dialog asks for the project. */
  projectId?: string;
}) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const router = useRouter();
  const toMessage = useErrorMessage();
  const [type, setType] = React.useState<ReportType>("EXECUTIVE");
  const [tone, setTone] = React.useState<ReportTone>("FORMAL");
  const [language, setLanguage] = React.useState<"ar" | "en">(locale === "en" ? "en" : "ar");
  const [audience, setAudience] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [useAi, setUseAi] = React.useState(true);
  const [project, setProject] = React.useState(projectId ?? "");
  const projects = useQuery({
    queryKey: ["projects", "for-reports"],
    queryFn: () => projectApi.list({ limit: 100 }),
    enabled: open && !projectId,
  });
  React.useEffect(() => {
    if (!projectId && !project && projects.data?.items.length) setProject(projects.data.items[0].id);
  }, [projectId, project, projects.data]);

  const create = useMutation({
    mutationFn: () =>
      reportsApi.create(projectId ?? project, {
        report_type: type,
        tone,
        language,
        audience: audience.trim(),
        title: title.trim(),
        use_ai: useAi,
      }),
    onSuccess: (report) => {
      const ai = report.version.content.ai;
      if (ai.requested && !ai.used) toast.warning(t("aiFallback"));
      else toast.success(t("created"));
      onOpenChange(false);
      router.push(`/reports/${report.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !create.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("new.title")}</DialogTitle>
          <DialogDescription>{t("new.subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          id="new-report"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (projectId || project) create.mutate();
          }}
        >
          {!projectId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="report-project">{t("new.project")}</Label>
              <select
                id="report-project"
                className={selectClass}
                value={project}
                onChange={(e) => setProject(e.target.value)}
                required
              >
                {(projects.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("new.type")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REPORT_TYPES.map(({ type: value, icon: Icon }) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    type === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="report-type"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="sr-only"
                  />
                  <span
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted"
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{t(`types.${value}.name`)}</span>
                    <span className="text-xs text-muted-foreground text-pretty">
                      {t(`types.${value}.description`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="report-tone">{t("new.tone")}</Label>
              <select
                id="report-tone"
                className={selectClass}
                value={tone}
                onChange={(e) => setTone(e.target.value as ReportTone)}
              >
                {TONES.map((v) => (
                  <option key={v} value={v}>
                    {t(`tones.${v}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t(`toneHints.${tone}`)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-language">{t("new.language")}</Label>
              <select
                id="report-language"
                className={selectClass}
                value={language}
                onChange={(e) => setLanguage(e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-audience">{t("new.audience")}</Label>
              <Input
                id="report-audience"
                value={audience}
                maxLength={200}
                placeholder={t("new.audiencePlaceholder")}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-title">{t("new.titleField")}</Label>
              <Input
                id="report-title"
                value={title}
                maxLength={300}
                placeholder={t("new.titlePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start justify-between gap-4 rounded-xl border p-3">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("new.useAi")}</span>
              <span className="text-xs text-muted-foreground text-pretty">{t("new.useAiHint")}</span>
            </span>
            <Switch checked={useAi} onCheckedChange={setUseAi} aria-label={t("new.useAi")} />
          </label>
        </form>
        <DialogFooter className="items-center gap-3">
          {create.isPending ? (
            <p className="me-auto flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Spinner className="size-4" />
              {t("new.working")}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="new-report" disabled={create.isPending || !(projectId || project)}>
            {t("new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
