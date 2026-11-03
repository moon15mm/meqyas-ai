"use client";

import {
  allKeys,
  newKey,
  newQuestion,
  newSection,
  newUuid,
  type LogicRuleDoc,
  type QuestionDoc,
  type QuestionType,
  type SectionDoc,
  type SurveyDetail,
  type SurveyDoc,
} from "@meqyas/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { surveyApi } from "@/lib/api/endpoints";

export type Selection =
  { kind: "question"; key: string } | { kind: "section"; key: string } | { kind: "survey" };
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 1200;

function referencesKey(rule: LogicRuleDoc, key: string): boolean {
  return (
    rule.source_key === key ||
    rule.target_key === key ||
    JSON.stringify(rule.condition ?? {}).includes(`"${key}"`)
  );
}

function mapQuestions(doc: SurveyDoc, fn: (q: QuestionDoc) => QuestionDoc): SurveyDoc {
  return { ...doc, sections: doc.sections.map((s) => ({ ...s, questions: s.questions.map(fn) })) };
}

export function useSurveyBuilder(detail: SurveyDetail, editable: boolean) {
  const queryClient = useQueryClient();
  const surveyId = detail.survey.id;
  const [doc, setDocState] = React.useState<SurveyDoc>(detail.doc);
  const [selection, setSelection] = React.useState<Selection>({ kind: "survey" });
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const revision = React.useRef(0);
  const savedRevision = React.useRef(0);
  const docRef = React.useRef(doc);
  docRef.current = doc;

  const save = useMutation({
    mutationFn: ({ next }: { next: SurveyDoc; rev: number }) => surveyApi.saveDraft(surveyId, next),
    onSuccess: (fresh, { rev }) => {
      queryClient.setQueryData(["survey", surveyId], fresh);
      savedRevision.current = Math.max(savedRevision.current, rev);
      if (rev === revision.current) {
        // No edits while saving: adopt the normalized server document.
        setDocState(fresh.doc);
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
    },
    onError: () => setSaveState("error"),
  });

  // Debounced autosave
  React.useEffect(() => {
    if (saveState !== "dirty" || !editable) return;
    const rev = revision.current;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      save.mutate({ next: docRef.current, rev });
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState, doc, editable]);

  // Warn before leaving with unsaved edits
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /** Replace local state with a fresh server document (after publish, review actions…). */
  const reset = React.useCallback((fresh: SurveyDetail) => {
    revision.current += 1;
    savedRevision.current = revision.current;
    setDocState(fresh.doc);
    setSaveState("idle");
  }, []);

  const update = React.useCallback(
    (fn: (d: SurveyDoc) => SurveyDoc) => {
      if (!editable) return;
      revision.current += 1;
      setDocState((d) => fn(d));
      setSaveState("dirty");
    },
    [editable],
  );

  const flush = React.useCallback(async () => {
    if (revision.current === savedRevision.current) return;
    setSaveState("saving");
    await save.mutateAsync({ next: docRef.current, rev: revision.current });
  }, [save]);

  // ------------------------------------------------------------- actions
  const actions = React.useMemo(
    () => ({
      setMeta: (
        patch: Partial<Pick<SurveyDoc, "title" | "introduction" | "thank_you_message" | "language">>,
      ) => update((d) => ({ ...d, ...patch })),
      setSettings: (patch: Partial<SurveyDoc["settings"]>) =>
        update((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
      addQuestion: (
        type: QuestionType,
        sectionKey?: string,
        index?: number,
        template?: Partial<QuestionDoc>,
      ) => {
        // Build outside the state updater (updaters run later, during render).
        const current = docRef.current;
        const fresh = newQuestion(type, current.language, allKeys(current));
        // A question from the bank keeps its wording and options, never its identity or project links.
        const q: QuestionDoc = template
          ? {
              ...fresh,
              ...template,
              type,
              key: fresh.key,
              lineage_id: fresh.lineage_id,
              dimension_id: null,
              indicator_id: null,
              ai_generated: false,
              settings: { ...fresh.settings, ...template.settings },
              validation: { ...fresh.validation, ...template.validation },
              scoring: { ...fresh.scoring, ...template.scoring },
            }
          : fresh;
        const targetKey =
          sectionKey ??
          (selection.kind === "question"
            ? current.sections.find((s) => s.questions.some((x) => x.key === selection.key))?.key
            : selection.kind === "section"
              ? selection.key
              : undefined) ??
          current.sections[current.sections.length - 1]!.key;
        const afterSelected = index === undefined && selection.kind === "question" ? selection.key : null;
        update((d) => ({
          ...d,
          sections: d.sections.map((s) => {
            if (s.key !== targetKey) return s;
            const questions = [...s.questions];
            let at = index ?? questions.length;
            if (afterSelected) {
              const selected = questions.findIndex((x) => x.key === afterSelected);
              if (selected >= 0) at = selected + 1;
            }
            questions.splice(at, 0, q);
            return { ...s, questions };
          }),
        }));
        setSelection({ kind: "question", key: q.key });
      },
      updateQuestion: (key: string, patch: Partial<QuestionDoc>) =>
        update((d) => mapQuestions(d, (q) => (q.key === key ? { ...q, ...patch } : q))),
      renameQuestion: (oldKey: string, newKeyValue: string) =>
        update((d) => {
          const renameCondition = (c: unknown): unknown =>
            JSON.parse(
              JSON.stringify(c ?? {})
                .split(`"${oldKey}"`)
                .join(`"${newKeyValue}"`),
            );
          return {
            ...mapQuestions(d, (q) => (q.key === oldKey ? { ...q, key: newKeyValue } : q)),
            logic: d.logic.map((r) => ({
              ...r,
              source_key: r.source_key === oldKey ? newKeyValue : r.source_key,
              target_key: r.target_key === oldKey ? newKeyValue : r.target_key,
              condition: renameCondition(r.condition) as LogicRuleDoc["condition"],
            })),
          };
        }),
      duplicateQuestion: (key: string) => {
        const copyKey = newKey("q", allKeys(docRef.current));
        update((d) => ({
          ...d,
          sections: d.sections.map((s) => {
            const i = s.questions.findIndex((q) => q.key === key);
            if (i < 0) return s;
            const copy: QuestionDoc = {
              ...structuredClone(s.questions[i]!),
              key: copyKey,
              lineage_id: newUuid(),
              ai_generated: false,
            };
            const questions = [...s.questions];
            questions.splice(i + 1, 0, copy);
            return { ...s, questions };
          }),
        }));
        setSelection({ kind: "question", key: copyKey });
      },
      deleteQuestion: (key: string) => {
        update((d) => ({
          ...d,
          sections: d.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => q.key !== key) })),
          logic: d.logic.filter((r) => !referencesKey(r, key)),
        }));
        setSelection({ kind: "survey" });
      },
      moveQuestion: (key: string, toSection: string, toIndex: number) =>
        update((d) => {
          let moving: QuestionDoc | undefined;
          const without = d.sections.map((s) => {
            const q = s.questions.find((x) => x.key === key);
            if (q) moving = q;
            return { ...s, questions: s.questions.filter((x) => x.key !== key) };
          });
          if (!moving) return d;
          return {
            ...d,
            sections: without.map((s) => {
              if (s.key !== toSection) return s;
              const questions = [...s.questions];
              questions.splice(Math.max(0, Math.min(toIndex, questions.length)), 0, moving!);
              return { ...s, questions };
            }),
          };
        }),
      addSection: () => {
        const section: SectionDoc = newSection(docRef.current.language, allKeys(docRef.current));
        update((d) => ({ ...d, sections: [...d.sections, section] }));
        setSelection({ kind: "section", key: section.key });
      },
      updateSection: (key: string, patch: Partial<SectionDoc>) =>
        update((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) })),
      deleteSection: (key: string) => {
        update((d) => {
          if (d.sections.length <= 1) return d;
          const removed = d.sections.find((s) => s.key === key);
          const gone = new Set([key, ...(removed?.questions.map((q) => q.key) ?? [])]);
          return {
            ...d,
            sections: d.sections.filter((s) => s.key !== key),
            logic: d.logic.filter((r) => ![...gone].some((k) => referencesKey(r, k))),
          };
        });
        setSelection({ kind: "survey" });
      },
      moveSection: (key: string, delta: -1 | 1) =>
        update((d) => {
          const i = d.sections.findIndex((s) => s.key === key);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= d.sections.length) return d;
          const sections = [...d.sections];
          [sections[i], sections[j]] = [sections[j]!, sections[i]!];
          return { ...d, sections };
        }),
      setLogic: (fn: (rules: LogicRuleDoc[]) => LogicRuleDoc[]) =>
        update((d) => ({ ...d, logic: fn(d.logic) })),
    }),
    [update, selection],
  );

  return { doc, selection, setSelection, saveState, actions, reset, flush, saving: save.isPending };
}

export type Builder = ReturnType<typeof useSurveyBuilder>;
