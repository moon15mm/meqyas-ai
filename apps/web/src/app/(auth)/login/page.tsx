"use client";

import { Alert, AlertDescription, Button, Field, Input, Spinner } from "@meqyas/ui";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useForm } from "react-hook-form";

import { PasswordInput } from "@/components/common/password-input";
import { useAuth } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

/** Optional «contact us» link for people without an account (e-mail, WhatsApp or a page). */
const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || "";

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const { login } = useAuth();
  const toMessage = useErrorMessage();
  const [error, setError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ mode: "onBlur" });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email.trim(), values.password);
    } catch (err) {
      setError(toMessage(err));
    }
  });

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("loginTitle")}</h1>
        <p className="text-muted-foreground">{t("loginSubtitle")}</p>
      </header>

      {error ? (
        <Alert variant="destructive" role="alert">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} method="post" noValidate className="grid gap-5">
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
        <Field
          id="password"
          label={t("password")}
          error={errors.password ? t("passwordRequired") : undefined}
          required
        >
          <PasswordInput
            autoComplete="current-password"
            required
            showLabel={t("showPassword")}
            {...register("password", { required: true })}
          />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t("forgotPassword")}
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {isSubmitting ? t("loggingIn") : t("login")}
        </Button>
      </form>

      {/* No self-registration: accounts come from the platform's administrators (SUBSCRIPTIONS.md). */}
      <p className="text-center text-sm text-muted-foreground text-pretty">
        {t("noAccount")} {t("accountsByInvitation")}
        {CONTACT_URL ? (
          <>
            {" "}
            <a href={CONTACT_URL} className="font-semibold text-primary hover:underline">
              {t("contactUs")}
            </a>
          </>
        ) : null}
      </p>

      {process.env.NODE_ENV !== "production" ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
          {t("demoHint")}
          <span dir="ltr" className="mt-1 flex flex-wrap justify-center gap-x-3 font-mono">
            <span className="whitespace-nowrap">demo@meqyas.example</span>
            <span className="whitespace-nowrap">Demo-Meqyas-2026</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
