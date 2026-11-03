"use client";

import {
  label,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURES,
  type PlanFeature,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
} from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Skeleton,
  Spinner,
  Switch,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, InfoIcon, MinusIcon, PackageIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { AdminOnly } from "@/components/admin/admin-only";
import { planLabel, usePlans } from "@/components/admin/subscriber-dialogs";
import { NumericInput } from "@/components/common/numeric-input";
import { adminApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

type LimitKey =
  "default_days" | "max_surveys" | "max_responses_per_month" | "max_members" | "ai_daily_tokens";
const LIMITS: LimitKey[] = [
  "max_surveys",
  "max_responses_per_month",
  "max_members",
  "ai_daily_tokens",
  "default_days",
];

interface PlanForm extends SubscriptionPlanInput {
  code: string;
  is_archived: boolean;
}

const EMPTY: PlanForm = {
  code: "",
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  is_trial: false,
  default_days: 365,
  max_surveys: 10,
  max_responses_per_month: 1000,
  max_members: 5,
  ai_daily_tokens: null,
  features: [...PLAN_FEATURES],
  sort_order: 10,
  is_archived: false,
};

function PlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: SubscriptionPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.plans");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<PlanForm>(EMPTY);
  const [touched, setTouched] = React.useState(false);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  React.useEffect(() => {
    if (!open) return;
    setTouched(false);
    setForm(plan ? { ...plan } : EMPTY);
  }, [open, plan]);

  const save = useMutation({
    mutationFn: () => {
      // Only the editable fields (the form was filled from a plan that also has id, subscribers…).
      const fields: SubscriptionPlanInput = {
        name_ar: form.name_ar.trim(),
        name_en: form.name_en.trim(),
        description_ar: form.description_ar.trim(),
        description_en: form.description_en.trim(),
        is_trial: form.is_trial,
        default_days: form.default_days,
        max_surveys: form.max_surveys,
        max_responses_per_month: form.max_responses_per_month,
        max_members: form.max_members,
        ai_daily_tokens: form.ai_daily_tokens,
        features: form.features,
        sort_order: form.sort_order,
      };
      return plan
        ? adminApi.updatePlan(plan.id, { ...fields, is_archived: form.is_archived })
        : adminApi.createPlan({ code: form.code, ...fields });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      toast.success(plan ? t("saved") : t("created"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const errors = {
    code: !plan && !/^[a-z][a-z0-9_-]{1,39}$/.test(form.code) ? t("codeInvalid") : undefined,
    name: !form.name_ar.trim() || !form.name_en.trim() ? t("nameRequired") : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const toggleFeature = (feature: PlanFeature, on: boolean) =>
    set(
      "features",
      on ? [...new Set([...form.features, feature])] : form.features.filter((f) => f !== feature),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {plan ? t("editTitle", { name: planLabel(plan, locale) }) : t("newTitle")}
          </DialogTitle>
          <DialogDescription>{plan ? t("editDescription") : t("newDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="plan-name-ar" label={t("nameAr")} error={touched ? errors.name : undefined} required>
              <Input value={form.name_ar} maxLength={80} onChange={(e) => set("name_ar", e.target.value)} />
            </Field>
            <Field id="plan-name-en" label={t("nameEn")} required>
              <Input
                dir="ltr"
                value={form.name_en}
                maxLength={80}
                onChange={(e) => set("name_en", e.target.value)}
              />
            </Field>
            {!plan ? (
              <Field
                id="plan-code"
                label={t("code")}
                hint={t("codeHint")}
                error={touched ? errors.code : undefined}
                required
              >
                <Input
                  dir="ltr"
                  value={form.code}
                  maxLength={40}
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => set("code", e.target.value.trim().toLowerCase())}
                />
              </Field>
            ) : null}
            <Field id="plan-order" label={t("order")} hint={t("orderHint")}>
              <NumericInput
                inputMode="numeric"
                value={form.sort_order}
                onValueChange={(n) => set("sort_order", Math.max(0, Math.round(n ?? 0)))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="plan-desc-ar" label={t("descriptionAr")}>
              <Input
                value={form.description_ar}
                maxLength={500}
                onChange={(e) => set("description_ar", e.target.value)}
              />
            </Field>
            <Field id="plan-desc-en" label={t("descriptionEn")}>
              <Input
                dir="ltr"
                value={form.description_en}
                maxLength={500}
                onChange={(e) => set("description_en", e.target.value)}
              />
            </Field>
          </div>
          <fieldset className="grid gap-3 rounded-xl border p-4">
            <legend className="px-1 text-sm font-medium">{t("limitsTitle")}</legend>
            {LIMITS.map((key) => {
              const unlimited = form[key] === null;
              return (
                <div key={key} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
                  <Label htmlFor={`plan-${key}`}>{t(`limits.${key}`)}</Label>
                  <NumericInput
                    id={`plan-${key}`}
                    inputMode="numeric"
                    value={unlimited ? null : form[key]}
                    disabled={unlimited}
                    onValueChange={(n) => set(key, n === null ? 0 : Math.max(0, Math.round(n)))}
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={unlimited}
                      onCheckedChange={(v) => set(key, v ? null : key === "default_days" ? 365 : 1)}
                    />
                    {t(
                      key === "default_days"
                        ? "noEnd"
                        : key === "ai_daily_tokens"
                          ? "platformDefault"
                          : "unlimited",
                    )}
                  </label>
                </div>
              );
            })}
          </fieldset>
          <fieldset className="grid gap-2 rounded-xl border p-4">
            <legend className="px-1 text-sm font-medium">{t("modules")}</legend>
            <p className="text-xs text-muted-foreground text-pretty">{t("modulesHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PLAN_FEATURES.map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.features.includes(feature)}
                    onCheckedChange={(v) => toggleFeature(feature, v)}
                  />
                  {label(PLAN_FEATURE_LABELS, feature, locale)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
              <Switch checked={form.is_trial} onCheckedChange={(v) => set("is_trial", v)} />
              <span className="grid gap-0.5">
                <span className="font-medium">{t("trial")}</span>
                <span className="text-xs text-muted-foreground">{t("trialHint")}</span>
              </span>
            </label>
            {plan ? (
              <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
                <Switch checked={form.is_archived} onCheckedChange={(v) => set("is_archived", v)} />
                <span className="grid gap-0.5">
                  <span className="font-medium">{t("archived")}</span>
                  <span className="text-xs text-muted-foreground">{t("archivedHint")}</span>
                </span>
              </label>
            ) : null}
          </div>
          {plan && plan.subscribers > 0 ? (
            <Alert variant="info">
              <InfoIcon aria-hidden="true" />
              <AlertDescription>{t("appliesNow", { n: plan.subscribers })}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner className="size-4" /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({ plan, onEdit }: { plan: SubscriptionPlan; onEdit: () => void }) {
  const t = useTranslations("admin.plans");
  const locale = useLocale() as "ar" | "en";
  const format = useFormatter();
  const value = (n: number | null, unlimited: string) => (n === null ? unlimited : format.number(n));
  const description = locale === "en" ? plan.description_en : plan.description_ar;
  return (
    <Card className={plan.is_archived ? "opacity-70" : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            {planLabel(plan, locale)}
            {plan.is_trial ? <Badge variant="soft">{t("trialBadge")}</Badge> : null}
            {plan.is_archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
          </CardTitle>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {plan.code}
          </p>
          {description ? <p className="text-sm text-muted-foreground text-pretty">{description}</p> : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={t("editTitle", { name: planLabel(plan, locale) })}
        >
          <PencilIcon aria-hidden="true" />
          {t("edit")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-1.5 text-sm">
          {(
            [
              ["max_surveys", value(plan.max_surveys, t("unlimited"))],
              ["max_responses_per_month", value(plan.max_responses_per_month, t("unlimited"))],
              ["max_members", value(plan.max_members, t("unlimited"))],
              ["ai_daily_tokens", value(plan.ai_daily_tokens, t("platformDefault"))],
              ["default_days", plan.default_days === null ? t("noEnd") : t("days", { n: plan.default_days })],
            ] as const
          ).map(([key, text]) => (
            <div key={key} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t(`limits.${key}`)}</dt>
              <dd className="font-medium tabular-nums">{text}</dd>
            </div>
          ))}
        </dl>
        <ul className="grid gap-1 text-sm">
          {PLAN_FEATURES.map((feature) => {
            const on = plan.features.includes(feature);
            return (
              <li
                key={feature}
                className={on ? "flex items-center gap-2" : "flex items-center gap-2 text-muted-foreground"}
              >
                {on ? (
                  <CheckIcon className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <MinusIcon className="size-4" aria-hidden="true" />
                )}
                {label(PLAN_FEATURE_LABELS, feature, locale)}
                <span className="visually-hidden">{on ? t("included") : t("notIncluded")}</span>
              </li>
            );
          })}
        </ul>
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {t("subscribers", { n: plan.subscribers })}
        </p>
      </CardContent>
    </Card>
  );
}

function PlansView() {
  const t = useTranslations("admin.plans");
  const plans = usePlans();
  const [editing, setEditing] = React.useState<SubscriptionPlan | null>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {t("new")}
        </Button>
      </div>
      {plans.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadFailed")}</AlertDescription>
        </Alert>
      ) : !plans.data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !plans.data.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <PackageIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {plans.data.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onEdit={() => {
                setEditing(plan);
                setOpen(true);
              }}
            />
          ))}
        </div>
      )}
      <PlanDialog plan={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export default function PlansPage() {
  return (
    <AdminOnly>
      <PlansView />
    </AdminOnly>
  );
}
