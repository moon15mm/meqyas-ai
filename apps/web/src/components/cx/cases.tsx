"use client";

import type { CxCase, CxCaseFilter, CxDashboard } from "@meqyas/shared";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Skeleton,
  Spinner,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  ClockIcon,
  EyeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  RotateCcwIcon,
  ShoppingBagIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { Num, useStatFormat } from "@/components/analytics/format";
import { cxApi } from "@/lib/api/endpoints";
import { useAuth, useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const SCALE_MAX: Record<CxCase["score_type"], number> = { NPS: 10, CSAT: 5, CES: 7 };
const FILTERS: CxCaseFilter[] = ["open", "resolved", "all"];

function useRelative() {
  const locale = useLocale();
  return React.useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { numeric: "auto" });
    return (iso: string) => {
      const seconds = (Date.parse(iso) - Date.now()) / 1000;
      const abs = Math.abs(seconds);
      if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
      // Hours up to three days: "in 47 hours" reads better against a 48-hour target than "the day after tomorrow".
      if (abs < 3 * 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
      return rtf.format(Math.round(seconds / 86_400), "day");
    };
  }, [locale]);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div
      className={cn(
        "grid gap-0.5 rounded-xl bg-muted/50 p-2.5",
        tone === "warning" && "bg-warning/12 ring-1 ring-warning/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-lg font-semibold">
        {tone === "warning" ? (
          <TriangleAlertIcon
            className="size-4 text-warning-foreground dark:text-warning"
            aria-hidden="true"
          />
        ) : null}
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ResolveDialog({
  item,
  onOpenChange,
  onDone,
}: {
  item: CxCase | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations("cx.cases.resolve");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (item) {
      setNote("");
      setTouched(false);
    }
  }, [item]);
  const resolve = useMutation({
    mutationFn: () => cxApi.updateCase(item!.id, { status: "RESOLVED", resolution_note: note.trim() }),
    onSuccess: () => {
      toast.success(t("done"));
      onDone();
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const short = note.trim().length < 3;
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!short) resolve.mutate();
          }}
        >
          <Field
            id="case-note"
            label={t("note")}
            error={touched && short ? t("noteRequired") : undefined}
            required
          >
            <Textarea
              rows={4}
              value={note}
              maxLength={2000}
              placeholder={t("placeholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={resolve.isPending}>
              {resolve.isPending ? <Spinner className="size-4" /> : <CircleCheckIcon aria-hidden="true" />}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CaseCard({
  item,
  onResolve,
  onChanged,
}: {
  item: CxCase;
  onResolve: (item: CxCase) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("cx.cases");
  const fmt = useStatFormat();
  const relative = useRelative();
  const can = useCan();
  const { user } = useAuth();
  const toMessage = useErrorMessage();
  const [contact, setContact] = React.useState<{ phone?: string; email?: string } | null>(null);
  const resolved = item.status === "RESOLVED";

  const update = useMutation({
    mutationFn: (data: Parameters<typeof cxApi.updateCase>[1]) => cxApi.updateCase(item.id, data),
    onSuccess: (_, data) => {
      if (data.assign_to_me) toast.success(t("assigned"));
      onChanged();
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const reveal = useMutation({
    mutationFn: () => cxApi.revealContact(item.id),
    onSuccess: (c) => setContact(c),
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <li
      className={cn(
        "grid content-start gap-3 rounded-2xl border bg-card p-4",
        item.overdue && "border-warning/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={resolved ? "outline" : "destructive"}>{t(`reasons.${item.reason}`)}</Badge>
            {/* Visually "NPS · 6/10" (each part isolated so RTL never reorders it); read as a sentence. */}
            <span className="text-sm font-semibold">
              <span aria-hidden="true">
                <bdi>{item.score_type}</bdi> ·{" "}
                <Num>{`${fmt.int(item.score)}/${SCALE_MAX[item.score_type]}`}</Num>
              </span>
              <span className="sr-only">
                {t("score", {
                  type: item.score_type,
                  score: fmt.int(item.score),
                  max: SCALE_MAX[item.score_type],
                })}
              </span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {item.location ? (
                <MapPinIcon className="size-3.5" aria-hidden="true" />
              ) : (
                <ShoppingBagIcon className="size-3.5" aria-hidden="true" />
              )}
              {item.location ?? t("noBranch")}
            </span>
            <time dateTime={item.created_at}>{relative(item.created_at)}</time>
          </span>
        </div>
        {resolved ? (
          <Badge variant="success">
            <CircleCheckIcon aria-hidden="true" />
            {t("status.RESOLVED")}
          </Badge>
        ) : item.overdue ? (
          <Badge variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            {t("overdue", { when: relative(item.due_at) })}
          </Badge>
        ) : (
          <Badge variant="outline">
            <ClockIcon aria-hidden="true" />
            {t("due", { when: relative(item.due_at) })}
          </Badge>
        )}
      </div>

      {item.comment ? (
        <blockquote className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-pretty">
          <span className="sr-only">{t("comment")}: </span>
          {item.comment}
        </blockquote>
      ) : null}

      {resolved ? (
        <div className="grid gap-0.5 text-sm">
          <span className="text-xs text-muted-foreground">{t("resolution")}</span>
          <p className="text-pretty">{item.resolution_note}</p>
        </div>
      ) : null}

      {contact ? (
        <div className="flex flex-wrap gap-2">
          {contact.phone ? (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${contact.phone}`} dir="ltr">
                <PhoneIcon aria-hidden="true" />
                {contact.phone}
              </a>
            </Button>
          ) : null}
          {contact.email ? (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${contact.email}`} dir="ltr">
                <MailIcon aria-hidden="true" />
                {contact.email}
              </a>
            </Button>
          ) : null}
          {!contact.phone && !contact.email ? (
            <p className="text-xs text-muted-foreground">{t("noContact")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <UserRoundCheckIcon className="size-3.5" aria-hidden="true" />
          {item.assigned_to ? t("assignedTo", { name: item.assigned_to }) : t("unassigned")}
        </span>
        {!item.has_contact && !resolved ? (
          <span>· {item.contact_requested ? t("contactGone") : t("noContactRequested")}</span>
        ) : null}
        {can.readResponses ? (
          <span className="ms-auto flex flex-wrap gap-1">
            {!resolved && item.assigned_to_id !== user?.id ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => update.mutate({ assign_to_me: true })}
              >
                <UserRoundCheckIcon aria-hidden="true" />
                {t("assign")}
              </Button>
            ) : null}
            {!resolved && item.has_contact && !contact ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={reveal.isPending}
                title={t("revealNote")}
                onClick={() => reveal.mutate()}
              >
                <EyeIcon aria-hidden="true" />
                {t("reveal")}
              </Button>
            ) : null}
            {resolved ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => update.mutate({ status: "IN_PROGRESS" })}
              >
                <RotateCcwIcon aria-hidden="true" />
                {t("reopen")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => onResolve(item)}>
                <CircleCheckIcon aria-hidden="true" />
                {t("resolveButton")}
              </Button>
            )}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function CasesPanel({ projectId, summary }: { projectId: string; summary: CxDashboard["cases"] }) {
  const t = useTranslations("cx.cases");
  const fmt = useStatFormat();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<CxCaseFilter>("open");
  const [resolving, setResolving] = React.useState<CxCase | null>(null);
  const cases = useQuery({
    queryKey: ["cx", projectId, "cases", filter],
    queryFn: () => cxApi.cases(projectId, filter),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["cx", projectId] });
  const items = cases.data ?? [];

  return (
    <section
      aria-labelledby="cx-cases"
      className="grid min-w-0 content-start gap-4 rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="grid gap-1">
        <h3 id="cx-cases" className="font-semibold">
          {t("title")}
        </h3>
        <p className="text-sm text-muted-foreground text-pretty">{t("description")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("summary.open")} value={fmt.int(summary.open)} />
        <Stat
          label={t("summary.overdue")}
          value={fmt.int(summary.overdue)}
          tone={summary.overdue > 0 ? "warning" : undefined}
        />
        <Stat
          label={t("summary.withinSla")}
          value={summary.within_sla_pct === null ? "—" : fmt.pct(summary.within_sla_pct, 0)}
        />
        <Stat
          label={t("summary.median")}
          value={summary.median_hours === null ? "—" : t("hours", { h: fmt.num(summary.median_hours, 1) })}
        />
      </div>
      <div
        role="group"
        aria-label={t("filter")}
        className="inline-flex justify-self-start rounded-lg border bg-muted/40 p-0.5"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-8 rounded-md px-3 text-sm text-muted-foreground transition hover:text-foreground",
              filter === f && "bg-card text-foreground shadow-sm",
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>
      {cases.isLoading ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : !items.length ? (
        <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground text-pretty">
          {t(`empty.${filter}`)}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <CaseCard key={item.id} item={item} onResolve={setResolving} onChanged={refresh} />
          ))}
        </ul>
      )}
      <ResolveDialog item={resolving} onOpenChange={(open) => !open && setResolving(null)} onDone={refresh} />
    </section>
  );
}
