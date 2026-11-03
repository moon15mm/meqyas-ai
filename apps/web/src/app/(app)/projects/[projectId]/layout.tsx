"use client";

import { label, MEASUREMENT_TYPE_LABELS, PROJECT_STATUS_LABELS } from "@meqyas/shared";
import { Badge, Button, cn, Skeleton } from "@meqyas/ui";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { useProjectContext } from "@/components/layout/shell-context";
import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { ApiError } from "@/lib/api/client";

const TABS = [
  { slug: "", key: "overview" },
  { slug: "plan", key: "plan" },
  { slug: "indicators", key: "indicators" },
  { slug: "theory-of-change", key: "theoryOfChange" },
  { slug: "surveys", key: "surveys" },
  { slug: "responses", key: "responses" },
  { slug: "integrations", key: "integrations" },
  { slug: "analytics", key: "analytics" },
  { slug: "cx", key: "cx" },
  { slug: "insights", key: "insights" },
  { slug: "recommendations", key: "recommendations" },
  { slug: "reports", key: "reports" },
  { slug: "settings", key: "settings" },
] as const;

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("project");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const projectId = useProjectId();
  const pathname = usePathname();
  const overview = useProjectOverview();
  const project = overview.data?.project;
  useProjectContext(project);

  if (overview.error && !project) {
    // Deleted, or in another workspace (e.g. after switching): say so instead of loading forever.
    const missing = overview.error instanceof ApiError && overview.error.status === 404;
    return (
      <div className="mx-auto grid max-w-md place-items-center gap-3 py-16 text-center">
        <p className="font-medium text-pretty">{missing ? t("notFound") : tc("error")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {missing ? null : (
            <Button variant="outline" disabled={overview.isFetching} onClick={() => void overview.refetch()}>
              {tc("retry")}
            </Button>
          )}
          <Button asChild variant={missing ? "outline" : "ghost"}>
            <Link href="/projects">{tn("projects")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const base = `/projects/${projectId}`;
  return (
    <div className="mx-auto grid max-w-6xl gap-6 print:block">
      <div className="grid gap-4 print:hidden">
        <Button asChild variant="link" className="justify-self-start px-0 text-muted-foreground">
          <Link href="/projects">
            <ArrowRightIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
            {tn("projects")}
          </Link>
        </Button>
        {project ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{project.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="soft">
                  {label(MEASUREMENT_TYPE_LABELS, project.measurement_type, locale)}
                </Badge>
                <Badge variant="outline">{label(PROJECT_STATUS_LABELS, project.status, locale)}</Badge>
                {project.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
              </div>
            </div>
          </div>
        ) : (
          <Skeleton className="h-16 w-2/3 rounded-xl" />
        )}
      </div>

      <nav
        aria-label={t("workspaceNav")}
        className="scroll-x-hidden -mx-4 border-b px-4 sm:mx-0 sm:px-0 print:hidden"
      >
        <ul className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const href = tab.slug ? `${base}/${tab.slug}` : base;
            const active = tab.slug
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === base;
            return (
              <li key={tab.key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 items-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    active &&
                      "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
                  )}
                >
                  {t(`tabs.${tab.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
