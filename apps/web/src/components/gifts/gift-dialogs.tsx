"use client";

import { label, SECTOR_LABELS, SECTORS, type GiftMessage, type Sector } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Spinner,
  Switch,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { NumericInput } from "@/components/common/numeric-input";
import { ShareMessageDialog } from "@/components/common/share-message-dialog";
import { giftApi, storeApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm";

export { whatsappNumber } from "@/components/common/share-message-dialog";

// ---------------------------------------------------------------- message
export function GiftMessageDialog({
  message,
  phone,
  onOpenChange,
}: {
  message: GiftMessage | null;
  phone: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("gifts.message");
  return (
    <ShareMessageDialog
      message={
        message
          ? {
              recipientName: message.gift.recipient_name,
              recipientEmail: message.gift.recipient_email,
              locale: message.gift.locale,
              subject: message.subject,
              body: message.body,
              link: message.link,
              emailed: message.emailed,
              emailAvailable: message.email_available,
              kind: message.link.includes("/gift/") ? "activation" : "sign_in",
            }
          : null
      }
      phone={phone}
      title={message ? t("title", { name: message.gift.recipient_name }) : undefined}
      onOpenChange={onOpenChange}
    />
  );
}

// ------------------------------------------------------------------- form
interface FormState {
  recipient_name: string;
  recipient_email: string;
  phone: string;
  organization_name: string;
  sector: Sector;
  survey_limit: number | null;
  trial_days: number | null;
  unlimited_time: boolean;
  locale: "ar" | "en";
  note: string;
  send_email: boolean;
}

const INITIAL: FormState = {
  recipient_name: "",
  recipient_email: "",
  phone: "",
  organization_name: "",
  sector: "OTHER",
  survey_limit: 3,
  trial_days: 30,
  unlimited_time: false,
  locale: "ar",
  note: "",
  send_email: true,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewGiftDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: GiftMessage, phone: string) => void;
}) {
  const t = useTranslations("gifts.form");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [touched, setTouched] = React.useState(false);
  const capabilities = useQuery({
    queryKey: ["integrations-capabilities"],
    queryFn: storeApi.capabilities,
    enabled: open,
  });
  const emailAvailable = capabilities.data?.email_delivery ?? false;

  React.useEffect(() => {
    if (open) {
      setForm({ ...INITIAL, locale });
      setTouched(false);
    }
  }, [open, locale]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      giftApi.create({
        recipient_name: form.recipient_name.trim(),
        recipient_email: form.recipient_email.trim(),
        organization_name: form.organization_name.trim(),
        sector: form.sector,
        survey_limit: form.survey_limit ?? 1,
        trial_days: form.unlimited_time ? null : (form.trial_days ?? 30),
        locale: form.locale,
        note: form.note.trim(),
        send_email: form.send_email && emailAvailable,
      }),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: ["gifts"] });
      onCreated(message, form.phone);
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const errors = {
    name: form.recipient_name.trim().length < 2 ? t("nameRequired") : undefined,
    email: !EMAIL.test(form.recipient_email.trim()) ? t("emailInvalid") : undefined,
    limit:
      !form.survey_limit || form.survey_limit < 1 || form.survey_limit > 100 ? t("limitInvalid") : undefined,
    days:
      !form.unlimited_time && (!form.trial_days || form.trial_days < 1 || form.trial_days > 365)
        ? t("daysInvalid")
        : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid) create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="gift-name" label={t("name")} error={touched ? errors.name : undefined} required>
              <Input
                value={form.recipient_name}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => set("recipient_name", e.target.value)}
              />
            </Field>
            <Field
              id="gift-email"
              label={t("email")}
              hint={t("emailHint")}
              error={touched ? errors.email : undefined}
              required
            >
              <Input
                type="email"
                dir="ltr"
                value={form.recipient_email}
                maxLength={320}
                autoComplete="off"
                onChange={(e) => set("recipient_email", e.target.value)}
              />
            </Field>
            <Field id="gift-phone" label={t("phone")} hint={t("phoneHint")}>
              <Input
                type="tel"
                dir="ltr"
                inputMode="tel"
                value={form.phone}
                maxLength={20}
                autoComplete="off"
                placeholder="05xxxxxxxx"
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
            <Field id="gift-org" label={t("organization")} hint={t("organizationHint")}>
              <Input
                value={form.organization_name}
                maxLength={200}
                autoComplete="off"
                placeholder={
                  form.recipient_name.trim()
                    ? t("organizationPlaceholder", { name: form.recipient_name.trim() })
                    : ""
                }
                onChange={(e) => set("organization_name", e.target.value)}
              />
            </Field>
            <Field
              id="gift-limit"
              label={t("surveys")}
              hint={t("surveysHint")}
              error={touched ? errors.limit : undefined}
              required
            >
              <NumericInput
                value={form.survey_limit}
                inputMode="numeric"
                onValueChange={(n) => set("survey_limit", n)}
              />
            </Field>
            <div className="grid content-start gap-2">
              <Field id="gift-days" label={t("days")} error={touched ? errors.days : undefined}>
                <NumericInput
                  value={form.unlimited_time ? null : form.trial_days}
                  inputMode="numeric"
                  disabled={form.unlimited_time}
                  onValueChange={(n) => set("trial_days", n)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.unlimited_time} onCheckedChange={(v) => set("unlimited_time", v)} />
                {t("noTimeLimit")}
              </label>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gift-sector">{t("sector")}</Label>
              <select
                id="gift-sector"
                className={selectClass}
                value={form.sector}
                onChange={(e) => set("sector", e.target.value as Sector)}
              >
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {label(SECTOR_LABELS, s, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gift-locale">{t("language")}</Label>
              <select
                id="gift-locale"
                className={selectClass}
                value={form.locale}
                onChange={(e) => set("locale", e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <Field id="gift-note" label={t("note")} hint={t("noteHint")}>
            <Textarea
              rows={3}
              value={form.note}
              maxLength={1000}
              placeholder={t("notePlaceholder")}
              onChange={(e) => set("note", e.target.value)}
            />
          </Field>
          <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="gift-send">{t("sendEmail")}</Label>
              <p className="text-xs text-muted-foreground text-pretty">
                {emailAvailable ? t("sendEmailHint") : t("sendEmailUnavailable")}
              </p>
            </div>
            <Switch
              id="gift-send"
              checked={form.send_email && emailAvailable}
              disabled={!emailAvailable}
              onCheckedChange={(v) => set("send_email", v)}
            />
          </div>
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{t("security")}</AlertDescription>
          </Alert>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner className="size-4" /> : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
