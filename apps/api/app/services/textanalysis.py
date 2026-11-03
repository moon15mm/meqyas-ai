"""Open-answer analysis per question (ANALYTICS.md §7): deterministic keywords always,
AI sentiment and themes when the organization's AI is available.

Only answers that count in analytics are read (quality filter, no test answers). The
model sees short ids (a1, a2…) instead of database ids and never sees respondent data
other than the answer text itself.
"""

from __future__ import annotations

import logging
import uuid
from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.agents import SentimentAnalyzerAgent, ThemeAnalyzerAgent
from meqyas_ai.errors import AIError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import NotFound
from ..domain import text as textmine
from ..domain.enums import QuestionType, SentimentLabel, ThemeCategory
from ..domain.permissions import Permission
from ..domain.survey.templates import PLACEHOLDER_FALLBACK, fill_placeholders
from ..models import Answer, AnswerSentiment, AnswerTheme, Project, TextAnalysis, Theme
from . import analytics
from .ai import run_agent
from .projects import get_owned

logger = logging.getLogger("meqyas.text")

TEXT_TYPES = (QuestionType.SHORT_TEXT, QuestionType.LONG_TEXT)
MAX_ANSWERS = 300
SENTIMENT_BATCH = 25
THEME_ITEMS = 150
_sentiment = SentimentAnalyzerAgent()
_themes = ThemeAnalyzerAgent()


def _language(ds: analytics.Dataset) -> str:
    langs = [d.language for d in ds.docs.values()]
    return langs[-1] if langs else "ar"


async def _answers(session: AsyncSession, ds: analytics.Dataset, key: str) -> list[tuple[uuid.UUID, str, datetime]]:
    """(answer id, text, submitted at) of included responses, newest first."""
    included = {r.id: r.created_at for r in ds.rows}
    if not included or not ds.surveys:
        return []
    rows = await session.execute(
        select(Answer.id, Answer.response_id, Answer.text_value).where(
            Answer.survey_id.in_(list(ds.surveys)),
            Answer.question_key == key,
            Answer.is_followup.is_(False),
            Answer.text_value.is_not(None),
        )
    )
    out = [
        (aid, text.strip(), included[rid]) for aid, rid, text in rows.all() if rid in included and text and text.strip()
    ]
    out.sort(key=lambda a: a[2], reverse=True)
    return out


def _question_text(ds: analytics.Dataset, key: str) -> str:
    q = ds.questions.get(key)
    if q is None:
        return ""
    lang = _language(ds)
    return fill_placeholders(q.text, PLACEHOLDER_FALLBACK.get(lang, PLACEHOLDER_FALLBACK["ar"]))


