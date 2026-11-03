"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from "@meqyas/ui";
import { CheckCircle2Icon, CircleDashedIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ArchitectComposer } from "@/components/measurement/architect-composer";

const CAPABILITIES = [
  { key: "plan", phase: null },
  { key: "survey", phase: 3 },
  { key: "review", phase: 3 },
  { key: "analyze", phase: 6 },
  { key: "report", phase: 7 },
] as const;

export default function AssistantPage() {
  const t = useTranslations("assistant");
  const tc = useTranslations("common");
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="flex items-center gap-3">
        <span className="brand-gradient flex size-11 items-center justify-center rounded-xl text-white">
          <SparklesIcon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </header>
      <Card className="hero-surface p-5 sm:p-7">
        <ArchitectComposer variant="hero" />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("capabilities")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {CAPABILITIES.map((cap) => (
              <li
                key={cap.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3",
                  cap.phase && "text-muted-foreground",
                )}
              >
                {cap.phase ? (
                  <CircleDashedIcon className="size-5" aria-hidden="true" />
                ) : (
                  <CheckCircle2Icon className="size-5 text-success" aria-hidden="true" />
                )}
                <span className="flex-1">{t(`cap.${cap.key}`)}</span>
                <Badge variant={cap.phase ? "secondary" : "success"}>
                  {cap.phase ? tc("phase", { n: cap.phase }) : t("available")}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
