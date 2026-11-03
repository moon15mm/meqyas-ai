"use client";

import type { AnswerView, QualityFlag, ResponseDetail, ReviewStatus } from "@meqyas/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanIcon,
  CheckCircle2Icon,
  MessageCircleQuestionIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { responseApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

import { QualityBadge, useFormatters } from "./response-format";

export function FlagList({ flags }: { flags: QualityFlag[] }) {
  const t = useTranslations("responses.flags");
  return (
    <ul className="grid gap-1 text-sm">
      {flags.map((flag, i) => (
        <li key={`${flag.code}-${i}`} className="flex gap-2">
          <span aria-hidden="true">•</span>
          <span>{t(flag.code, flag as unknown as Record<string, string | number>)}</span>
        </li>
      ))}
    </ul>
  );
}

function groupAnswers(answers: AnswerView[]): Array<{ key: string; items: AnswerView[] }> {
  const groups: Array<{ key: string; items: AnswerView[] }> = [];
  for (const a of answers) {
    const last = groups[groups.length - 1];
    if (last && last.key === a.question_key) last.items.push(a);
    else groups.push({ key: a.question_key, items: [a] });
  }
  return groups;
}

export function ResponseDetailSheet({
  responseId,
  onOpenChange,
}: {
  responseId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("responses");
  const td = useTranslations("responses.detail");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const can = useCan();
  const fmt = useFormatters();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const detail = useQuery({
    queryKey: ["response", responseId],
    queryFn: () => responseApi.get(responseId!),
    enabled: !!responseId,
  });

  const refreshLists = () => void queryClient.invalidateQueries({ queryKey: ["responses"] });

  const review = useMutation({
    mutationFn: (status: ReviewStatus) => responseApi.review(responseId!, status),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["response", responseId], fresh);
      refreshLists();
      toast.success(td("reviewed"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => responseApi.remove(responseId!),
    onSuccess: () => {
      setConfirmDelete(false);
      onOpenChange(false);
      refreshLists();
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      toast.success(td("deleted"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const r: ResponseDetail | undefined = detail.data;

  return (
    <>
      <Sheet open={!!responseId} onOpenChange={onOpenChange}>
        <SheetContent side="end" closeLabel={tc("close")} className="w-[min(96vw,36rem)] p-0">
          <SheetHeader className="border-b px-5 pt-5 pb-4">
            <SheetTitle>{td("title")}</SheetTitle>
            <SheetDescription>
              {r ? (
                `${r.survey_title} · ${td("version", { n: r.version_number })}`
              ) : (
                <Skeleton className="h-4 w-40" />
              )}
            </SheetDescription>
          </SheetHeader>
          {!r ? (
            <div className="grid gap-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-5 px-5 pb-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("columns.respondent")}</dt>
                  <dd className="font-medium">{r.respondent_label ?? t("anonymous")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("columns.completed")}</dt>
                  <dd>{fmt.dateTime(r.completed_at ?? r.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("columns.duration")}</dt>
                  <dd className="tabular-nums">{fmt.duration(r.duration_seconds)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("columns.device")}</dt>
                  <dd>
                    {t(
                      `device.${r.device in { mobile: 1, tablet: 1, desktop: 1 } ? r.device : "unknown"}` as "device.unknown",
                    )}{" "}
                    · {t(`channel.${r.channel}`)}
                  </dd>
                </div>
              </dl>

              {r.respondent_name || r.respondent_email ? (
                <div className="rounded-xl border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">{td("identity")}</p>
                  <p className="font-medium">{r.respondent_name}</p>
                  {r.respondent_email ? (
                    <p dir="ltr" className="text-start text-muted-foreground">
                      {r.respondent_email}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <section aria-labelledby="quality-title" className="grid gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="quality-title" className="text-sm font-semibold">
                    {td("flagsTitle")}
                  </h3>
                  <QualityBadge status={r.quality_status} score={r.quality_score} />
                </div>
                {r.quality_flags.length ? (
                  <FlagList flags={r.quality_flags} />
                ) : (
                  <p className="text-sm text-muted-foreground">{td("noFlags")}</p>
                )}
                {can.readResponses ? (
                  <div className="grid gap-2 pt-1">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={r.review_status === "KEEP" ? "default" : "outline"}
                        onClick={() => review.mutate("KEEP")}
                        disabled={review.isPending || r.review_status === "KEEP"}
                      >
                        <CheckCircle2Icon aria-hidden="true" />
                        {td("keep")}
                      </Button>
                      <Button
                        size="sm"
                        variant={r.review_status === "EXCLUDE" ? "destructive" : "outline"}
                        onClick={() => review.mutate("EXCLUDE")}
                        disabled={review.isPending || r.review_status === "EXCLUDE"}
                      >
                        <BanIcon aria-hidden="true" />
                        {td("exclude")}
                      </Button>
                      {r.review_status !== "NONE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => review.mutate("NONE")}
                          disabled={review.isPending}
                        >
                          <RotateCcwIcon aria-hidden="true" />
                          {td("resetReview")}
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{td("reviewHint")}</p>
                  </div>
                ) : null}
              </section>

              <section aria-labelledby="answers-title" className="grid gap-3">
                <h3 id="answers-title" className="text-sm font-semibold">
                  {td("answers")}
                </h3>
                <ol className="grid gap-2">
                  {groupAnswers(r.answers).map((group) => {
                    const main = group.items.filter((a) => !a.is_followup);
                    const follow = group.items.filter((a) => a.is_followup);
                    const first = group.items[0]!;
                    return (
                      <li key={group.key} className="grid gap-1.5 rounded-xl bg-muted/50 p-3 text-sm">
                        <p className="font-medium">{first.question_text}</p>
                        {main.some((a) => a.row_key) ? (
                          <ul className="grid gap-1">
                            {main.map((a) => (
                              <li key={a.row_key ?? a.question_key} className="flex justify-between gap-3">
                                <span className="text-muted-foreground">{a.row_text}</span>
                                <span className="font-medium">{a.display}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          main.map((a, i) => (
                            <p key={i} className="whitespace-pre-line">
                              {a.display}
                              {a.other_text ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {td("otherText")}: {a.other_text}
                                </span>
                              ) : null}
                            </p>
                          ))
                        )}
                        {follow.map((a, i) => (
                          <div
                            key={`f-${i}`}
                            className="mt-1 grid gap-0.5 border-s-2 border-primary/40 ps-2.5"
                          >
                            <p className="flex items-center gap-1.5 text-xs text-primary">
                              <MessageCircleQuestionIcon className="size-3.5" aria-hidden="true" />
                              {td("followup")}: {a.followup_prompt}
                            </p>
                            <p className="whitespace-pre-line">{a.display}</p>
                          </div>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </section>

              {r.is_demo ? <Badge variant="demo">DEMO DATA</Badge> : null}

              {can.deleteResponses ? (
                <>
                  <Separator />
                  <Button
                    variant="ghost"
                    className="justify-self-start text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {td("delete")}
                  </Button>
                </>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{td("delete")}</DialogTitle>
            <DialogDescription>{td("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? <Spinner className="size-4" /> : <Trash2Icon aria-hidden="true" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
