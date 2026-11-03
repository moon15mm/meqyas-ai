"""Recommendations and the grounded AI data analyst (ANALYTICS.md §9–10).

Both agents work only from facts the platform computed. Numbers they write must be
traceable to those facts (grounding check), and causal language is rejected unless the
project's evidence level supports attribution (causality guard).
"""

from __future__ import annotations

import re

from ..domain.causality import CLAIM_STRENGTH, find_causal_claims
from ..domain.enums import EvidenceLevel
from ..domain.grounding import strip_inline_citations, ungrounded_numbers, ungrounded_percentages
from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope, wrap_user_request
from ..providers.base import Message
from ..schemas.insight import (
    AnalystInput,
    AnalystOutput,
    RecommendationInput,
    RecommendationOut,
    RecommendationOutput,
)
from .base import Agent

_HEDGES = re.compile(r"^\s*(قد|ربما|يُحتمل|يحتمل|من المحتمل|فرضية|احتمال|possibly|perhaps|may|might|hypothesis)", re.I)


def _level(value: str) -> EvidenceLevel:
    try:
        return EvidenceLevel(value)
    except ValueError:
        return EvidenceLevel.DESCRIPTIVE


def _causal_issue(texts: list[str], level: EvidenceLevel) -> list[str]:
    if CLAIM_STRENGTH[level] >= CLAIM_STRENGTH[EvidenceLevel.ATTRIBUTION]:
        return []
    hits = sorted({h for t in texts for h in find_causal_claims(t)})
    if hits:
        return [
            "Causal wording is not allowed at evidence level "
            f"{level.value}: rewrite without {', '.join(hits[:5])} (describe change/association, not cause)."
        ]
    return []


RECOMMENDATION_PROMPT = (
    """\
You are an evaluation consultant at MEQYAS AI (مِقياس AI). The platform computed the insights below from real
survey data. Propose practical, specific recommendations that respond to them.

Each recommendation:
- insight_ids: the ids of the insights it addresses (at least one).
- problem: what the evidence shows, in one or two sentences. Do not add numbers that are not in the insights.
- recommendation: a concrete action (who does what, how), realistic for the organization.
- possible_cause: a HYPOTHESIS about why the problem exists — always phrase it as a possibility ("قد يكون…",
  "ربما…", "Possibly…"); it is not proven by the data.
- expected_outcome: what should improve and how it can be checked in the next measurement.
- priority (HIGH/MEDIUM/LOW) by severity and reach; confidence (HIGH/MEDIUM/LOW) by the strength of the evidence.
- owner_hint: the role best placed to act (e.g. "إدارة البرنامج", "المدربون"); timeframe (e.g. "خلال شهر").
Rules: never claim that the program caused results unless the evidence level is ATTRIBUTION; never invent
facts or numbers; write in the requested language; at most MAX recommendations, most important first.
"""
    + UNTRUSTED_NOTICE
)


class RecommendationAgent(Agent[RecommendationInput, RecommendationOutput, RecommendationOutput]):
    name = "recommendation_agent"
    prompt_version = "2026-10-11.1"
    input_model = RecommendationInput
    output_model = RecommendationOutput
    tier = "smart"
    temperature = 0.3
    max_output_tokens = 5000
    max_repairs = 2
    cache_ttl_s = 3600

    def build_messages(self, data: RecommendationInput) -> list[Message]:
        items = [
            UntrustedItem(
                id=i.id,
                text=f"[{i.kind} · {i.severity}] {i.title} — {i.body}"
                + (f" (evidence: {i.evidence})" if i.evidence else ""),
            )
            for i in data.insights
        ]
        user = "\n\n".join(
            [
                f"Language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Project: {data.project_title or '—'} · Type: {data.measurement_type or '—'}"
                f" · Population: {data.target_population or '—'}",
                f"Evidence level: {data.evidence_level}",
                f"MAX recommendations: {data.max_recommendations}",
                "Insights (the id attribute is the insight id):",
                envelope(items, source="computed_insights", max_item_chars=900),
                "Return the recommendations JSON now.",
            ]
        )
        return [
            Message("system", RECOMMENDATION_PROMPT.replace("MAX", str(data.max_recommendations))),
            Message("user", user),
        ]

    def semantic_issues(self, data: RecommendationInput, output: RecommendationOutput) -> list[str]:
        issues: list[str] = []
        ids = {i.id for i in data.insights}
        if output.recommendations and not any(set(r.insight_ids) & ids for r in output.recommendations):
            issues.append("insight_ids must reference the provided insight ids.")
        texts = [f"{r.problem} {r.recommendation} {r.expected_outcome}" for r in output.recommendations]
        issues += _causal_issue(texts, _level(data.evidence_level))
        sources = [f"{i.title} {i.body} {i.evidence}" for i in data.insights]
        stray = ungrounded_numbers(" ".join(r.problem for r in output.recommendations), sources)
        if stray:
            issues.append(f"These numbers are not in the insights: {stray[:5]}. Use only numbers from the insights.")
        return issues

    def recommendation_issues(self, data: RecommendationInput, rec: RecommendationOut) -> list[str]:
        """Problems that make one recommendation unsafe to show: invented numbers, causal wording."""
        sources = [f"{i.title} {i.body} {i.evidence}" for i in data.insights]
        text = f"{rec.problem} {rec.recommendation} {rec.expected_outcome}"
        issues = _causal_issue([text], _level(data.evidence_level))
        stray = ungrounded_numbers(rec.problem, sources)
        if stray:
            issues.append(f"Numbers not in the insights: {stray[:5]}.")
        return issues

    def post_process(self, data: RecommendationInput, output: RecommendationOutput) -> RecommendationOutput:
        ids = {i.id for i in data.insights}
        hedge = "فرضية: " if data.language == "ar" else "Hypothesis: "
        out: list[RecommendationOut] = []
        for r in output.recommendations[: data.max_recommendations]:
            linked = [i for i in dict.fromkeys(r.insight_ids) if i in ids]
            if not r.recommendation.strip():
                continue
            cause = r.possible_cause.strip()
            if cause and not _HEDGES.match(cause):
                cause = hedge + cause
            out.append(r.model_copy(update={"insight_ids": linked, "possible_cause": cause}))
        return RecommendationOutput(recommendations=out)


