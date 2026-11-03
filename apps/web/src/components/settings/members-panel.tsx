"use client";

import { label, ROLE_LABELS, ROLES, type Member, type Role } from "@meqyas/shared";
import {
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
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisVerticalIcon, KeyRoundIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import {
  fromAccountMessage,
  ShareMessageDialog,
  type ShareableMessage,
} from "@/components/common/share-message-dialog";
import { useSubscription } from "@/components/subscription/subscription";
import { orgApi, storeApi } from "@/lib/api/endpoints";
import { useAuth, useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The workspace's people: invite (new accounts get a one-time activation link), roles, links, removal. */
export function MembersPanel() {
  const t = useTranslations("settings");
  const tm = useTranslations("settings.team");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const { activeOrg, user, reloadMe } = useAuth();
  const can = useCan();
  const sub = useSubscription();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const orgId = activeOrg?.organization_id ?? "";
  const members = useQuery({
    queryKey: ["members", orgId],
    queryFn: () => orgApi.members(orgId),
    enabled: !!orgId,
  });
  const capabilities = useQuery({
    queryKey: ["integrations-capabilities"],
    queryFn: storeApi.capabilities,
    enabled: can.manageOrg,
  });
  const emailAvailable = capabilities.data?.email_delivery ?? false;
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("VIEWER");
  const [sendEmail, setSendEmail] = React.useState(true);
  const [message, setMessage] = React.useState<ShareableMessage | null>(null);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["members", orgId] });
    await reloadMe(); // the member count on the plan
  };

  const add = useMutation({
    mutationFn: () =>
      orgApi.addMember(orgId, {
        email: email.trim(),
        role,
        full_name: name.trim(),
        send_email: sendEmail && emailAvailable,
      }),
    onSuccess: (result) => {
      setEmail("");
      setName("");
      void refresh();
      toast.success(t("memberAdded"));
      setMessage(fromAccountMessage(result.message));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, r }: { id: string; r: Role }) => orgApi.updateMember(orgId, id, r),
    onSuccess: () => {
      void refresh();
      toast.success(t("roleUpdated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => orgApi.removeMember(orgId, id),
    onSuccess: () => {
      void refresh();
      toast.success(t("memberRemoved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const link = useMutation({
    mutationFn: (member: Member) => orgApi.memberAccessLink(orgId, member.id, emailAvailable),
    onSuccess: (result) => setMessage(fromAccountMessage(result)),
    onError: (e) => toast.error(toMessage(e)),
  });

  const assignable = ROLES.filter((r) => activeOrg?.role === "OWNER" || r !== "OWNER");
  const limit = sub?.limits.members ?? null;
  const count = members.data?.length ?? sub?.usage.members ?? 0;
  const full = limit !== null && count >= limit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("members")}</CardTitle>
        {limit !== null ? <CardDescription>{tm("seats", { count, limit })}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        {can.manageOrg ? (
          <form
            className="grid gap-3 rounded-xl border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (EMAIL.test(email.trim())) add.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_11rem]">
              <Field id="mb-email" label={t("memberEmail")} required>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field id="mb-name" label={tm("name")} hint={tm("nameHint")}>
                <Input
                  autoComplete="off"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <div className="grid content-start gap-2">
                <span id="mb-role" className="text-sm font-medium">
                  {t("role")}
                </span>
                <Select value={role} onValueChange={(v) => setRole(v as Role)} dir={dir}>
                  <SelectTrigger aria-labelledby="mb-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (
                      <SelectItem key={r} value={r}>
                        {label(ROLE_LABELS, r, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={sendEmail && emailAvailable}
                  disabled={!emailAvailable}
                  onCheckedChange={setSendEmail}
                  aria-describedby="mb-email-hint"
                />
                <span>{tm("sendEmail")}</span>
              </label>
              <Button type="submit" disabled={add.isPending || !EMAIL.test(email.trim()) || full}>
                {add.isPending ? <Spinner /> : <UserPlusIcon aria-hidden="true" />}
                {t("addMember")}
              </Button>
            </div>
            <p id="mb-email-hint" className="text-xs text-muted-foreground text-pretty">
              {full ? tm("full") : emailAvailable ? tm("inviteHint") : tm("inviteHintNoEmail")}
            </p>
          </form>
        ) : null}
        {members.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{tm("name")}</TableHead>
                <TableHead scope="col">{t("memberEmail")}</TableHead>
                <TableHead scope="col">{t("role")}</TableHead>
                {can.manageOrg ? (
                  <TableHead scope="col" className="w-12">
                    <span className="visually-hidden">{tm("actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.map((m) => {
                const self = m.user_id === user?.id;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {m.full_name}
                        {self ? <Badge variant="secondary">{t("you")}</Badge> : null}
                        {m.pending ? <Badge variant="outline">{tm("pending")}</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell dir="ltr" className="text-start text-muted-foreground">
                      {m.email}
                    </TableCell>
                    <TableCell>
                      {can.manageOrg && !self ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => changeRole.mutate({ id: m.id, r: v as Role })}
                          dir={dir}
                        >
                          <SelectTrigger className="h-9 w-36" aria-label={`${t("role")}: ${m.full_name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {assignable.map((r) => (
                              <SelectItem key={r} value={r}>
                                {label(ROLE_LABELS, r, locale)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{label(ROLE_LABELS, m.role, locale)}</Badge>
                      )}
                    </TableCell>
                    {can.manageOrg ? (
                      <TableCell>
                        {!self ? (
                          <DropdownMenu dir={dir}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${tm("actions")}: ${m.full_name}`}
                              >
                                <EllipsisVerticalIcon aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {m.links_allowed ? (
                                <DropdownMenuItem onSelect={() => link.mutate(m)}>
                                  <KeyRoundIcon aria-hidden="true" />
                                  {m.pending ? tm("newActivationLink") : tm("recoveryLink")}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem disabled>
                                  <KeyRoundIcon aria-hidden="true" />
                                  {tm("linksByPlatform")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() => {
                                  if (window.confirm(tm("removeConfirm", { name: m.full_name })))
                                    remove.mutate(m.id);
                                }}
                              >
                                <Trash2Icon aria-hidden="true" />
                                {tc("delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ShareMessageDialog message={message} onOpenChange={(open) => !open && setMessage(null)} />
    </Card>
  );
}
