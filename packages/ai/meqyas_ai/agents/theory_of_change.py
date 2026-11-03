"""Theory of Change (Phase 8): the causal hypothesis behind a program, drafted from its plan.

A theory of change states what the program assumes will happen (inputs → activities →
outputs → outcomes → impact). Outcomes are linked to the project's real indicator codes so
each one can be checked against measured data; the agent may not invent indicators,
numbers or targets.
"""

from __future__ import annotations

from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope
from ..providers.base import Message
from ..schemas.toc import TocInput, TocOutcome, TocOutput
from .base import Agent

MAX_ITEMS = 8
MAX_CHARS = 240
_COLUMNS = ("inputs", "activities", "outputs", "assumptions", "risks")
_OUTCOMES = ("short_term_outcomes", "medium_term_outcomes", "long_term_impact")

PROMPT = (
    """\
You are an evaluation designer at MEQYAS AI (مِقياس AI). Draft a Theory of Change for the program described
below, in the requested language. It is a hypothesis about how change happens, used to plan measurement.

- inputs: resources the program uses (people, time, budget lines, materials, partners) — 2 to 5 items.
- activities: what the program does — 2 to 6 items, each starting with a verb.
- outputs: direct, countable deliverables of the activities (sessions held, people trained…) — 2 to 5 items.
- short_term_outcomes: changes in participants soon after (knowledge, skills, attitudes, confidence).
- medium_term_outcomes: changes in behaviour or practice that follow.
- long_term_impact: the lasting change the program contributes to — 1 to 2 items.
- For every outcome, list in indicator_codes the codes of the PROVIDED indicators that measure it
  (use each indicator at least once where it fits; an outcome may have none). Never invent indicator codes.
- assumptions: conditions that must hold for each step to lead to the next — 2 to 5 items.
- risks: what could break the chain — 2 to 5 items.
Rules: short, concrete items (one sentence, at most 25 words); no numbers, targets or dates that are not in the
plan; at most 8 items per list; no markdown.
"""
    + UNTRUSTED_NOTICE
)


def _clean(text: str) -> str:
    return " ".join((text or "").split()).strip(" -•*")[:MAX_CHARS]


def _unique(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in (_clean(i) for i in items):
        if item and item not in out:
            out.append(item)
    return out[:MAX_ITEMS]


class TheoryOfChangeAgent(Agent[TocInput, TocOutput, TocOutput]):
    name = "theory_of_change"
    prompt_version = "2026-10-11.1"
    input_model = TocInput
    output_model = TocOutput
    tier = "smart"
    temperature = 0.3
    max_output_tokens = 3500
    max_repairs = 2
    cache_ttl_s = 3600

    def build_messages(self, data: TocInput) -> list[Message]:
        context = [
            UntrustedItem(id="purpose", text=data.purpose),
            UntrustedItem(id="description", text=data.description),
            *(UntrustedItem(id=f"objective_{i + 1}", text=o) for i, o in enumerate(data.objectives)),
            *(UntrustedItem(id=f"dimension_{i + 1}", text=d) for i, d in enumerate(data.dimensions)),
            *(UntrustedItem(id=f"note_{i + 1}", text=n) for i, n in enumerate([data.notes] if data.notes else [])),
        ]
        indicators = [
            UntrustedItem(id=i.code, text=f"{i.name}" + (f" (dimension: {i.dimension})" if i.dimension else ""))
            for i in data.indicators
        ]
        user = "\n\n".join(
            [
                f"Language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Program: {data.project_title or '—'} · Type: {data.measurement_type or '—'}"
                f" · Population: {data.target_population or '—'}",
                f"Measurement waves: {', '.join(data.waves) or '—'}",
                "Plan (written by the organization):",
                envelope([c for c in context if c.text.strip()], source="measurement_plan", max_item_chars=1500),
                "Indicators (the id attribute is the indicator code):",
                envelope(indicators, source="indicators", max_item_chars=300) if indicators else "(none)",
                "Return the Theory of Change JSON now.",
            ]
        )
        return [Message("system", PROMPT), Message("user", user)]

    def semantic_issues(self, data: TocInput, output: TocOutput) -> list[str]:
        issues: list[str] = []
        empty = [
            c
            for c in ("inputs", "activities", "outputs", "short_term_outcomes", "long_term_impact")
            if not getattr(output, c)
        ]
        if empty:
            issues.append(f"These lists must not be empty: {empty}.")
        codes = {i.code for i in data.indicators}
        unknown = sorted(
            {c for col in _OUTCOMES for o in getattr(output, col) for c in o.indicator_codes if c not in codes}
        )
        if unknown:
            issues.append(f"Unknown indicator codes {unknown[:6]}: use only the provided codes.")
        linked = {c for col in _OUTCOMES for o in getattr(output, col) for c in o.indicator_codes}
        if codes and len(linked & codes) < len(codes) / 2:
            issues.append("Link the provided indicators to the outcomes they measure (most indicators are unlinked).")
        return issues

    def post_process(self, data: TocInput, output: TocOutput) -> TocOutput:
        codes = {i.code for i in data.indicators}
        update: dict[str, object] = {c: _unique(getattr(output, c)) for c in _COLUMNS}
        for col in _OUTCOMES:
            seen: list[TocOutcome] = []
            for o in getattr(output, col):
                text = _clean(o.text)
                if text and all(text != s.text for s in seen):
                    seen.append(
                        TocOutcome(
                            text=text, indicator_codes=[c for c in dict.fromkeys(o.indicator_codes) if c in codes]
                        )
                    )
            update[col] = seen[:MAX_ITEMS]
        return output.model_copy(update=update)
