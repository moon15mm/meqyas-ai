"use client";

import type {
  IndicatorStatus,
  ReportBarsSection,
  ReportContent,
  ReportNarrativeSection,
  ReportSection,
  ReportTableSection,
  Severity,
} from "@meqyas/shared";
import { Badge, cn, Textarea } from "@meqyas/ui";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  HourglassIcon,
  CircleXIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { Num } from "@/components/analytics/format";
import { ordinalColors } from "@/components/analytics/viz";

/*
 * A report is a document in its own language: direction, labels and number formats come
 * from the report (content.language), not from the interface. The sheet always uses the
 * light palette (.paper-light) so the screen matches the printed/PDF page.
 */

const DOC = {
  ar: {
    prepared: "تاريخ الإعداد",
    period: "فترة البيانات",
    evidence: "مستوى الدليل",
    version: "الإصدار",
    audience: "موجّه إلى",
    sources: "المصادر",
    sourcesDraft: "مصادر المسودة الأصلية",
    aiNote: "صاغه الذكاء الاصطناعي من الأرقام المحسوبة فقط",
    ruleNote: "مستخلص من الاستنتاجات المحسوبة",
    userNote: "حرّره فريق المشروع",
    hidden: "مخفي من التقرير",
    hide: "إخفاء هذا القسم",
    paragraphs: "الفقرات (افصل بين الفقرات بسطر فارغ)",
    bullets: "النقاط (نقطة في كل سطر)",
    tableNote: "الأرقام في هذا القسم محسوبة من البيانات ولا تُحرَّر.",
    problem: "المشكلة",
    cause: "السبب المحتمل",
    outcome: "النتيجة المتوقعة",
    owner: "المسؤول",
    timeframe: "المدة",
    priority: "الأولوية",
    status: "الحالة",
    fact: "الرقم",
    value: "القيمة",
    chartTable: "جدول بيانات المخطط",
    footer: "مِقياس AI — من الفكرة إلى الدليل",
  },
  en: {
    prepared: "Prepared",
    period: "Data period",
    evidence: "Evidence level",
    version: "Version",
    audience: "Prepared for",
    sources: "Sources",
    sourcesDraft: "Sources of the original draft",
    aiNote: "Drafted by AI from the computed figures only",
    ruleNote: "Assembled from the computed insights",
    userNote: "Edited by the project team",
    hidden: "Hidden from the report",
    hide: "Hide this section",
    paragraphs: "Paragraphs (separate paragraphs with a blank line)",
    bullets: "Bullet points (one per line)",
    tableNote: "Figures in this section are computed from the data and cannot be edited.",
    problem: "Problem",
    cause: "Possible cause",
    outcome: "Expected outcome",
    owner: "Owner",
    timeframe: "Timeframe",
    priority: "Priority",
    status: "Status",
    fact: "Figure",
    value: "Value",
    chartTable: "Chart data table",
    footer: "MEQYAS AI — from idea to evidence",
  },
} as const;
type DocText = (typeof DOC)["ar"] | (typeof DOC)["en"];

const STATUS_META: Record<
  IndicatorStatus,
  { icon: LucideIcon; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  ACHIEVED: { icon: CircleCheckIcon, variant: "success" },
  ON_TRACK: { icon: TrendingUpIcon, variant: "success" },
  AT_RISK: { icon: TriangleAlertIcon, variant: "warning" },
  OFF_TRACK: { icon: CircleXIcon, variant: "destructive" },
  NOT_STARTED: { icon: CircleDashedIcon, variant: "outline" },
  COLLECTING: { icon: HourglassIcon, variant: "outline" },
};
const SEVERITY_VARIANT: Record<Severity, "destructive" | "warning" | "outline" | "soft"> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "outline",
  INFO: "soft",
};
const ARABIC = /[؀-ۿ]/;
/** A left-to-right run inside Arabic text: Latin words, numbers, signs and statistics ("d = 2.16 (p < 0.001)"). */
const LTR_RUN = /[(+\-−]?[A-Za-z0-9][A-Za-z0-9+\-−=<>≤≥%.,:/()\s]*[A-Za-z0-9%)]|[A-Za-z0-9]/g;

