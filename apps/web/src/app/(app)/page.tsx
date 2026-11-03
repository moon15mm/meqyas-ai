"use client";

import { Button, Card, Skeleton } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ClipboardCheckIcon, LightbulbIcon, MapIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";

import { ProjectCard } from "@/components/common/project-card";
import { ArchitectComposer } from "@/components/measurement/architect-composer";
import { projectApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";

function FocusOnParam({ target }: { target: React.RefObject<HTMLTextAreaElement | null> }) {
  const params = useSearchParams();
  React.useEffect(() => {
    if (params.get("focus")) target.current?.focus();
  }, [params, target]);
  return null;
}

export default function HomePage() {
  const t = useTranslations("home");
  const { user, activeOrg } = useAuth();
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const projects = useQuery({
    queryKey: ["projects", { q: "", home: true }, activeOrg?.organization_id],
    queryFn: () => projectApi.list({ limit: 6 }),
  });

  const steps = [
    { icon: LightbulbIcon, title: t("steps.idea"), body: t("steps.ideaBody") },
    { icon: MapIcon, title: t("steps.plan"), body: t("steps.planBody") },
    { icon: ClipboardCheckIcon, title: t("steps.evidence"), body: t("steps.evidenceBody") },
  ];

  return (
    <div className="mx-auto grid max-w-5xl gap-10">
      <React.Suspense>
        <FocusOnParam target={inputRef} />
      </React.Suspense>

      <section aria-labelledby="home-title" className="grid gap-6">
        <div className="grid gap-2">
          {user ? (
            <p className="text-sm font-medium text-primary">
              {t("greeting", { name: user.full_name.split(" ")[0] ?? "" })}
            </p>
          ) : null}
          <h1 id="home-title" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <Card className="hero-surface gap-0 border-primary/15 p-5 sm:p-7">
          <ArchitectComposer variant="hero" inputRef={inputRef} />
        </Card>
      </section>

      <section aria-labelledby="how-title" className="grid gap-4">
        <h2 id="how-title" className="text-sm font-semibold text-muted-foreground">
          {t("howItWorks")}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3 rounded-2xl border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <step.icon className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="grid gap-0.5">
                <p className="text-sm font-semibold">
                  <span className="text-muted-foreground tabular-nums">{i + 1}. </span>
                  {step.title}
                </p>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="recent-title" className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 id="recent-title" className="text-lg font-semibold">
            {t("recentProjects")}
          </h2>
          <Button variant="link" asChild className="gap-1 px-0">
            <Link href="/projects">
              {t("allProjects")}
              <ArrowLeftIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        {projects.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : projects.data?.items.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data.items.map((p) => (
              <li key={p.id} className="grid">
                <ProjectCard project={p} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("noProjects")}
          </p>
        )}
      </section>
    </div>
  );
}
