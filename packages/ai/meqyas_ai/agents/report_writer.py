"""Report writer (Phase 7): drafts the narrative sections of a report around computed facts.

The platform renders every table, key figure, methodology note and limitation itself.
The writer only adds prose: each section cites the fact ids it relies on, every number
must be copied from those facts (grounding check), and causal wording is rejected below
the ATTRIBUTION evidence level.
"""

from __future__ import annotations

import re

from ..domain.grounding import numbers_in, strip_inline_citations, ungrounded_numbers, ungrounded_percentages
from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope
from ..providers.base import Message
from ..schemas.report import ReportSectionOut, ReportWriterInput, ReportWriterOutput
from .base import Agent
from .insight_agents import _causal_issue, _level

TONES = {
    "FORMAL": "formal, institutional register (فصحى رسمية in Arabic); measured, no hype or exclamation.",
    "PLAIN": (
        "plain language for non-specialists: short sentences; explain statistics in everyday words "
        "(say 'a clear difference' rather than citing d or p, unless the reader needs them)."
    ),
    "ANALYTICAL": (
        "analytical: refer to effect sizes, significance and consistency across waves; compare dimensions "
        "and groups; point out contrasts and caveats."
    ),
}
TYPES = {
    "EXECUTIVE": "an executive report for decision makers — brief, what matters most and what to do next.",
    "DETAILED": "a detailed results report for the program team — the full picture, section by section.",
    "IMPACT": "an impact report for funders and stakeholders — what changed, how strongly, and how sure we are.",
    "MANAGEMENT": "a management follow-up report — status against targets, risks, and decisions needed.",
    "ACADEMIC": "an academic-style report — neutral, structured, careful about method and limitations.",
}
MAX_PARAGRAPHS = 8
MAX_BULLETS = 10
_BULLET_MARK = re.compile(r"^\s*(?:[-•*·▪–]|\d{1,2}[.)-])\s*")
#: "النتيجة الأولى:", "Finding 2:" — labels the layout already provides.
_BULLET_LABEL = re.compile(r"^\s*(?:النتيجة|نتيجة|Finding|Result)\s+\S+\s*[:：]\s*", re.IGNORECASE)
_BOLD = re.compile(r"\*\*(.+?)\*\*")

PROMPT = (
    """\
You are the report writer of MEQYAS AI (مِقياس AI), writing the narrative sections of a measurement report.
The platform has already computed every number and will print the tables itself. You write only the prose
sections requested, in the requested language, tone and audience.

Rules:
- Use ONLY the facts and context provided. Every number you write must be copied exactly from a fact value
  (you may round to fewer decimals). Never calculate, combine, estimate or invent numbers, dates or names.
- For each section, list in evidence_ids the ids of the facts you relied on.
- Respect the evidence level: below ATTRIBUTION never say the program caused, led to, resulted in or proved
  anything — describe the change or association and state the limitation where relevant.
- Do not repeat the tables: interpret them — what stands out, what it means for the audience, what to watch.
- Keep every number's unit exactly as in its fact: "75.5 / 100" is a score out of 100, NOT a percentage;
  "3.64" on a 1–5 scale is a mean; only values written with % are percentages.
- Each claim uses ONE fact as labelled. Never mix measures: a dimension score, an indicator and a question
  result are different things — do not compare one measure with another measure's target.
- Do not state dates, durations or time spans (e.g. "after one month") unless a fact or the context gives them.
- Do not write fact ids inside the text — list them in evidence_ids only. No numbering or labels in bullets.
- Stay within each section's word limit. No headings inside sections, no markdown, no emojis.
- form "paragraphs": write 1–4 paragraphs; "bullets": short bullet sentences (no leading symbols);
  "mixed": one lead paragraph then bullets.
- If the facts are insufficient for a section, write one sentence saying what data is missing.
Return JSON: {"sections": [{"key", "paragraphs": [], "bullets": [], "evidence_ids": []}]} with every
requested key, in order.
"""
    + UNTRUSTED_NOTICE
)


def _clean(text: str) -> str:
    return strip_inline_citations(_BOLD.sub(r"\1", text))


def _words(section: ReportSectionOut) -> int:
    return sum(len(t.split()) for t in [*section.paragraphs, *section.bullets])