/** Tokens that bind their neighbours into one expression: Latin words and operators. */
const JOINS = /[A-Za-z]|^[=<>≤≥±×/]+$/;

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** Splits Arabic prose into RTL text and LTR runs (signs, operators, statistics) to isolate. */
export function splitBidi(text: string): Array<{ text: string; ltr: boolean }> {
  if (!ARABIC.test(text)) return [{ text, ltr: false }];
  const parts: Array<{ text: string; ltr: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(LTR_RUN)) {
    let start = m.index;
    let run = m[0];
    // An unmatched bracket at an edge belongs to the surrounding Arabic text: «(أثر كبير d = 1.3)».
    if (count(run, "(") > count(run, ")") && run.startsWith("(")) {
      run = run.slice(1);
      start += 1;
    }
    if (count(run, ")") > count(run, "(") && run.endsWith(")")) run = run.slice(0, -1);
    run = run.trimEnd();
    if (!/[A-Za-z0-9]/.test(run)) continue;
    if (start > last) parts.push({ text: text.slice(last, start), ltr: false });
    // Separate numbers keep the sentence's RTL order («3.64 (+1.31)»); only an expression with
    // Latin letters or operators («d = 1.30 (p < 0.001)») is one left-to-right span.
    const tokens = run.split(/(\s+)/);
    let group = tokens[0];
    for (let i = 2; i < tokens.length; i += 2) {
      const prev = tokens[i - 2];
      const next = tokens[i];
      if (JOINS.test(prev) || JOINS.test(next) || next.startsWith("%")) group += tokens[i - 1] + next;
      else {
        parts.push({ text: group, ltr: true }, { text: tokens[i - 1], ltr: false });
        group = next;
      }
    }
    parts.push({ text: group, ltr: true });
    last = start + run.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), ltr: false });
  return parts;
}

