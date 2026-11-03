"use client";

import { Alert, AlertDescription, Button, Field, Spinner } from "@meqyas/ui";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useForm } from "react-hook-form";

import { PasswordInput } from "@/components/common/password-input";
import { authApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

function ResetForm() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const toMessage = useErrorMessage();
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(token ? null : t("invalidResetToken"));
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ password: string }>({ mode: "onBlur" });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(toMessage(err));
    }
  });

  if (done) {
    return (
      <Alert variant="evidence" role="status">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertDescription className="text-foreground">{t("resetDone")}</AlertDescription>
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} method="post" noValidate className="grid gap-5">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Field
        id="password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        error={errors.password ? t("passwordTooShort") : undefined}
        required
      >
        <PasswordInput
          autoComplete="new-password"
          minLength={10}
          required
          showLabel={t("showPassword")}
          {...register("password", { required: true, minLength: 10 })}
        />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting || !token}>
        {isSubmitting ? <Spinner /> : null}
        {t("resetPassword")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("resetTitle")}</h1>
      </header>
      <React.Suspense>
        <ResetForm />
      </React.Suspense>
      <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
