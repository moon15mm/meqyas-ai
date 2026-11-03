"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Spinner,
} from "@meqyas/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/common/password-input";
import { authApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

/** Change one's own password (the current one proves it); other devices are signed out. */
export function ChangePasswordCard() {
  const t = useTranslations("settings.password");
  const ta = useTranslations("auth");
  const toMessage = useErrorMessage();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
      toast.success(t("done"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const errors = {
    current: !current ? ta("passwordRequired") : undefined,
    next: next.length < 10 ? ta("passwordTooShort") : undefined,
    confirm: confirm !== next ? t("mismatch") : undefined,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!Object.values(errors).some(Boolean)) change.mutate();
          }}
        >
          <Field id="pw-current" label={t("current")} error={touched ? errors.current : undefined} required>
            <PasswordInput
              autoComplete="current-password"
              value={current}
              showLabel={ta("showPassword")}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            id="pw-new"
            label={ta("newPassword")}
            hint={ta("passwordHint")}
            error={touched ? errors.next : undefined}
            required
          >
            <PasswordInput
              autoComplete="new-password"
              minLength={10}
              value={next}
              showLabel={ta("showPassword")}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field id="pw-confirm" label={t("confirm")} error={touched ? errors.confirm : undefined} required>
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              showLabel={ta("showPassword")}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={change.isPending}>
            {change.isPending ? <Spinner /> : null}
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
