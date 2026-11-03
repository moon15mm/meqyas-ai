"use client";

import { Alert, AlertDescription, Button, Card, Field, Input, Skeleton, Spinner } from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  ClockIcon,
  GiftIcon,
  InfoIcon,
  LayoutGridIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";

import { BrandMark, BrandName } from "@/components/common/brand";
import { PasswordInput } from "@/components/common/password-input";
import { giftApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export default function GiftClaimPage() {
  const t = useTranslations("giftClaim");
  const ta = useTranslations("auth");
  const tm = useTranslations("meta");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status, user, adoptSession } = useAuth();
  const toMessage = useErrorMessage();
  const valid = TOKEN.test(token ?? "");
  const preview = useQuery({
    queryKey: ["gift-preview", token],
    queryFn: () => giftApi.preview(token),
    enabled: valid,
    retry: false,
  });
  const [fullName, setFullName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (preview.data?.recipient_name) setFullName((current) => current || preview.data?.recipient_name || "");
  }, [preview.data?.recipient_name]);

  const gift = preview.data;
  const state = !valid ? "invalid" : gift?.state;
  const passwordError = touched && password.length < 10 ? ta("passwordTooShort") : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (password.length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await giftApi.claim(token, password, fullName.trim() || undefined);
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
        ) : state !== "valid" || !gift ? (
          <Card className="grid gap-4 p-6 text-center sm:p-8">
            <GiftIcon className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-lg font-semibold">
              {t(`states.${state === "used" || state === "expired" ? state : "invalid"}`)}
            </p>
            <Button asChild variant="outline" className="justify-self-center">
              <Link href="/login">{t("toLogin")}</Link>
            </Button>
          </Card>
        ) : (
          <Card className="grid gap-6 p-6 sm:p-8">
            <div className="grid gap-2 text-center">
              <span className="brand-gradient mx-auto grid size-14 place-items-center rounded-2xl text-white shadow-md">
                <GiftIcon className="size-7" aria-hidden="true" />
              </span>
              <h1 className="text-2xl font-bold text-balance">
                {t("title", { name: gift.recipient_name ?? "" })}
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
            </div>
            {gift.note ? (
              <blockquote className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-pretty">
                {gift.note}
              </blockquote>
            ) : null}
            <ul className="grid gap-2 text-sm">
              {gift.organization_name ? (
                <li className="flex items-center gap-2">
                  <LayoutGridIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {t("workspace", { name: gift.organization_name })}
                </li>
              ) : null}
              <li className="flex items-center gap-2">
                <ClipboardListIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                {t("surveys", { n: gift.survey_limit ?? 0 })}
              </li>
              {gift.trial_days ? (
                <li className="flex items-center gap-2">
                  <ClockIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {t("trial", { days: gift.trial_days })}
                </li>
              ) : null}
            </ul>
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
              <Field id="gift-email" label={ta("email")} hint={t("emailHint")}>
                <Input value={gift.email ?? ""} readOnly dir="ltr" autoComplete="username" />
              </Field>
              <Field id="gift-full-name" label={ta("fullName")}>
                <Input
                  value={fullName}
                  maxLength={200}
                  autoComplete="name"
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
              <Field
                id="gift-password"
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
