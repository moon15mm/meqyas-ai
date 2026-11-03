"use client";

import {
  label,
  WAVE_LABELS,
  type QualityStatus,
  type ResponseSummary,
  type ReviewStatus,
} from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { InboxIcon, LockIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { useProjectId } from "@/components/measurement/use-project";
import { FlagList, ResponseDetailSheet } from "@/components/responses/response-detail-sheet";
import { QualityBadge, useFormatters } from "@/components/responses/response-format";
import { responseApi, surveyApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";

const PAGE = 25;
const selectClass = "h-10 rounded-lg border border-input bg-card px-3 text-sm";
const DEVICE_ICON = { mobile: SmartphoneIcon, tablet: TabletIcon, desktop: MonitorIcon } as const;

export default function ResponsesPage() {
  const t = useTranslations("responses");
  const locale = useLocale() as "ar" | "en";
  const projectId = useProjectId();
  const can = useCan();
  const fmt = useFormatters();
  const [surveyId, setSurveyId] = React.useState("");
  const [quality, setQuality] = React.useState<QualityStatus | "">("");
  const [review, setReview] = React.useState<ReviewStatus | "">("");
  const [limit, setLimit] = React.useState(PAGE);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const responses = useQuery({
    queryKey: ["responses", projectId, { surveyId, quality, review, limit }],
    queryFn: () =>
      responseApi.forProject(projectId, {
        survey_id: surveyId || undefined,
        quality: quality || undefined,
        review: review || undefined,
        limit,
      }),
    enabled: can.readResponses,
    placeholderData: keepPreviousData,
  });

  if (!can.readResponses) {
    return (
      <Card className="grid place-items-center gap-3 p-10 text-center">
        <LockIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-md text-sm text-muted-foreground">{t("noAccess")}</p>
      </Card>
    );
  }

  const page = responses.data;
  const counts = page?.counts;
  const stats: Array<{ key: string; value: number; tone?: string; filter?: () => void }> = counts
    ? [
        { key: "total", value: counts.total, filter: () => setQuality("") },
        { key: "valid", value: counts.valid, tone: "text-success", filter: () => setQuality("VALID") },
        {
          key: "suspicious",
          value: counts.suspicious,
          tone: "text-warning-foreground dark:text-warning",
          filter: () => setQuality("SUSPICIOUS"),
        },
        {
          key: "low_quality",
          value: counts.low_quality,
          tone: "text-destructive",
          filter: () => setQuality("LOW_QUALITY"),
        },
        { key: "excluded", value: counts.excluded, filter: () => setReview("EXCLUDE") },
      ]
    : [];

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {counts ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={s.filter}
                className="grid w-full gap-0.5 rounded-2xl border bg-card p-3 text-start transition hover:border-primary/40"
              >
                <span className={`text-2xl font-bold tabular-nums ${s.tone ?? ""}`}>{s.value}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`counts.${s.key}` as "counts.total")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton className="h-20 rounded-2xl" />
      )}

      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="filter-survey">
          {t("columns.survey")}
        </label>
        <select
          id="filter-survey"
          className={selectClass}
          value={surveyId}
          onChange={(e) => setSurveyId(e.target.value)}
        >
          <option value="">{t("allSurveys")}</option>
          {(surveys.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-quality">
          {t("columns.quality")}
        </label>
        <select
          id="filter-quality"
          className={selectClass}
          value={quality}
          onChange={(e) => setQuality(e.target.value as QualityStatus | "")}
        >
          <option value="">{t("allQuality")}</option>
          {(["VALID", "SUSPICIOUS", "LOW_QUALITY"] as const).map((q) => (
            <option key={q} value={q}>
              {t(`quality.${q}`)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-review">
          {t("columns.review")}
        </label>
        <select
          id="filter-review"
          className={selectClass}
          value={review}
          onChange={(e) => setReview(e.target.value as ReviewStatus | "")}
        >
          <option value="">{t("allReview")}</option>
          {(["KEEP", "EXCLUDE"] as const).map((r) => (
            <option key={r} value={r}>
              {t(`review.${r}`)}
            </option>
          ))}
        </select>
      </div>

      {responses.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !page?.items.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/surveys`}>{t("goToSurveys")}</Link>
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableCaption className="visually-hidden">{t("title")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.respondent")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  {t("columns.survey")}
                </TableHead>
                <TableHead scope="col">{t("columns.completed")}</TableHead>
                <TableHead scope="col" className="hidden sm:table-cell">
                  {t("columns.duration")}
                </TableHead>
                <TableHead scope="col">{t("columns.quality")}</TableHead>
                <TableHead scope="col" className="hidden lg:table-cell">
                  {t("columns.review")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((r: ResponseSummary) => {
                const DeviceIcon = DEVICE_ICON[r.device as keyof typeof DEVICE_ICON] ?? MonitorIcon;
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <TableCell>
                      <button
                        type="button"
                        className="flex items-center gap-2 text-start font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(r.id);
                        }}
                      >
                        <DeviceIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-label={t(
                            `device.${r.device in DEVICE_ICON ? r.device : "unknown"}` as "device.unknown",
                          )}
                        />
                        {r.respondent_label ?? t("anonymous")}
                      </button>
                      {r.is_demo ? (
                        <Badge variant="demo" className="mt-1">
                          DEMO
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden max-w-60 md:table-cell">
                      <span className="line-clamp-1">{r.survey_title}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.wave_type ? `${label(WAVE_LABELS, r.wave_type, locale)} · ` : ""}v
                        {r.version_number}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <time dateTime={r.completed_at ?? r.created_at}>
                        {fmt.dateTime(r.completed_at ?? r.created_at)}
                      </time>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {fmt.duration(r.duration_seconds)}
                    </TableCell>
                    <TableCell>
                      <QualityBadge status={r.quality_status} score={r.quality_score} />
                      {r.quality_flags.length ? (
                        <div className="mt-1 hidden max-w-72 text-xs text-muted-foreground xl:block">
                          <FlagList flags={r.quality_flags.slice(0, 2)} />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {t(`review.${r.review_status}`)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {page.total > page.items.length ? (
            <div className="flex items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
              <span>{t("showing", { shown: page.items.length, total: page.total })}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((l) => l + PAGE)}
                disabled={responses.isFetching}
              >
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      <ResponseDetailSheet responseId={openId} onOpenChange={(open) => !open && setOpenId(null)} />
    </div>
  );
}
