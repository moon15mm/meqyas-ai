"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
  Spinner,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { projectApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

export default function ProjectSettingsPage() {
  const t = useTranslations("project");
  const tf = useTranslations("plan.fields");
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const projectId = useProjectId();
  const overview = useProjectOverview();
  const can = useCan();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const project = overview.data?.project;
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [population, setPopulation] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");

  React.useEffect(() => {
    if (project) {
      setTitle(project.title);
      setDescription(project.description);
      setPopulation(project.target_population);
    }
  }, [project]);

  const update = useMutation({
    mutationFn: (data: Parameters<typeof projectApi.update>[1]) => projectApi.update(projectId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("updated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => projectApi.remove(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("deleted"));
      router.replace("/projects");
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (!project) return <Skeleton className="h-80 rounded-2xl" />;
  const readOnly = !can.write;

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settingsTitle")}</CardTitle>
          {readOnly ? <CardDescription>{ts("readOnly")}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ title: title.trim(), description, target_population: population.trim() });
            }}
          >
            <fieldset disabled={readOnly} className="grid gap-4">
              <Field id="ps-title" label={tf("title")} required>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={2}
                  maxLength={200}
                  required
                />
              </Field>
              <Field id="ps-population" label={tf("population")}>
                <Input value={population} onChange={(e) => setPopulation(e.target.value)} maxLength={300} />
              </Field>
              <Field id="ps-description" label={tf("purpose")}>
                <Textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                />
              </Field>
              <Button
                type="submit"
                className="justify-self-start"
                disabled={update.isPending || title.trim().length < 2}
              >
                {update.isPending ? <Spinner /> : null}
                {tc("save")}
              </Button>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      {can.deleteProject && !project.is_demo ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">{t("dangerZone")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => update.mutate({ status: project.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" })}
            >
              {project.status === "ARCHIVED" ? (
                <ArchiveRestoreIcon aria-hidden="true" />
              ) : (
                <ArchiveIcon aria-hidden="true" />
              )}
              {project.status === "ARCHIVED" ? t("restore") : t("archive")}
            </Button>
            <div className="grid gap-2 rounded-xl border border-destructive/30 p-4">
              <p className="text-sm">{t("deleteConfirm")}</p>
              <label htmlFor="ps-confirm" className="visually-hidden">
                {t("deleteConfirm")}
              </label>
              <Input
                id="ps-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={project.title}
              />
              <Button
                variant="destructive"
                className="justify-self-start"
                disabled={confirmText.trim() !== project.title.trim() || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? <Spinner /> : <Trash2Icon aria-hidden="true" />}
                {t("deleteProject")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