class ReportWriterAgent(Agent[ReportWriterInput, ReportWriterOutput, ReportWriterOutput]):
    name = "report_writer"
    prompt_version = "2026-10-11.1"
    input_model = ReportWriterInput
    output_model = ReportWriterOutput
    tier = "smart"
    temperature = 0.3
    max_output_tokens = 6000
    max_repairs = 2
    cache_ttl_s = 3600

    def output_budget(self, data: ReportWriterInput) -> int:
        # Arabic prose runs ~3 tokens per word, plus JSON keys and evidence ids per section.
        words = sum(s.max_words for s in data.sections)
        return max(1500, min(self.max_output_tokens, 400 + 3 * words + 120 * len(data.sections)))

    def build_messages(self, data: ReportWriterInput) -> list[Message]:
        facts = [
            UntrustedItem(
                id=f.id,
                text=f"{f.label}: {f.value}"
                + (f" (n={f.n})" if f.n is not None else "")
                + (f" — {f.note}" if f.note else ""),
            )
            for f in data.facts
        ]
        context = [UntrustedItem(id=c.id, text=f"{c.label}: {c.text}") for c in data.context]
        sections = "\n".join(
            f'- key "{s.key}" — {s.title}: {s.purpose} (form: {s.form}; at most {s.max_words} words)'
            for s in data.sections
        )
        user = "\n\n".join(
            [
                f"Language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Report: {TYPES.get(data.report_type, TYPES['EXECUTIVE'])}",
                f"Tone: {TONES.get(data.tone, TONES['FORMAL'])}",
                f"Audience: {data.audience or 'as implied by the report type'}",
                f"Project: {data.project_title or '—'} · Type: {data.measurement_type or '—'}"
                f" · Population: {data.target_population or '—'}",
                f"Evidence level: {data.evidence_level}. Limitation to respect: {data.caveat or '—'}",
                "Project context (written by the organization):",
                envelope(context, source="project_context", max_item_chars=1500) if context else "(none)",
                "Facts (the id attribute is the fact id):",
                envelope(facts, source="analytics_pack", max_item_chars=400, max_total_chars=45_000),
                f"Sections to write, in this order:\n{sections}",
                "Return the sections JSON now.",
            ]
        )
        return [Message("system", PROMPT), Message("user", user)]

    def section_issues(self, data: ReportWriterInput, section: ReportSectionOut) -> list[str]:
        """Problems that make one section unsafe to print: invented numbers or ids, causal wording."""
        issues: list[str] = []
        spec = next((s for s in data.sections if s.key == section.key), None)
        ids = {f.id for f in data.facts} | {c.id for c in data.context}
        unknown = [i for i in section.evidence_ids if i not in ids]
        if unknown:
            issues.append(f'Section "{section.key}": unknown evidence_ids {unknown[:6]}; cite only provided fact ids.')
        sources = [f"{f.label} {f.value} {f.n or ''} {f.note}" for f in data.facts] + [c.text for c in data.context]
        text = " ".join([*section.paragraphs, *section.bullets])
        stray = ungrounded_numbers(text, sources)
        if stray:
            issues.append(
                f'Section "{section.key}": these numbers are not in any fact: {stray[:5]}. Copy numbers from facts only.'
            )
        elif ungrounded_percentages(text, sources):
            issues.append(
                f'Section "{section.key}": {ungrounded_percentages(text, sources)[:5]} are written as percentages but '
                "the facts give them in other units (e.g. a score out of 100). Keep each number's unit as in its fact."
            )
        elif numbers_in(text) and not section.evidence_ids:
            issues.append(f'Section "{section.key}" uses numbers: list the fact ids it relies on in evidence_ids.')
        if spec is not None and _words(section) > spec.max_words * 2:
            issues.append(f'Section "{section.key}" is too long: keep it under {spec.max_words} words.')
        causal = _causal_issue([text], _level(data.evidence_level))
        issues += [f'Section "{section.key}": {c}' for c in causal]
        return issues

    def semantic_issues(self, data: ReportWriterInput, output: ReportWriterOutput) -> list[str]:
        by_key = {s.key: s for s in output.sections}
        missing = [s.key for s in data.sections if not (by_key.get(s.key) and _words(by_key[s.key]))]
        issues = [f"Write every requested section; missing or empty: {missing}."] if missing else []
        for section in output.sections:
            issues += self.section_issues(data, section)
        return issues

    def post_process(self, data: ReportWriterInput, output: ReportWriterOutput) -> ReportWriterOutput:
        ids = {f.id for f in data.facts}
        by_key = {s.key: s for s in output.sections}
        out: list[ReportSectionOut] = []
        for spec in data.sections:
            section = by_key.get(spec.key)
            if section is None:
                continue
            raw_paragraphs, raw_bullets = section.paragraphs, section.bullets
            if spec.form == "bullets" and not raw_bullets:  # a list written as paragraphs
                raw_paragraphs, raw_bullets = [], raw_paragraphs
            paragraphs = [p for p in (_clean(x) for x in raw_paragraphs) if p]
            bullets = [b for b in (_clean(_BULLET_LABEL.sub("", _BULLET_MARK.sub("", x))) for x in raw_bullets) if b]
            out.append(
                ReportSectionOut(
                    key=spec.key,
                    paragraphs=paragraphs[:MAX_PARAGRAPHS],
                    bullets=bullets[:MAX_BULLETS],
                    evidence_ids=[i for i in dict.fromkeys(section.evidence_ids) if i in ids],
                )
            )
        return ReportWriterOutput(sections=out)
