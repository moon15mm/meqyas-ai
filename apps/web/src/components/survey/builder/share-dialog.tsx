"use client";

import type { SurveyDetail, SurveyMeta } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Separator,
  Skeleton,
  Spinner,
} from "@meqyas/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { NumericInput } from "@/components/common/numeric-input";
import { surveyApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

/** "2026-10-09T14:00" in the browser's time zone, for <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareDialog({
  survey,
  open,
  onOpenChange,
  onUpdated,
  canEdit,
}: {
  survey: SurveyMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (detail: SurveyDetail) => void;
  canEdit: boolean;
}) {
  const t = useTranslations("survey.shareDialog");
  const tc = useTranslations("common");
  const ts = useTranslations("survey");
  const toMessage = useErrorMessage();
  const published = !!survey.published_version_number;
  const [origin, setOrigin] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [closesAt, setClosesAt] = React.useState(toLocalInput(survey.closes_at));
  const [limit, setLimit] = React.useState<number | null>(survey.response_limit);

  React.useEffect(() => setOrigin(window.location.origin), []);
  React.useEffect(() => {
    if (open) {
      setClosesAt(toLocalInput(survey.closes_at));
      setLimit(survey.response_limit);
    }
  }, [open, survey.closes_at, survey.response_limit]);

  const url = `${origin}/s/${survey.public_id}`;
  const qr = useQuery({
    queryKey: ["survey-qr", survey.id, survey.public_id],
    queryFn: () => surveyApi.qr(survey.id, "svg"),
    enabled: open && published,
    staleTime: Infinity,
  });
  const qrUrl = React.useMemo(() => (qr.data ? URL.createObjectURL(qr.data) : null), [qr.data]);
  React.useEffect(() => () => (qrUrl ? URL.revokeObjectURL(qrUrl) : undefined), [qrUrl]);

  const save = useMutation({
    mutationFn: () =>
      surveyApi.setCollection(survey.id, {
        closes_at: closesAt ? new Date(closesAt).toISOString() : null,
        response_limit: limit && limit > 0 ? Math.round(limit) : null,
      }),
    onSuccess: (detail) => {
      onUpdated(detail);
      toast.success(t("savedCollection"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById("share-link")?.focus();
    }
  };

  const downloadQr = async (format: "svg" | "png") => {
    try {
      download(await surveyApi.qr(survey.id, format), `survey-${survey.public_id}.${format}`);
    } catch (e) {
      toast.error(toMessage(e));
    }
  };

  const statusNote =
    survey.status === "PAUSED" ? t("statusPaused") : survey.status === "CLOSED" ? t("statusClosed") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {!published ? (
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{t("notPublished")}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-5">
            {statusNote ? (
              <Alert variant="warning">
                <InfoIcon aria-hidden="true" />
                <AlertDescription>{statusNote}</AlertDescription>
              </Alert>
            ) : (
              <p className="flex items-center gap-2 text-sm text-success">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                {t("statusOpen")} · {ts("responsesCount", { n: survey.response_count })}
              </p>
            )}

            <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
              <div className="grid content-start gap-2">
                <label htmlFor="share-link" className="text-sm font-medium">
                  {t("link")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="share-link"
                    readOnly
                    dir="ltr"
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button variant="outline" onClick={() => void copy()} aria-label={t("copy")}>
                    {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                    <span className="max-sm:hidden">{t("copy")}</span>
                  </Button>
                </div>
                <Button asChild variant="link" className="justify-self-start px-0">
                  <a href={`/s/${survey.public_id}`} target="_blank" rel="noopener">
                    <ExternalLinkIcon aria-hidden="true" />
                    {t("open")}
                  </a>
                </Button>
              </div>
              <div className="grid justify-items-center gap-2">
                <span className="text-sm font-medium">{t("qr")}</span>
                <div className="grid size-40 place-items-center rounded-xl border bg-white p-2">
                  {qrUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL
                    <img src={qrUrl} alt={t("qrAlt")} className="size-full" />
                  ) : (
                    <Skeleton className="size-full" />
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void downloadQr("svg")}>
                    <DownloadIcon aria-hidden="true" />
                    {t("downloadSvg")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void downloadQr("png")}>
                    <DownloadIcon aria-hidden="true" />
                    {t("downloadPng")}
                  </Button>
                </div>
              </div>
            </div>

            {canEdit ? (
              <>
                <Separator />
                <form
                  className="grid gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                  }}
                >
                  <h3 className="text-sm font-semibold">{t("collection")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="closes-at" label={t("closesAt")} hint={t("closesAtHint")}>
                      <Input
                        type="datetime-local"
                        value={closesAt}
                        onChange={(e) => setClosesAt(e.target.value)}
                      />
                    </Field>
                    <Field id="response-limit" label={t("responseLimit")} hint={t("responseLimitHint")}>
                      <NumericInput value={limit} onValueChange={(n) => setLimit(n)} inputMode="numeric" />
                    </Field>
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="justify-self-start"
                    disabled={save.isPending}
                  >
                    {save.isPending ? <Spinner className="size-4" /> : null}
                    {t("saveCollection")}
                  </Button>
                </form>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