/** Isolates LTR runs so the bidi algorithm never reorders signs, operators or brackets in RTL prose. */
function BidiText({ text }: { text: string }) {
  return (
    <>
      {splitBidi(text).map((p, i) =>
        p.ltr ? (
          <bdi key={i} dir="ltr">
            {p.text}
          </bdi>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/** Cells without Arabic letters (numbers, ranges, "75.5 (n=35)") are isolated left-to-right. */
function Cell({ text }: { text: string }) {
  return ARABIC.test(text) ? <BidiText text={text} /> : <Num>{text}</Num>;
}

export interface SectionDraft {
  paragraphs?: string;
  bullets?: string;
  hidden?: boolean;
}

function SourceLine({
  section,
  doc,
  appendix,
}: {
  section: ReportNarrativeSection;
  doc: DocText;
  appendix: boolean;
}) {
  const note = section.source === "AI" ? doc.aiNote : section.source === "USER" ? doc.userNote : doc.ruleNote;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{note}</span>
      {section.evidence_ids.length ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{section.source === "USER" ? doc.sourcesDraft : doc.sources}:</span>
          {section.evidence_ids.map((id) =>
            appendix ? (
              <a
                key={id}
                href={`#fact-${id}`}
                className="rounded border px-1 font-mono text-[11px] hover:bg-muted"
              >
                {id}
              </a>
            ) : (
              <span key={id} className="rounded border px-1 font-mono text-[11px]">
                {id}
              </span>
            ),
          )}
        </>
      ) : null}
    </p>
  );
}

function Narrative({
  section,
  doc,
  appendix,
  editing,
  draft,
  onDraft,
}: {
  section: ReportNarrativeSection;
  doc: DocText;
  appendix: boolean;
  editing: boolean;
  draft?: SectionDraft;
  onDraft: (patch: SectionDraft) => void;
}) {
  if (editing) {
    const paragraphs = draft?.paragraphs ?? section.paragraphs.join("\n\n");
    const bullets = draft?.bullets ?? section.bullets.join("\n");
    return (
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {doc.paragraphs}
          <Textarea
            rows={Math.min(14, Math.max(3, paragraphs.split("\n").length + 1))}
            value={paragraphs}
            onChange={(e) => onDraft({ paragraphs: e.target.value })}
            className="text-sm leading-7 text-foreground"
          />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {doc.bullets}
          <Textarea
            rows={Math.min(12, Math.max(2, bullets.split("\n").length + 1))}
            value={bullets}
            onChange={(e) => onDraft({ bullets: e.target.value })}
            className="text-sm leading-7 text-foreground"
          />
        </label>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {section.paragraphs.map((p, i) => (
        <p key={i} className="leading-8 text-pretty">
          <BidiText text={p} />
        </p>
      ))}
      {section.bullets.length ? (
        <ul className="grid list-disc gap-1.5 ps-5 leading-7 marker:text-muted-foreground">
          {section.bullets.map((b, i) => (
            <li key={i} className="text-pretty">
              <BidiText text={b} />
            </li>
          ))}
        </ul>
      ) : null}
      <SourceLine section={section} doc={doc} appendix={appendix} />
    </div>
  );
}

function Table({ section }: { section: ReportTableSection }) {
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-xl border print:overflow-visible">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              {section.columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className="px-3 py-2 text-start align-bottom text-xs font-semibold text-muted-foreground"
                >
                  <Cell text={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, r) => (
              <tr key={r} className="border-t align-top">
                {row.map((cell, c) => {
                  const status = c === section.status_column ? section.statuses?.[r] : undefined;
                  const meta = status ? STATUS_META[status] : undefined;
                  return (
                    <td key={c} className={cn("px-3 py-2", c === 0 && "font-medium")}>
                      {meta ? (
                        <Badge variant={meta.variant}>
                          <meta.icon aria-hidden="true" />
                          {cell}
                        </Badge>
                      ) : (
                        <Cell text={cell} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.note ? <p className="text-xs text-muted-foreground">{section.note}</p> : null}
    </div>
  );
}

/** Grouped horizontal bars (one per wave, ordinal ramp) with values printed at the bar end. */
function Bars({
  section,
  doc,
  format,
}: {
  section: ReportBarsSection;
  doc: DocText;
  format: (v: number) => string;
}) {
  const colors = ordinalColors(section.series.length);
  return (
    <figure className="grid gap-3">
      {section.series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {section.series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: colors[i] }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-4" aria-hidden="true">
        {section.rows.map((row) => (
          <div key={row.label} className="report-avoid-break grid gap-1.5">
            <p className="text-sm font-medium">{row.label}</p>
            <div className="grid gap-[3px]">
              {row.values.map((v, i) => (
                <div key={section.series[i]?.key ?? i} className="flex items-center gap-2">
                  <div className="h-3.5 min-w-0 flex-1">
                    {v !== null ? (
                      <div
                        className="h-full rounded-e-[4px]"
                        style={{ width: `${Math.max(1, (v / section.max) * 100)}%`, background: colors[i] }}
                      />
                    ) : null}
                  </div>
                  <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {v !== null ? <Num>{format(v)}</Num> : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{doc.chartTable}</caption>
        <thead>
          <tr>
            <th scope="col">{section.title}</th>
            {section.series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => (
                <td key={i}>{v !== null ? format(v) : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {section.note ? (
        <figcaption className="text-xs text-muted-foreground">{section.note}</figcaption>
      ) : null}
    </figure>
  );
}

function Body({
  section,
  doc,
  format,
  appendix,
  editing,
  draft,
  onDraft,
}: {
  section: ReportSection;
  doc: DocText;
  format: (v: number) => string;
  appendix: boolean;
  editing: boolean;
  draft?: SectionDraft;
  onDraft: (patch: SectionDraft) => void;
}) {
  switch (section.kind) {
    case "narrative":
      return (
        <Narrative
          section={section}
          doc={doc}
          appendix={appendix}
          editing={editing}
          draft={draft}
          onDraft={onDraft}
        />
      );
    case "kpis":
      return (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {section.items.map((it) => (
            <div key={it.label} className="report-avoid-break grid gap-0.5 rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">{it.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                <Cell text={it.value} />
              </dd>
              {it.note ? <dd className="text-xs text-muted-foreground">{it.note}</dd> : null}
            </div>
          ))}
        </dl>
      );
    case "definitions":
      return (
        <div className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            {section.items.map((it) => (
              <React.Fragment key={it.label}>
                <dt className="text-muted-foreground">{it.label}</dt>
                <dd className="font-medium">
                  <Cell text={it.value} />
                </dd>
              </React.Fragment>
            ))}
          </dl>
          {section.paragraphs.map((p, i) => (
            <p key={i} className="leading-8 text-pretty">
              <BidiText text={p} />
            </p>
          ))}
        </div>
      );
    case "table":
      return <Table section={section} />;
    case "bars":
      return <Bars section={section} doc={doc} format={format} />;
    case "insights":
      return (
        <ul className="grid gap-3">
          {section.items.map((it, i) => (
            <li key={i} className="report-avoid-break grid gap-1.5 rounded-xl border p-3">
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="outline">{it.label}</Badge>
                <Badge variant={SEVERITY_VARIANT[it.severity]}>{it.severity_label}</Badge>
              </span>
              <p className="font-semibold text-pretty">
                <BidiText text={it.title} />
              </p>
              <p className="text-sm leading-7 text-pretty text-muted-foreground">
                <BidiText text={it.body} />
              </p>
            </li>
          ))}
        </ul>
      );
    case "recommendations":
      return (
        <ol className="grid gap-3">
          {section.items.map((it, i) => (
            <li key={i} className="report-avoid-break grid gap-2 rounded-xl border p-3">
              <p className="font-semibold text-pretty">
                {`${i + 1}. `}
                <BidiText text={it.recommendation} />
              </p>
              <dl className="grid gap-1 text-sm">
                {(
                  [
                    [doc.problem, it.problem],
                    [doc.cause, it.possible_cause],
                    [doc.outcome, it.expected_outcome],
                  ] as const
                ).map(([label, value]) =>
                  value ? (
                    <div key={label} className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-pretty">
                        <BidiText text={value} />
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {doc.priority}: {it.priority_label}
                </span>
                <span>
                  {doc.status}: {it.status_label}
                </span>
                {it.owner ? (
                  <span>
                    {doc.owner}: {it.owner}
                  </span>
                ) : null}
                {it.timeframe ? (
                  <span>
                    {doc.timeframe}: {it.timeframe}
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      );
    case "facts":
      return (
        <div className="overflow-x-auto rounded-xl border print:overflow-visible">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                  #
                </th>
                <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                  {doc.fact}
                </th>
                <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                  {doc.value}
                </th>
                <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                  n
                </th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((f) => (
                <tr
                  key={f.id}
                  id={`fact-${f.id}`}
                  className="scroll-mt-24 border-t align-top target:bg-primary/10"
                >
                  <td className="px-3 py-2 font-mono text-xs">{f.id}</td>
                  <td className="px-3 py-2">
                    <BidiText text={f.label} />
                  </td>
                  <td className="px-3 py-2">
                    <Cell text={f.value} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{f.n ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function ReportDocument({
  content,
  version,
  editing = false,
  drafts = {},
  onDraft = () => {},
}: {
  content: ReportContent;
  version: number;
  editing?: boolean;
  drafts?: Record<string, SectionDraft>;
  onDraft?: (key: string, patch: SectionDraft) => void;
}) {
  const lang = content.language === "en" ? "en" : "ar";
  const doc = DOC[lang];
  const tag = lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB";
  const date = new Intl.DateTimeFormat(tag, { dateStyle: "long" });
  const number = new Intl.NumberFormat(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    maximumFractionDigits: 1,
  });
  const format = (v: number) => number.format(v);
  const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));
  const hiddenOf = (s: ReportSection) => drafts[s.key]?.hidden ?? s.hidden;
  const visible = content.sections.filter((s) => editing || !hiddenOf(s));
  const appendix = content.sections.some((s) => s.kind === "facts" && !hiddenOf(s));
  let index = 0;

  return (
    <article
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="paper-light report-paper mx-auto w-full max-w-[860px] rounded-2xl border bg-card p-6 text-[15px] leading-7 text-card-foreground shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
    >
      <header className="grid gap-3 border-b pb-6">
        <div aria-hidden="true" className="h-1.5 w-16 rounded-full bg-primary" />
        <p className="text-sm text-muted-foreground">{content.organization}</p>
        <h1 className="text-2xl font-bold text-balance sm:text-3xl">{content.title}</h1>
        <p className="text-muted-foreground">
          {content.type_label} · {content.project_title}
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{doc.prepared}</dt>
            <dd className="font-medium">{date.format(new Date(content.generated_at))}</dd>
          </div>
          {content.data_range ? (
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{doc.period}</dt>
              <dd className="font-medium">
                {day(content.data_range.from)} — {day(content.data_range.to)}
              </dd>
            </div>
          ) : null}
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{doc.evidence}</dt>
            <dd className="font-medium">{content.evidence_label}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{doc.version}</dt>
            <dd className="font-medium tabular-nums">{version}</dd>
          </div>
          {content.audience ? (
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{doc.audience}</dt>
              <dd className="font-medium">{content.audience}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {visible.map((section) => {
        const hidden = hiddenOf(section);
        if (!hidden) index += 1;
        return (
          <section
            key={section.key}
            id={`sec-${section.key}`}
            aria-labelledby={`sec-${section.key}-title`}
            className={cn("report-section grid gap-4 border-b py-7 last:border-b-0", hidden && "opacity-50")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`sec-${section.key}-title`} className="text-lg font-semibold text-balance">
                {hidden ? null : `${index}. `}
                {section.title}
              </h2>
              {editing ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground print:hidden">
                  {hidden ? <Badge variant="outline">{doc.hidden}</Badge> : null}
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={hidden}
                    onChange={(e) => onDraft(section.key, { hidden: e.target.checked })}
                  />
                  <span>{doc.hide}</span>
                </label>
              ) : null}
            </div>
            {editing && section.kind !== "narrative" ? (
              <p className="text-xs text-muted-foreground print:hidden">{doc.tableNote}</p>
            ) : null}
            <Body
              section={section}
              doc={doc}
              format={format}
              appendix={appendix}
              editing={editing}
              draft={drafts[section.key]}
              onDraft={(patch) => onDraft(section.key, patch)}
            />
          </section>
        );
      })}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
        <span>{content.caveat}</span>
        <span>{doc.footer}</span>
      </footer>
    </article>
  );
}
