"use client";

import {
  label,
  ROLE_LABELS,
  type BulkResult,
  type SubscriberDetail,
  type SubscriberMember,
} from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  BanIcon,
  EllipsisVerticalIcon,
  KeyRoundIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserCheckIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { AdminOnly } from "@/components/admin/admin-only";
import {
  AddMembersDialog,
  BulkResultsDialog,
  RenewDialog,
  SubscriptionDialog,
  SuspendDialog,
  useEmailAvailable,
} from "@/components/admin/subscriber-dialogs";
import {
  fromAccountMessage,
  ShareMessageDialog,
  type ShareableMessage,
} from "@/components/common/share-message-dialog";
import { planName, StateBadge, UsageMeters } from "@/components/subscription/plan-summary";
import { useDateFormat } from "@/components/subscription/subscription-banner";
import { adminApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

function Facts({ detail }: { detail: SubscriberDetail }) {
  const t = useTranslations("admin.detail");
  const format = useFormatter();
  const date = useDateFormat();
  const sub = detail.subscription;
  const overrides = Object.entries(detail.overrides ?? {});
  const rows: Array<[string, React.ReactNode]> = [
    [t("periodStart"), sub.period_started_at ? date(sub.period_started_at) : t("onActivation")],
    [
      t("periodEnd"),
      sub.period_ends_at
        ? date(sub.period_ends_at)
        : sub.pending_days
          ? t("pendingDays", { days: sub.pending_days })
          : t("noEnd"),
    ],
  ];
  if (sub.state === "EXPIRED" && sub.collection_ends_at) {
    rows.push([t("collectionEnds"), date(sub.collection_ends_at)]);
  }
  rows.push([t("aiDaily"), format.number(sub.limits.ai_daily_tokens ?? 0)]);
  if (overrides.length) {
    rows.push([
      t("ownLimits"),
      overrides
        .map(
          ([k, v]) =>
            `${t(`limits.${k}` as "limits.surveys")}: ${v === null ? t("unlimited") : format.number(Number(v))}`,
        )
        .join(" · "),
    ]);
  }
  if (detail.suspended_at) {
    rows.push([
      t("suspendedAt"),
      `${date(detail.suspended_at)}${detail.suspension_reason ? ` — ${detail.suspension_reason}` : ""}`,
    ]);
  }
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium text-pretty">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function NoteCard({ detail }: { detail: SubscriberDetail }) {
  const t = useTranslations("admin.detail");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState(detail.admin_note);
  React.useEffect(() => setNote(detail.admin_note), [detail.admin_note]);
  const save = useMutation({
    mutationFn: () => adminApi.updateSubscription(detail.organization_id, { admin_note: note.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", detail.organization_id], updated);
      toast.success(t("noteSaved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("note")}</CardTitle>
        <CardDescription>{t("noteHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          rows={4}
          value={note}
          maxLength={2000}
          aria-label={t("note")}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={save.isPending || note.trim() === detail.admin_note}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Spinner /> : null}
          {tc("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function MemberStatus({ member }: { member: SubscriberMember }) {
  const t = useTranslations("admin.detail");
  if (!member.is_active) return <Badge variant="destructive">{t("disabled")}</Badge>;
  if (member.pending) return <Badge variant="outline">{t("pending")}</Badge>;
  return <Badge variant="success">{t("active")}</Badge>;
}

function MembersCard({
  detail,
  onMessage,
}: {
  detail: SubscriberDetail;
  onMessage: (m: ShareableMessage) => void;
}) {
  const t = useTranslations("admin.detail");
  const locale = useLocale() as "ar" | "en";
  const date = useDateFormat();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const emailAvailable = useEmailAvailable(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-subscriber", detail.organization_id] });
  const link = useMutation({
    mutationFn: (m: SubscriberMember) => adminApi.accessLink(m.user_id, emailAvailable),
    onSuccess: (message) => onMessage(fromAccountMessage(message)),
    onError: (e) => toast.error(toMessage(e)),
  });
  const active = useMutation({
    mutationFn: ({ m, on }: { m: SubscriberMember; on: boolean }) => adminApi.setUserActive(m.user_id, on),
    onSuccess: (_r, { on }) => {
      void refresh();
      toast.success(on ? t("enabled") : t("disabledDone"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (m: SubscriberMember) => adminApi.removeMember(detail.organization_id, m.member_id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", detail.organization_id], updated);
      toast.success(t("removed"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="text-base">{t("members")}</CardTitle>
          <CardDescription>{t("membersHint")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlusIcon aria-hidden="true" />
          {t("addMembers")}
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("person")}</TableHead>
              <TableHead scope="col">{t("role")}</TableHead>
              <TableHead scope="col">{t("status")}</TableHead>
              <TableHead scope="col">{t("lastLogin")}</TableHead>
              <TableHead scope="col" className="w-12">
                <span className="visually-hidden">{t("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.members.map((m) => (
              <TableRow key={m.member_id}>
                <TableCell className="min-w-48">
                  <span className="font-medium">{m.full_name}</span>
                  {m.is_platform_admin ? (
                    <Badge variant="soft" className="ms-1.5">
                      {t("platformAdmin")}
                    </Badge>
                  ) : null}
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {m.email}
                  </span>
                  {m.other_workspaces ? (
                    <span className="block text-xs text-muted-foreground">
                      {t("otherWorkspaces", { n: m.other_workspaces })}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{label(ROLE_LABELS, m.role, locale)}</TableCell>
                <TableCell>
                  <MemberStatus member={m} />
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                  {m.last_login_at ? date(m.last_login_at) : t("never")}
                </TableCell>
                <TableCell>
                  <DropdownMenu dir={dir}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`${t("actions")}: ${m.full_name}`}>
                        <EllipsisVerticalIcon aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={!m.is_active} onSelect={() => link.mutate(m)}>
                        <KeyRoundIcon aria-hidden="true" />
                        {m.pending ? t("activationLink") : t("recoveryLink")}
                      </DropdownMenuItem>
                      {m.user_id !== user?.id && !m.is_platform_admin ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            if (m.is_active && !window.confirm(t("disableConfirm", { name: m.full_name })))
                              return;
                            active.mutate({ m, on: !m.is_active });
                          }}
                        >
                          {m.is_active ? (
                            <UserXIcon aria-hidden="true" />
                          ) : (
                            <UserCheckIcon aria-hidden="true" />
                          )}
                          {m.is_active ? t("disableAccount") : t("enableAccount")}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => {
                          if (window.confirm(t("removeConfirm", { name: m.full_name }))) remove.mutate(m);
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                        {t("removeFromWorkspace")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <AddMembersDialog
        orgId={detail.organization_id}
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={setResult}
      />
      <BulkResultsDialog
        result={result}
        filename="meqyas-members.csv"
        onOpenChange={(open) => !open && setResult(null)}
        onShow={(m) => onMessage(fromAccountMessage(m))}
      />
    </Card>
  );
}

const EVENT_KEYS = new Set([
  "subscriber.create",
  "subscription.update",
  "subscription.renew",
  "subscription.suspend",
  "subscription.reactivate",
  "member.add",
  "member.remove",
  "member.role_change",
  "member.access_link",
  "gift.create",
  "gift.resend",
  "gift.activate",
  "auth.activate",
  "survey.publish",
]);

function EventsCard({ detail }: { detail: SubscriberDetail }) {
  const t = useTranslations("admin.detail");
  const te = useTranslations("admin.events");
  const date = useDateFormat();
  if (!detail.events.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("events")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 text-sm">
          {detail.events.map((e, i) => (
            <li
              key={`${e.action}-${e.created_at}-${i}`}
              className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0"
            >
              <span>
                {EVENT_KEYS.has(e.action) ? te(e.action.replace(".", "_") as "subscriber_create") : e.action}
                {e.actor_name ? <span className="text-muted-foreground"> — {e.actor_name}</span> : null}
              </span>
              <time dateTime={e.created_at} className="text-muted-foreground tabular-nums">
                {date(e.created_at)}
              </time>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function DetailView() {
  const t = useTranslations("admin.detail");
  const tl = useTranslations("admin.list");
  const locale = useLocale();
  const { orgId } = useParams<{ orgId: string }>();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin-subscriber", orgId],
    queryFn: () => adminApi.subscriber(orgId),
  });
  const [dialog, setDialog] = React.useState<"plan" | "renew" | "suspend" | null>(null);
  const [message, setMessage] = React.useState<ShareableMessage | null>(null);
  const reactivate = useMutation({
    mutationFn: () => adminApi.reactivate(orgId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin-subscriber", orgId], updated);
      void queryClient.invalidateQueries({ queryKey: ["admin-subscribers"] });
      toast.success(t("reactivated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  if (detail.isError) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-xl">
        <AlertDescription>{t("notFound")}</AlertDescription>
      </Alert>
    );
  }
  if (!detail.data) return <Skeleton className="mx-auto h-96 max-w-6xl rounded-2xl" />;
  const d = detail.data;
  const sub = d.subscription;
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5">
      <Button asChild variant="link" className="justify-self-start px-0 text-muted-foreground">
        <Link href="/admin/subscribers">
          <ArrowRightIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
          {tl("title")}
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{d.organization_name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{planName(sub, locale)}</Badge>
            <StateBadge state={sub.state} />
            {d.is_demo ? <Badge variant="demo">{tl("demo")}</Badge> : null}
            {d.owner ? (
              <span className="text-sm text-muted-foreground">
                {t("owner", { name: d.owner.full_name })} · <span dir="ltr">{d.owner.email}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("plan")}>
            <PencilIcon aria-hidden="true" />
            {t("editPlan")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("renew")}>
            <RefreshCwIcon aria-hidden="true" />
            {t("renew")}
          </Button>
          {sub.state === "SUSPENDED" ? (
            <Button disabled={reactivate.isPending} onClick={() => reactivate.mutate()}>
              {reactivate.isPending ? <Spinner /> : <PlayIcon aria-hidden="true" />}
              {t("reactivate")}
            </Button>
          ) : !d.is_demo ? (
            <Button variant="outline" className="text-destructive" onClick={() => setDialog("suspend")}>
              <BanIcon aria-hidden="true" />
              {t("suspend")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("subscription")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts detail={d} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("usage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageMeters sub={sub} />
          </CardContent>
        </Card>
        <NoteCard detail={d} />
      </div>

      <MembersCard detail={d} onMessage={setMessage} />
      <EventsCard detail={d} />

      <SubscriptionDialog
        detail={d}
        open={dialog === "plan"}
        onOpenChange={(o) => setDialog(o ? "plan" : null)}
      />
      <RenewDialog detail={d} open={dialog === "renew"} onOpenChange={(o) => setDialog(o ? "renew" : null)} />
      <SuspendDialog
        detail={d}
        open={dialog === "suspend"}
        onOpenChange={(o) => setDialog(o ? "suspend" : null)}
      />
      <ShareMessageDialog message={message} onOpenChange={(open) => !open && setMessage(null)} />
    </div>
  );
}

export default function SubscriberPage() {
  return (
    <AdminOnly>
      <DetailView />
    </AdminOnly>
  );
}
