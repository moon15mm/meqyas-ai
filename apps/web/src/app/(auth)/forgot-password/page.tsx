"use client";

import { Alert, AlertDescription, Button, Field, Input, Spinner } from "@meqyas/ui";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useForm } from "react-hook-form";

import { authApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const toMessage = useErrorMessage();
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ mode: "onBlur" });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(toMessage(err));
    }
  });

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("forgotTitle")}</h1>
        <p className="text-muted-foreground">{t("forgotSubtitle")}</p>
      </header>
      {sent ? (
        <Alert variant="evidence" role="status">
          <MailCheckIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t("resetSent")}</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} method="post" noValidate className="grid gap-5">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Field id="email" label={t("email")} error={errors.email ? t("emailInvalid") : undefined} required>
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              required
              {...register("email", { required: true, pattern: /^\S+@\S+\.\S+$/ })}
            />
          </Field>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {t("sendResetLink")}
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-muted-foreground text-pretty">{t("noEmailHelp")}</p>
      <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