async def _dataset(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> analytics.Dataset:
    return await analytics.load_dataset(session, ctx, project_id)


# ------------------------------------------------------------------ summary
async def project_text_questions(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, *, raw: bool
) -> list[dict[str, Any]]:
    """Every open question of the project with its latest analysis (aggregates; samples only with raw)."""
    ds = await _dataset(session, ctx, project_id)
    out = []
    for key, q in ds.questions.items():
        if q.type not in TEXT_TYPES:
            continue
        out.append(await _summary(session, ds, key, raw=raw, question_text=_question_text(ds, key)))
    return out


async def _summary(
    session: AsyncSession, ds: analytics.Dataset, key: str, *, raw: bool, question_text: str
) -> dict[str, Any]:
    answers = await _answers(session, ds, key)
    ids = [a[0] for a in answers]
    analysis = await session.scalar(
        select(TextAnalysis).where(TextAnalysis.project_id == ds.project.id, TextAnalysis.question_key == key)
    )
    base: dict[str, Any] = {
        "question_key": key,
        "question_text": question_text,
        "answers": len(answers),
        "masked": 0 < len(answers) < analytics.K_ANON,
        "analyzed_at": analysis.analyzed_at if analysis else None,
        "answers_analyzed": analysis.answers_analyzed if analysis else 0,
        "parts": analysis.parts if analysis else {},
        "keywords": [],
        "sentiment": None,
        "themes": [],
    }
    if base["masked"] or not answers:
        return base
    # Always live: cheap, deterministic, and never stale when answers arrive after an AI run.
    base["keywords"] = [{"term": k.term, "answers": k.answers} for k in textmine.keywords(a[1] for a in answers)]
    labels = dict(
        (
            await session.execute(
                select(AnswerSentiment.answer_id, AnswerSentiment.label).where(AnswerSentiment.answer_id.in_(ids))
            )
        ).all()
    )
    if labels:
        counts = Counter(label.value for label in labels.values())
        rated = sum(counts.values())
        base["sentiment"] = {
            "rated": rated,
            "counts": {s.value: counts.get(s.value, 0) for s in SentimentLabel},
            "pct": {s.value: round(counts.get(s.value, 0) / rated * 100, 1) for s in SentimentLabel},
        }
    themes = (
        await session.scalars(
            select(Theme).where(Theme.project_id == ds.project.id, Theme.question_key == key).order_by(Theme.sort_order)
        )
    ).all()
    if themes:
        theme_answers: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
        for aid, tid in (
            await session.execute(
                select(AnswerTheme.answer_id, AnswerTheme.theme_id).where(
                    AnswerTheme.theme_id.in_([t.id for t in themes]), AnswerTheme.answer_id.in_(ids)
                )
            )
        ).all():
            theme_answers[tid].append(aid)
        text_of = {a[0]: a[1] for a in answers}
        analyzed = max(1, base["answers_analyzed"] or len(answers))
        for t in themes:
            mentions = len(theme_answers.get(t.id, []))
            entry = {
                "id": t.id,
                "key": t.key,
                "name": t.name,
                "description": t.description,
                "category": t.category.value,
                "sentiment": t.sentiment.value,
                "keywords": t.keywords,
                "count": mentions,
                "share": round(mentions / analyzed * 100, 1),
            }
            if raw:
                entry["samples"] = [text_of[a] for a in theme_answers.get(t.id, [])[:3] if a in text_of]
            base["themes"].append(entry)
    return base


# ------------------------------------------------------------------ analyze
async def analyze_question(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, key: str, *, use_ai: bool = True
) -> dict[str, Any]:
    ctx.require(Permission.AI_ANALYZE)
    project = await get_owned(session, Project, project_id, ctx)
    ds = await _dataset(session, ctx, project.id)
    q = ds.questions.get(key)
    if q is None or q.type not in TEXT_TYPES:
        raise NotFound("Open question not found in the published surveys of this project")
    answers = (await _answers(session, ds, key))[:MAX_ANSWERS]
    lang = _language(ds)
    question = _question_text(ds, key)
    parts: dict[str, Any] = {}

    analysis = await session.scalar(
        select(TextAnalysis).where(TextAnalysis.project_id == project.id, TextAnalysis.question_key == key)
    )
    if analysis is None:
        analysis = TextAnalysis(organization_id=ctx.organization_id, project_id=project.id, question_key=key)
        session.add(analysis)
    analysis.keywords = [{"term": k.term, "answers": k.answers} for k in textmine.keywords(a[1] for a in answers)]
    analysis.answers_total = len(answers)
    analysis.created_by_id = ctx.user_id

    if use_ai and len(answers) >= analytics.K_ANON:
        parts["sentiment"] = await _run_sentiment(session, ctx, project, answers, question, lang)
        parts["themes"] = await _run_themes(session, ctx, project, key, answers, question, lang, ds)
    elif use_ai:
        parts["ai"] = {"ok": False, "error": "too_few_answers"}
    rated = (
        await session.scalars(
            select(AnswerSentiment.answer_id).where(AnswerSentiment.answer_id.in_([a[0] for a in answers]))
        )
    ).all()
    analysis.answers_analyzed = len(rated)
    analysis.parts = parts
    analysis.analyzed_at = datetime.now(UTC)
    await session.commit()
    return await _summary(session, ds, key, raw=ctx.can(Permission.RESPONSES_READ_RAW), question_text=question)


async def _run_sentiment(
    session: AsyncSession,
    ctx: OrgContext,
    project: Project,
    answers: list[tuple[uuid.UUID, str, datetime]],
    question: str,
    lang: str,
) -> dict[str, Any]:
    done = set(
        (
            await session.scalars(
                select(AnswerSentiment.answer_id).where(AnswerSentiment.answer_id.in_([a[0] for a in answers]))
            )
        ).all()
    )
    todo = [a for a in answers if a[0] not in done]
    rated = 0
    try:
        for start in range(0, len(todo), SENTIMENT_BATCH):
            batch = todo[start : start + SENTIMENT_BATCH]
            short = {f"a{i + 1}": a[0] for i, a in enumerate(batch)}
            result, run = await run_agent(
                session,
                organization=ctx.organization,
                user_id=ctx.user_id,
                agent=_sentiment,
                data={
                    "language": lang,
                    "question": question,
                    "items": [{"id": sid, "text": a[1]} for sid, a in zip(short, batch, strict=True)],
                },
                entity_type="project",
                entity_id=project.id,
            )
            for r in result.output.results:
                session.add(
                    AnswerSentiment(
                        organization_id=ctx.organization_id,
                        answer_id=short[r.id],
                        label=SentimentLabel(r.label),
                        score=r.score,
                        confidence=r.confidence,
                        model=run.model or "",
                    )
                )
                rated += 1
            await session.flush()
    except AIError as exc:
        logger.warning("sentiment analysis stopped: %s", exc.code)
        return {"ok": False, "error": exc.code, "rated": rated}
    return {"ok": True, "rated": rated + len(done)}


async def _run_themes(
    session: AsyncSession,
    ctx: OrgContext,
    project: Project,
    key: str,
    answers: list[tuple[uuid.UUID, str, datetime]],
    question: str,
    lang: str,
    ds: analytics.Dataset,
) -> dict[str, Any]:
    # Identical answers are sent once; every duplicate inherits the themes of its representative.
    groups: dict[str, list[uuid.UUID]] = defaultdict(list)
    first_text: dict[str, str] = {}
    for aid, text, _ in answers:
        norm = " ".join(textmine.normalize_ar(text).lower().split())
        groups[norm].append(aid)
        first_text.setdefault(norm, text)
    reps = list(groups)[:THEME_ITEMS]
    short = {f"a{i + 1}": rep for i, rep in enumerate(reps)}
    survey_title = next(iter(ds.docs.values())).title if ds.docs else ""
    try:
        result, run = await run_agent(
            session,
            organization=ctx.organization,
            user_id=ctx.user_id,
            agent=_themes,
            data={
                "language": lang,
                "question": question,
                "survey_title": survey_title,
                "population": ds.project.target_population or "",
                "items": [{"id": sid, "text": first_text[rep]} for sid, rep in short.items()],
            },
            entity_type="project",
            entity_id=project.id,
        )
    except AIError as exc:
        logger.warning("theme analysis failed: %s", exc.code)
        return {"ok": False, "error": exc.code}
    out = result.output
    if not out.assignments:  # themes nobody is assigned to would read as "0 mentions": keep the previous result
        return {"ok": False, "error": "no_assignments"}
    await session.execute(delete(Theme).where(Theme.project_id == project.id, Theme.question_key == key))
    rows: dict[str, Theme] = {}
    for order, t in enumerate(out.themes):
        row = Theme(
            organization_id=ctx.organization_id,
            project_id=project.id,
            question_key=key,
            key=t.key,
            name=t.name[:200],
            description=t.description,
            category=ThemeCategory(t.category),
            sentiment=SentimentLabel(t.sentiment),
            keywords=t.keywords,
            sort_order=order,
            ai_run_id=run.id,
        )
        session.add(row)
        rows[t.key] = row
    await session.flush()
    counts: Counter[str] = Counter()
    for sid, keys in out.assignments.items():
        rep = short.get(sid)
        if rep is None:
            continue
        for answer_id in groups[rep]:
            for k in keys:
                session.add(AnswerTheme(organization_id=ctx.organization_id, answer_id=answer_id, theme_id=rows[k].id))
                counts[k] += 1
    for k, row in rows.items():
        row.mention_count = counts.get(k, 0)
    await session.flush()
    return {"ok": True, "themes": len(rows)}
