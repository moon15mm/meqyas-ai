"use client";

import type {
  InvitationDelivery,
  StoreConnection,
  StoreConnectionCreated,
  StorePlatform,
  StoreTrigger,
  SurveyMeta,
} from "@meqyas/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { NumericInput } from "@/components/common/numeric-input";
import { storeApi, surveyApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

export const PLATFORMS: StorePlatform[] = ["SALLA", "ZID", "SHOPIFY", "WOOCOMMERCE", "CUSTOM"];
/** Shopify and Salla generate the signing secret themselves; the others take MEQYAS's. */
export const PLATFORM_OWNS_SECRET: ReadonlySet<StorePlatform> = new Set(["SHOPIFY", "SALLA"]);
const RECOMMENDED_TRIGGER: Record<StorePlatform, StoreTrigger> = {
  SALLA: "DELIVERED",
  ZID: "DELIVERED",
  SHOPIFY: "FULFILLED",
  WOOCOMMERCE: "DELIVERED",
  CUSTOM: "DELIVERED",
};

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm";

interface FormState {
  platform: StorePlatform;
  name: string;
  store_url: string;
  store_survey_id: string;
  product_survey_id: string;
  trigger: StoreTrigger;
  delivery: InvitationDelivery;
  delay_days: number;
  max_products: number;
  min_days_between: number;
  secret: string;
}

function initial(connection: StoreConnection | null): FormState {
  return {
    platform: connection?.platform ?? "SALLA",
    name: connection?.name ?? "",
    store_url: connection?.store_url ?? "",
    store_survey_id: connection?.store_survey_id ?? "",
    product_survey_id: connection?.product_survey_id ?? "",
    trigger: connection?.trigger ?? "DELIVERED",
    delivery: connection?.delivery ?? "LINK",
    delay_days: connection?.delay_days ?? 3,
    max_products: connection?.max_products ?? 3,
    min_days_between: connection?.min_days_between ?? 30,
    secret: "",
  };
}

function SurveyPicker({
  id,
  label,
  hint,
  value,
  onChange,
  surveys,
  exclude,
  template,
  projectId,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (id: string) => void;
  surveys: SurveyMeta[];
  exclude: string;
  template: "store_experience" | "product_feedback";
  projectId: string;
}) {
  const t = useTranslations("integrations.form");
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const create = useMutation({
    mutationFn: () => storeApi.surveyFromTemplate(projectId, template),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys", { projectId }] });
      onChange(detail.survey.id);
      toast.success(t("templateCreated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          className={cn(selectClass, "flex-1")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
        >
          <option value="">{t("noSurvey")}</option>
          {surveys
            .filter((s) => s.id !== exclude && s.status !== "ARCHIVED")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.published_version_number ? "" : ` — ${t("draft")}`}
              </option>
            ))}
        </select>
        <Button type="button" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
          <SparklesIcon aria-hidden="true" />
          {t("useTemplate")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

export function ConnectionFormDialog({
  projectId,
  connection,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  /** null → create a new connection. */
  connection: StoreConnection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: StoreConnection | StoreConnectionCreated, created: boolean) => void;
}) {
  const t = useTranslations("integrations");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(() => initial(connection));
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setForm(initial(connection));
      setError(null);
    }
  }, [open, connection]);

  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
    enabled: open,
  });
  const caps = useQuery({
    queryKey: ["integrations", "capabilities"],
    queryFn: () => storeApi.capabilities(),
    enabled: open,
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: form.name.trim(),
        store_url: form.store_url.trim() || null,
        store_survey_id: form.store_survey_id || null,
        product_survey_id: form.product_survey_id || null,
        trigger: form.trigger,
        delivery: form.delivery,
        delay_days: form.delay_days,
        max_products: form.max_products,
        min_days_between: form.min_days_between,
      };
      if (connection) return { saved: await storeApi.update(connection.id, common), created: false };
      return {
        saved: await storeApi.create(projectId, {
          ...common,
          platform: form.platform,
          secret: form.secret.trim() || null,
        }),
        created: true,
      };
    },
    onSuccess: ({ saved, created }) => {
      void queryClient.invalidateQueries({ queryKey: ["store-connections", projectId] });
      onSaved(saved, created);
      onOpenChange(false);
    },
    onError: (e) => setError(toMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError(t("form.nameRequired"));
    if (!form.store_survey_id && !form.product_survey_id) return setError(t("form.surveyRequired"));
    setError(null);
    save.mutate();
  };

  const list = surveys.data ?? [];
  const emailAvailable = caps.data?.email_delivery ?? true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{connection ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          <DialogDescription>{t("form.description")}</DialogDescription>
        </DialogHeader>
        <form id="store-connection-form" onSubmit={submit} className="grid gap-5" noValidate>
          {!connection ? (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t("form.platform")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PLATFORMS.map((p) => (
                  <label
                    key={p}
                    className={cn(
                      "grid cursor-pointer gap-0.5 rounded-xl border p-3 text-sm transition hover:border-primary/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      form.platform === p && "border-primary bg-primary/5",
                    )}
                  >
                    <input
                      type="radio"
                      name="platform"
                      value={p}
                      checked={form.platform === p}
                      onChange={() =>
                        setForm((f) => ({ ...f, platform: p, trigger: RECOMMENDED_TRIGGER[p] }))
                      }
                      className="sr-only"
                    />
                    <span className="font-semibold">{t(`platforms.${p}.name`)}</span>
                    <span className="text-xs text-muted-foreground">{t(`platforms.${p}.tagline`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="store-name">{t("form.name")}</Label>
              <Input
                id="store-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="store-url">{t("form.storeUrl")}</Label>
              <Input
                id="store-url"
                type="url"
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                value={form.store_url}
                onChange={(e) => set("store_url", e.target.value)}
              />
            </div>
          </div>

          <SurveyPicker
            id="store-survey"
            label={t("form.storeSurvey")}
            hint={t("form.storeSurveyHint")}
            value={form.store_survey_id}
            onChange={(id) => set("store_survey_id", id)}
            surveys={list}
            exclude={form.product_survey_id}
            template="store_experience"
            projectId={projectId}
          />
          <SurveyPicker
            id="product-survey"
            label={t("form.productSurvey")}
            hint={t("form.productSurveyHint")}
            value={form.product_survey_id}
            onChange={(id) => set("product_survey_id", id)}
            surveys={list}
            exclude={form.store_survey_id}
            template="product_feedback"
            projectId={projectId}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="store-trigger">{t("form.trigger")}</Label>
              <select
                id="store-trigger"
                className={selectClass}
                value={form.trigger}
                onChange={(e) => set("trigger", e.target.value as StoreTrigger)}
              >
                {(["FULFILLED", "DELIVERED"] as const).map((tr) => (
                  <option key={tr} value={tr}>
                    {t(`triggers.${tr}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t(`platforms.${form.platform}.triggerHint`)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="store-products">{t("form.maxProducts")}</Label>
              <NumericInput
                id="store-products"
                inputMode="numeric"
                value={form.max_products}
                onValueChange={(n) => set("max_products", Math.min(10, Math.max(1, Math.round(n ?? 1))))}
              />
              <p className="text-xs text-muted-foreground">{t("form.maxProductsHint")}</p>
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("form.delivery")}</legend>
            {(["LINK", "EMAIL"] as const).map((d) => {
              const disabled = d === "EMAIL" && !emailAvailable;
              return (
                <label
                  key={d}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    form.delivery === d && "border-primary bg-primary/5",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value={d}
                    checked={form.delivery === d}
                    disabled={disabled}
                    onChange={() => set("delivery", d)}
                    className="mt-1 accent-[var(--primary)]"
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{t(`delivery.${d}.title`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {disabled ? t("delivery.EMAIL.unavailable") : t(`delivery.${d}.body`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {form.delivery === "EMAIL" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="store-delay">{t("form.delayDays")}</Label>
                <NumericInput
                  id="store-delay"
                  inputMode="numeric"
                  value={form.delay_days}
                  onValueChange={(n) => set("delay_days", Math.min(30, Math.max(0, Math.round(n ?? 0))))}
                />
                <p className="text-xs text-muted-foreground">{t("form.delayDaysHint")}</p>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="store-fatigue">{t("form.minDays")}</Label>
              <NumericInput
                id="store-fatigue"
                inputMode="numeric"
                value={form.min_days_between}
                onValueChange={(n) => set("min_days_between", Math.min(365, Math.max(0, Math.round(n ?? 0))))}
              />
              <p className="text-xs text-muted-foreground">{t("form.minDaysHint")}</p>
            </div>
          </div>

          {!connection && PLATFORM_OWNS_SECRET.has(form.platform) ? (
            <div className="grid gap-1.5">
              <Label htmlFor="store-secret">
                {t("form.platformSecret", { platform: t(`platforms.${form.platform}.name`) })}
              </Label>
              <Input
                id="store-secret"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={form.secret}
                onChange={(e) => set("secret", e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("form.platformSecretHint")}</p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" form="store-connection-form" disabled={save.isPending}>
            {connection ? t("form.save") : t("form.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