ANALYST_PROMPT = (
    """\
You are the data analyst of MEQYAS AI (مِقياس AI). Answer the user's question about their measurement results
using ONLY the facts provided. Each fact has an id, a label and a value computed by the platform.

Rules:
- Every number you write must be copied from a fact value. Never calculate, estimate or invent numbers.
- Keep each number's unit as in its fact: "75.5 / 100" is a score out of 100, not a percentage.
- List the ids of the facts you relied on in evidence_ids.
- If the facts cannot answer the question, say so plainly and say what data would be needed.
- Respect the evidence level: below ATTRIBUTION never say the program caused, led to or proved anything —
  describe change and association, and mention the limitation when relevant.
- Be concise (at most ~180 words), in the user's language, with short paragraphs or "- " bullets.
- follow_ups: up to 3 short questions the user could ask next.
"""
    + UNTRUSTED_NOTICE
)


class DataAnalystAgent(Agent[AnalystInput, AnalystOutput, AnalystOutput]):
    name = "data_analyst"
    prompt_version = "2026-10-11.1"
    input_model = AnalystInput
    output_model = AnalystOutput
    tier = "smart"
    temperature = 0.2
    max_output_tokens = 1800
    max_repairs = 2
    cache_ttl_s = 600

    def build_messages(self, data: AnalystInput) -> list[Message]:
        facts = [
            UntrustedItem(
                id=f.id,
                text=f"{f.label}: {f.value}"
                + (f" (n={f.n})" if f.n is not None else "")
                + (f" — {f.note}" if f.note else ""),
            )
            for f in data.facts
        ]
        history = "\n".join(
            (
                f"USER: {wrap_user_request(t.content, max_chars=1500)}"
                if t.role == "user"
                else f"ANALYST: {t.content[:1500]}"
            )
            for t in data.history[-8:]
        )
        user = "\n\n".join(
            [
                f"Language of the answer: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Project: {data.project_title or '—'} · Type: {data.measurement_type or '—'}",
                f"Evidence level: {data.evidence_level}. Limitation to respect: {data.caveat or '—'}",
                "Facts (the id attribute is the fact id):",
                envelope(facts, source="analytics_pack", max_item_chars=400, max_total_chars=40_000),
                f"Conversation so far:\n{history}" if history else "Conversation so far: (none)",
                "Question:",
                wrap_user_request(data.question, max_chars=2000),
                "Return the answer JSON now.",
            ]
        )
        return [Message("system", ANALYST_PROMPT), Message("user", user)]

    def semantic_issues(self, data: AnalystInput, output: AnalystOutput) -> list[str]:
        issues: list[str] = []
        ids = {f.id for f in data.facts}
        unknown = [i for i in output.evidence_ids if i not in ids]
        if unknown:
            issues.append(f"evidence_ids contains unknown ids {unknown[:5]}; cite only provided fact ids.")
        sources = [f"{f.label} {f.value} {f.n or ''} {f.note}" for f in data.facts]
        stray = ungrounded_numbers(output.answer, sources)
        if stray:
            issues.append(f"These numbers are not in any fact: {stray[:5]}. Copy numbers from facts only.")
        elif ungrounded_percentages(output.answer, sources):
            issues.append(
                f"{ungrounded_percentages(output.answer, sources)[:5]} are written as percentages but the facts give "
                "them in other units (e.g. a score out of 100). Keep each number's unit as in its fact."
            )
        issues += _causal_issue([output.answer], _level(data.evidence_level))
        return issues

    def post_process(self, data: AnalystInput, output: AnalystOutput) -> AnalystOutput:
        ids = {f.id for f in data.facts}
        return output.model_copy(
            update={
                "answer": strip_inline_citations(output.answer),
                "evidence_ids": [i for i in dict.fromkeys(output.evidence_ids) if i in ids],
                "follow_ups": [q.strip() for q in output.follow_ups if q.strip()][:3],
            }
        )
