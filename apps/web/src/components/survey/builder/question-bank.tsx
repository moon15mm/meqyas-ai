"use client";

import {
  label,
  QUESTION_TYPE_LABELS,
  type BankItem,
  type QuestionDoc,
  type QuestionType,
} from "@meqyas/shared";
import {
  Badge,
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlusIcon, LibraryIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { libraryApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

/** A short preview of an item's answer format: option labels or the scale ends. */
export function BankAnswerPreview({ item }: { item: BankItem }) {
  const q = item.question as Partial<QuestionDoc>;
  const options = (q.options ?? []).map((o) => o.label).filter(Boolean);
  const scale = q.scale;
  if (options.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {options.slice(0, 5).join(" · ")}
        {options.length > 5 ? " …" : ""}
      </p>
    );
  }
  if (scale && (scale.min_label || scale.max_label)) {
    return (
      <p className="text-xs text-muted-foreground">
        <bdi dir="ltr">{scale.min}</bdi> {scale.min_label} — <bdi dir="ltr">{scale.max}</bdi>{" "}
        {scale.max_label}
      </p>
    );
  }
  return null;
}

export function useBankSearch(params: { q: string; type: string; scope: "all" | "system" | "organization" }) {
  const [debounced, setDebounced] = React.useState(params.q);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(params.q), 250);
    return () => window.clearTimeout(id);
  }, [params.q]);
  return useQuery({
    queryKey: ["question-bank", debounced, params.type, params.scope],
    queryFn: () =>
      libraryApi.bank({ q: debounced || undefined, type: params.type || undefined, scope: params.scope }),
    placeholderData: (prev) => prev,
  });
}

export function QuestionBankSheet({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: QuestionType, template: Partial<QuestionDoc>) => void;
}) {
  const t = useTranslations("library.bank");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const [q, setQ] = React.useState("");
  const items = useBankSearch({ q, type: "", scope: "all" });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        closeLabel={tc("close")}
        className="w-[min(96vw,32rem)] gap-0 overflow-y-auto p-0"
      >
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <LibraryIcon className="size-4" aria-hidden="true" />
            {t("sheetTitle")}
          </SheetTitle>
          <SheetDescription>{t("sheetHint")}</SheetDescription>
          <label className="relative mt-2 block">
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
        </SheetHeader>
        {items.isLoading ? (
          <Skeleton className="m-5 h-40 rounded-xl" />
        ) : (
          <ul className="grid gap-2 p-4">
            {(items.data ?? []).slice(0, 60).map((item) => (
              <li key={item.id} className="grid gap-1.5 rounded-xl border p-3">
                <p className="text-sm font-medium text-pretty">{item.text}</p>
                <BankAnswerPreview item={item} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant="soft">{label(QUESTION_TYPE_LABELS, item.question_type, locale)}</Badge>
                    {item.topic ? <Badge variant="outline">{item.topic}</Badge> : null}
                    <span className="text-muted-foreground">
                      {item.source === "system" ? item.template : t("mine")}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onInsert(item.question_type, item.question as Partial<QuestionDoc>);
                      toast.success(t("inserted"));
                    }}
                  >
                    <PlusIcon aria-hidden="true" />
                    {t("insert")}
                  </Button>
                </div>
              </li>
            ))}
            {items.data && !items.data.length ? (
              <li className="p-3 text-sm text-muted-foreground">{t("noResults")}</li>
            ) : null}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function SaveToBankButton({ question, topic }: { question: QuestionDoc; topic: string }) {
  const t = useTranslations("library.bank");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => libraryApi.saveToBank({ question, topic }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const savable =
    !["SECTION", "INFORMATION", "FILE"].includes(question.type) && question.text.trim().length > 0;
  if (!savable) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-self-start"
      onClick={() => save.mutate()}
      disabled={save.isPending}
    >
      <BookmarkPlusIcon aria-hidden="true" />
      {t("save")}
    </Button>
  );
}
