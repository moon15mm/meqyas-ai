"use client";

import type { Gift, GiftMessage, GiftState } from "@meqyas/shared";
import { Alert, AlertDescription, Badge, Button, Card, Skeleton } from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, GiftIcon, MailCheckIcon, PlusIcon, RefreshCwIcon, ShieldIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { GiftMessageDialog, NewGiftDialog } from "@/components/gifts/gift-dialogs";
import { useFormatters } from "@/components/responses/response-format";
import { giftApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const STATE_VARIANT: Record<GiftState, "soft" | "success" | "warning" | "outline"> = {
  pending: "soft",
  active: "success",
  expired: "warning",
  revoked: "outline",
};

function GiftCard({ gift, onMessage }: { gift: Gift; onMessage: (message: GiftMessage) => void }) {
  const t = useTranslations("gifts");
  const fmt = useFormatters();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const resend = useMutation({
    mutationFn: () => giftApi.resend(gift.id, false),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: ["gifts"] });
      onMessage(message);
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: () => giftApi.revoke(gift.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gifts"] });
      toast.success(t("revoked"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const waiting = gift.state === "pending" || gift.state === "expired";
  return (
    <li className="grid content-start gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-semibold text-pretty">{gift.recipient_name}</span>
          <span className="truncate text-xs text-muted-foreground" dir="ltr">
            {gift.recipient_email}
          </span>
        </div>
        <Badge variant={STATE_VARIANT[gift.state]}>{t(`states.${gift.state}`)}</Badge>
      </div>
      <dl className="grid gap-1 text-sm">
        {gift.organization_name ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("workspace")}:</dt>
            <dd className="min-w-0 truncate">{gift.organization_name}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("surveys")}:</dt>
          <dd>{t("surveysUsed", { used: gift.surveys_published, limit: gift.survey_limit })}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("trial")}:</dt>
          <dd>
            {gift.trial_ends_at
              ? t("trialEnds", { date: fmt.dateTime(gift.trial_ends_at) })
              : gift.trial_days
                ? t("trialDays", { days: gift.trial_days })
                : t("noTrialLimit")}
          </dd>
        </div>
      </dl>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("created", { date: fmt.dateTime(gift.created_at) })}</span>
        {gift.emailed_at ? (
          <span className="flex items-center gap-1">
            <MailCheckIcon className="size-3.5" aria-hidden="true" />
            {t("emailed")}
          </span>
        ) : null}
        {gift.last_login_at ? (
          <span>{t("lastLogin", { date: fmt.dateTime(gift.last_login_at) })}</span>
        ) : null}
        {!gift.new_account ? <span>{t("existingAccount")}</span> : null}
      </p>
      {gift.state !== "revoked" ? (
        <div className="flex flex-wrap gap-1 border-t pt-3">
          <Button size="sm" variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate()}>
            <RefreshCwIcon aria-hidden="true" />
            {waiting ? t("newLink") : t("messageAgain")}
          </Button>
          {waiting ? (
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              disabled={revoke.isPending}
              onClick={() => {
                if (window.confirm(t("revokeConfirm", { name: gift.recipient_name }))) revoke.mutate();
              }}
            >
              <BanIcon aria-hidden="true" />
              {t("revoke")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function GiftsPage() {
  const t = useTranslations("gifts");
  const { user } = useAuth();
  const [formOpen, setFormOpen] = React.useState(false);
  const [message, setMessage] = React.useState<{ message: GiftMessage; phone: string } | null>(null);
  const admin = !!user?.is_platform_admin;
  const gifts = useQuery({ queryKey: ["gifts"], queryFn: giftApi.list, enabled: admin });

  if (!admin) {
    return (
      <Card className="mx-auto grid max-w-xl place-items-center gap-3 p-10 text-center">
        <ShieldIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t("adminOnly")}</p>
      </Card>
    );
  }

  const items = gifts.data ?? [];
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <PlusIcon aria-hidden="true" />
          {t("new")}
        </Button>
      </div>

      {gifts.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadFailed")}</AlertDescription>
        </Alert>
      ) : gifts.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !items.length ? (
        <Card className="grid gap-5 p-6 text-center sm:p-8">
          <GiftIcon className="mx-auto size-10 text-primary" aria-hidden="true" />
          <div className="grid gap-2">
            <p className="text-lg font-semibold">{t("empty.title")}</p>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground text-pretty">{t("empty.body")}</p>
          </div>
          <ol className="grid gap-3 text-start sm:grid-cols-3">
            {(["fill", "send", "start"] as const).map((step, i) => (
              <li key={step} className="grid gap-1 rounded-xl border p-4">
                <span className="text-xs font-semibold text-primary">{t("empty.step", { n: i + 1 })}</span>
                <span className="font-medium">{t(`empty.steps.${step}.title`)}</span>
                <span className="text-sm text-muted-foreground text-pretty">
                  {t(`empty.steps.${step}.body`)}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex justify-center">
            <Button onClick={() => setFormOpen(true)}>
              <PlusIcon aria-hidden="true" />
              {t("new")}
            </Button>
          </div>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((gift) => (
            <GiftCard key={gift.id} gift={gift} onMessage={(m) => setMessage({ message: m, phone: "" })} />
          ))}
        </ul>
      )}

      <NewGiftDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(m, phone) => setMessage({ message: m, phone })}
      />
      <GiftMessageDialog
        message={message?.message ?? null}
        phone={message?.phone ?? ""}
        onOpenChange={(open) => !open && setMessage(null)}
      />
    </div>
  );
}
