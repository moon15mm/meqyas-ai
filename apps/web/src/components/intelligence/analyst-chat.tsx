"use client";

import type { PackFact } from "@meqyas/shared";
import { Button, Textarea } from "@meqyas/ui";
import { useMutation } from "@tanstack/react-query";
import { BotIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Num } from "@/components/analytics/format";
import { intelligenceApi } from "@/lib/api/endpoints";
import { useErrorMessage } from "@/lib/errors";

interface Turn {
  role: "user" | "assistant";
  content: string;
  evidence?: PackFact[];
  followUps?: string[];
}

/** Renders "- " lines as a list and keeps paragraphs; the text comes from our own API. */
function AnswerText({ text }: { text: string }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const list = /^[-•*]\s+/.test(line);
    const clean = line.replace(/^[-•*]\s+/, "");
    const last = blocks[blocks.length - 1];
    if (last && last.list === list && list) last.lines.push(clean);
    else blocks.push({ list, lines: [clean] });
  }
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="grid list-disc gap-1 ps-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines.join(" ")}</p>
        ),
      )}
    </div>
  );
}

export function AnalystChat({ projectId }: { projectId: string }) {
  const t = useTranslations("intelligence.analyst");
  const toMessage = useErrorMessage();
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef<HTMLDivElement>(null);
  const suggestions = t.raw("suggestions") as string[];

  const ask = useMutation({
    mutationFn: (message: string) =>
      intelligenceApi.ask(
        projectId,
        message,
        turns.map((turn) => ({ role: turn.role, content: turn.content })),
      ),
    onSuccess: (res) =>
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, evidence: res.evidence, followUps: res.follow_ups },
      ]),
    onError: (e) => setTurns((prev) => [...prev, { role: "assistant", content: toMessage(e) }]),
  });

  React.useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns, ask.isPending]);

  const send = (message: string) => {
    const text = message.trim();
    if (!text || ask.isPending) return;
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    ask.mutate(text);
  };

  return (
    <section
      aria-labelledby="analyst-title"
      className="grid content-start gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span
          className="brand-gradient grid size-9 shrink-0 place-items-center rounded-xl text-white"
          aria-hidden="true"
        >
          <BotIcon className="size-4" />
        </span>
        <div className="grid gap-0.5">
          <h2 id="analyst-title" className="font-semibold">
            {t("title")}
          </h2>
          <p className="text-xs text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
      </div>

      <div ref={listRef} className="grid max-h-[28rem] gap-3 overflow-y-auto" aria-live="polite">
        {turns.length === 0 ? (
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 text-start"
                  onClick={() => send(s)}
                >
                  {s}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p
              key={i}
              className="justify-self-end rounded-2xl rounded-ee-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              {turn.content}
            </p>
          ) : (
            <div
              key={i}
              className="grid gap-2 rounded-2xl rounded-es-sm bg-muted/60 px-3 py-2 text-sm leading-relaxed"
            >
              <AnswerText text={turn.content} />
              {turn.evidence?.length ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {t("sources", { count: turn.evidence.length })}
                  </summary>
                  <ul className="mt-1 grid gap-1">
                    {turn.evidence.map((f) => (
                      <li key={f.id}>
                        {f.label}: <Num className="font-medium text-foreground">{f.value}</Num>
                        {f.n != null ? ` (n=${f.n})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {turn.followUps?.length && i === turns.length - 1 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {turn.followUps.map((q) => (
                    <li key={q}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto py-1 text-start text-xs"
                        onClick={() => send(q)}
                      >
                        {q}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ),
        )}
        {ask.isPending ? (
          <p role="status" className="rounded-2xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {t("thinking")}
          </p>
        ) : null}
      </div>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="analyst-input" className="visually-hidden">
          {t("placeholder")}
        </label>
        <Textarea
          id="analyst-input"
          rows={2}
          value={draft}
          maxLength={2000}
          placeholder={t("placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("grounded")}</p>
          <Button type="submit" size="sm" disabled={!draft.trim() || ask.isPending}>
            <SendIcon className="ltr:-scale-x-100" aria-hidden="true" />
            {t("send")}
          </Button>
        </div>
      </form>
    </section>
  );
}
