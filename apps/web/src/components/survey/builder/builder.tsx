"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  completenessIssues,
  label,
  QUESTION_TYPE_LABELS,
  WAVE_LABELS,
  type ProjectPlan,
  type QuestionType,
  type SurveyAction,
  type SurveyDetail,
} from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@meqyas/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CloudIcon,
  EllipsisIcon,
  EyeIcon,
  GaugeIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
  RotateCcwIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { surveyApi } from "@/lib/api/endpoints";
import { useAuth, useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";
import { useAdvancedMode } from "@/lib/preferences";
import { useMediaQuery } from "@/lib/use-media-query";

import { QUESTION_ICONS, SurveyStatusBadge } from "../question-type-meta";
import { Canvas } from "./canvas";
import { Palette } from "./palette";
import { QuestionBankSheet } from "./question-bank";
import { PreviewDialog } from "./preview-dialog";
import { QualityPanel } from "./quality-panel";
import { ShareDialog } from "./share-dialog";
import { SettingsPanel } from "./settings-panel";
import { useSurveyBuilder, type Builder, type SaveState } from "./use-builder";

/** Prefer question cards under the pointer, then sections, then the nearest item (keyboard). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const questions = hits.filter((c) => String(c.id).startsWith("q:"));
  if (questions.length) return questions;
  if (hits.length) return hits;
  return closestCenter(args);
};

function locate(builder: Builder, key: string): { section: string; index: number } | null {
  for (const s of builder.doc.sections) {
    const index = s.questions.findIndex((q) => q.key === key);
    if (index >= 0) return { section: s.key, index };
  }
  return null;
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations("survey.builder");
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {state === "saving" ? (
        <>
          <Spinner className="size-3.5" />
          {t("saving")}
        </>
      ) : state === "saved" ? (
        <>
          <CheckIcon className="size-3.5 text-success" aria-hidden="true" />
          {t("saved")}
        </>
      ) : state === "dirty" ? (
        <>
          <CloudIcon className="size-3.5" aria-hidden="true" />
          {t("unsaved")}
        </>
      ) : state === "error" ? (
        <>
          <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden="true" />
          <span className="text-destructive">{t("saveError")}</span>
          <Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={onRetry}>
            {t("retrySave")}
          </Button>
        </>
      ) : null}
    </span>
  );
}

export function SurveyBuilder({ detail, plan }: { detail: SurveyDetail; plan: ProjectPlan | null }) {
  const t = useTranslations("survey");
  const tb = useTranslations("survey.builder");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const router = useRouter();
  const queryClient = useQueryClient();
  const toMessage = useErrorMessage();
  const can = useCan();
  const { reloadMe } = useAuth();
  const [advanced] = useAdvancedMode();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);

  const meta = detail.survey;
  const editable = can.write && meta.status !== "ARCHIVED";
  const builder = useSurveyBuilder(detail, editable);
  const dimensions = plan?.dimensions ?? [];
  const indicators = plan?.indicators ?? [];

  const [panelTab, setPanelTab] = React.useState<"settings" | "quality">("settings");
  const [sheet, setSheet] = React.useState<null | "palette" | "panel">(null);
  const [bankOpen, setBankOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [activeDrag, setActiveDrag] = React.useState<string | null>(null);

  // Selecting an item means "edit it": show its settings (in a sheet on small screens).
  const selectionKey =
    builder.selection.kind === "survey" ? "" : `${builder.selection.kind}:${builder.selection.key}`;
  const lastSelection = React.useRef(selectionKey);
  React.useEffect(() => {
    if (selectionKey === lastSelection.current) return;
    lastSelection.current = selectionKey;
    if (!selectionKey) return;
    setPanelTab("settings");
    if (!isDesktop) setSheet("panel");
  }, [selectionKey, isDesktop]);

  const adopt = React.useCallback(
    (fresh: SurveyDetail) => {
      queryClient.setQueryData(["survey", meta.id], fresh);
      builder.reset(fresh);
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      void queryClient.invalidateQueries({ queryKey: ["project", meta.project_id] });
    },
    [queryClient, builder, meta.id, meta.project_id],
  );

  const action = useMutation({
    mutationFn: async (name: SurveyAction) => {
      await builder.flush();
      return surveyApi.action(meta.id, name);
    },
    onSuccess: (fresh, name) => {
      adopt(fresh);
      setPublishOpen(false);
      toast.success(name === "publish" ? tb("published") : tb(`actionDone.${name}`));
      if (name === "publish") void reloadMe(); // a trial workspace's survey count changed
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => surveyApi.remove(meta.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      void queryClient.invalidateQueries({ queryKey: ["project", meta.project_id] });
      toast.success(tb("deleted"));
      router.replace(`/projects/${meta.project_id}/surveys`);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: reducedMotion ? "auto" : "smooth",
    }),
  );

  const nameOf = (id: string | number): string => {
    const value = String(id);
    if (value.startsWith("palette:"))
      return label(QUESTION_TYPE_LABELS, value.slice(8) as QuestionType, locale);
    if (value.startsWith("q:")) {
      const q = builder.doc.sections.flatMap((s) => s.questions).find((x) => x.key === value.slice(2));
      return q?.text || tb("questionTextPlaceholder");
    }
    if (value.startsWith("section:")) {
      const s = builder.doc.sections.find((x) => x.key === value.slice(8));
      return s?.title || tb("untitledSection");
    }
    return value;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => tb("dnd.picked", { name: nameOf(active.id) }),
    onDragOver: ({ over }) => (over ? tb("dnd.over", { name: nameOf(over.id) }) : tb("dnd.outside")),
    onDragEnd: ({ over }) => (over ? tb("dnd.dropped", { name: nameOf(over.id) }) : tb("dnd.cancelled")),
    onDragCancel: () => tb("dnd.cancelled"),
  };

  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDrag(null);
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a.startsWith("palette:")) {
      const type = a.slice(8) as QuestionType;
      if (o.startsWith("q:")) {
        const at = locate(builder, o.slice(2));
        if (at) builder.actions.addQuestion(type, at.section, at.index + 1);
      } else if (o.startsWith("section:")) {
        const section = builder.doc.sections.find((s) => s.key === o.slice(8));
        builder.actions.addQuestion(type, o.slice(8), section?.questions.length ?? 0);
      }
      return;
    }
    if (!a.startsWith("q:") || a === o) return;
    const key = a.slice(2);
    const from = locate(builder, key);
    if (!from) return;
    if (o.startsWith("q:")) {
      const to = locate(builder, o.slice(2));
      if (to) builder.actions.moveQuestion(key, to.section, to.index);
    } else if (o.startsWith("section:") && o.slice(8) !== from.section) {
      const section = builder.doc.sections.find((s) => s.key === o.slice(8));
      builder.actions.moveQuestion(key, o.slice(8), section?.questions.length ?? 0);
    }
  };

  const editQuestion = (key: string) => {
    builder.setSelection({ kind: "question", key });
    setPanelTab("settings");
    if (!isDesktop) setSheet("panel");
    requestAnimationFrame(() =>
      document.getElementById(`card-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const canPublish = editable && (meta.status === "DRAFT" || meta.has_unpublished_changes);
  const answerable = detail.quality.answerable_count;
  const incomplete = React.useMemo(() => completenessIssues(builder.doc), [builder.doc]);
  const publishBlocked = detail.logic_issues.length > 0 || answerable === 0 || incomplete.length > 0;
  const questionNumber = (key: string) => {
    const keys = builder.doc.sections.flatMap((s) =>
      s.questions.filter((q) => q.type !== "INFORMATION" && q.type !== "SECTION").map((q) => q.key),
    );
    return keys.indexOf(key) + 1;
  };
  const versionNumber = meta.current_version?.version_number ?? 1;
  const publishLabel = meta.published_version_number ? tb("publishNew", { n: versionNumber }) : tb("publish");

  const moreActions: Array<{ name: SurveyAction; icon: typeof PauseIcon; show: boolean }> = [
    { name: "pause", icon: PauseIcon, show: meta.status === "PUBLISHED" },
    { name: "resume", icon: PlayIcon, show: meta.status === "PAUSED" },
    { name: "close", icon: SquareIcon, show: meta.status === "PUBLISHED" || meta.status === "PAUSED" },
    {
      name: "reopen",
      icon: RotateCcwIcon,
      show: meta.status === "CLOSED" && !!meta.published_version_number,
    },
    { name: "discard_changes", icon: Undo2Icon, show: meta.has_unpublished_changes },
    { name: "archive", icon: ArchiveIcon, show: meta.status === "DRAFT" || meta.status === "CLOSED" },
  ];
  const visibleActions = can.write ? moreActions.filter((a) => a.show) : [];
  const canDelete = can.write && !meta.published_version_number;

  const sidePanel = (
    <Tabs
      value={panelTab}
      onValueChange={(v) => setPanelTab(v as "settings" | "quality")}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="grid gap-4"
    >
      <TabsList className="w-full">
        <TabsTrigger value="settings" className="flex-1">
          <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
          {tb("settingsTab")}
        </TabsTrigger>
        <TabsTrigger value="quality" className="flex-1">
          <GaugeIcon className="size-4" aria-hidden="true" />
          {tb("review")}
          <Badge
            variant={
              detail.quality.total >= 80 ? "success" : detail.quality.total >= 60 ? "warning" : "destructive"
            }
            className="tabular-nums"
          >
            {detail.quality.total}
          </Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        <SettingsPanel
          builder={builder}
          dimensions={dimensions}
          indicators={indicators}
          advanced={advanced}
          editable={editable}
        />
      </TabsContent>
      <TabsContent value="quality">
        <QualityPanel detail={detail} builder={builder} editable={editable} onEditQuestion={editQuestion} />
      </TabsContent>
    </Tabs>
  );

  const activeType = activeDrag?.startsWith("palette:") ? (activeDrag.slice(8) as QuestionType) : null;
  const ActiveIcon = activeType ? QUESTION_ICONS[activeType] : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {/* Toolbar */}
      <header className="grid min-w-0 gap-3">
        <Button asChild variant="link" className="justify-self-start px-0 text-muted-foreground">
          <Link href={`/projects/${meta.project_id}/surveys`}>
            <ArrowRightIcon className="size-4 ltr:-scale-x-100" aria-hidden="true" />
            {meta.project_title}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1.5">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {builder.doc.title || meta.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <SurveyStatusBadge status={meta.status} label={t(`status.${meta.status}`)} />
              <Badge variant="outline" className="font-normal tabular-nums">
                {t("version", { n: versionNumber })}
              </Badge>
              {meta.wave_type ? (
                <Badge variant="soft">{meta.wave_name || label(WAVE_LABELS, meta.wave_type, locale)}</Badge>
              ) : null}
              {meta.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
              <span className="text-xs text-muted-foreground tabular-nums">
                {tb("estimated", { minutes: Math.max(1, Math.round(detail.quality.estimated_minutes)) })}
              </span>
              {editable ? (
                <SaveIndicator
                  state={builder.saveState}
                  onRetry={() => void builder.flush().catch(() => undefined)}
                />
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <EyeIcon aria-hidden="true" />
              {tb("preview")}
            </Button>
            {meta.published_version_number ? (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Share2Icon aria-hidden="true" />
                {t("share")}
                {meta.response_count ? (
                  <Badge variant="soft" className="tabular-nums">
                    {meta.response_count}
                  </Badge>
                ) : null}
              </Button>
            ) : null}
            {canPublish ? (
              <Button onClick={() => setPublishOpen(true)} disabled={action.isPending}>
                <RocketIcon aria-hidden="true" />
                {publishLabel}
              </Button>
            ) : null}
            {visibleActions.length || canDelete ? (
              <DropdownMenu dir={locale === "ar" ? "rtl" : "ltr"}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={tb("more")}>
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {visibleActions.map((a) => (
                    <DropdownMenuItem key={a.name} onSelect={() => action.mutate(a.name)}>
                      <a.icon aria-hidden="true" />
                      {tb(`actions.${a.name}`)}
                    </DropdownMenuItem>
                  ))}
                  {canDelete ? (
                    <>
                      {visibleActions.length ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                        <Trash2Icon aria-hidden="true" />
                        {tb("deleteSurvey")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {!can.write ? (
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{tb("readOnly")}</AlertDescription>
          </Alert>
        ) : meta.status === "ARCHIVED" ? (
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{tb("archived")}</AlertDescription>
          </Alert>
        ) : meta.has_unpublished_changes ? (
          <Alert variant="warning">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>
              {tb("unpublishedNotice", { n: meta.published_version_number ?? 1 })}
            </AlertDescription>
          </Alert>
        ) : meta.published_version_number && editable ? (
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{tb("publishedNotice")}</AlertDescription>
          </Alert>
        ) : null}
        {!isDesktop ? (
          <div className="flex gap-2">
            {editable ? (
              <Button variant="soft" className="flex-1" onClick={() => setSheet("palette")}>
                <PlusIcon aria-hidden="true" />
                {tb("addQuestion")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setPanelTab("quality");
                setSheet("panel");
              }}
            >
              <GaugeIcon aria-hidden="true" />
              {tb("review")}
              <span className="tabular-nums">{detail.quality.total}</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={tb("surveySettings")}
              onClick={() => {
                builder.setSelection({ kind: "survey" });
                setPanelTab("settings");
                setSheet("panel");
              }}
            >
              <SlidersHorizontalIcon aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDrag(null)}
        accessibility={{ announcements, screenReaderInstructions: { draggable: tb("dnd.instructions") } }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[12.5rem_minmax(0,1fr)_20rem] xl:grid-cols-[13.5rem_minmax(0,1fr)_24rem]">
          {isDesktop ? (
            <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pe-1">
              <Palette
                onAdd={(type) => builder.actions.addQuestion(type)}
                disabled={!editable}
                onOpenBank={() => setBankOpen(true)}
              />
            </div>
          ) : null}
          <Canvas builder={builder} dimensions={dimensions} editable={editable} />
          {isDesktop ? (
            <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border bg-card p-4">
              {sidePanel}
            </div>
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeType && ActiveIcon ? (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg">
              <ActiveIcon className="size-4 text-primary" aria-hidden="true" />
              {label(QUESTION_TYPE_LABELS, activeType, locale)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <QuestionBankSheet
        open={bankOpen}
        onOpenChange={setBankOpen}
        onInsert={(type, template) => builder.actions.addQuestion(type, undefined, undefined, template)}
      />

      {/* Small screens: palette and settings live in sheets */}
      {!isDesktop ? (
        <>
          <Sheet open={sheet === "palette"} onOpenChange={(o) => setSheet(o ? "palette" : null)}>
            <SheetContent side="bottom" closeLabel={tc("close")} className="p-5">
              <SheetHeader>
                <SheetTitle>{tb("palette")}</SheetTitle>
                <SheetDescription className="visually-hidden">{tb("paletteHint")}</SheetDescription>
              </SheetHeader>
              <Palette
                onAdd={(type) => {
                  builder.actions.addQuestion(type);
                  setSheet(null);
                }}
                disabled={!editable}
                onOpenBank={() => {
                  setSheet(null);
                  setBankOpen(true);
                }}
              />
            </SheetContent>
          </Sheet>
          <Sheet open={sheet === "panel"} onOpenChange={(o) => setSheet(o ? "panel" : null)}>
            <SheetContent side="bottom" closeLabel={tc("close")} className="p-5 pt-12">
              <SheetHeader className="visually-hidden">
                <SheetTitle>{panelTab === "quality" ? tb("review") : tb("settingsTab")}</SheetTitle>
                <SheetDescription>{tb("panelHint")}</SheetDescription>
              </SheetHeader>
              {sidePanel}
            </SheetContent>
          </Sheet>
        </>
      ) : null}

      <PreviewDialog doc={builder.doc} open={previewOpen} onOpenChange={setPreviewOpen} />

      <ShareDialog
        survey={meta}
        open={shareOpen}
        onOpenChange={setShareOpen}
        canEdit={can.write}
        onUpdated={(fresh) => {
          // Collection settings live on the survey, not the document: keep local edits untouched.
          queryClient.setQueryData<SurveyDetail>(["survey", meta.id], (old) =>
            old ? { ...old, survey: fresh.survey } : fresh,
          );
          void queryClient.invalidateQueries({ queryKey: ["surveys"] });
        }}
      />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{tb("publishConfirmTitle")}</DialogTitle>
            <DialogDescription>{tb("publishConfirmBody")}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5 text-sm">
            <li className="flex items-center gap-2">
              <CheckIcon className="size-4 text-success" aria-hidden="true" />
              {tc("questions", { n: answerable })}
            </li>
            <li className="flex items-center gap-2">
              {detail.logic_issues.length ? (
                <CircleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
              ) : (
                <CheckIcon className="size-4 text-success" aria-hidden="true" />
              )}
              {detail.logic_issues.length ? tb("logicIssuesBlock") : tb("logicOk")}
            </li>
            <li className="flex items-center gap-2">
              <GaugeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {tb("qualityLine", { score: detail.quality.total })}
            </li>
            <li className="flex items-center gap-2">
              <InfoIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {tb(`anonymityModes.${builder.doc.settings.anonymity_mode}`)}
            </li>
          </ul>
          {answerable === 0 ? <p className="text-sm text-destructive">{tb("emptyBlock")}</p> : null}
          {incomplete.length ? (
            <div className="grid gap-1.5 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm">
              <p className="font-medium text-destructive">{tb("completenessBlock")}</p>
              <ul className="grid gap-1">
                {incomplete.slice(0, 8).map((issue, i) => (
                  <li key={`${issue.code}-${issue.question_key}-${i}`}>
                    {issue.question_key ? (
                      <button
                        type="button"
                        className="text-start underline-offset-4 hover:underline"
                        onClick={() => {
                          setPublishOpen(false);
                          editQuestion(issue.question_key);
                        }}
                      >
                        {tb(`completeness.${issue.code}`, { n: questionNumber(issue.question_key) })}
                      </button>
                    ) : (
                      tb(`completeness.${issue.code}`, { n: 0 })
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => action.mutate("publish")} disabled={publishBlocked || action.isPending}>
              {action.isPending ? <Spinner className="size-4" /> : <RocketIcon aria-hidden="true" />}
              {publishLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{tb("deleteSurvey")}</DialogTitle>
            <DialogDescription>{tb("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? <Spinner className="size-4" /> : <Trash2Icon aria-hidden="true" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
