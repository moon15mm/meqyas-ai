"""Sentiment and theme analysis of open-ended answers (ANALYTICS.md §7).

Answers are untrusted data (wrapped in envelopes). Theme counts are computed from the
model's per-answer assignments — the model never states how many answers mention a theme.
"""

from __future__ import annotations

import re
import unicodedata

from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope
from ..providers.base import Message
from ..schemas.insight import (
    SentimentInput,
    SentimentOutput,
    SentimentResultOut,
    ThemeInput,
    ThemeOut,
    ThemeOutput,
    ThemeResult,
)
from .base import Agent

SENTIMENT_PROMPT = (
    """\
You rate the sentiment of open-ended survey answers for MEQYAS AI (مِقياس AI).
For EVERY item return exactly one result with its id:
- label: POSITIVE (praise, satisfaction, benefit), NEGATIVE (complaint, problem, frustration, barrier),
  NEUTRAL (factual, no feeling, or a plain suggestion), MIXED (clearly both positive and negative).
- score: from -1 (very negative) to +1 (very positive); 0 for neutral.
- confidence: 0..1, lower for very short, sarcastic or ambiguous answers.
Judge the answer in the context of the question: describing a barrier in answer to "what stops you?" is NEGATIVE;
a constructive suggestion without complaint is NEUTRAL. Never skip an item, never invent ids.
"""
    + UNTRUSTED_NOTICE
)

THEME_PROMPT = (
    """\
You are a qualitative analyst at MEQYAS AI (مِقياس AI). Group open-ended survey answers into a few clear themes.

Return:
- themes: between 2 and MAX themes (fewer if answers are few). Each theme has:
  key (short latin slug, e.g. "time_pressure"), name (2–5 words in the survey language),
  description (one sentence in the survey language, grounded in what respondents actually wrote),
  category: STRENGTH (praise/what worked), PAIN_POINT (problem, complaint, barrier), SUGGESTION (proposal to
  improve), TOPIC (neutral subject), sentiment (POSITIVE/NEUTRAL/NEGATIVE/MIXED),
  keywords: 3–6 words or short phrases that appear in the answers.
- assignments: one entry per answer id with the keys of the themes that answer expresses (0–3 keys).
Themes must come from the answers — never add topics nobody mentioned. Merge near-duplicates.
Do not count answers yourself; the platform counts the assignments.
"""
    + UNTRUSTED_NOTICE
)

_SLUG = re.compile(r"[^a-z0-9_]+")


def _slug(value: str, fallback: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    slug = _SLUG.sub("_", ascii_text).strip("_")[:40]
    return slug or fallback


class SentimentAnalyzerAgent(Agent[SentimentInput, SentimentOutput, SentimentOutput]):
    name = "sentiment_analyzer"
    prompt_version = "2026-10-11.1"
    input_model = SentimentInput
    output_model = SentimentOutput
    tier = "fast"
    temperature = 0.1
    max_output_tokens = 2500
    max_repairs = 1
    cache_ttl_s = 7 * 24 * 3600

    def build_messages(self, data: SentimentInput) -> list[Message]:
        user = "\n\n".join(
            [
                f"Language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Question asked: {data.question or '—'}",
                "Answers (the id attribute is the item id):",
                envelope(
                    [UntrustedItem(id=i.id, text=i.text) for i in data.items],
                    source="survey_answers",
                    max_item_chars=800,
                ),
                "Return the sentiment JSON now.",
            ]
        )
        return [Message("system", SENTIMENT_PROMPT), Message("user", user)]

    def semantic_issues(self, data: SentimentInput, output: SentimentOutput) -> list[str]:
        returned = {r.id for r in output.results}
        missing = [i.id for i in data.items if i.id not in returned]
        if len(missing) > max(1, len(data.items) // 5):
            return [f"Results are missing for ids: {', '.join(missing[:20])}. Return one result per item."]
        return []

    def post_process(self, data: SentimentInput, output: SentimentOutput) -> SentimentOutput:
        ids = {i.id for i in data.items}
        seen: set[str] = set()
        results: list[SentimentResultOut] = []
        for r in output.results:
            if r.id in ids and r.id not in seen:
                seen.add(r.id)
                results.append(r)
        return SentimentOutput(results=results)


class ThemeAnalyzerAgent(Agent[ThemeInput, ThemeOutput, ThemeResult]):
    name = "theme_analyzer"
    prompt_version = "2026-10-11.1"
    input_model = ThemeInput
    output_model = ThemeOutput
    final_model = ThemeResult
    tier = "smart"
    temperature = 0.2
    max_output_tokens = 7000
    max_repairs = 1
    cache_ttl_s = 24 * 3600

    def build_messages(self, data: ThemeInput) -> list[Message]:
        user = "\n\n".join(
            [
                f"Language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Survey: {data.survey_title or '—'} · Population: {data.population or '—'}",
                f"Question asked: {data.question or '—'}",
                f"MAX themes: {data.max_themes}",
                "Answers (the id attribute is the answer id):",
                envelope(
                    [UntrustedItem(id=i.id, text=i.text) for i in data.items],
                    source="survey_answers",
                    max_item_chars=600,
                    max_total_chars=45_000,
                ),
                "Return the themes JSON now.",
            ]
        )
        return [Message("system", THEME_PROMPT.replace("MAX", str(data.max_themes))), Message("user", user)]

    def semantic_issues(self, data: ThemeInput, output: ThemeOutput) -> list[str]:
        if len(data.items) >= 3 and not any(a.themes for a in output.assignments):
            return ["assignments are empty: list, for each answer id, the keys of the themes it expresses."]
        return []

    def post_process(self, data: ThemeInput, output: ThemeOutput) -> ThemeResult:
        ids = {i.id for i in data.items}
        themes: list[ThemeOut] = []
        rename: dict[str, str] = {}
        for i, theme in enumerate(output.themes):
            key = _slug(theme.key or theme.name, f"theme_{i + 1}")
            while key in {t.key for t in themes}:
                key = f"{key}_{i + 1}"
            rename.setdefault(theme.key, key)
            themes.append(theme.model_copy(update={"key": key, "keywords": [k for k in theme.keywords if k][:6]}))
        valid = {t.key for t in themes}
        assignments: dict[str, list[str]] = {}
        for a in output.assignments:
            if a.id not in ids:
                continue
            keys = [rename.get(k, k) for k in a.themes]
            keys = [k for k in dict.fromkeys(keys) if k in valid][:3]
            if keys:
                assignments[a.id] = keys
        counts = {t.key: 0 for t in themes}
        for keys in assignments.values():
            for k in keys:
                counts[k] += 1
        kept = [t for t in themes if counts[t.key] > 0] or themes
        kept.sort(key=lambda t: -counts[t.key])
        kept = kept[: data.max_themes]
        allowed = {t.key for t in kept}
        assignments = {i: [k for k in ks if k in allowed] for i, ks in assignments.items()}
        assignments = {i: ks for i, ks in assignments.items() if ks}
        return ThemeResult(themes=kept, assignments=assignments, counts={k: counts[k] for k in allowed})
