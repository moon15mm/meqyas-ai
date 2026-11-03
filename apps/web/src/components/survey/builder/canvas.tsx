"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  label,
  QUESTION_TYPE_LABELS,
  type Dimension,
  type QuestionDoc,
  type SectionDoc,
} from "@meqyas/shared";
import { Badge, Button, cn } from "@meqyas/ui";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CopyIcon,
  GitBranchIcon,
  GripVerticalIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { QUESTION_ICONS } from "../question-type-meta";
import type { Builder } from "./use-builder";

function QuestionCard({
  question,
  number,
  builder,
  dimensions,
  hasLogic,
  editable,
  isFirst,
  isLast,
}: {
  question: QuestionDoc;
  number: number | null;
  builder: Builder;
  dimensions: Dimension[];
  hasLogic: boolean;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("survey.builder");
  const locale = useLocale() as "ar" | "en";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `q:${question.key}`,
    disabled: !editable,
  });
  const selected = builder.selection.kind === "question" && builder.selection.key === question.key;
  const Icon = QUESTION_ICONS[question.type];
  const dimension = dimensions.find((d) => d.id === question.dimension_id);
  const section = builder.doc.sections.find((s) => s.questions.some((q) => q.key === question.key))!;
  const index = section.questions.findIndex((q) => q.key === question.key);

  return (
    <li
      ref={setNodeRef}
      id={`card-${question.key}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative", isDragging && "z-10 opacity-60")}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => builder.setSelection({ kind: "question", key: question.key })}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            builder.setSelection({ kind: "question", key: question.key });
          }
        }}
        className={cn(
          "flex gap-2 rounded-xl border bg-card p-3 text-start shadow-xs transition hover:border-primary/40",
          selected && "border-primary ring-2 ring-primary/15",
        )}
      >
        {editable ? (
          <button
            type="button"
            className="mt-0.5 flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
            aria-label={t("dragHandle")}
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <p
              className={cn(
                "min-w-0 flex-1 leading-relaxed",
                !question.text && "text-muted-foreground italic",
              )}
            >
              {number !== null ? (
                <span className="me-1.5 text-muted-foreground tabular-nums">{number}.</span>
              ) : null}
              {question.text || t("questionTextPlaceholder")}
              {question.required ? <span className="ms-1 text-destructive">*</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 ps-9">
            <Badge variant="outline" className="font-normal">
              {label(QUESTION_TYPE_LABELS, question.type, locale)}
            </Badge>
            {dimension ? (
              <Badge variant="soft">{t("linkedDimension", { name: dimension.name })}</Badge>
            ) : null}
            {hasLogic ? (
              <Badge variant="evidence" className="gap-1">
                <GitBranchIcon aria-hidden="true" />
                {t("logicBadge")}
              </Badge>
            ) : null}
            {!question.text.trim() ||
            (question.type !== "INFORMATION" &&
              question.type !== "SECTION" &&
              question.options.some((o) => !o.label.trim())) ||
            (question.type === "MATRIX" && question.settings.rows.some((r) => !r.text.trim())) ? (
              <Badge variant="warning" className="gap-1">
                <CircleAlertIcon aria-hidden="true" />
                {t("incomplete")}
              </Badge>
            ) : null}
            {question.ai_generated ? (
              <Badge variant="secondary" className="gap-1">
                <SparklesIcon aria-hidden="true" />
                {t("aiBadge")}
              </Badge>
            ) : null}
            {question.options.length && question.type !== "LIKERT" ? (
              <span className="max-w-full min-w-0 truncate text-xs text-muted-foreground">
                {question.options
                  .slice(0, 4)
                  .map((o) => o.label)
                  .join(" · ")}
                {question.options.length > 4 ? " …" : ""}
              </span>
            ) : null}
          </div>
        </div>
        {editable ? (
          <div
            className={cn(
              "flex shrink-0 flex-col gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100",
              // Touch screens have no hover: show the actions for the selected card only.
              selected ? "opacity-100" : "max-sm:hidden",
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("moveUp")}: ${question.text}`}
              disabled={isFirst}
              onClick={(e) => {
                e.stopPropagation();
                builder.actions.moveQuestion(question.key, section.key, index - 1);
              }}
            >
              <ChevronUpIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("moveDown")}: ${question.text}`}
              disabled={isLast}
              onClick={(e) => {
                e.stopPropagation();
                builder.actions.moveQuestion(question.key, section.key, index + 1);
              }}
            >
              <ChevronDownIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("duplicate")}: ${question.text}`}
              onClick={(e) => {
                e.stopPropagation();
                builder.actions.duplicateQuestion(question.key);
              }}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("delete")}: ${question.text}`}
              onClick={(e) => {
                e.stopPropagation();
                builder.actions.deleteQuestion(question.key);
              }}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SectionBlock({
  section,
  sectionIndex,
  builder,
  dimensions,
  numbering,
  editable,
}: {
  section: SectionDoc;
  sectionIndex: number;
  builder: Builder;
  dimensions: Dimension[];
  numbering: Map<string, number>;
  editable: boolean;
}) {
  const t = useTranslations("survey.builder");
  const { setNodeRef, isOver } = useDroppable({ id: `section:${section.key}`, disabled: !editable });
  const selected = builder.selection.kind === "section" && builder.selection.key === section.key;
  const logicTargets = new Set(
    builder.doc.logic.flatMap((r) => [r.target_key, r.source_key]).filter(Boolean) as string[],
  );
  return (
    <section
      ref={setNodeRef}
      aria-label={section.title || t("untitledSection")}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl border border-dashed bg-muted/30 p-3 transition sm:p-4",
        isOver && "border-primary bg-primary/5",
        selected && "border-solid border-primary/60",
      )}
    >
      <button
        type="button"
        onClick={() => builder.setSelection({ kind: "section", key: section.key })}
        className="flex items-center gap-2 rounded-lg px-1 text-start"
      >
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{sectionIndex + 1}</span>
        <span className="font-semibold">{section.title || t("untitledSection")}</span>
        {section.description ? (
          <span className="truncate text-xs text-muted-foreground">— {section.description}</span>
        ) : null}
      </button>
      <SortableContext
        items={section.questions.map((q) => `q:${q.key}`)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {section.questions.map((q, i) => (
            <QuestionCard
              key={q.key}
              question={q}
              number={numbering.get(q.key) ?? null}
              builder={builder}
              dimensions={dimensions}
              hasLogic={logicTargets.has(q.key)}
              editable={editable}
              isFirst={i === 0}
              isLast={i === section.questions.length - 1}
            />
          ))}
        </ol>
      </SortableContext>
      {section.questions.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card/60 p-6 text-center text-sm text-muted-foreground">
          {t("emptySection")}
        </p>
      ) : null}
    </section>
  );
}

export function Canvas({
  builder,
  dimensions,
  editable,
}: {
  builder: Builder;
  dimensions: Dimension[];
  editable: boolean;
}) {
  const t = useTranslations("survey.builder");
  const numbering = new Map<string, number>();
  let n = 0;
  for (const q of builder.doc.sections.flatMap((s) => s.questions)) {
    if (q.type !== "INFORMATION" && q.type !== "SECTION") numbering.set(q.key, ++n);
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
      {builder.doc.sections.map((section, i) => (
        <SectionBlock
          key={section.key}
          section={section}
          sectionIndex={i}
          builder={builder}
          dimensions={dimensions}
          numbering={numbering}
          editable={editable}
        />
      ))}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => builder.actions.addQuestion("LIKERT")}>
            <PlusIcon aria-hidden="true" />
            {t("addQuestion")}
          </Button>
          <Button variant="ghost" onClick={() => builder.actions.addSection()}>
            <PlusIcon aria-hidden="true" />
            {t("addSection")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
