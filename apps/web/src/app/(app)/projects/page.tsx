"use client";

import { label, MEASUREMENT_TYPE_LABELS, MEASUREMENT_TYPES, type MeasurementType } from "@meqyas/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { ProjectCard } from "@/components/common/project-card";
import { projectApi } from "@/lib/api/endpoints";
import { useAuth, useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

function ManualProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("projects");
  const tf = useTranslations("plan.fields");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const [title, setTitle] = React.useState("");
  const [population, setPopulation] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<MeasurementType>("SATISFACTION");

  const create = useMutation({
    mutationFn: () =>
      projectApi.create({
        title: title.trim(),
        target_population: population.trim(),
        description,
        measurement_type: type,
      }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("created"));
      onOpenChange(false);
      router.push(`/projects/${project.id}/plan`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim().length >= 2) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("manualTitle")}</DialogTitle>
            <DialogDescription>{t("manualDescription")}</DialogDescription>
          </DialogHeader>
          <Field id="mp-title" label={tf("title")} required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={2}
              maxLength={200}
            />
          </Field>
          <div className="grid gap-2">
            <span id="mp-type" className="text-sm font-medium">
              {tf("type")}
            </span>
            <Select
              value={type}
              onValueChange={(v) => setType(v as MeasurementType)}
              dir={locale === "ar" ? "rtl" : "ltr"}
            >
              <SelectTrigger aria-labelledby="mp-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEASUREMENT_TYPES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {label(MEASUREMENT_TYPE_LABELS, m, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field id="mp-population" label={tf("population")}>
            <Input value={population} onChange={(e) => setPopulation(e.target.value)} maxLength={300} />
          </Field>
          <Field id="mp-description" label={tf("purpose")}>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || title.trim().length < 2}>
              {create.isPending ? <Spinner /> : null}
              {t("new")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OpenManualFromParam({ onOpen }: { onOpen: () => void }) {
  const params = useSearchParams();
  React.useEffect(() => {
    if (params.get("new")) onOpen();
  }, [params, onOpen]);
  return null;
}

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const { activeOrg } = useAuth();
  const can = useCan();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [manualOpen, setManualOpen] = React.useState(false);
  const openManual = React.useCallback(() => setManualOpen(true), []);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);

  const projects = useQuery({
    queryKey: ["projects", { q: debounced }, activeOrg?.organization_id],
    queryFn: () => projectApi.list({ q: debounced || undefined, limit: 100 }),
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <React.Suspense>
        <OpenManualFromParam onOpen={openManual} />
      </React.Suspense>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can.write ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openManual}>
              <PlusIcon aria-hidden="true" />
              {t("newManual")}
            </Button>
            <Button asChild>
              <Link href="/?focus=1">
                <SparklesIcon aria-hidden="true" />
                {t("newWithAI")}
              </Link>
            </Button>
          </div>
        ) : null}
      </header>

      <div className="relative max-w-md">
        <label htmlFor="project-search" className="visually-hidden">
          {t("searchPlaceholder")}
        </label>
        <SearchIcon
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="project-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="ps-9"
          autoComplete="off"
        />
      </div>

      {projects.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
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
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      )}

      <ManualProjectDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}
