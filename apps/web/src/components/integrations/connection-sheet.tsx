"use client";

import type { InvitationStatus, StoreConnection, StoreOrderResult } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConicalIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { useFormatters } from "@/components/responses/response-format";
import { storeApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

import { PLATFORM_OWNS_SECRET } from "./connection-form";
import { CopyField } from "./copy-field";

/** The documented Custom-format body (also used by "Send a test order"). */
const CUSTOM_SAMPLE = JSON.stringify(
  {
    event: "order.delivered",
    order: {
      id: "1001",
      status: "delivered",
      locale: "ar",
      customer: { id: "c-77", email: "customer@example.com" },
      items: [{ id: "p-12", name: "Product name", sku: "SKU-12", quantity: 1 }],
    },
  },
  null,
  2,
);

const INVITATION_VARIANT: Record<
  InvitationStatus,
  "success" | "warning" | "destructive" | "outline" | "soft"
> = {
  READY: "soft",
  SCHEDULED: "outline",
  SENT: "soft",
  OPENED: "warning",
  RESPONDED: "success",
  EXPIRED: "outline",
  CANCELLED: "outline",
  OPTED_OUT: "destructive",
};

function SetupTab({ connection, secret }: { connection: StoreConnection; secret: string | null }) {
  const t = useTranslations("integrations");
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [shown, setShown] = React.useState<string | null>(secret);
  const [pasted, setPasted] = React.useState("");
  const [test, setTest] = React.useState<StoreOrderResult | null>(null);
  React.useEffect(() => setShown(secret), [secret]);
  const ownsSecret = PLATFORM_OWNS_SECRET.has(connection.platform);
  const steps = t.raw(`platforms.${connection.platform}.steps`) as string[];

  const rotate = useMutation({
    mutationFn: (value: string | null) => storeApi.rotateSecret(connection.id, value),
    onSuccess: (res, value) => {
      void queryClient.invalidateQueries({ queryKey: ["store-connections", connection.project_id] });
      setShown(value ? null : res.secret);
      setPasted("");
      toast.success(value ? t("setup.secretSaved") : t("setup.secretRotated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const sendTest = useMutation({
    mutationFn: () => storeApi.test(connection.id),
    onSuccess: (res) => {
      setTest(res);
      void queryClient.invalidateQueries({ queryKey: ["store-connections", connection.project_id] });
      void queryClient.invalidateQueries({ queryKey: ["store-connection", connection.id] });
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <div className="grid gap-5">
      <ol className="grid list-decimal gap-2 ps-5 text-sm leading-relaxed marker:text-muted-foreground">
        {steps.map((step, i) => (
          <li key={i} className="text-pretty">
            {step}
          </li>
        ))}
      </ol>

      {connection.platform === "CUSTOM" ? (
        <figure className="grid gap-1.5">
          <figcaption className="text-sm font-medium">{t("setup.customSample")}</figcaption>
          <pre dir="ltr" className="overflow-x-auto rounded-xl bg-muted p-3 text-xs leading-relaxed">
            {CUSTOM_SAMPLE}
          </pre>
        </figure>
      ) : null}

      <CopyField
        id={`hook-${connection.id}`}
        label={t("setup.webhookUrl")}
        value={connection.webhook_url}
        hint={t("setup.webhookUrlHint")}
      />
      {connection.auth_username ? (
        <CopyField
          id={`user-${connection.id}`}
          label={t("setup.username")}
          value={connection.auth_username}
        />
      ) : null}

      {shown ? (
        <Alert variant="warning">
          <KeyRoundIcon aria-hidden="true" />
          <AlertTitle>{t("setup.secretOnce")}</AlertTitle>
          <AlertDescription className="grid gap-2">
            <CopyField id={`secret-${connection.id}`} label={t("setup.secret")} value={shown} />
          </AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheckIcon className="size-4" aria-hidden="true" />
          {t("setup.secretStored", { hint: connection.secret_hint })}
        </p>
      )}

      {can.manageIntegrations ? (
        <div className="grid gap-3 rounded-xl border p-3">
          {ownsSecret ? (
            <form
              className="grid gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (pasted.trim().length >= 8) rotate.mutate(pasted.trim());
              }}
            >
              <Label htmlFor={`paste-${connection.id}`}>
                {t("form.platformSecret", { platform: t(`platforms.${connection.platform}.name`) })}
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`paste-${connection.id}`}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 font-mono text-xs"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={rotate.isPending || pasted.trim().length < 8}
                >
                  {t("setup.saveSecret")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("setup.rotateHint")}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={rotate.isPending}
                onClick={() => {
                  if (window.confirm(t("setup.rotateConfirm"))) rotate.mutate(null);
                }}
              >
                {t("setup.rotate")}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-sm text-muted-foreground">{t("setup.testHint")}</p>
            <Button size="sm" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
              <FlaskConicalIcon aria-hidden="true" />
              {t("setup.test")}
            </Button>
          </div>
          {test ? (
            <div role="status" className="grid gap-2 text-sm">
              <p className="font-medium">{t(`reasons.${test.reason}`)}</p>
              {test.invitations.map((inv, i) => (
                <CopyField
                  key={inv.url}
                  id={`test-${connection.id}-${i}`}
                  label={
                    inv.product ? t("setup.testProduct", { product: inv.product }) : t("setup.testStore")
                  }
                  value={inv.url}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InvitationsTab({ connection }: { connection: StoreConnection }) {
  const t = useTranslations("integrations");
  const fmt = useFormatters();
  const can = useCan();
  const list = useQuery({
    queryKey: ["store-invitations", connection.id],
    queryFn: () => storeApi.invitations(connection.id),
    enabled: can.readResponses,
  });
  if (!can.readResponses) return <p className="text-sm text-muted-foreground">{t("invitations.noAccess")}</p>;
  if (list.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  const items = list.data ?? [];
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("invitations.empty")}</p>;
  return (
    <ul className="grid gap-2">
      {items.map((inv) => (
        <li key={inv.id} className="grid gap-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{inv.product ?? t("invitations.storeExperience")}</span>
            <span className="flex items-center gap-1.5">
              {inv.is_test ? <Badge variant="outline">{t("invitations.test")}</Badge> : null}
              <Badge variant={INVITATION_VARIANT[inv.status]}>{t(`invitationStatus.${inv.status}`)}</Badge>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("invitations.created", { date: fmt.dateTime(inv.created_at) })}
            {inv.responded_at
              ? ` · ${t("invitations.responded", { date: fmt.dateTime(inv.responded_at) })}`
              : ""}
          </p>
          {["READY", "SENT", "OPENED", "SCHEDULED"].includes(inv.status) ? (
            <CopyField id={`inv-${inv.id}`} label={t("invitations.link")} value={inv.url} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EventsTab({ connection }: { connection: StoreConnection }) {
  const t = useTranslations("integrations");
  const fmt = useFormatters();
  const list = useQuery({
    queryKey: ["store-events", connection.id],
    queryFn: () => storeApi.events(connection.id),
  });
  if (list.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  const items = list.data ?? [];
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("events.empty")}</p>;
  const variant = {
    ACCEPTED: "success",
    DUPLICATE: "outline",
    IGNORED: "soft",
    REJECTED: "destructive",
  } as const;
  return (
    <ul className="grid gap-2">
      {items.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border p-3 text-sm"
        >
          <span className="grid gap-0.5">
            <span>{e.reason ? t(`reasons.${e.reason}`) : e.event}</span>
            <span className="text-xs text-muted-foreground">
              <time dateTime={e.created_at}>{fmt.dateTime(e.created_at)}</time>
              {e.event ? (
                <>
                  {" · "}
                  <bdi dir="ltr" className="font-mono">
                    {e.event}
                  </bdi>
                </>
              ) : null}
              {e.invitations_created ? ` · ${t("events.created", { count: e.invitations_created })}` : ""}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {e.is_test ? <Badge variant="outline">{t("invitations.test")}</Badge> : null}
            <Badge variant={variant[e.status]}>{t(`eventStatus.${e.status}`)}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ConnectionSheet({
  connection,
  secret,
  open,
  onOpenChange,
}: {
  connection: StoreConnection | null;
  /** One-time secret right after creation/rotation. */
  secret: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("integrations");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-[min(96vw,36rem)] overflow-y-auto p-0" closeLabel={t("close")}>
        {connection ? (
          <>
            <SheetHeader className="border-b px-5 pt-5 pb-4">
              <SheetTitle>{connection.name}</SheetTitle>
              <SheetDescription>{t(`platforms.${connection.platform}.name`)}</SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="setup" className="grid gap-4 px-5 pt-4 pb-6">
              <TabsList className="justify-start">
                <TabsTrigger value="setup">{t("tabs.setup")}</TabsTrigger>
                <TabsTrigger value="invitations">{t("tabs.invitations")}</TabsTrigger>
                <TabsTrigger value="events">{t("tabs.events")}</TabsTrigger>
              </TabsList>
              <TabsContent value="setup">
                <SetupTab connection={connection} secret={secret} />
              </TabsContent>
              <TabsContent value="invitations">
                <InvitationsTab connection={connection} />
              </TabsContent>
              <TabsContent value="events">
                <EventsTab connection={connection} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
