"use client";

import {
  DESIGN_LABELS,
  INDICATOR_TYPE_LABELS,
  INDICATOR_TYPES,
  label,
  MEASUREMENT_DESIGNS,
  MEASUREMENT_TYPE_LABELS,
  MEASUREMENT_TYPES,
  type ArchitectOutput,
  type IndicatorType,
  type MeasurementDesign,
  type MeasurementPlanDraft,
  type MeasurementType,
} from "@meqyas/shared";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";

interface EditorValues {
  project_title: string;
  understanding_summary: string;
  target_population: string;
  purpose: string;
  measurement_type: MeasurementType;
  recommended_design: MeasurementDesign;
  recommended_questions_count: number;
  objectives: { key: string; title: string; description: string }[];
  dimensions: { key: string; name: string; description: string; objective_key: string | null }[];
  indicators: {
    code: string;
    name: string;
    dimension_key: string;
    indicator_type: IndicatorType;
    target: string;
    unit: string;
    description: string;
    formula: string;
    target_value: number | null;
    frequency: MeasurementPlanDraft["indicators"][number]["frequency"];
    direction: MeasurementPlanDraft["indicators"][number]["direction"];
  }[];
}

function nextKey(prefix: string, existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

export function PlanEditor({
  draft,
  saving,
  onSave,
  onCancel,
}: {
  draft: MeasurementPlanDraft;
  saving: boolean;
  onSave: (value: ArchitectOutput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("plan");
  const tf = useTranslations("plan.fields");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const [formError, setFormError] = React.useState<string | null>(null);

  const { control, register, handleSubmit, getValues } = useForm<EditorValues>({
    defaultValues: {
      project_title: draft.project_title,
      understanding_summary: draft.understanding_summary,
      target_population: draft.target_population,
      purpose: draft.purpose,
      measurement_type: draft.measurement_type,
      recommended_design: draft.recommended_design,
      recommended_questions_count: draft.recommended_questions_count,
      objectives: draft.objectives.map((o) => ({ ...o })),
      dimensions: draft.dimensions.map((d) => ({ ...d })),
      indicators: draft.indicators.map((i) => ({ ...i })),
    },
  });
  const objectives = useFieldArray({ control, name: "objectives" });
  const dimensions = useFieldArray({ control, name: "dimensions" });
  const indicators = useFieldArray({ control, name: "indicators" });

  const submit = handleSubmit((values) => {
    setFormError(null);
    if (values.dimensions.length < 2) {
      setFormError(t("minDimensions"));
      return;
    }
    const keys = new Set(values.dimensions.map((d) => d.key));
    onSave({
      ...draft,
      project_title: values.project_title.trim(),
      understanding_summary: values.understanding_summary.trim(),
      target_population: values.target_population.trim(),
      purpose: values.purpose.trim(),
      measurement_type: values.measurement_type,
      recommended_design: values.recommended_design,
      recommended_questions_count:
        Number(values.recommended_questions_count) || draft.recommended_questions_count,
      objectives: values.objectives.filter((o) => o.title.trim()),
      dimensions: values.dimensions.filter((d) => d.name.trim()),
      indicators: values.indicators.filter((i) => i.name.trim() && keys.has(i.dimension_key)),
    });
  });

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t("editPlan")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="pe-title" label={tf("title")} className="sm:col-span-2" required>
            <Input {...register("project_title", { required: true })} />
          </Field>
          <Field id="pe-summary" label={tf("summary")} className="sm:col-span-2">
            <Textarea rows={2} {...register("understanding_summary")} />
          </Field>
          <Field id="pe-population" label={tf("population")} required>
            <Input {...register("target_population", { required: true })} />
          </Field>
          <Field id="pe-questions" label={tf("questionsCount")}>
            <Input
              type="number"
              inputMode="numeric"
              min={5}
              max={60}
              {...register("recommended_questions_count", { valueAsNumber: true })}
            />
          </Field>
          <Field id="pe-purpose" label={tf("purpose")} className="sm:col-span-2">
            <Textarea rows={3} {...register("purpose")} />
          </Field>
          <div className="grid gap-2">
            <span className="text-sm font-medium" id="pe-type-label">
              {tf("type")}
            </span>
            <Controller
              control={control}
              name="measurement_type"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  dir={locale === "ar" ? "rtl" : "ltr"}
                >
                  <SelectTrigger aria-labelledby="pe-type-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEASUREMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {label(MEASUREMENT_TYPE_LABELS, type, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium" id="pe-design-label">
              {tf("design")}
            </span>
            <Controller
              control={control}
              name="recommended_design"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  dir={locale === "ar" ? "rtl" : "ltr"}
                >
                  <SelectTrigger aria-labelledby="pe-design-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEASUREMENT_DESIGNS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {label(DESIGN_LABELS, d, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("objectives")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {objectives.fields.map((field, i) => (
            <div key={field.id} className="flex items-center gap-2">
              <span className="w-6 text-center text-sm text-muted-foreground tabular-nums">{i + 1}</span>
              <Input
                aria-label={`${tf("objective")} ${i + 1}`}
                {...register(`objectives.${i}.title` as const)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={tf("remove")}
                onClick={() => objectives.remove(i)}
                disabled={objectives.fields.length <= 1}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              objectives.append({
                key: nextKey(
                  "o",
                  getValues("objectives").map((o) => o.key),
                ),
                title: "",
                description: "",
              })
            }
          >
            <PlusIcon aria-hidden="true" />
            {tf("addObjective")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dimensions")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {dimensions.fields.map((dim, di) => (
            <fieldset key={dim.id} className="grid gap-3 rounded-xl border p-4">
              <legend className="px-1 text-sm font-semibold">
                {tf("dimensionName")} {di + 1}
              </legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <Field id={`pe-dim-${di}`} label={tf("dimensionName")}>
                  <Input {...register(`dimensions.${di}.name` as const)} />
                </Field>
                <Field id={`pe-dimdesc-${di}`} label={tf("dimensionDescription")}>
                  <Input {...register(`dimensions.${di}.description` as const)} />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tf("remove")}
                  disabled={dimensions.fields.length <= 2}
                  onClick={() => {
                    const key = getValues(`dimensions.${di}.key`);
                    const keep = getValues("indicators")
                      .map((ind, idx) => ({ ind, idx }))
                      .filter(({ ind }) => ind.dimension_key === key)
                      .map(({ idx }) => idx);
                    indicators.remove(keep);
                    dimensions.remove(di);
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-2 border-s-2 border-primary/20 ps-3">
                <p className="text-xs font-medium text-muted-foreground">{t("indicators")}</p>
                {indicators.fields.map((ind, ii) =>
                  ind.dimension_key === dim.key ? (
                    <div key={ind.id} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center">
                      <Input
                        aria-label={tf("indicatorName")}
                        placeholder={tf("indicatorName")}
                        {...register(`indicators.${ii}.name` as const)}
                      />
                      <Controller
                        control={control}
                        name={`indicators.${ii}.indicator_type` as const}
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                            dir={locale === "ar" ? "rtl" : "ltr"}
                          >
                            <SelectTrigger aria-label={tf("indicatorType")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {INDICATOR_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {label(INDICATOR_TYPE_LABELS, type, locale)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <Input
                        aria-label={tf("target")}
                        placeholder={tf("target")}
                        {...register(`indicators.${ii}.target` as const)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tf("remove")}
                        onClick={() => indicators.remove(ii)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null,
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    indicators.append({
                      code: nextKey(
                        "IND-",
                        getValues("indicators").map((i) => i.code),
                      ),
                      name: "",
                      dimension_key: dim.key,
                      indicator_type: "AVERAGE_SCORE",
                      target: "",
                      unit: "",
                      description: "",
                      formula: "",
                      target_value: null,
                      frequency: "PER_WAVE",
                      direction: "HIGHER_IS_BETTER",
                    })
                  }
                >
                  <PlusIcon aria-hidden="true" />
                  {tf("addIndicator")}
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              dimensions.append({
                key: nextKey(
                  "d",
                  getValues("dimensions").map((d) => d.key),
                ),
                name: "",
                description: "",
                objective_key: getValues("objectives")[0]?.key ?? null,
              })
            }
          >
            <PlusIcon aria-hidden="true" />
            {tf("addDimension")}
          </Button>
        </CardContent>
      </Card>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="sticky bottom-20 z-10 flex flex-wrap justify-end gap-2 rounded-2xl border bg-background/90 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          {saving ? tc("saving") : t("saveEdits")}
        </Button>
      </div>
    </form>
  );
}
