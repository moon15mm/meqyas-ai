"use client";

import { Alert, AlertDescription, Button, Card, Field, Input, Skeleton, Spinner } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, InfoIcon, KeyRoundIcon, LayoutGridIcon, UserRoundCheckIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";

import { BrandMark, BrandName } from "@/components/common/brand";
import { PasswordInput } from "@/components/common/password-input";
import { authApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

/** A new account chooses its password from its one-time activation link (SUBSCRIPTIONS.md §4). */
export default function ActivatePage() {
  const t = useTranslations("activate");
  const ta = useTranslations("auth");
  const tm = useTranslations("meta");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status, user, adoptSession } = useAuth();
  const toMessage = useErrorMessage();
  const valid = TOKEN.test(token ?? "");
  const preview = useQuery({
    queryKey: ["activation-preview", token],
    queryFn: () => authApi.activationPreview(token),
    enabled: valid,
    retry: false,
  });
  const [fullName, setFullName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (preview.data?.full_name) setFullName((current) => current || preview.data?.full_name || "");
  }, [preview.data?.full_name]);

  const account = preview.data;
  const state = !valid ? "invalid" : account?.state;
  const passwordError = touched && password.length < 10 ? ta("passwordTooShort") : undefined;
  const confirmError = touched && confirm !== password ? t("mismatch") : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (password.length < 10 || confirm !== password) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await authApi.activate(token, password, fullName.trim() || undefined);
      adoptSession(session);
      router.replace("/");
    } catch (err) {
      setError(toMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <main id="content" className="flex min-h-dvh flex-col px-5 py-8 sm:px-10">
      <div className="flex items-center gap-3">
        <BrandMark />
        <BrandName tagline={tm("tagline")} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-10">
        {valid && preview.isLoading ? (
          <Skeleton className="h-96 rounded-3xl" />
        ) : state !== "valid" || !account ? (
          <Card className="grid gap-4 p-6 text-center sm:p-8">
            <KeyRoundIcon className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-lg font-semibold text-balance">
              {t(`states.${state === "used" || state === "expired" ? state : "invalid"}`)}
            </p>
            <p className="text-sm text-muted-foreground text-pretty">{t("askAgain")}</p>
            <Button asChild variant="outline" className="justify-self-center">
              <Link href="/login">{t("toLogin")}</Link>
            </Button>
          </Card>
        ) : (
          <Card className="grid gap-6 p-6 sm:p-8">
            <div className="grid gap-2 text-center">
              <span className="brand-gradient mx-auto grid size-14 place-items-center rounded-2xl text-white shadow-md">
                <UserRoundCheckIcon className="size-7" aria-hidden="true" />
              </span>
              <h1 className="text-2xl font-bold text-balance">
                {t("title", { name: account.full_name ?? "" })}
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
            </div>
            {account.organization_name ? (
              <p className="flex items-center justify-center gap-2 text-sm">
                <LayoutGridIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                {t("workspace", { name: account.organization_name })}
              </p>
            ) : null}
            {status === "authenticated" && user ? (
              <Alert variant="info">
                <InfoIcon aria-hidden="true" />
                <AlertDescription>{t("signedInAs", { email: user.email })}</AlertDescription>
              </Alert>
            ) : null}
            <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Field id="activate-email" label={ta("email")} hint={t("emailHint")}>
                <Input value={account.email ?? ""} readOnly dir="ltr" autoComplete="username" />
              </Field>
              <Field id="activate-name" label={ta("fullName")}>
                <Input
                  value={fullName}
                  maxLength={200}
                  autoComplete="name"
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
              <Field
                id="activate-password"
                label={t("password")}
                hint={ta("passwordHint")}
                error={passwordError}
                required
              >
                <PasswordInput
                  autoComplete="new-password"
                  minLength={10}
                  required
                  value={password}
                  showLabel={ta("showPassword")}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field id="activate-confirm" label={t("confirm")} error={confirmError} required>
                <PasswordInput
                  autoComplete="new-password"
                  required
                  value={confirm}
                  showLabel={ta("showPassword")}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" disabled={submitting}>
                {submitting ? <Spinner /> : <CheckCircle2Icon aria-hidden="true" />}
                {t("submit")}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
