"use client";

import { label, SECTOR_LABELS, SECTORS, type Sector } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, PlugZapIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { MembersPanel } from "@/components/settings/members-panel";
import { useSubscription } from "@/components/subscription/subscription";
import { PlanSummaryCard } from "@/components/subscription/plan-summary";
import { aiApi, authApi, orgApi } from "@/lib/api/endpoints";
import { useAuth, useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { setLocaleCookie } from "@/lib/preferences";

function ProfileTab() {
  const t = useTranslations("settings");
  const ta = useTranslations("auth");
  const tc = useTranslations("common");
  const { user, reloadMe } = useAuth();
  const router = useRouter();
  const toMessage = useErrorMessage();
  const [name, setName] = React.useState(user?.full_name ?? "");
  const [lang, setLang] = React.useState<"ar" | "en">(user?.locale ?? "ar");
  const save = useMutation({
    mutationFn: () => authApi.updateMe({ full_name: name.trim(), locale: lang }),
    onSuccess: async () => {
      await reloadMe();
      setLocaleCookie(lang);
      router.refresh();
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="pf-name" label={ta("fullName")} required>
            <Input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              required
            />
          </Field>
          <Field id="pf-email" label={ta("email")}>
            <Input value={user?.email ?? ""} readOnly dir="ltr" />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{tc("language")}</legend>
            <div className="flex gap-4">
              {(["ar", "en"] as const).map((l) => (
                <label key={l} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="lang"
                    value={l}
                    checked={lang === l}
                    onChange={() => setLang(l)}
                    className="accent-[var(--primary)]"
                  />
                  {l === "ar" ? "العربية" : "English"}
                </label>
              ))}
            </div>
          </fieldset>
          <Button
            type="submit"
            className="justify-self-start"
            disabled={save.isPending || name.trim().length < 2}
          >
            {save.isPending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OrganizationTab() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const { activeOrg, reloadMe } = useAuth();
  const can = useCan();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const orgId = activeOrg?.organization_id ?? "";
  const org = useQuery({ queryKey: ["org", orgId], queryFn: () => orgApi.get(orgId), enabled: !!orgId });
  const [name, setName] = React.useState("");
  const [sector, setSector] = React.useState<Sector>("EDUCATION");
  const [allowCloud, setAllowCloud] = React.useState(true);

  React.useEffect(() => {
    if (org.data) {
      setName(org.data.name);
      setSector(org.data.sector);
      setAllowCloud(org.data.settings?.ai?.allow_cloud_ai ?? true);
    }
  }, [org.data]);

  const save = useMutation({
    mutationFn: () =>
      orgApi.update(orgId, { name: name.trim(), sector, settings: { ai: { allow_cloud_ai: allowCloud } } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org", orgId] });
      await reloadMe();
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (!org.data) return <Skeleton className="h-64 rounded-2xl" />;
  const readOnly = !can.manageOrg;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("organization")}</CardTitle>
        {readOnly ? <CardDescription>{t("readOnly")}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-lg gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={readOnly} className="grid gap-5">
            <Field id="org-name" label={t("orgName")} required>
              <Input
                autoComplete="organization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </Field>
            <div className="grid gap-2">
              <span id="org-sector" className="text-sm font-medium">
                {t("sector")}
              </span>
              <Select
                value={sector}
                onValueChange={(v) => setSector(v as Sector)}
                dir={locale === "ar" ? "rtl" : "ltr"}
                disabled={readOnly}
              >
                <SelectTrigger aria-labelledby="org-sector">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTORS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(SECTOR_LABELS, s, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <div className="grid gap-1">
                <Label htmlFor="org-cloud">{t("allowCloudAI")}</Label>
                <p id="org-cloud-hint" className="text-xs text-muted-foreground">
                  {t("allowCloudAIHint")}
                </p>
              </div>
              <Switch
                id="org-cloud"
                aria-describedby="org-cloud-hint"
                checked={allowCloud}
                onCheckedChange={setAllowCloud}
                disabled={readOnly}
              />
            </div>
            <Button type="submit" className="justify-self-start" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {tc("save")}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function WorkspacePlan() {
  const sub = useSubscription();
  return sub ? <PlanSummaryCard sub={sub} /> : null;
}

function AITab() {
  const t = useTranslations("settings");
  const format = useFormatter();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => aiApi.status() });
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: () => aiApi.usage() });
  const check = useMutation({ mutationFn: () => aiApi.status(true) });
  const s = status.data;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("ai")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {s ? (
            <dl className="grid gap-3">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiStatus")}</dt>
                <dd>
                  <Badge variant={s.configured ? "success" : "warning"}>
                    {s.configured ? t("aiConfigured") : t("aiNotConfigured")}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiProvider")}</dt>
                <dd dir="ltr" className="font-mono">
                  {s.provider_label ?? s.provider ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiFast")}</dt>
                <dd dir="ltr" className="font-mono">
                  {s.model_fast ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiSmart")}</dt>
                <dd dir="ltr" className="font-mono">
                  {s.model_smart ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiFallback")}</dt>
                <dd className="text-end">
                  {s.fallback_configured ? (
                    <span dir="ltr" className="font-mono">
                      {s.fallback_provider_label} · {s.fallback_model_fast} / {s.fallback_model_smart}
                    </span>
                  ) : (
                    t("aiFallbackNone")
                  )}
                </dd>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">{t("aiFallbackHint")}</p>
              {s.fallback_reason ? (
                <p className="rounded-lg bg-warning/10 p-3 text-xs" dir="ltr">
                  {s.fallback_reason}
                </p>
              ) : null}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("aiLocal")}</dt>
                <dd>{s.local_enabled ? t("aiLocalEnabled") : t("aiLocalDisabled")}</dd>
              </div>
              {s.reason ? (
                <p className="rounded-lg bg-warning/10 p-3 text-xs" dir="ltr">
                  {s.reason}
                </p>
              ) : null}
            </dl>
          ) : (
            <Skeleton className="h-32" />
          )}
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={() => check.mutate()}
            disabled={check.isPending || !s?.configured}
          >
            {check.isPending ? <Spinner /> : <PlugZapIcon aria-hidden="true" />}
            {t("checkConnection")}
          </Button>
          {check.data ? (
            <p
              className={
                check.data.healthy
                  ? "flex items-center gap-2 text-success"
                  : "flex items-center gap-2 text-destructive"
              }
              role="status"
            >
              {check.data.healthy ? (
                <CheckCircle2Icon className="size-4" aria-hidden="true" />
              ) : (
                <XCircleIcon className="size-4" aria-hidden="true" />
              )}
              {check.data.healthy
                ? t("connectionOk")
                : `${t("connectionFailed")}: ${check.data.health_detail ?? ""}`}
            </p>
          ) : null}
          {check.data?.fallback_configured ? (
            <p
              className={
                check.data.fallback_healthy
                  ? "flex items-center gap-2 text-success"
                  : "flex items-center gap-2 text-destructive"
              }
              role="status"
            >
              {check.data.fallback_healthy ? (
                <CheckCircle2Icon className="size-4" aria-hidden="true" />
              ) : (
                <XCircleIcon className="size-4" aria-hidden="true" />
              )}
              {t("aiFallback")}:{" "}
              {check.data.fallback_healthy
                ? t("connectionOk")
                : `${t("connectionFailed")}: ${check.data.fallback_health_detail ?? ""}`}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("aiUsageToday")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {usage.data ? (
            <>
              <Progress
                value={(usage.data.today_tokens / Math.max(1, usage.data.daily_limit)) * 100}
                aria-label={t("aiUsageToday")}
              />
              <p className="text-sm tabular-nums">
                {t("aiTokens", {
                  used: format.number(usage.data.today_tokens),
                  limit: format.number(usage.data.daily_limit),
                })}
              </p>
              <p className="text-sm text-muted-foreground">{t("aiRuns", { n: usage.data.runs_today })}</p>
            </>
          ) : (
            <Skeleton className="h-16" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const locale = useLocale();
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <Tabs defaultValue="profile" dir={locale === "ar" ? "rtl" : "ltr"} className="grid gap-5">
        <TabsList className="scroll-x-hidden w-full justify-start sm:w-fit">
          <TabsTrigger value="profile">{t("profile")}</TabsTrigger>
          <TabsTrigger value="organization">{t("organization")}</TabsTrigger>
          <TabsTrigger value="members">{t("members")}</TabsTrigger>
          <TabsTrigger value="ai">{t("ai")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="grid gap-6">
          <ProfileTab />
          <ChangePasswordCard />
        </TabsContent>
        <TabsContent value="organization" className="grid gap-6">
          <WorkspacePlan />
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="members">
          <MembersPanel />
        </TabsContent>
        <TabsContent value="ai">
          <AITab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
