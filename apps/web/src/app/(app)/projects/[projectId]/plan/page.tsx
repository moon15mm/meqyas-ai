"use client";

import {
  INDICATOR_TYPE_LABELS,
  label,
  MEASUREMENT_TYPE_LABELS,
  type Dimension,
  type Indicator,
} from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  Spinner,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheckIcon, LayersIcon, PencilIcon, PlusIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { DesignFlow } from "@/components/measurement/design-flow";
import { IndicatorDialog } from "@/components/measurement/indicator-dialog";
import { useProjectId, useProjectOverview } from "@/components/measurement/use-project";
import { projectApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

type TextDialogState =
  | { kind: "objective"; id?: string; title: string; description: string }
  | { kind: "dimension"; id?: string; title: string; description: string }
  | null;

export default function ProjectPlanPage() {
  const t = useTranslations("plan");
  const tf = useTranslations("plan.fields");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const projectId = useProjectId();
  const overview = useProjectOverview();
  const can = useCan();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const [textDialog, setTextDialog] = React.useState<TextDialogState>(null);
  const [indicatorDialog, setIndicatorDialog] = React.useState<{
    indicator: Indicator | null;
    dimensionId: string | null;
  } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const saveText = useMutation({
    mutationFn: async (state: NonNullable<TextDialogState>) => {
      if (state.kind === "objective") {
        return state.id
          ? projectApi.updateObjective(state.id, { title: state.title, description: state.description })
          : projectApi.createObjective(projectId, { title: state.title, description: state.description });
      }
      return state.id
        ? projectApi.updateDimension(state.id, { name: state.title, description: state.description })
        : projectApi.createDimension(projectId, { name: state.title, description: state.description });
    },
    onSuccess: () => {
      void invalidate();
      setTextDialog(null);
      toast.success(tc("save"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: "objective" | "dimension"; id: string }) =>
      kind === "objective" ? projectApi.deleteObjective(id) : projectApi.deleteDimension(id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(toMessage(e)),
  });

  if (overview.isLoading || !overview.data) return <Skeleton className="h-96 rounded-2xl" />;
  const { plan } = overview.data;
  const indicatorsOf = (d: Dimension) => plan.indicators.filter((i) => i.dimension_id === d.id);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("purpose")}</CardTitle>
            <CardDescription>
              {label(MEASUREMENT_TYPE_LABELS, plan.measurement_type, locale)} · {plan.target_population}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="leading-relaxed">{plan.goal?.statement ?? plan.purpose}</p>
            {plan.measurement_type_rationale ? (
              <p className="text-sm text-muted-foreground">{plan.measurement_type_rationale}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TargetIcon className="size-4 text-primary" aria-hidden="true" />
              {t("objectives")}
            </CardTitle>
            {can.write ? (
              <CardAction>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTextDialog({ kind: "objective", title: "", description: "" })}
                >
                  <PlusIcon aria-hidden="true" />
                  {tf("addObjective")}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2">
              {plan.objectives.map((o, i) => (
                <li key={o.id} className="flex items-start gap-3 rounded-lg px-1 py-1.5">
                  <span className="w-5 text-sm text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="flex-1 leading-relaxed">{o.title}</span>
                  {can.write ? (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${tc("edit")}: ${o.title}`}
                        onClick={() =>
                          setTextDialog({
                            kind: "objective",
                            id: o.id,
                            title: o.title,
                            description: o.description,
                          })
                        }
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${tc("delete")}: ${o.title}`}
                        onClick={() =>
                          window.confirm(`${tc("delete")}؟`) && remove.mutate({ kind: "objective", id: o.id })
                        }
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-4 text-primary" aria-hidden="true" />
              {t("dimensions")}
            </CardTitle>
            {can.write ? (
              <CardAction>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTextDialog({ kind: "dimension", title: "", description: "" })}
                >
                  <PlusIcon aria-hidden="true" />
                  {tf("addDimension")}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3">
              {plan.dimensions.map((d, i) => (
                <li key={d.id} className="grid gap-3 rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <div className="grid flex-1 gap-0.5">
                      <h3 className="font-semibold">{d.name}</h3>
                      {d.description ? (
                        <p className="text-sm text-muted-foreground">{d.description}</p>
                      ) : null}
                    </div>
                    {can.write ? (
                      <span className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${tc("edit")}: ${d.name}`}
                          onClick={() =>
                            setTextDialog({
                              kind: "dimension",
                              id: d.id,
                              title: d.name,
                              description: d.description,
                            })
                          }
                        >
                          <PencilIcon aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${tc("delete")}: ${d.name}`}
                          onClick={() =>
                            window.confirm(`${tc("delete")}؟`) &&
                            remove.mutate({ kind: "dimension", id: d.id })
                          }
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  <ul className="grid gap-2 ps-11">
                    {indicatorsOf(d).map((ind) => (
                      <li
                        key={ind.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm"
                      >
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {ind.code}
                        </span>
                        <span className="font-medium">{ind.name}</span>
                        <Badge variant="soft">
                          {label(INDICATOR_TYPE_LABELS, ind.indicator_type, locale)}
                        </Badge>
                        {ind.target_label ? (
                          <span className="text-xs text-muted-foreground">{ind.target_label}</span>
                        ) : null}
                        {can.write ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ms-auto"
                            aria-label={`${tc("edit")} ${ind.code}`}
                            onClick={() => setIndicatorDialog({ indicator: ind, dimensionId: d.id })}
                          >
                            <PencilIcon aria-hidden="true" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                    {can.write ? (
                      <li>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIndicatorDialog({ indicator: null, dimensionId: d.id })}
                        >
                          <PlusIcon aria-hidden="true" />
                          {tf("addIndicator")}
                        </Button>
                      </li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:sticky lg:top-20">
        <Card>
          <CardHeader>
            <CardTitle>{t("design")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <DesignFlow design={plan.recommended_design} evidence={plan.evidence_level} waves={plan.waves} />
            {plan.design_rationale ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{plan.design_rationale}</p>
            ) : null}
          </CardContent>
        </Card>
        {plan.methodology_notes.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpenCheckIcon className="size-4 text-evidence" aria-hidden="true" />
                {t("methodologyNotes")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm leading-relaxed">
                {plan.methodology_notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                    {n}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={!!textDialog} onOpenChange={(o) => !o && setTextDialog(null)}>
        <DialogContent closeLabel={tc("close")}>
          {textDialog ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (textDialog.title.trim().length >= 2) saveText.mutate(textDialog);
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {textDialog.kind === "objective" ? tf("objective") : tf("dimensionName")}
                </DialogTitle>
              </DialogHeader>
              <Field
                id="td-title"
                label={textDialog.kind === "objective" ? tf("objective") : tf("dimensionName")}
                required
              >
                <Input
                  value={textDialog.title}
                  onChange={(e) => setTextDialog({ ...textDialog, title: e.target.value })}
                />
              </Field>
              <Field id="td-desc" label={tf("dimensionDescription")}>
                <Textarea
                  rows={3}
                  value={textDialog.description}
                  onChange={(e) => setTextDialog({ ...textDialog, description: e.target.value })}
                />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setTextDialog(null)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={saveText.isPending || textDialog.title.trim().length < 2}>
                  {saveText.isPending ? <Spinner /> : null}
                  {tc("save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <IndicatorDialog
        projectId={projectId}
        indicator={indicatorDialog?.indicator ?? null}
        defaultDimensionId={indicatorDialog?.dimensionId ?? null}
        dimensions={plan.dimensions}
        open={!!indicatorDialog}
        onOpenChange={(o) => !o && setIndicatorDialog(null)}
      />
    </div>
  );
}
