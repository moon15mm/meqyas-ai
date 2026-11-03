"use client";

import type { AccountMessage } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@meqyas/ui";
import { CheckIcon, CopyIcon, LinkIcon, MailIcon, MessageCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

/** wa.me wants international digits only: Arabic-Indic digits, +, 00 and a Saudi 05… prefix are normalized. */
export function whatsappNumber(phone: string): string | null {
  const digits = phone
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
    .replace(/^00/, "");
  if (!digits) return null;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  return digits.length >= 8 ? digits : null;
}

/** A message prepared for one person (gift, invitation, activation or recovery link). */
export interface ShareableMessage {
  recipientName: string;
  recipientEmail: string;
  locale: "ar" | "en";
  subject: string;
  body: string;
  link: string;
  emailed: boolean;
  emailAvailable: boolean;
  /** What the link is: one-time links are never shown again, so the dialog says so. */
  kind: "activation" | "reset" | "sign_in";
}

export function fromAccountMessage(message: AccountMessage): ShareableMessage {
  return {
    recipientName: message.recipient_name,
    recipientEmail: message.recipient_email,
    locale: message.locale,
    subject: message.subject,
    body: message.body,
    link: message.link,
    emailed: message.emailed,
    emailAvailable: message.email_available,
    kind: message.kind,
  };
}

export function ShareMessageDialog({
  message,
  phone = "",
  title,
  onOpenChange,
}: {
  message: ShareableMessage | null;
  phone?: string;
  title?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("share");
  const tc = useTranslations("common");
  const [copied, setCopied] = React.useState<"body" | "link" | null>(null);
  React.useEffect(() => setCopied(null), [message]);
  const copyRef = React.useRef<HTMLButtonElement>(null);
  if (!message) return null;
  const wa = whatsappNumber(phone);
  const dir = message.locale === "ar" ? "rtl" : "ltr";
  const copy = async (what: "body" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "body" ? message.body : message.link);
      setCopied(what);
      toast.success(t(what === "body" ? "copiedBody" : "copiedLink"));
    } catch {
      document.getElementById("share-message-text")?.focus();
    }
  };
  const mailto = `mailto:${message.recipientEmail}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
  const whatsapp = `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message.body)}`;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={tc("close")}
        className="max-w-2xl"
        onOpenAutoFocus={(e) => {
          // Focus the main action, not the message (focusing it would select all of it).
          e.preventDefault();
          copyRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title ?? t("title", { name: message.recipientName })}</DialogTitle>
          <DialogDescription>
            {message.emailed
              ? t("emailed", { email: message.recipientEmail })
              : message.emailAvailable
                ? t("notEmailed")
                : t("noEmail")}
          </DialogDescription>
        </DialogHeader>
        {message.kind !== "sign_in" ? (
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>{t(message.kind === "reset" ? "onceReset" : "once")}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="share-message-text">{message.subject}</Label>
          <Textarea
            id="share-message-text"
            readOnly
            dir={dir}
            rows={14}
            value={message.body}
            onFocus={(e) => e.currentTarget.select()}
            className="font-sans text-sm leading-relaxed"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button ref={copyRef} onClick={() => void copy("body")}>
            {copied === "body" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {t("copyBody")}
          </Button>
          <Button asChild variant="outline">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircleIcon aria-hidden="true" />
              {wa ? t("whatsappTo") : t("whatsapp")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={mailto}>
              <MailIcon aria-hidden="true" />
              {t("mail")}
            </a>
          </Button>
          <Button variant="ghost" onClick={() => void copy("link")}>
            {copied === "link" ? <CheckIcon aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
            {t("copyLink")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
