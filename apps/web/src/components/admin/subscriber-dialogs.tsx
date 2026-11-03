"use client";

import {
  label,
  ROLE_LABELS,
  ROLES,
  SECTOR_LABELS,
  SECTORS,
  type AccountMessage,
  type BulkResult,
  type LimitOverrides,
  type Role,
  type Sector,
  type SubscriberDetail,
  type SubscriptionPlan,
} from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, InfoIcon, MessageSquareTextIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { NumericInput } from "@/components/common/numeric-input";
import { fromAccountMessage, type ShareableMessage } from "@/components/common/share-message-dialog";
import { adminApi, storeApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

import { downloadText, parsePeople, resultsCsv } from "./bulk";

export const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usePlans() {
  return useQuery({ queryKey: ["admin-plans"], queryFn: adminApi.plans });
}

export function useEmailAvailable(enabled: boolean): boolean {
  const capabilities = useQuery({
    queryKey: ["integrations-capabilities"],
    queryFn: storeApi.capabilities,
    enabled,
  });
  return capabilities.data?.email_delivery ?? false;
}

export function planLabel(plan: Pick<SubscriptionPlan, "name_ar" | "name_en">, locale: string): string {
  return locale === "en" ? plan.name_en : plan.name_ar;
}

/** Plan + length (days, or no end date), prefilled from the plan's suggested length. */
function PlanAndDays({
  plans,
  planCode,
  days,
  openEnded,
  onPlan,
  onDays,
  onOpenEnded,
  idPrefix,
  error,
}: {
  plans: SubscriptionPlan[];
  planCode: string;
  days: number | null;
  openEnded: boolean;
  onPlan: (plan: SubscriptionPlan) => void;
  onDays: (days: number | null) => void;
  onOpenEnded: (value: boolean) => void;
  idPrefix: string;
  error?: string;
}) {
  const t = useTranslations("admin.form");
  const locale = useLocale();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-plan`}>{t("plan")}</Label>
        <select
          id={`${idPrefix}-plan`}
          className={selectClass}
          value={planCode}
          onChange={(e) => {
            const plan = plans.find((p) => p.code === e.target.value);
            if (plan) onPlan(plan);
          }}
        >
          {plans
            .filter((p) => !p.is_archived)
            .map((p) => (
              <option key={p.code} value={p.code}>
                {planLabel(p, locale)}
              </option>
            ))}
        </select>
      </div>
      <div className="grid content-start gap-2">
        <Field id={`${idPrefix}-days`} label={t("days")} hint={t("daysHint")} error={error}>
          <NumericInput
            value={openEnded ? null : days}
            inputMode="numeric"
            disabled={openEnded}
            onValueChange={onDays}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={openEnded} onCheckedChange={onOpenEnded} />
          {t("openEnded")}
        </label>
      </div>
    </>
  );
}

function SendEmailRow({
  id,
  checked,
  available,
  onChange,
}: {
  id: string;
  checked: boolean;
  available: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("admin.form");
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{t("sendEmail")}</Label>
        <p className="text-xs text-muted-foreground text-pretty">
          {available ? t("sendEmailHint") : t("sendEmailUnavailable")}
        </p>
      </div>
      <Switch id={id} checked={checked && available} disabled={!available} onCheckedChange={onChange} />
    </div>
  );
}

// ------------------------------------------------------------ new subscriber
export function NewSubscriberDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: ShareableMessage, phone: string) => void;
}) {
  const t = useTranslations("admin.form");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const emailAvailable = useEmailAvailable(open);
  const initial = React.useMemo(
    () => ({
      owner_name: "",
      owner_email: "",
      phone: "",
      organization_name: "",
      sector: "OTHER" as Sector,
      locale,
      plan_code: "",
      days: null as number | null,
      open_ended: false,
      admin_note: "",
      send_email: true,
    }),
    [locale],
  );
  const [form, setForm] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  React.useEffect(() => {
    if (!open) return;
    setTouched(false);
    const first = plans.data?.find((p) => !p.is_archived && !p.is_trial) ?? plans.data?.[0];
    setForm({
      ...initial,
      plan_code: first?.code ?? "",
      days: first?.default_days ?? null,
      open_ended: first ? first.default_days === null : false,
    });
  }, [open, initial, plans.data]);

  const create = useMutation({
    mutationFn: () =>
      adminApi.createSubscriber({
        owner_name: form.owner_name.trim(),
        owner_email: form.owner_email.trim(),
        organization_name: form.organization_name.trim(),
        sector: form.sector,
        locale: form.locale,
        plan_code: form.plan_code,
        days: form.open_ended ? null : form.days,
        admin_note: form.admin_note.trim(),
        send_email: form.send_email && emailAvailable,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      onCreated(fromAccountMessage(result.message), form.phone);
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const errors = {
    name: form.owner_name.trim().length < 2 ? t("nameRequired") : undefined,
    email: !EMAIL.test(form.owner_email.trim()) ? t("emailInvalid") : undefined,
    days:
      !form.open_ended && (!form.days || form.days < 1 || form.days > 3650) ? t("daysInvalid") : undefined,
    plan: !form.plan_code ? t("planRequired") : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
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
            <Field id="sub-name" label={t("ownerName")} error={touched ? errors.name : undefined} required>
              <Input
                value={form.owner_name}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => set("owner_name", e.target.value)}
              />
            </Field>
            <Field
              id="sub-email"
              label={t("ownerEmail")}
              hint={t("ownerEmailHint")}
              error={touched ? errors.email : undefined}
              required
            >
              <Input
                type="email"
                dir="ltr"
                value={form.owner_email}
                maxLength={320}
                autoComplete="off"
                onChange={(e) => set("owner_email", e.target.value)}
              />
            </Field>
            <Field id="sub-phone" label={t("phone")} hint={t("phoneHint")}>
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
            <Field id="sub-org" label={t("workspace")} hint={t("workspaceHint")}>
              <Input
                value={form.organization_name}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => set("organization_name", e.target.value)}
              />
            </Field>
            {plans.data ? (
              <PlanAndDays
                idPrefix="sub"
                plans={plans.data}
                planCode={form.plan_code}
                days={form.days}
                openEnded={form.open_ended}
                error={touched ? errors.days : undefined}
                onPlan={(plan) =>
                  setForm((f) => ({
                    ...f,
                    plan_code: plan.code,
                    days: plan.default_days,
                    open_ended: plan.default_days === null,
                  }))
                }
                onDays={(d) => set("days", d)}
                onOpenEnded={(v) => set("open_ended", v)}
              />
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="sub-sector">{t("sector")}</Label>
              <select
                id="sub-sector"
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
              <Label htmlFor="sub-locale">{t("language")}</Label>
              <select
                id="sub-locale"
                className={selectClass}
                value={form.locale}
                onChange={(e) => set("locale", e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <Field id="sub-note" label={t("adminNote")} hint={t("adminNoteHint")}>
            <Textarea
              rows={2}
              value={form.admin_note}
              maxLength={2000}
              onChange={(e) => set("admin_note", e.target.value)}
            />
          </Field>
          <SendEmailRow
            id="sub-send"
            checked={form.send_email}
            available={emailAvailable}
            onChange={(v) => set("send_email", v)}
          />
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
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------- bulk results
export function BulkResultsDialog({
  result,
  onOpenChange,
  onShow,
  filename,
}: {
  result: BulkResult | null;
  onOpenChange: (open: boolean) => void;
  onShow: (message: AccountMessage) => void;
  filename: string;
}) {
  const t = useTranslations("admin.bulk");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  if (!result) return null;
  const error = (code: string | null) =>
    code && te.has(`codes.${code}`)
      ? te(`codes.${code}` as "codes.no_data")
      : t(`rowErrors.${code ?? "unknown"}` as "rowErrors.unknown");
  const download = () =>
    downloadText(
      filename,
      resultsCsv(
        [t("csv.row"), t("csv.name"), t("csv.email"), t("csv.status"), t("csv.link")],
        result.results.map((r) => [
          r.row,
          r.name,
          r.email,
          r.status === "error" ? error(r.error_code) : t(`status.${r.status}`),
          r.message?.link ?? "",
        ]),
      ),
    );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("resultsTitle")}</DialogTitle>
          <DialogDescription>
            {t("summary", { created: result.created, added: result.added, failed: result.failed })}
          </DialogDescription>
        </DialogHeader>
        <Alert variant="warning">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{t("linksOnce")}</AlertDescription>
        </Alert>
        <div className="max-h-[50dvh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">#</TableHead>
                <TableHead scope="col">{t("csv.name")}</TableHead>
                <TableHead scope="col">{t("csv.email")}</TableHead>
                <TableHead scope="col">{t("csv.status")}</TableHead>
                <TableHead scope="col">
                  <span className="visually-hidden">{t("message")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                  <TableCell>{r.name || "—"}</TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {r.email || "—"}
                  </TableCell>
                  <TableCell>
                    {r.status === "error" ? (
                      <span className="text-sm text-destructive">{error(r.error_code)}</span>
                    ) : (
                      <Badge variant={r.status === "created" ? "success" : "soft"}>
                        {t(`status.${r.status}`)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.message ? (
                      <Button size="sm" variant="ghost" onClick={() => onShow(r.message!)}>
                        <MessageSquareTextIcon aria-hidden="true" />
                        {t("message")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={download}>
            <DownloadIcon aria-hidden="true" />
            {t("download")}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Paste from Excel / Sheets or pick a CSV file: a preview of the people found. */
function PeopleInput({ text, onText, hint }: { text: string; onText: (text: string) => void; hint: string }) {
  const t = useTranslations("admin.bulk");
  const { rows, skipped } = parsePeople(text);
  return (
    <div className="grid gap-2">
      <Field id="bulk-text" label={t("paste")} hint={hint}>
        <Textarea
          rows={7}
          dir="ltr"
          value={text}
          placeholder={t("placeholder")}
          className="font-mono text-xs"
          onChange={(e) => onText(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-primary hover:underline">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="visually-hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) onText(await file.text());
              e.target.value = "";
            }}
          />
          {t("pickFile")}
        </label>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("found", { n: rows.length })}
          {skipped ? ` · ${t("skipped", { n: skipped })}` : ""}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------- bulk new subscribers
export function BulkSubscribersDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (result: BulkResult) => void;
}) {
  const t = useTranslations("admin.bulk");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const emailAvailable = useEmailAvailable(open);
  const [text, setText] = React.useState("");
  const [planCode, setPlanCode] = React.useState("");
  const [days, setDays] = React.useState<number | null>(null);
  const [openEnded, setOpenEnded] = React.useState(false);
  const [sector, setSector] = React.useState<Sector>("OTHER");
  const [lang, setLang] = React.useState<"ar" | "en">(locale);
  const [sendEmail, setSendEmail] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setText("");
    const first = plans.data?.find((p) => !p.is_archived && p.is_trial) ?? plans.data?.[0];
    setPlanCode(first?.code ?? "");
    setDays(first?.default_days ?? null);
    setOpenEnded(first ? first.default_days === null : false);
  }, [open, plans.data]);

  const rows = parsePeople(text).rows;
  const create = useMutation({
    mutationFn: () =>
      adminApi.bulkCreate({
        rows,
        plan_code: planCode,
        days: openEnded ? null : days,
        sector,
        locale: lang,
        send_email: sendEmail && emailAvailable,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      onDone(result);
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const daysError = !openEnded && (!days || days < 1 || days > 3650) ? tf("daysInvalid") : undefined;
  const ready = rows.length > 0 && rows.length <= 200 && !!planCode && !daysError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <PeopleInput text={text} onText={setText} hint={t("hintWorkspaces")} />
        {rows.length > 200 ? <p className="text-sm text-destructive">{t("tooMany")}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.data ? (
            <PlanAndDays
              idPrefix="bulk"
              plans={plans.data}
              planCode={planCode}
              days={days}
              openEnded={openEnded}
              error={daysError}
              onPlan={(plan) => {
                setPlanCode(plan.code);
                setDays(plan.default_days);
                setOpenEnded(plan.default_days === null);
              }}
              onDays={setDays}
              onOpenEnded={setOpenEnded}
            />
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="bulk-sector">{tf("sector")}</Label>
            <select
              id="bulk-sector"
              className={selectClass}
              value={sector}
              onChange={(e) => setSector(e.target.value as Sector)}
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {label(SECTOR_LABELS, s, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bulk-locale">{tf("language")}</Label>
            <select
              id="bulk-locale"
              className={selectClass}
              value={lang}
              onChange={(e) => setLang(e.target.value as "ar" | "en")}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <SendEmailRow id="bulk-send" checked={sendEmail} available={emailAvailable} onChange={setSendEmail} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner className="size-4" /> : null}
            {t("create", { n: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ add members
export function AddMembersDialog({
  orgId,
  open,
  onOpenChange,
  onDone,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (result: BulkResult) => void;
}) {
  const t = useTranslations("admin.bulk");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const emailAvailable = useEmailAvailable(open);
  const [text, setText] = React.useState("");
  const [role, setRole] = React.useState<Role>("VIEWER");
  const [sendEmail, setSendEmail] = React.useState(true);
  React.useEffect(() => {
    if (open) setText("");
  }, [open]);
  const rows = parsePeople(text).rows;
  const add = useMutation({
    mutationFn: () =>
      adminApi.addMembers(
        orgId,
        rows.map((r) => ({ name: r.name, email: r.email, role })),
        sendEmail && emailAvailable,
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriber", orgId] });
      onDone(result);
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("membersTitle")}</DialogTitle>
          <DialogDescription>{t("membersDescription")}</DialogDescription>
        </DialogHeader>
        <PeopleInput text={text} onText={setText} hint={t("hintMembers")} />
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="members-role">{tf("role")}</Label>
          <select
            id="members-role"
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {label(ROLE_LABELS, r, locale)}
              </option>
            ))}
          </select>
        </div>
        <SendEmailRow
          id="members-send"
          checked={sendEmail}
          available={emailAvailable}
          onChange={setSendEmail}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={!rows.length || rows.length > 200 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? <Spinner className="size-4" /> : null}
            {t("add", { n: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------- plan & limits
const LIMIT_KEYS = ["surveys", "responses_per_month", "members", "ai_daily_tokens"] as const;

export function SubscriptionDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: SubscriberDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.subscription");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const locale = useLocale();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const [planCode, setPlanCode] = React.useState(detail.subscription.plan_code);
  const [own, setOwn] = React.useState<Record<string, boolean>>({});
  const [values, setValues] = React.useState<Record<string, number | null>>({});
  const [unlimited, setUnlimited] = React.useState<Record<string, boolean>>({});
  const [endDate, setEndDate] = React.useState("");
  const [noEnd, setNoEnd] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPlanCode(detail.subscription.plan_code);
    const o = detail.overrides as Record<string, number | null>;
    setOwn(Object.fromEntries(LIMIT_KEYS.map((k) => [k, k in o])));
    setValues(Object.fromEntries(LIMIT_KEYS.map((k) => [k, o[k] ?? null])));
    setUnlimited(Object.fromEntries(LIMIT_KEYS.map((k) => [k, k in o && o[k] === null])));
    setEndDate(detail.subscription.period_ends_at ? detail.subscription.period_ends_at.slice(0, 10) : "");
    setNoEnd(!detail.subscription.period_ends_at);
  }, [open, detail]);

  const planChanged = planCode !== detail.subscription.plan_code;
  const save = useMutation({
    mutationFn: () => {
      const overrides: LimitOverrides = {};
      for (const k of LIMIT_KEYS) {
        if (own[k]) overrides[k] = unlimited[k] ? null : (values[k] ?? 0);
      }
      const started = detail.subscription.period_started_at !== null;
      return adminApi.updateSubscription(detail.organization_id, {
        ...(planChanged ? { plan_code: planCode } : {}),
        overrides,
        ...(started
          ? { period_ends_at: noEnd || !endDate ? null : new Date(`${endDate}T23:59:59`).toISOString() }
          : {}),
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", detail.organization_id], updated);
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      toast.success(t("saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const plan = plans.data?.find((p) => p.code === planCode);
  const planValue = (k: (typeof LIMIT_KEYS)[number]) =>
    plan
      ? {
          surveys: plan.max_surveys,
          responses_per_month: plan.max_responses_per_month,
          members: plan.max_members,
          ai_daily_tokens: plan.ai_daily_tokens,
        }[k]
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {plans.data ? (
            <div className="grid gap-2 sm:max-w-sm">
              <Label htmlFor="subscription-plan">{tf("plan")}</Label>
              <select
                id="subscription-plan"
                className={selectClass}
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
              >
                {plans.data
                  .filter((p) => !p.is_archived || p.code === detail.subscription.plan_code)
                  .map((p) => (
                    <option key={p.code} value={p.code}>
                      {planLabel(p, locale)}
                    </option>
                  ))}
              </select>
              {planChanged ? <p className="text-xs text-muted-foreground">{t("planChangeHint")}</p> : null}
            </div>
          ) : null}
          <fieldset className="grid gap-3 rounded-xl border p-4">
            <legend className="px-1 text-sm font-medium">{t("ownLimits")}</legend>
            {LIMIT_KEYS.map((k) => (
              <div key={k} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={!!own[k]} onCheckedChange={(v) => setOwn((s) => ({ ...s, [k]: v }))} />
                  <span>
                    {t(`limits.${k}`)}{" "}
                    <span className="text-muted-foreground">
                      ({t("fromPlan", { value: planValue(k) ?? t("unlimited") })})
                    </span>
                  </span>
                </label>
                <NumericInput
                  aria-label={t(`limits.${k}`)}
                  value={own[k] && !unlimited[k] ? (values[k] ?? null) : null}
                  disabled={!own[k] || !!unlimited[k]}
                  inputMode="numeric"
                  onValueChange={(n) => setValues((s) => ({ ...s, [k]: n }))}
                />
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={!!unlimited[k]}
                    disabled={!own[k]}
                    onCheckedChange={(v) => setUnlimited((s) => ({ ...s, [k]: v }))}
                  />
                  {t("unlimited")}
                </label>
              </div>
            ))}
          </fieldset>
          {detail.subscription.period_started_at ? (
            <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
              <Field id="subscription-end" label={t("endDate")} hint={t("endDateHint")}>
                <Input
                  type="date"
                  dir="ltr"
                  value={noEnd ? "" : endDate}
                  disabled={noEnd}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <Switch checked={noEnd} onCheckedChange={setNoEnd} />
                {tf("openEnded")}
              </label>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="size-4" /> : null}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ renew
export function RenewDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: SubscriberDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.renew");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const [planCode, setPlanCode] = React.useState(detail.subscription.plan_code);
  const [days, setDays] = React.useState<number | null>(365);
  const [openEnded, setOpenEnded] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const current = plans.data?.find((p) => p.code === detail.subscription.plan_code);
    setPlanCode(detail.subscription.plan_code);
    setDays(current?.default_days ?? 365);
    setOpenEnded(false);
  }, [open, detail, plans.data]);
  const renew = useMutation({
    mutationFn: () =>
      adminApi.renew(
        detail.organization_id,
        openEnded ? null : days,
        planCode !== detail.subscription.plan_code ? planCode : undefined,
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", detail.organization_id], updated);
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      toast.success(t("done"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const daysError = !openEnded && (!days || days < 1 || days > 3650) ? tf("daysInvalid") : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {plans.data ? (
            <PlanAndDays
              idPrefix="renew"
              plans={plans.data}
              planCode={planCode}
              days={days}
              openEnded={openEnded}
              error={daysError}
              onPlan={(plan) => {
                setPlanCode(plan.code);
                if (plan.default_days) setDays(plan.default_days);
              }}
              onDays={setDays}
              onOpenEnded={setOpenEnded}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={!!daysError || renew.isPending} onClick={() => renew.mutate()}>
            {renew.isPending ? <Spinner className="size-4" /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- suspend
export function SuspendDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: SubscriberDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.suspend");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const suspend = useMutation({
    mutationFn: () => adminApi.suspend(detail.organization_id, reason.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", detail.organization_id], updated);
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      toast.success(t("done"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { name: detail.organization_name })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Field id="suspend-reason" label={t("reason")} hint={t("reasonHint")}>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" disabled={suspend.isPending} onClick={() => suspend.mutate()}>
            {suspend.isPending ? <Spinner className="size-4" /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
