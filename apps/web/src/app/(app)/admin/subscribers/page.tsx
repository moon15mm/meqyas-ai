"use client";

import type { AccountMessage, BulkResult, SubscriberFilter, SubscriberItem } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  cn,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meqyas/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BuildingIcon, ListPlusIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { AdminOnly } from "@/components/admin/admin-only";
import {
  BulkResultsDialog,
  BulkSubscribersDialog,
  NewSubscriberDialog,
  planLabel,
  selectClass,
  usePlans,
} from "@/components/admin/subscriber-dialogs";
import {
  fromAccountMessage,
  ShareMessageDialog,
  type ShareableMessage,
} from "@/components/common/share-message-dialog";
import { planName, StateBadge } from "@/components/subscription/plan-summary";
import { useDateFormat } from "@/components/subscription/subscription-banner";
import { adminApi } from "@/lib/api/endpoints";

const PAGE = 50;
const FILTERS: Array<SubscriberFilter | "ALL"> = [
  "ALL",
  "ACTIVE",
  "TRIAL",
  "ENDING_SOON",
  "EXPIRED",
  "SUSPENDED",
  "PENDING",
];

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Usage({ item }: { item: SubscriberItem }) {
  const t = useTranslations("admin.list");
  const format = useFormatter();
  const { usage, limits } = item.subscription;
  const pair = (used: number, limit: number | null) =>
    limit === null ? format.number(used) : `${format.number(used)}/${format.number(limit)}`;
  return (
    <dl className="grid gap-0.5 text-xs">
      <div className="flex gap-1">
        <dt className="text-muted-foreground">{t("usageSurveys")}</dt>
        <dd className="tabular-nums">{pair(usage.surveys, limits.surveys)}</dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-muted-foreground">{t("usageResponses")}</dt>
        <dd className="tabular-nums">{pair(usage.responses_this_month, limits.responses_per_month)}</dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-muted-foreground">{t("usageMembers")}</dt>
        <dd className="tabular-nums">{pair(usage.members, limits.members)}</dd>
      </div>
    </dl>
  );
}

function SubscribersView() {
  const t = useTranslations("admin.list");
  const locale = useLocale();
  const date = useDateFormat();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<SubscriberFilter | "ALL">("ALL");
  const [plan, setPlan] = React.useState("");
  const [sort, setSort] = React.useState<"created" | "ending" | "name">("created");
  const [offset, setOffset] = React.useState(0);
  const query = useDebounced(q.trim());
  React.useEffect(() => setOffset(0), [query, filter, plan, sort]);
  const plans = usePlans();
  const list = useQuery({
    queryKey: ["admin-subscribers", { query, filter, plan, sort, offset }],
    queryFn: () =>
      adminApi.subscribers({
        q: query || undefined,
        state: filter === "ALL" ? undefined : filter,
        plan: plan || undefined,
        sort,
        limit: PAGE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });
  const [newOpen, setNewOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<BulkResult | null>(null);
  const [message, setMessage] = React.useState<{ message: ShareableMessage; phone: string } | null>(null);
  const stats = list.data?.stats;
  const count = (f: SubscriberFilter | "ALL") =>
    !stats
      ? null
      : f === "ALL"
        ? stats.total
        : f === "ENDING_SOON"
          ? stats.ending_soon
          : (stats.by_state[f] ?? 0);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <ListPlusIcon aria-hidden="true" />
            {t("bulk")}
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t("new")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`filters.${f}`)}
            {count(f) !== null ? (
              <span className={cn("tabular-nums", filter === f ? "opacity-80" : "text-muted-foreground")}>
                {count(f)}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={q}
            placeholder={t("search")}
            aria-label={t("search")}
            className="ps-9"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className={selectClass}
          aria-label={t("planFilter")}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        >
          <option value="">{t("allPlans")}</option>
          {plans.data?.map((p) => (
            <option key={p.code} value={p.code}>
              {planLabel(p, locale)}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label={t("sortLabel")}
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="created">{t("sort.created")}</option>
          <option value="ending">{t("sort.ending")}</option>
          <option value="name">{t("sort.name")}</option>
        </select>
      </div>

      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadFailed")}</AlertDescription>
        </Alert>
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !items.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <BuildingIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{query || filter !== "ALL" || plan ? t("noMatch") : t("empty")}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.workspace")}</TableHead>
                  <TableHead scope="col">{t("columns.plan")}</TableHead>
                  <TableHead scope="col">{t("columns.ends")}</TableHead>
                  <TableHead scope="col">{t("columns.usage")}</TableHead>
                  <TableHead scope="col">{t("columns.activity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.organization_id}>
                    <TableCell className="min-w-56">
                      <Link
                        href={`/admin/subscribers/${item.organization_id}`}
                        className="font-semibold text-pretty hover:text-primary hover:underline"
                      >
                        {item.organization_name}
                      </Link>
                      {item.owner ? (
                        <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                          {item.owner.email}
                        </span>
                      ) : null}
                      {item.is_demo ? <Badge variant="demo">{t("demo")}</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{planName(item.subscription, locale)}</span>
                        <StateBadge state={item.subscription.state} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {item.subscription.period_ends_at
                        ? date(item.subscription.period_ends_at)
                        : item.subscription.state === "PENDING"
                          ? t("onActivation")
                          : t("noEnd")}
                    </TableCell>
                    <TableCell>
                      <Usage item={item} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {item.last_activity_at ? date(item.last_activity_at) : t("never")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {total > PAGE ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {t("range", { from: offset + 1, to: Math.min(offset + PAGE, total), total })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(offset - PAGE)}
            >
              {t("previous")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE >= total}
              onClick={() => setOffset(offset + PAGE)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      ) : null}

      <NewSubscriberDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(m, phone) => setMessage({ message: m, phone })}
      />
      <BulkSubscribersDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={setBulkResult} />
      <BulkResultsDialog
        result={bulkResult}
        filename="meqyas-subscribers.csv"
        onOpenChange={(open) => !open && setBulkResult(null)}
        onShow={(m: AccountMessage) => setMessage({ message: fromAccountMessage(m), phone: "" })}
      />
      <ShareMessageDialog
        message={message?.message ?? null}
        phone={message?.phone ?? ""}
        onOpenChange={(open) => !open && setMessage(null)}
      />
    </div>
  );
}

export default function SubscribersPage() {
  return (
    <AdminOnly>
      <SubscribersView />
    </AdminOnly>
  );
}
