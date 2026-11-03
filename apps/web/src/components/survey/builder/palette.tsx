"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  label,
  QUESTION_GROUPS,
  QUESTION_TYPE_LABELS,
  type QuestionGroup,
  type QuestionType,
} from "@meqyas/shared";
import { cn } from "@meqyas/ui";
import { LibraryIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { QUESTION_ICONS } from "../question-type-meta";

function PaletteItem({
  type,
  onAdd,
  disabled,
}: {
  type: QuestionType;
  onAdd: (t: QuestionType) => void;
  disabled: boolean;
}) {
  const locale = useLocale() as "ar" | "en";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, disabled });
  const Icon = QUESTION_ICONS[type];
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => onAdd(type)}
        disabled={disabled}
        {...attributes}
        {...listeners}
        className={cn(
          "flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-start text-sm transition hover:border-border hover:bg-card disabled:pointer-events-none disabled:opacity-50",
          isDragging && "opacity-40",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate">{label(QUESTION_TYPE_LABELS, type, locale)}</span>
      </button>
    </li>
  );
}

export function Palette({
  onAdd,
  disabled,
  onOpenBank,
}: {
  onAdd: (type: QuestionType) => void;
  disabled: boolean;
  onOpenBank?: () => void;
}) {
  const t = useTranslations("survey.builder");
  const tl = useTranslations("library.bank");
  return (
    <nav aria-label={t("palette")} className="grid content-start gap-4">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">{t("palette")}</h2>
      {(Object.keys(QUESTION_GROUPS) as QuestionGroup[]).map((group) => (
        <div key={group} className="grid gap-1">
          <h3 className="px-2.5 text-[11px] font-medium text-muted-foreground/80">{t(`groups.${group}`)}</h3>
          <ul className="grid gap-0.5">
            {QUESTION_GROUPS[group].map((type) => (
              <PaletteItem key={type} type={type} onAdd={onAdd} disabled={disabled} />
            ))}
          </ul>
        </div>
      ))}
      {onOpenBank ? (
        <button
          type="button"
          onClick={onOpenBank}
          disabled={disabled}
          className="flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-dashed px-2.5 py-2 text-start text-sm transition hover:bg-card disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LibraryIcon className="size-4" aria-hidden="true" />
          </span>
          {tl("fromBank")}
        </button>
      ) : null}
    </nav>
  );
}
