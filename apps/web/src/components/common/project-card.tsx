"use client";

import { label, MEASUREMENT_TYPE_LABELS, PROJECT_STATUS_LABELS, type Project } from "@meqyas/shared";
import { Badge, Card, cn } from "@meqyas/ui";
import { ArrowUpLeftIcon, CalendarIcon, TargetIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";

export function ProjectCard({ project, className }: { project: Project; className?: string }) {
  const locale = useLocale() as "ar" | "en";
  const format = useFormatter();
  const tc = useTranslations("common");
  return (
    <Card
      className={cn(
        "group relative gap-3 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 px-5">
        <Badge variant="soft">{label(MEASUREMENT_TYPE_LABELS, project.measurement_type, locale)}</Badge>
        <div className="flex items-center gap-1.5">
          {project.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
          <Badge variant="outline">{label(PROJECT_STATUS_LABELS, project.status, locale)}</Badge>
        </div>
      </div>
      <div className="grid gap-1.5 px-5">
        <h3 className="leading-snug font-semibold">
          <Link
            href={`/projects/${project.id}`}
            className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
          >
            {project.title}
          </Link>
        </h3>
        {project.target_population ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <TargetIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{project.target_population}</span>
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between px-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          {format.dateTime(new Date(project.created_at), { dateStyle: "medium" })}
        </span>
        <ArrowUpLeftIcon
          className="size-4 opacity-0 transition group-hover:opacity-100 ltr:-scale-x-100"
          aria-hidden="true"
        />
      </div>
    </Card>
  );
}
