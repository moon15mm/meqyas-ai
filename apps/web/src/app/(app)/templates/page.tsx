"use client";

import { DESIGN_LABELS, label, QUESTION_TYPE_LABELS, type TemplateSummary } from "@meqyas/shared";
import {
  Badge,
  Button,
  Card,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from "@meqyas/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpenIcon,
  CalendarIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  LayoutTemplateIcon,
  type LucideIcon,
  SmileIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { libraryApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

const ICONS: Record<string, LucideIcon> = {
  "graduation-cap": GraduationCapIcon,
  smile: SmileIcon,
  calendar: CalendarIcon,
  users: UsersIcon,
  "book-open": BookOpenIcon,
  "clipboard-list": ClipboardListIcon,
};

function Preview({
  code,
  onClose,
  onUse,
  using,
}: {
  code: string | null;
  onClose: () => void;
  onUse: (code: string) => void;
  using: boolean;
}) {
  const t = useTranslations("library.templates");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const detail = useQuery({
    queryKey: ["template", code, locale],
    queryFn: () => libraryApi.template(code!, locale),
    enabled: Boolean(code),
  });
  const d = detail.data;
  return (
    <Sheet open={Boolean(code)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="end" closeLabel={tc("close")} className="w-[min(96vw,40rem)] overflow-y-auto p-0">
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle>{d?.name ?? "…"}</SheetTitle>
          <SheetDescription>{d?.description}</SheetDescription>
        </SheetHeader>
        {!d ? (
          <Skeleton className="m-5 h-64 rounded-xl" />
        ) : (
          <div className="grid gap-5 px-5 pb-6">
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{t("purpose")}</dt>
              <dd>{d.purpose}</dd>
              <dt className="text-muted-foreground">{t("population")}</dt>
              <dd>{d.target_population}</dd>
              <dt className="text-muted-foreground">{t("design")}</dt>
              <dd>{label(DESIGN_LABELS, d.design, locale)}</dd>
              <dt className="text-muted-foreground">{t("waves")}</dt>
              <dd>{d.waves.join(" · ")}</dd>
            </dl>
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("objectives")}</h3>
              <ul className="grid list-disc gap-1 ps-5 text-sm">
                {d.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </section>
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("dimensions")}</h3>
              <ul className="grid gap-1.5 text-sm">
                {d.dimension_details.map((x) => (
                  <li key={x.name}>
                    <span className="font-medium">{x.name}</span>
                    {x.description ? <span className="text-muted-foreground"> — {x.description}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("indicators")}</h3>
              <ul className="grid gap-1.5 text-sm">
                {d.indicator_details.map((x) => (
                  <li key={x.code} className="flex flex-wrap gap-x-2">
                    <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
                      {x.code}
                    </bdi>
                    <span>{x.name}</span>
                    {x.target ? <span className="text-muted-foreground">({x.target})</span> : null}
                  </li>
                ))}
              </ul>
            </section>
            {d.surveys.map((s) => (
              <section key={s.wave_type} className="grid gap-2 rounded-xl border p-3">
                <h3 className="text-sm font-semibold">
                  {s.title} <span className="font-normal text-muted-foreground">· {s.wave_name}</span>
                </h3>
                {s.sections.map((sec) => (
                  <div key={sec.title} className="grid gap-1">
                    <p className="text-xs font-medium text-muted-foreground">{sec.title}</p>
                    <ol className="grid list-decimal gap-1 ps-5 text-sm">
                      {sec.questions.map((q) => (
                        <li key={q.text} className="text-pretty">
                          {q.text}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({label(QUESTION_TYPE_LABELS, q.type, locale)})
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </section>
            ))}
            <p className="text-xs text-muted-foreground">{t("note")}</p>
            <Button className="justify-self-start" onClick={() => onUse(d.code)} disabled={using}>
              <LayoutTemplateIcon aria-hidden="true" />
              {t("use")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function TemplatesPage() {
  const t = useTranslations("library.templates");
  const locale = useLocale() as "ar" | "en";
  const router = useRouter();
  const can = useCan();
  const toMessage = useErrorMessage();
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const templates = useQuery({
    queryKey: ["templates", locale],
    queryFn: () => libraryApi.templates(locale),
  });
  const use = useMutation({
    mutationFn: (code: string) => libraryApi.useTemplate(code),
    onSuccess: (plan) => {
      toast.success(t("created"));
      router.push(`/plans/${plan.id}`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
      </div>
      {templates.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(templates.data ?? []).map((tpl: TemplateSummary) => {
            const Icon = ICONS[tpl.icon] ?? LayoutTemplateIcon;
            return (
              <li key={tpl.code}>
                <Card className="grid h-full content-between gap-4 p-5">
                  <div className="grid gap-3">
                    <span className="flex items-start gap-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
                        aria-hidden="true"
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="grid gap-1">
                        <span className="font-semibold text-pretty">{tpl.name}</span>
                        <span className="text-sm text-muted-foreground text-pretty">{tpl.description}</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="soft">{label(DESIGN_LABELS, tpl.design, locale)}</Badge>
                      <Badge variant="outline">{t("questionsN", { n: tpl.questions })}</Badge>
                      <Badge variant="outline">{t("minutesN", { n: tpl.minutes })}</Badge>
                      {tpl.language !== locale ? <Badge variant="outline">{t("arabicOnly")}</Badge> : null}
                    </span>
                    <p className="text-xs text-muted-foreground">{tpl.dimensions.join(" · ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPreviewing(tpl.code)}>
                      {t("preview")}
                    </Button>
                    {can.write ? (
                      <Button size="sm" onClick={() => use.mutate(tpl.code)} disabled={use.isPending}>
                        {t("use")}
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("rights")}</p>
      <Preview
        code={previewing}
        onClose={() => setPreviewing(null)}
        onUse={(c) => use.mutate(c)}
        using={use.isPending}
      />
    </div>
  );
}
