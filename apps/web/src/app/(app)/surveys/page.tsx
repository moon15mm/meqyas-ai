"use client";

import { label, WAVE_LABELS, type SurveyStatus } from "@meqyas/shared";
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
import { useQuery } from "@tanstack/react-query";
import { ClipboardListIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { SurveyStatusBadge } from "@/components/survey/question-type-meta";
import { surveyApi } from "@/lib/api/endpoints";

const FILTERS: Array<SurveyStatus | "ALL"> = ["ALL", "DRAFT", "PUBLISHED", "PAUSED", "CLOSED", "ARCHIVED"];

export default function SurveysPage() {
  const t = useTranslations("survey");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const [filter, setFilter] = React.useState<SurveyStatus | "ALL">("ALL");
  const surveys = useQuery({
    queryKey: ["surveys", { status: filter }],
    queryFn: () => surveyApi.list(filter === "ALL" ? {} : { status: filter }),
  });
  const dateFormat = React.useMemo(
    () => new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { dateStyle: "medium" }),
    [locale],
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("listTitle")}</h1>
        <p className="text-muted-foreground">{t("listSubtitle")}</p>
      </div>

      <div
        role="group"
        aria-label={t("filterByStatus")}
        className="scroll-x-hidden -mx-4 flex gap-1.5 px-4 sm:mx-0 sm:px-0"
      >
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === "ALL" ? t("allStatuses") : t(`status.${f}`)}
          </Button>
        ))}
      </div>

      {surveys.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !surveys.data?.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardListIcon className="size-6" aria-hidden="true" />
          </span>
          <p className="font-medium">{t("empty")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button asChild>
            <Link href="/">
              <SparklesIcon aria-hidden="true" />
              {t("startWithAI")}
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableCaption className="visually-hidden">{t("listTitle")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.title")}</TableHead>
                <TableHead scope="col">{t("columns.project")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  {t("columns.wave")}
                </TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
                <TableHead scope="col" className="hidden sm:table-cell">
                  {t("columns.questions")}
                </TableHead>
                <TableHead scope="col" className="hidden sm:table-cell">
                  {t("columns.responses")}
                </TableHead>
                <TableHead scope="col" className="hidden lg:table-cell">
                  {t("columns.updated")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surveys.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-72">
                    <Link href={`/surveys/${s.id}`} className="font-medium hover:underline">
                      {s.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.has_unpublished_changes ? (
                        <Badge variant="warning">{t("unpublishedChanges")}</Badge>
                      ) : null}
                      {s.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${s.project_id}/surveys`}
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {s.project_title}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.wave_type ? s.wave_name || label(WAVE_LABELS, s.wave_type, locale) : "—"}
                  </TableCell>
                  <TableCell>
                    <SurveyStatusBadge status={s.status} label={t(`status.${s.status}`)} />
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">{s.question_count}</TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {s.published_version_number ? (
                      <Link href={`/projects/${s.project_id}/responses`} className="hover:underline">
                        {s.response_count}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    <time dateTime={s.updated_at}>{dateFormat.format(new Date(s.updated_at))}</time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
