"use client";

import { Button, Input, Label } from "@meqyas/ui";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

/** Read-only value with a copy button (URLs, usernames, one-time secrets). Always LTR. */
export function CopyField({
  id,
  label,
  value,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
}) {
  const t = useTranslations("integrations");
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(id) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          dir="ltr"
          className="min-w-0 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void copy()}
          aria-label={`${t("copy")} — ${label}`}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <span className="max-sm:hidden">{t("copy")}</span>
        </Button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
