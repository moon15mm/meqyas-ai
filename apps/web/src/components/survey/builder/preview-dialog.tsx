"use client";

import type { SurveyDoc } from "@meqyas/shared";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@meqyas/ui";
import { MonitorIcon, RotateCcwIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { PulseRenderer } from "../pulse/pulse-renderer";
import { SurveyRenderer } from "../renderer/survey-renderer";

const DEVICES = {
  desktop: { icon: MonitorIcon, width: "100%" },
  tablet: { icon: TabletIcon, width: "768px" },
  mobile: { icon: SmartphoneIcon, width: "390px" },
} as const;
type Device = keyof typeof DEVICES;

export function PreviewDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: SurveyDoc;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("survey.preview");
  const tc = useTranslations("common");
  const [device, setDevice] = React.useState<Device>("desktop");
  const [dir, setDir] = React.useState<"rtl" | "ltr">(doc.language === "ar" ? "rtl" : "ltr");
  const [run, setRun] = React.useState(0);

  React.useEffect(() => {
    if (open) setDir(doc.language === "ar" ? "rtl" : "ltr");
  }, [open, doc.language]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={tc("close")}
        className="flex h-[calc(100dvh-2rem)] max-w-6xl flex-col gap-3 p-0 sm:p-0"
      >
        <DialogHeader className="border-b px-5 pt-5 pb-3">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("note")}</DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("device")} className="flex rounded-lg border bg-muted/50 p-0.5">
              {(Object.keys(DEVICES) as Device[]).map((d) => {
                const Icon = DEVICES[d].icon;
                return (
                  <Button
                    key={d}
                    size="sm"
                    variant={device === d ? "outline" : "ghost"}
                    aria-pressed={device === d}
                    onClick={() => setDevice(d)}
                    className={cn("border-transparent", device === d && "bg-card shadow-xs")}
                  >
                    <Icon aria-hidden="true" />
                    {t(d)}
                  </Button>
                );
              })}
            </div>
            <div
              role="group"
              aria-label={t("direction")}
              className="flex rounded-lg border bg-muted/50 p-0.5"
            >
              {(["rtl", "ltr"] as const).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={dir === d ? "outline" : "ghost"}
                  aria-pressed={dir === d}
                  onClick={() => setDir(d)}
                  className={cn("border-transparent font-mono", dir === d && "bg-card shadow-xs")}
                >
                  {d.toUpperCase()}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRun((r) => r + 1)}>
              <RotateCcwIcon aria-hidden="true" />
              {t("restart")}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-3 pb-5 sm:px-5">
          <div
            className="mx-auto min-h-full rounded-2xl border bg-background p-5 shadow-sm transition-[max-width] duration-300 sm:p-8"
            style={{ maxWidth: DEVICES[device].width }}
          >
            {doc.settings.experience === "pulse" ? (
              <PulseRenderer key={run} doc={doc} mode="preview" dir={dir} />
            ) : (
              <SurveyRenderer key={run} doc={doc} mode="preview" dir={dir} onSubmit={async () => undefined} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
