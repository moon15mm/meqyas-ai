"use client";

import {
  Badge,
  Button,
  Separator,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Sheet,
  cn,
} from "@meqyas/ui";
import { CheckCircle2Icon, CircleDashedIcon, FolderOpenIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ArchitectComposer } from "@/components/measurement/architect-composer";

import { useShell } from "./shell-context";

const CAPABILITIES = [
  { key: "plan", available: true },
  { key: "survey", available: false, phase: 3 },
  { key: "review", available: false, phase: 3 },
  { key: "analyze", available: false, phase: 6 },
  { key: "report", available: false, phase: 7 },
] as const;

/** Global AI assistant — always reachable, aware of the open project. */
export function AssistantPanel() {
  const t = useTranslations("assistant");
  const tc = useTranslations("common");
  const { assistantOpen, setAssistantOpen, projectContext } = useShell();

  return (
    <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
      <SheetContent side="end" className="gap-5 p-5 sm:w-[30rem]" closeLabel={tc("close")}>
        <SheetHeader className="pe-8">
          <SheetTitle className="flex items-center gap-2">
            <span className="brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
              <SparklesIcon className="size-4" aria-hidden="true" />
            </span>
            {t("title")}
          </SheetTitle>
          <SheetDescription>{t("subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm">
          <FolderOpenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t("context")}:</span>
          <span className="truncate font-medium">{projectContext?.title ?? t("noContext")}</span>
        </div>

        <ArchitectComposer variant="compact" onDone={() => setAssistantOpen(false)} />

        <Separator />

        <section className="grid gap-3" aria-labelledby="assistant-capabilities">
          <h3 id="assistant-capabilities" className="text-sm font-semibold">
            {t("capabilities")}
          </h3>
          <ul className="grid gap-2">
            {CAPABILITIES.map((cap) => (
              <li
                key={cap.key}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm",
                  !cap.available && "text-muted-foreground",
                )}
              >
                {cap.available ? (
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashedIcon className="size-4" aria-hidden="true" />
                )}
                <span className="flex-1">{t(`cap.${cap.key}`)}</span>
                <Badge variant={cap.available ? "success" : "secondary"}>
                  {cap.available ? t("available") : tc("phase", { n: "phase" in cap ? cap.phase : 0 })}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
        <Button
          variant="ghost"
          className="mt-auto justify-self-start"
          onClick={() => setAssistantOpen(false)}
        >
          {tc("close")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
