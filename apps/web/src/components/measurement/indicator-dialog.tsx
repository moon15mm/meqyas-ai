"use client";

import {
  FREQUENCY_LABELS,
  INDICATOR_DIRECTIONS,
  INDICATOR_FREQUENCIES,
  INDICATOR_STATUS_LABELS,
  INDICATOR_STATUSES,
  INDICATOR_TYPE_LABELS,
  INDICATOR_TYPES,
  label,
  type Dimension,
  type Indicator,
} from "@meqyas/shared";
import {
  Button,
  Dialog,
  DialogContent,
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
  Spinner,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { projectApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

const NO_DIMENSION = "__none__";

interface IndicatorForm {
  name: string;
  description: string;
  dimension_id: string;
  indicator_type: Indicator["indicator_type"];
  formula: string;
  unit: string;
  direction: Indicator["direction"];
  target_label: string;
  target_value: string;
  baseline_value: string;
  frequency: Indicator["frequency"];
  owner: string;
  status: Indicator["status"];
}

function toNumber(value: string): number | null {
  const n = Number(String(value).replace(",", "."));
  return value.trim() === "" || Number.isNaN(n) ? null : n;
}

/** Indicator Builder (spec §15): create or edit one indicator. */
export function IndicatorDialog({
  projectId,
  indicator,
  dimensions,
  defaultDimensionId,
  open,
  onOpenChange,
}: {
  projectId: string;
  indicator?: Indicator | null;
  dimensions: Dimension[];
  defaultDimensionId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const dir = locale === "ar" ? "rtl" : "ltr";
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();

  const defaults = React.useMemo<IndicatorForm>(
    () => ({
      name: indicator?.name ?? "",
      description: indicator?.description ?? "",
      dimension_id: indicator?.dimension_id ?? defaultDimensionId ?? dimensions[0]?.id ?? NO_DIMENSION,
      indicator_type: indicator?.indicator_type ?? "AVERAGE_SCORE",
      formula: indicator?.formula ?? "",
      unit: indicator?.unit ?? "",
      direction: indicator?.direction ?? "HIGHER_IS_BETTER",
      target_label: indicator?.target_label ?? "",
      target_value: indicator?.target_value?.toString() ?? "",
      baseline_value: indicator?.baseline_value?.toString() ?? "",
      frequency: indicator?.frequency ?? "PER_WAVE",
      owner: indicator?.owner ?? "",
      status: indicator?.status ?? "NOT_STARTED",
    }),
    [indicator, defaultDimensionId, dimensions],
  );

  const { register, control, handleSubmit, reset, formState } = useForm<IndicatorForm>({
    defaultValues: defaults,
  });
  React.useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const save = useMutation({
    mutationFn: (values: IndicatorForm) => {
      const payload = {
        name: values.name.trim(),
        description: values.description,
        dimension_id: values.dimension_id === NO_DIMENSION ? null : values.dimension_id,
        indicator_type: values.indicator_type,
        formula: values.formula,
        unit: values.unit,
        direction: values.direction,
        target_label: values.target_label,
        target_value: toNumber(values.target_value),
        frequency: values.frequency,
        owner: values.owner,
      };
      return indicator
        ? projectApi.updateIndicator(indicator.id, {
            ...payload,
            baseline_value: toNumber(values.baseline_value),
            status: values.status,
          })
        : projectApi.createIndicator(projectId, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success(t("saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const select = <K extends keyof IndicatorForm>(
    name: K,
    labelId: string,
    options: { value: string; label: string }[],
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select value={String(field.value)} onValueChange={field.onChange} dir={dir}>
          <SelectTrigger aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" closeLabel={tc("close")}>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {indicator ? t("edit") : t("add")}
              {indicator ? (
                <span className="ms-2 font-mono text-sm text-muted-foreground" dir="ltr">
                  {indicator.code}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="ind-name"
              label={t("name")}
              className="sm:col-span-2"
              required
              error={formState.errors.name ? tc("required") : undefined}
            >
              <Input {...register("name", { required: true, minLength: 2 })} />
            </Field>
            <Field id="ind-desc" label={t("description")} className="sm:col-span-2">
              <Textarea rows={2} {...register("description")} />
            </Field>
            <div className="grid gap-2">
              <span id="ind-dim" className="text-sm font-medium">
                {t("dimension")}
              </span>
              {select("dimension_id", "ind-dim", [
                ...dimensions.map((d) => ({ value: d.id, label: d.name })),
                { value: NO_DIMENSION, label: t("noDimension") },
              ])}
            </div>
            <div className="grid gap-2">
              <span id="ind-type" className="text-sm font-medium">
                {t("type")}
              </span>
              {select(
                "indicator_type",
                "ind-type",
                INDICATOR_TYPES.map((v) => ({ value: v, label: label(INDICATOR_TYPE_LABELS, v, locale) })),
              )}
            </div>
            <Field id="ind-formula" label={t("formula")} className="sm:col-span-2">
              <Input {...register("formula")} />
            </Field>
            <Field id="ind-target-label" label={t("target")}>
              <Input {...register("target_label")} />
            </Field>
            <Field id="ind-target-value" label={`${t("target")} (#)`}>
              <Input inputMode="decimal" dir="ltr" {...register("target_value")} />
            </Field>
            <Field id="ind-unit" label={t("unit")}>
              <Input {...register("unit")} />
            </Field>
            <div className="grid gap-2">
              <span id="ind-direction" className="text-sm font-medium">
                {t("direction")}
              </span>
              {select(
                "direction",
                "ind-direction",
                INDICATOR_DIRECTIONS.map((v) => ({ value: v, label: t(`directions.${v}`) })),
              )}
            </div>
            <div className="grid gap-2">
              <span id="ind-frequency" className="text-sm font-medium">
                {t("frequency")}
              </span>
              {select(
                "frequency",
                "ind-frequency",
                INDICATOR_FREQUENCIES.map((v) => ({ value: v, label: label(FREQUENCY_LABELS, v, locale) })),
              )}
            </div>
            <Field id="ind-owner" label={t("owner")}>
              <Input autoComplete="off" {...register("owner")} />
            </Field>
            {indicator ? (
              <>
                <Field id="ind-baseline" label={t("baseline")}>
                  <Input inputMode="decimal" dir="ltr" {...register("baseline_value")} />
                </Field>
                <div className="grid gap-2">
                  <span id="ind-status" className="text-sm font-medium">
                    {t("status")}
                  </span>
                  {select(
                    "status",
                    "ind-status",
                    INDICATOR_STATUSES.map((v) => ({
                      value: v,
                      label: label(INDICATOR_STATUS_LABELS, v, locale),
                    })),
                  )}
                </div>
                <div className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm sm:col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {t("current")} · {t("source")}: {indicator.source}
                  </span>
                  <span>{indicator.current_value ?? t("notComputed")}</span>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
