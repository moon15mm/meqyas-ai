"""Analytics pack: the computed facts an AI agent may cite (AI_ARCHITECTURE.md §7).

Aggregates only — no respondent rows, no raw answers. Each fact has a short id (F1…),
a human label, a display value formatted here (never by a model), and the sample size.
The data analyst and the report writer can only state numbers that appear in facts.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from meqyas_ai.agents import DataAnalystAgent
from meqyas_ai.domain.causality import result_caveat
from meqyas_ai.domain.enums import EvidenceLevel as AIEvidenceLevel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Unprocessable
from ..domain.enums import QuestionType, WaveType
from ..domain.permissions import Permission
from ..models import Insight, TextAnalysis, Theme
from . import analytics
from .ai import run_agent
from .insights import EFFECT_NAMES, SCALE_TYPES, WAVE_NAMES, _num, _p, _signed, _Text, indicator_display, language

STATUS_NAMES = {
    "NOT_STARTED": ("لم يبدأ", "not started"),
    "COLLECTING": ("قيد الجمع", "collecting answers"),
    "ON_TRACK": ("على المسار", "on track"),
    "AT_RISK": ("معرض للخطر", "at risk"),
    "OFF_TRACK": ("خارج المسار", "off track"),
    "ACHIEVED": ("تحقق", "achieved"),
}
CATEGORY_NAMES = {
    "TOPIC": ("موضوع", "topic"),
    "PAIN_POINT": ("مشكلة", "pain point"),
    "STRENGTH": ("نقطة قوة", "strength"),
    "SUGGESTION": ("اقتراح", "suggestion"),
}
MAX_QUESTION_FACTS = 40
_analyst = DataAnalystAgent()


@dataclass
class Pack:
    project_id: uuid.UUID
    project_title: str
    measurement_type: str
    language: str
    evidence_level: str
    caveat: str
    facts: list[dict[str, Any]] = field(default_factory=list)

    def add(
        self, label: str, value: str, *, n: int | None = None, note: str = "", ref: dict[str, Any] | None = None
    ) -> str:
        fid = f"F{len(self.facts) + 1}"
        self.facts.append({"id": fid, "label": label, "value": value, "n": n, "note": note, "ref": ref or {}})
        return fid

    def for_agent(self) -> list[dict[str, Any]]:
        return [{k: f[k] for k in ("id", "label", "value", "n", "note")} for f in self.facts]

    def by_id(self) -> dict[str, dict[str, Any]]:
        return {f["id"]: f for f in self.facts}


def _dimension_facts(pack: Pack, s: dict[str, Any], t: _Text) -> None:
    for d in s["dimensions"]:
        for w in d["waves"]:
            if w.get("masked") or w.get("score") is None:
                continue
            native = (
                t(
                    f" (المتوسط {_num(w['mean'], 2)} من {_num(w['scale_max'], 0)})",
                    f" (mean {_num(w['mean'], 2)} of {_num(w['scale_max'], 0)})",
                )
                if w.get("mean") is not None and w.get("scale_max") is not None
                else ""
            )
            alpha = (
                t(f"ألفا كرونباخ {_num(w['alpha'], 2)}", f"Cronbach's alpha {_num(w['alpha'], 2)}")
                if w.get("alpha") is not None
                else ""
            )
            pack.add(
                t(f"درجة بُعد «{d['name']}» — {t.wave(w['wave'])}", f"“{d['name']}” score — {t.wave(w['wave'])}"),
                f"{_num(w['score'])} / 100{native}",
                n=w["n"],
                note=alpha,
                ref={"kind": "dimension", "dimension_id": d["id"], "wave": w["wave"]},
            )


def _indicator_facts(pack: Pack, s: dict[str, Any], t: _Text) -> None:
    for ind in s["indicators"]:
        pct = "%" if ind["indicator_type"] == "PERCENTAGE" else ""
        ar, en = STATUS_NAMES.get(ind["status"], (ind["status"], ind["status"]))
        shown = indicator_display(ind, t)
        target = (
            t(f"، المستهدف {shown['target']}", f", target {shown['target']}") if ind["target_value"] is not None else ""
        )
        where = shown["where"]
        waves = "، ".join(
            f"{t.wave(w['wave'])} {_num(w['value'], 2)}{pct}" for w in ind["waves"] if w["value"] is not None
        )
        pack.add(
            t(f"المؤشر {ind['code']} «{ind['name']}»", f"Indicator {ind['code']} “{ind['name']}”"),
            shown["value"] + target + t(f"، الحالة: {ar}", f", status: {en}"),
            n=where["n"] if where else None,
            note=(
                t(f"محسوب بين {where['label']}؛ ", f"computed {where['label']}; ")
                if ind.get("from_wave") and where
                else ""
            )
            + waves,
            ref={"kind": "indicator", "indicator_id": ind["id"]},
        )


def _comparison_facts(pack: Pack, ds: analytics.Dataset, dims: list[Any], t: _Text) -> None:
    waves = list(ds.wave_rows())
    pairs = []
    if len(waves) >= 2:
        pairs.append((waves[0], waves[-1]))
    if (
        WaveType.POST.value in waves
        and WaveType.FOLLOW_UP.value in waves
        and (waves[0], waves[-1])
        != (
            WaveType.POST.value,
            WaveType.FOLLOW_UP.value,
        )
    ):
        pairs.append((WaveType.POST.value, WaveType.FOLLOW_UP.value))
        if waves[0] != WaveType.POST.value:
            pairs.append((waves[0], WaveType.POST.value))
    for a, b in pairs:
        for dim in dims:
            cmp = analytics.compare_scores(ds, analytics._items_for(ds, dimension_id=dim.id), a, b)
            if not cmp or cmp.get("masked") or cmp["from_mean"] is None:
                continue
            test = cmp["test"]
            digits = 2 if cmp["scale"] == "native" else 1
            stat = ""
            if test["suitable"]:
                effect = EFFECT_NAMES.get(test["effect_label"] or "", ("", ""))
                stat = t(
                    f"، d = {_num(test['effect_size'], 2)} (أثر {effect[0]})، p {_p(test['p_value'])}، "
                    + ("قياس مترابط" if cmp["paired"] else "مجموعات مستقلة"),
                    f", d = {_num(test['effect_size'], 2)} ({effect[1]} effect), p {_p(test['p_value'])}, "
                    + ("paired" if cmp["paired"] else "independent groups"),
                )
            pack.add(
                t(
                    f"تغير «{dim.name}» من {t.wave(a)} إلى {t.wave(b)}",
                    f"Change in “{dim.name}” from {t.wave(a)} to {t.wave(b)}",
                ),
                f"{_num(cmp['from_mean'], digits)} → {_num(cmp['to_mean'], digits)} ({_signed(cmp['change']['absolute'] or 0, digits)}){stat}",
                n=cmp["n_pairs"] if cmp["paired"] else min(cmp["n_from"], cmp["n_to"]),
                ref={"kind": "comparison", "dimension_id": str(dim.id), "from_wave": a, "to_wave": b},
            )


def question_summaries(ds: analytics.Dataset, t: _Text, limit: int = MAX_QUESTION_FACTS) -> list[dict[str, Any]]:
    """One line per answerable question in the latest wave: its headline statistic, formatted here."""
    rows_by_wave = ds.wave_rows()
    if not rows_by_wave:
        return []
    wave, rows = list(rows_by_wave.items())[-1]
    out: list[dict[str, Any]] = []
    for q in ds.questions.values():
        if len(out) >= limit or not q.answerable:
            continue
        st = analytics.question_stats(ds, q, rows, raw_text=False)
        if st.get("masked") or not st["n"]:
            continue
        value = ""
        if q.type == QuestionType.NPS and st.get("nps") and st["nps"].get("score") is not None:
            nps = st["nps"]
            value = t(
                f"صافي نقاط الترويج {_signed(nps['score'], 0)} (مروجون {_num(nps['promoters'])}%، منتقدون {_num(nps['detractors'])}%)",
                f"NPS {_signed(nps['score'], 0)} (promoters {_num(nps['promoters'])}%, detractors {_num(nps['detractors'])}%)",
            )
        elif q.type in SCALE_TYPES and st.get("describe") and st["describe"].get("mean") is not None:
            top = (st.get("top_box") or {}).get("estimate")
            value = t(f"المتوسط {_num(st['describe']['mean'], 2)}", f"mean {_num(st['describe']['mean'], 2)}") + (
                t(f"، أعلى فئتين {_num(top * 100)}%", f", top-2 box {_num(top * 100)}%") if top is not None else ""
            )
        elif st.get("distribution") and st["distribution"]["categories"]:
            best = max(st["distribution"]["categories"], key=lambda c: c["count"])
            value = t(
                f"الأكثر اختيارًا «{best['label']}» ({_num(best['pct'])}%)",
                f"most chosen “{best['label']}” ({_num(best['pct'])}%)",
            )
        elif st.get("options"):
            best = max(st["options"], key=lambda o: o["count"])
            value = t(
                f"الأكثر اختيارًا «{best['label']}» ({_num(best['pct'])}% من المجيبين)",
                f"most chosen “{best['label']}” ({_num(best['pct'])}% of respondents)",
            )
        if value:
            out.append({"key": q.key, "text": t.question(q.key), "wave": wave, "n": st["n"], "value": value})
    return out


def _question_facts(pack: Pack, ds: analytics.Dataset, t: _Text) -> None:
    for q in question_summaries(ds, t):
        pack.add(
            f"«{q['text']}» — {t.wave(q['wave'])}",
            q["value"],
            n=q["n"],
            ref={"kind": "question", "question_key": q["key"], "wave": q["wave"]},
        )


async def _theme_facts(session: AsyncSession, pack: Pack, ds: analytics.Dataset, t: _Text) -> None:
    totals = {
        a.question_key: a.answers_total
        for a in (await session.scalars(select(TextAnalysis).where(TextAnalysis.project_id == ds.project.id))).all()
    }
    themes = (
        await session.scalars(
            select(Theme).where(Theme.project_id == ds.project.id).order_by(Theme.question_key, Theme.sort_order)
        )
    ).all()
    for theme in themes:
        total = totals.get(theme.question_key, 0)
        if total < analytics.K_ANON:
            continue
        ar, en = CATEGORY_NAMES.get(theme.category.value, ("", ""))
        pack.add(
            t(
                f"موضوع في «{t.question(theme.question_key)}»: {theme.name} ({ar})",
                f"Theme in “{t.question(theme.question_key)}”: {theme.name} ({en})",
            ),
            t(
                f"{theme.mention_count} من {total} ({_num(theme.mention_count / total * 100)}%)",
                f"{theme.mention_count} of {total} ({_num(theme.mention_count / total * 100)}%)",
            ),
            n=total,
            note=theme.description[:200],
            ref={"kind": "theme", "theme_id": str(theme.id), "question_key": theme.question_key},
        )


async def build_pack(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, lang: str | None = None) -> Pack:
    return await assemble_pack(session, await analytics.load_project(session, ctx, project_id), lang)


async def assemble_pack(session: AsyncSession, data: analytics.Loaded, lang: str | None = None) -> Pack:
    project, ds, dims, s = data.project, data.ds, data.dims, data.summary
    lang = lang or language(ds)
    t = _Text(lang, ds)
    level = s["evidence_level"]
    pack = Pack(
        project_id=project.id,
        project_title=project.title,
        measurement_type=project.measurement_type.value if project.measurement_type else "",
        language=lang,
        evidence_level=level,
        caveat=result_caveat(AIEvidenceLevel(level), lang),
    )
    c = s["counts"]
    pack.add(
        t("إجابات في التحليل", "Responses analyzed"),
        t(f"{c['included']} (من أصل {c['total']})", f"{c['included']} (of {c['total']})"),
        ref={"kind": "counts"},
    )
    if s["waves"]:
        pack.add(
            t("القياسات المجموعة", "Waves collected"),
            "، ".join(f"{t.wave(w['wave'])} ({w['n']})" for w in s["waves"])
            if lang == "ar"
            else ", ".join(f"{t.wave(w['wave'])} ({w['n']})" for w in s["waves"]),
            ref={"kind": "waves"},
        )
    for wave, rows in ds.wave_rows().items():  # when each wave was collected: grounds any timing statement
        if len(rows) >= analytics.K_ANON:
            times = [r.created_at for r in rows]
            pack.add(
                t(f"فترة جمع «{t.wave(wave)}»", f"“{t.wave(wave)}” collection period"),
                f"{min(times).date().isoformat()} — {max(times).date().isoformat()}",
                n=len(rows),
                ref={"kind": "wave_period", "wave": wave},
            )
    if s["overall_score"] is not None:
        pack.add(
            t("الدرجة العامة (آخر قياس متاح لكل بُعد)", "Overall score (latest wave per dimension)"),
            f"{_num(s['overall_score'])} / 100",
            ref={"kind": "overall"},
        )
    if s["nps"]:
        pack.add(
            t("صافي نقاط الترويج (آخر قياس)", "NPS (latest wave)"),
            _signed(s["nps"]["score"], 0),
            n=s["nps"]["n"],
            ref={"kind": "nps"},
        )
    if s["csat"] and s["csat"].get("estimate") is not None:
        pack.add(
            t("نسبة الرضا CSAT (آخر قياس)", "CSAT (latest wave)"),
            f"{_num(s['csat']['estimate'] * 100)}%",
            ref={"kind": "csat"},
        )
    if s["median_duration_seconds"] is not None:
        pack.add(
            t("الوقت الوسيط للإجابة", "Median completion time"),
            t(f"{s['median_duration_seconds']} ثانية", f"{s['median_duration_seconds']} seconds"),
            ref={"kind": "duration"},
        )
    _dimension_facts(pack, s, t)
    _indicator_facts(pack, s, t)
    _comparison_facts(pack, ds, dims, t)
    _question_facts(pack, ds, t)
    await _theme_facts(session, pack, ds, t)
    insights = (
        await session.scalars(
            select(Insight)
            .where(Insight.project_id == project.id, Insight.current.is_(True))
            .order_by(Insight.sort_order)
        )
    ).all()
    for ins in insights[:20]:
        pack.add(
            t(f"استنتاج: {ins.title}", f"Insight: {ins.title}"),
            ins.body[:400],
            n=ins.evidence.get("n"),
            ref={"kind": "insight", "insight_id": str(ins.id)},
        )
    return pack


async def chat(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, message: str, history: list[dict[str, str]]
) -> dict[str, Any]:
    ctx.require(Permission.AI_ANALYZE)
    pack = await build_pack(session, ctx, project_id)
    result, _ = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_analyst,
        data={
            "language": "en" if _looks_english(message) else pack.language,
            "project_title": pack.project_title,
            "measurement_type": pack.measurement_type,
            "evidence_level": pack.evidence_level,
            "caveat": pack.caveat,
            "facts": pack.for_agent(),
            "history": history[-8:],
            "question": message,
        },
        entity_type="project",
        entity_id=pack.project_id,
    )
    if result.semantic_issues:  # still unverified after the repair rounds: never show it
        raise Unprocessable(
            "The analyst could not back its answer with the computed facts; try rephrasing the question",
            code="analyst_unverified",
        )
    facts = pack.by_id()
    return {
        "answer": result.output.answer,
        "evidence": [
            {k: facts[i][k] for k in ("id", "label", "value", "n", "ref")}
            for i in result.output.evidence_ids
            if i in facts
        ],
        "follow_ups": result.output.follow_ups,
    }


def _looks_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if c.isascii()) / len(letters) > 0.7


__all__ = ["WAVE_NAMES", "Pack", "assemble_pack", "build_pack", "chat", "question_summaries"]
