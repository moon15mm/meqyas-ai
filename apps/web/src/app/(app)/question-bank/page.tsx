"use client";

import { label, QUESTION_TYPE_LABELS, type QuestionType } from "@meqyas/shared";
import { Badge, Button, Card, Input, Skeleton } from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LibraryIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { selectClass } from "@/components/analytics/viz";
import { BankAnswerPreview, useBankSearch } from "@/components/survey/builder/question-bank";
import { libraryApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const TYPES: QuestionType[] = [
  "LIKERT",
  "CSAT",
  "NPS",
  "RATING",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
  "LONG_TEXT",
];
type Scope = "all" | "system" | "organization";

export default function QuestionBankPage() {
  const t = useTranslations("library.bank");
  const locale = useLocale() as "ar" | "en";
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("all");
  const items = useBankSearch({ q, type, scope });
  const remove = useMutation({
    mutationFn: (id: string) => libraryApi.deleteFromBank(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast.success(t("deleted"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative grid min-w-0 flex-1 basis-64 gap-1.5 text-sm">
          <span className="sr-only">{t("search")}</span>
          <SearchIcon
            className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="ps-9"
          />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {t("type")}
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t("allTypes")}</option>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {label(QUESTION_TYPE_LABELS, x, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {t("scope")}
          <select className={selectClass} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {(["all", "system", "organization"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`scopes.${x}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !items.data?.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <LibraryIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{scope === "organization" ? t("emptyMine") : t("noResults")}</p>
          <p className="max-w-md text-sm text-muted-foreground text-pretty">{t("emptyHint")}</p>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t("count", { count: items.data.length })}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.data.map((item) => (
              <li key={item.id}>
                <Card className="grid h-full content-between gap-2 p-4">
                  <div className="grid gap-1.5">
                    <p className="font-medium text-pretty">{item.text}</p>
                    <BankAnswerPreview item={item} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant="soft">{label(QUESTION_TYPE_LABELS, item.question_type, locale)}</Badge>
                      {item.topic ? <Badge variant="outline">{item.topic}</Badge> : null}
                      <span className="text-muted-foreground">
                        {item.source === "system"
                          ? t("fromTemplate", { name: item.template ?? "" })
                          : t("mine")}
                      </span>
                    </span>
                    {item.source === "organization" && can.write ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("delete")}
                        onClick={() => {
                          if (window.confirm(t("deleteConfirm"))) remove.mutate(item.id);
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
