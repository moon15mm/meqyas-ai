"use client";

import {
  ANSWERABLE_TYPES,
  CHOICE_TYPES,
  FIXED_SCALES,
  KEY_PATTERN,
  label,
  likertOptions,
  LIKERT_PRESETS,
  type LikertPreset,
  newQuestion,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type Dimension,
  type Indicator,
  type QuestionDoc,
  type QuestionType,
  type SurveyDoc,
} from "@meqyas/shared";
import {
  Button,
  Field,
  Input,
  Label,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@meqyas/ui";
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { NumericInput } from "@/components/common/numeric-input";

import { DisplayLogicEditor, SkipLogicEditor } from "./logic-editor";
import { OptionsEditor, RowsEditor } from "./options-editor";
import type { Builder } from "./use-builder";
import { SaveToBankButton } from "./question-bank";

const selectClass = "h-10 w-full rounded-lg border border-input bg-card px-3 text-base md:text-sm";
const CHOICE_LIKE = new Set<QuestionType>([...CHOICE_TYPES, "RANKING"]);
/** Scale questions that can be the CX outcome or one of its drivers (key driver analysis). */
const CX_SCALES = new Set<QuestionType>(["NPS", "CSAT", "CES", "STAR", "RATING", "LIKERT", "SLIDER"]);

/** Change a question's type while keeping what still makes sense. */
function convertQuestion(q: QuestionDoc, type: QuestionType, language: "ar" | "en"): QuestionDoc {
  const fresh = newQuestion(type, language, []);
  const keepOptions = CHOICE_LIKE.has(q.type) && CHOICE_LIKE.has(type);
  return {
    ...fresh,
    key: q.key,
    lineage_id: q.lineage_id,
    text: q.text || fresh.text,
    description: q.description,
    required: ANSWERABLE_TYPES.has(type) ? q.required : false,
    dimension_id: q.dimension_id,
    indicator_id: q.indicator_id,
    options: keepOptions ? q.options : fresh.options,
    settings: {
      ...fresh.settings,
      is_profile: q.settings.is_profile,
      rows: type === "MATRIX" && q.settings.rows.length ? q.settings.rows : fresh.settings.rows,
    },
    ai_generated: q.ai_generated,
  };
}

function SwitchRow({
  id,
  label: text,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{text}</Label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
}

function NumberField({
  id,
  label: text,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <Field id={id} label={text}>
      <NumericInput
        value={value}
        onValueChange={(n, raw) => {
          if (n !== null || raw.trim() === "") onChange(n);
        }}
        className="h-9"
      />
    </Field>
  );
}

function QuestionSettings({
  builder,
  question,
  dimensions,
  indicators,
  advanced,
}: {
  builder: Builder;
  question: QuestionDoc;
  dimensions: Dimension[];
  indicators: Indicator[];
  advanced: boolean;
}) {
  const t = useTranslations("survey.builder");
  const locale = useLocale() as "ar" | "en";
  const update = (patch: Partial<QuestionDoc>) => builder.actions.updateQuestion(question.key, patch);
  const updateSettings = (patch: Partial<QuestionDoc["settings"]>) =>
    update({ settings: { ...question.settings, ...patch } });
  const updateValidation = (patch: Partial<QuestionDoc["validation"]>) =>
    update({ validation: { ...question.validation, ...patch } });
  const answerable = ANSWERABLE_TYPES.has(question.type);
  const [keyDraft, setKeyDraft] = React.useState(question.key);
  React.useEffect(() => setKeyDraft(question.key), [question.key]);
  const filteredIndicators = indicators.filter(
    (i) => !question.dimension_id || i.dimension_id === question.dimension_id,
  );
  const scale = question.scale;

  return (
    <Tabs defaultValue="question" dir={locale === "ar" ? "rtl" : "ltr"} className="grid gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="question" className="flex-1">
          {t("settings")}
        </TabsTrigger>
        <TabsTrigger
          value="logic"
          className="flex-1"
          disabled={!answerable && question.type !== "INFORMATION"}
        >
          {t("logic")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="question" className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="qs-type">{t("type")}</Label>
          <select
            id="qs-type"
            className={selectClass}
            value={question.type}
            onChange={(e) => update(convertQuestion(question, e.target.value as QuestionType, locale))}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(QUESTION_TYPE_LABELS, type, locale)}
              </option>
            ))}
          </select>
        </div>
        <Field id="qs-text" label={t("questionText")}>
          <Textarea
            rows={3}
            value={question.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder={t("questionTextPlaceholder")}
            maxLength={1000}
          />
        </Field>
        {answerable ? (
          <>
            <Field id="qs-desc" label={t("description")}>
              <Input
                value={question.description}
                onChange={(e) => update({ description: e.target.value })}
                maxLength={2000}
              />
            </Field>
            <SwitchRow
              id="qs-required"
              label={t("required")}
              checked={question.required}
              onChange={(v) => update({ required: v })}
            />
            <Separator />
            <div className="grid gap-2">
              <Label htmlFor="qs-dim">{t("dimension")}</Label>
              <select
                id="qs-dim"
                className={selectClass}
                value={question.dimension_id ?? ""}
                disabled={question.settings.is_profile}
                onChange={(e) => update({ dimension_id: e.target.value || null, indicator_id: null })}
              >
                <option value="">{t("none")}</option>
                {dimensions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qs-ind">{t("indicator")}</Label>
              <select
                id="qs-ind"
                className={selectClass}
                value={question.indicator_id ?? ""}
                disabled={question.settings.is_profile}
                onChange={(e) => update({ indicator_id: e.target.value || null })}
              >
                <option value="">{t("none")}</option>
                {filteredIndicators.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </select>
            </div>
            <SwitchRow
              id="qs-profile"
              label={t("profile")}
              hint={t("profileHint")}
              checked={question.settings.is_profile}
              onChange={(v) =>
                update({
                  settings: { ...question.settings, is_profile: v },
                  ...(v ? { dimension_id: null, indicator_id: null } : {}),
                })
              }
            />
            {question.type !== "FILE" ? (
              <SwitchRow
                id="qs-followup"
                label={t("aiFollowup")}
                hint={t("aiFollowupHint")}
                checked={question.settings.ai_followup}
                onChange={(v) => updateSettings({ ai_followup: v })}
              />
            ) : null}
            {CX_SCALES.has(question.type) && !question.settings.is_profile ? (
              <div className="grid gap-1">
                <Label htmlFor="qs-cx-role">{t("cx.role")}</Label>
                <select
                  id="qs-cx-role"
                  className={selectClass}
                  value={question.settings.cx_role ?? ""}
                  onChange={(e) =>
                    updateSettings({ cx_role: (e.target.value || null) as "outcome" | "driver" | null })
                  }
                  aria-describedby="qs-cx-role-hint"
                >
                  <option value="">{t("cx.roles.none")}</option>
                  <option value="outcome">{t("cx.roles.outcome")}</option>
                  <option value="driver">{t("cx.roles.driver")}</option>
                </select>
                <p id="qs-cx-role-hint" className="text-xs text-muted-foreground">
                  {t("cx.roleHint")}
                </p>
              </div>
            ) : null}
            {question.type === "SHORT_TEXT" ? (
              <div className="grid gap-1">
                <Label htmlFor="qs-contact">{t("cx.contact")}</Label>
                <select
                  id="qs-contact"
                  className={selectClass}
                  value={question.settings.contact_field ?? ""}
                  onChange={(e) =>
                    updateSettings({ contact_field: (e.target.value || null) as "phone" | "email" | null })
                  }
                  aria-describedby="qs-contact-hint"
                >
                  <option value="">{t("cx.contacts.none")}</option>
                  <option value="phone">{t("cx.contacts.phone")}</option>
                  <option value="email">{t("cx.contacts.email")}</option>
                </select>
                <p id="qs-contact-hint" className="text-xs text-muted-foreground">
                  {t("cx.contactHint")}
                </p>
                {question.settings.contact_field && !builder.doc.settings.closed_loop ? (
                  <p role="status" className="text-xs font-medium text-warning-foreground dark:text-warning">
                    {t("cx.contactNeedsLoop")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <Separator />
          </>
        ) : null}

        {CHOICE_LIKE.has(question.type) ? (
          <>
            <OptionsEditor
              question={question}
              label={t("options")}
              advanced={advanced}
              onChange={(options) => update({ options })}
              allowFlags={question.type !== "RANKING"}
            />
            <SwitchRow
              id="qs-random"
              label={t("randomizeOptions")}
              checked={question.settings.randomize_options}
              onChange={(v) => updateSettings({ randomize_options: v })}
            />
          </>
        ) : null}

        {question.type === "LIKERT" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="qs-likert-points">{t("scale")}</Label>
                <select
                  id="qs-likert-points"
                  className={selectClass}
                  value={question.options.length}
                  onChange={(e) => {
                    const points = Number(e.target.value);
                    const next = {
                      min: 1,
                      max: points,
                      step: 1,
                      min_label: scale?.min_label ?? "",
                      max_label: scale?.max_label ?? "",
                      reverse_scored: scale?.reverse_scored ?? false,
                    };
                    update({ scale: next, options: likertOptions(next, locale) });
                  }}
                >
                  {[3, 4, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      1–{n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="qs-likert-preset">{locale === "ar" ? "قالب المقياس" : "Scale Preset"}</Label>
                <select
                  id="qs-likert-preset"
                  className={selectClass}
                  defaultValue="agreement"
                  onChange={(e) => {
                    const preset = e.target.value as LikertPreset;
                    const points = question.options.length || 5;
                    const next = {
                      min: 1,
                      max: points,
                      step: 1,
                      min_label: scale?.min_label ?? "",
                      max_label: scale?.max_label ?? "",
                      reverse_scored: scale?.reverse_scored ?? false,
                    };
                    update({ scale: next, options: likertOptions(next, locale, preset) });
                  }}
                >
                  {Object.entries(LIKERT_PRESETS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item[locale as "ar" | "en"]?.name ?? key}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <OptionsEditor
              question={question}
              label={t("columns")}
              advanced={advanced}
              fixedCount
              allowFlags={false}
              onChange={(options) => update({ options })}
            />
          </>
        ) : null}

        {question.type === "MATRIX" ? (
          <>
            <RowsEditor question={question} onChange={(rows) => updateSettings({ rows })} />
            <OptionsEditor
              question={question}
              label={t("columns")}
              advanced={advanced}
              allowFlags={false}
              onChange={(options) => update({ options })}
            />
          </>
        ) : null}

        {scale && question.type !== "LIKERT" && question.type !== "MATRIX" ? (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{t("scale")}</legend>
            {!FIXED_SCALES[question.type] ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  id="qs-smin"
                  label={t("scaleMin")}
                  value={scale.min}
                  onChange={(v) =>
                    v !== null && v < scale.max && update({ scale: { ...scale, min: Math.round(v) } })
                  }
                />
                <NumberField
                  id="qs-smax"
                  label={t("scaleMax")}
                  value={scale.max}
                  onChange={(v) =>
                    v !== null &&
                    v > scale.min &&
                    update({
                      scale: { ...scale, max: Math.min(question.type === "STAR" ? 10 : 100, Math.round(v)) },
                    })
                  }
                />
              </div>
            ) : null}
            <Field id="qs-minlabel" label={t("minLabel")}>
              <Input
                value={scale.min_label}
                maxLength={120}
                onChange={(e) => update({ scale: { ...scale, min_label: e.target.value } })}
                className="h-9"
              />
            </Field>
            <Field id="qs-maxlabel" label={t("maxLabel")}>
              <Input
                value={scale.max_label}
                maxLength={120}
                onChange={(e) => update({ scale: { ...scale, max_label: e.target.value } })}
                className="h-9"
              />
            </Field>
            {question.type === "SLIDER" ? (
              <NumberField
                id="qs-step"
                label={t("step")}
                value={scale.step}
                onChange={(v) => v && v > 0 && update({ scale: { ...scale, step: v } })}
              />
            ) : null}
          </fieldset>
        ) : null}

        {question.type === "SHORT_TEXT" || question.type === "LONG_TEXT" ? (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{t("validation")}</legend>
            <Field id="qs-placeholder" label={t("placeholder")}>
              <Input
                value={question.settings.placeholder}
                maxLength={200}
                onChange={(e) => updateSettings({ placeholder: e.target.value })}
                className="h-9"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                id="qs-minlen"
                label={t("minLength")}
                value={question.validation.min_length}
                onChange={(v) => updateValidation({ min_length: v })}
              />
              <NumberField
                id="qs-maxlen"
                label={t("maxLength")}
                value={question.validation.max_length}
                onChange={(v) => updateValidation({ max_length: v })}
              />
            </div>
          </fieldset>
        ) : null}
        {question.type === "NUMBER" ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="qs-min"
              label={t("minValue")}
              value={question.validation.min}
              onChange={(v) => updateValidation({ min: v })}
            />
            <NumberField
              id="qs-max"
              label={t("maxValue")}
              value={question.validation.max}
              onChange={(v) => updateValidation({ max: v })}
            />
          </div>
        ) : null}
        {question.type === "MULTIPLE_CHOICE" ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="qs-minc"
              label={t("minChoices")}
              value={question.validation.min_choices}
              onChange={(v) => updateValidation({ min_choices: v })}
            />
            <NumberField
              id="qs-maxc"
              label={t("maxChoices")}
              value={question.validation.max_choices}
              onChange={(v) => updateValidation({ max_choices: v })}
            />
          </div>
        ) : null}

        {advanced && answerable && scale ? (
          <SwitchRow
            id="qs-reverse"
            label={t("reverseScored")}
            checked={scale.reverse_scored}
            onChange={(v) => update({ scale: { ...scale, reverse_scored: v } })}
          />
        ) : null}

        {advanced ? (
          <Field
            id="qs-key"
            label={t("key")}
            hint={t("keyHint")}
            error={KEY_PATTERN.test(keyDraft) ? undefined : t("keyHint")}
          >
            <Input
              dir="ltr"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value.toLowerCase())}
              onBlur={() => {
                const taken = builder.doc.sections.flatMap((s) => [s.key, ...s.questions.map((q) => q.key)]);
                if (keyDraft !== question.key && KEY_PATTERN.test(keyDraft) && !taken.includes(keyDraft)) {
                  builder.actions.renameQuestion(question.key, keyDraft);
                  builder.setSelection({ kind: "question", key: keyDraft });
                } else setKeyDraft(question.key);
              }}
              className="h-9 font-mono"
            />
          </Field>
        ) : null}
      </TabsContent>

      <TabsContent value="logic" className="grid gap-5">
        <DisplayLogicEditor doc={builder.doc} question={question} onRulesChange={builder.actions.setLogic} />
        {answerable ? (
          <>
            <Separator />
            <SkipLogicEditor doc={builder.doc} question={question} onRulesChange={builder.actions.setLogic} />
          </>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

function SectionSettings({ builder, sectionKey }: { builder: Builder; sectionKey: string }) {
  const t = useTranslations("survey.builder");
  const section = builder.doc.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const index = builder.doc.sections.indexOf(section);
  return (
    <div className="grid gap-4">
      <Field id="ss-title" label={t("sectionTitle")}>
        <Input
          value={section.title}
          maxLength={300}
          onChange={(e) => builder.actions.updateSection(section.key, { title: e.target.value })}
        />
      </Field>
      <Field id="ss-desc" label={t("sectionDescription")}>
        <Textarea
          rows={3}
          value={section.description}
          maxLength={2000}
          onChange={(e) => builder.actions.updateSection(section.key, { description: e.target.value })}
        />
      </Field>
      <SwitchRow
        id="ss-random"
        label={t("randomizeQuestions")}
        checked={section.randomize_questions}
        onChange={(v) => builder.actions.updateSection(section.key, { randomize_questions: v })}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => builder.actions.moveSection(section.key, -1)}
        >
          <ChevronUpIcon aria-hidden="true" />
          {t("moveUp")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={index === builder.doc.sections.length - 1}
          onClick={() => builder.actions.moveSection(section.key, 1)}
        >
          <ChevronDownIcon aria-hidden="true" />
          {t("moveDown")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={builder.doc.sections.length <= 1}
          onClick={() => builder.actions.deleteSection(section.key)}
        >
          <Trash2Icon aria-hidden="true" />
          {t("delete")}
        </Button>
      </div>
    </div>
  );
}

function SurveySettings({ builder }: { builder: Builder }) {
  const t = useTranslations("survey.builder");
  const doc: SurveyDoc = builder.doc;
  const s = doc.settings;
  return (
    <div className="grid gap-4">
      <Field id="sv-title" label={t("title")} required>
        <Input
          value={doc.title}
          maxLength={300}
          onChange={(e) => builder.actions.setMeta({ title: e.target.value })}
        />
      </Field>
      <Field id="sv-intro" label={t("introduction")}>
        <Textarea
          rows={4}
          value={doc.introduction}
          maxLength={5000}
          onChange={(e) => builder.actions.setMeta({ introduction: e.target.value })}
        />
      </Field>
      <Field id="sv-thanks" label={t("thankYou")}>
        <Textarea
          rows={2}
          value={doc.thank_you_message}
          maxLength={2000}
          onChange={(e) => builder.actions.setMeta({ thank_you_message: e.target.value })}
        />
      </Field>
      <div className="grid gap-2">
        <Label htmlFor="sv-lang">{t("language")}</Label>
        <select
          id="sv-lang"
          className={selectClass}
          value={doc.language}
          onChange={(e) => builder.actions.setMeta({ language: e.target.value as "ar" | "en" })}
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </div>
      <Separator />
      <div className="grid gap-2">
        <Label htmlFor="sv-anon">{t("anonymity")}</Label>
        <select
          id="sv-anon"
          className={selectClass}
          value={s.anonymity_mode}
          onChange={(e) =>
            builder.actions.setSettings({
              anonymity_mode: e.target.value as SurveyDoc["settings"]["anonymity_mode"],
            })
          }
        >
          {(["ANONYMOUS", "PSEUDONYMOUS", "IDENTIFIED"] as const).map((m) => (
            <option key={m} value={m}>
              {t(`anonymityModes.${m}`)}
            </option>
          ))}
        </select>
      </div>
      <SwitchRow
        id="sv-code"
        label={t("collectCode")}
        hint={t("collectCodeHint")}
        checked={s.collect_respondent_code}
        onChange={(v) => builder.actions.setSettings({ collect_respondent_code: v })}
      />
      <SwitchRow
        id="sv-onepage"
        label={t("onePerPage")}
        checked={s.one_question_per_page}
        onChange={(v) => builder.actions.setSettings({ one_question_per_page: v })}
      />
      <SwitchRow
        id="sv-progress"
        label={t("showProgress")}
        checked={s.show_progress}
        onChange={(v) => builder.actions.setSettings({ show_progress: v })}
      />
      <SwitchRow
        id="sv-back"
        label={t("allowBack")}
        checked={s.allow_back}
        onChange={(v) => builder.actions.setSettings({ allow_back: v })}
      />
      <SwitchRow
        id="sv-ai"
        label={t("aiFollowupEnabled")}
        hint={t("aiFollowupHint")}
        checked={s.ai_followup_enabled}
        onChange={(v) => builder.actions.setSettings({ ai_followup_enabled: v })}
      />
      {s.ai_followup_enabled ? (
        <div className="grid gap-2">
          <Label htmlFor="sv-aimax">{t("aiFollowupMax")}</Label>
          <select
            id="sv-aimax"
            className={selectClass}
            value={s.ai_followup_max}
            onChange={(e) => builder.actions.setSettings({ ai_followup_max: Number(e.target.value) })}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Separator />
      <p className="text-sm font-semibold">{t("cx.title")}</p>
      <SwitchRow
        id="sv-pulse"
        label={t("cx.pulse")}
        hint={t("cx.pulseHint")}
        checked={s.experience === "pulse"}
        onChange={(v) => builder.actions.setSettings({ experience: v ? "pulse" : "standard" })}
      />
      <SwitchRow
        id="sv-closed-loop"
        label={t("cx.closedLoop")}
        hint={t("cx.closedLoopHint")}
        checked={s.closed_loop}
        onChange={(v) => builder.actions.setSettings({ closed_loop: v })}
      />
      <Field id="sv-reward" label={t("cx.reward")}>
        <Input
          value={s.reward_text}
          maxLength={300}
          placeholder={t("cx.rewardPlaceholder")}
          onChange={(e) => builder.actions.setSettings({ reward_text: e.target.value })}
        />
      </Field>
    </div>
  );
}

export function SettingsPanel({
  builder,
  dimensions,
  indicators,
  advanced,
  editable,
}: {
  builder: Builder;
  dimensions: Dimension[];
  indicators: Indicator[];
  advanced: boolean;
  editable: boolean;
}) {
  const t = useTranslations("survey.builder");
  const sel = builder.selection;
  const question =
    sel.kind === "question"
      ? builder.doc.sections.flatMap((s) => s.questions).find((q) => q.key === sel.key)
      : undefined;
  const title =
    sel.kind === "question"
      ? t("settings")
      : sel.kind === "section"
        ? t("sectionTitle")
        : t("surveySettings");
  return (
    <aside aria-label={title} className="grid content-start gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sel.kind !== "survey" ? (
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => builder.setSelection({ kind: "survey" })}
          >
            {t("surveySettings")}
          </Button>
        ) : null}
      </div>
      <fieldset disabled={!editable} className="grid min-w-0 gap-4">
        {question ? (
          <>
            <QuestionSettings
              key={question.key}
              builder={builder}
              question={question}
              dimensions={dimensions}
              indicators={indicators}
              advanced={advanced}
            />
            <SaveToBankButton
              question={question}
              topic={dimensions.find((d) => d.id === question.dimension_id)?.name ?? ""}
            />
          </>
        ) : sel.kind === "section" ? (
          <SectionSettings builder={builder} sectionKey={sel.key} />
        ) : (
          <SurveySettings builder={builder} />
        )}
      </fieldset>
    </aside>
  );
}
