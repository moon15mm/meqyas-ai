"""Reports (Phase 7, docs/REPORTS.md).

A report combines sections the platform renders itself — key figures, methodology,
tables, chart data, insights, recommendations, limitations and an appendix of cited
facts — with narrative sections the ReportWriterAgent drafts around the analytics pack
(numbers may only be copied from facts; D-040). When AI is off or fails, narrative
sections fall back to text assembled from the computed insights, so a report is always
available. Every version stores its content and the data snapshot it was built from;
refreshing data or editing text creates a new version.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.agents import ReportWriterAgent
from meqyas_ai.domain.causality import result_caveat
from meqyas_ai.domain.enums import EvidenceLevel as AIEvidenceLevel
from meqyas_ai.errors import AIError
from meqyas_ai.schemas.report import ReportWriterInput
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import NotFound, Unprocessable
from ..domain.enums import (
    InsightKind,
    InsightStatus,
    Priority,
    RecommendationStatus,
    ReportTone,
    ReportType,
    Severity,
    WaveType,
)
from ..domain.permissions import Permission
from ..models import Insight, Project, Recommendation, Report, ReportVersion, TextAnalysis, Theme, User
from . import analytics
from . import insights as insight_svc
from .ai import run_agent
from .audit import audit
from .insights import EFFECT_NAMES, SEVERITY_RANK, _num, _p, _signed, _Text, indicator_display, language
from .pack import CATEGORY_NAMES, STATUS_NAMES, Pack, assemble_pack, question_summaries
from .projects import get_owned

CONTENT_SCHEMA = 1
_writer = ReportWriterAgent()

TYPE_NAMES = {
    ReportType.EXECUTIVE: ("تقرير تنفيذي", "Executive report"),
    ReportType.DETAILED: ("تقرير تفصيلي", "Detailed report"),
    ReportType.IMPACT: ("تقرير الأثر", "Impact report"),
    ReportType.MANAGEMENT: ("تقرير متابعة إداري", "Management report"),
    ReportType.ACADEMIC: ("تقرير أكاديمي", "Academic report"),
}
LEVEL_NAMES = {
    "DESCRIPTIVE": ("دليل وصفي", "Descriptive"),
    "PERCEIVED_CHANGE": ("تغير مُدرَك", "Perceived change"),
    "CHANGE": ("تغير ملحوظ", "Observed change"),
    "CHANGE_PERSISTENCE": ("تغير واستمرارية", "Change & persistence"),
    "TREND": ("اتجاه زمني", "Trend"),
    "CONTRIBUTION": ("إسهام", "Contribution"),
    "ATTRIBUTION": ("إسناد سببي", "Attribution"),
}
DESIGN_NAMES = {
    "POST_ONLY": ("قياس واحد", "Single measurement"),
    "RETROSPECTIVE_PRE_POST": ("قبلي/بعدي استرجاعي", "Retrospective pre/post"),
    "PRE_POST": ("قبلي / بعدي", "Pre / Post"),
    "PRE_POST_FOLLOW_UP": ("قبلي / بعدي / متابعة", "Pre / Post / Follow-up"),
    "REPEATED": ("قياسات متكررة", "Repeated measurements"),
    "COMPARISON_GROUP": ("مجموعة مقارنة", "Comparison group"),
}
KIND_NAMES = {
    InsightKind.STRENGTH: ("نقطة قوة", "Strength"),
    InsightKind.WEAKNESS: ("نقطة ضعف", "Weakness"),
    InsightKind.IMPROVEMENT: ("تحسّن", "Improvement"),
    InsightKind.DECLINE: ("تراجع", "Decline"),
    InsightKind.PERSISTENCE: ("الاستمرارية", "Persistence"),
    InsightKind.RISK: ("خطر", "Risk"),
    InsightKind.SUCCESS: ("إنجاز", "Achievement"),
    InsightKind.GAP: ("فجوة بين فئات", "Group gap"),
    InsightKind.ATTENTION: ("يحتاج انتباهًا", "Needs attention"),
    InsightKind.PAIN_POINT: ("شكوى متكررة", "Recurring complaint"),
    InsightKind.DATA_QUALITY: ("جودة البيانات", "Data quality"),
    InsightKind.SAMPLE: ("حجم العينة", "Sample size"),
}
SEVERITY_NAMES = {
    Severity.HIGH: ("أهمية عالية", "High importance"),
    Severity.MEDIUM: ("أهمية متوسطة", "Medium importance"),
    Severity.LOW: ("أهمية منخفضة", "Low importance"),
    Severity.INFO: ("للعلم", "For information"),
}
PRIORITY_NAMES = {
    Priority.HIGH: ("عالية", "High"),
    Priority.MEDIUM: ("متوسطة", "Medium"),
    Priority.LOW: ("منخفضة", "Low"),
}
REC_STATUS_NAMES = {
    RecommendationStatus.PROPOSED: ("مقترحة", "Proposed"),
    RecommendationStatus.ACCEPTED: ("معتمدة", "Accepted"),
    RecommendationStatus.IN_PROGRESS: ("قيد التنفيذ", "In progress"),
    RecommendationStatus.DONE: ("منفذة", "Done"),
    RecommendationStatus.DISMISSED: ("مستبعدة", "Dismissed"),
}
RISK_KINDS = {
    InsightKind.RISK,
    InsightKind.WEAKNESS,
    InsightKind.DECLINE,
    InsightKind.ATTENTION,
    InsightKind.PAIN_POINT,
    InsightKind.GAP,
    InsightKind.DATA_QUALITY,
}


@dataclass(frozen=True)
class Narrative:
    ar: str
    en: str
    purpose: str
    form: str = "paragraphs"
    max_words: int = 180


NARRATIVE: dict[str, Narrative] = {
    "abstract": Narrative(
        "الملخص",
        "Abstract",
        "A structured abstract: purpose, method (design, waves, sample sizes), the main results with their "
        "numbers, and the main limitation.",
        max_words=220,
    ),
    "introduction": Narrative(
        "المقدمة",
        "Introduction",
        "Introduce the project and its goal from the project context; say what was measured, with whom and "
        "when. No results here.",
        max_words=160,
    ),
    "summary": Narrative(
        "الملخص التنفيذي",
        "Executive summary",
        "The most important results and what they mean for the audience, in priority order.",
        max_words=200,
    ),
    "findings": Narrative(
        "أبرز النتائج",
        "Key findings",
        "The 3 to 6 most important findings; each one sentence with its number.",
        form="bullets",
        max_words=200,
    ),
    "impact": Narrative(
        "ما الذي تغيّر؟",
        "What changed?",
        "What changed between waves, how large and how consistent the change is (effect sizes and "
        "significance), and what the evidence level allows us to conclude.",
        max_words=260,
    ),
    "sustainability": Narrative(
        "استمرارية التغير",
        "Did the change last?",
        "Whether the changes held at follow-up compared with right after the program, dimension by dimension.",
        max_words=160,
    ),
    "status": Narrative(
        "الوضع الحالي",
        "Where we stand",
        "Status against indicators and targets: what is achieved, on track, at risk or off track, and why it matters.",
        max_words=170,
    ),
    "decisions": Narrative(
        "قرارات مطلوبة",
        "Decisions needed",
        "3 to 5 decisions or actions management should take now, each tied to a result.",
        form="bullets",
        max_words=170,
    ),
    "discussion": Narrative(
        "مناقشة النتائج",
        "Discussion",
        "Interpret the results: patterns across dimensions, groups and waves; explanations framed as "
        "hypotheses; implications for the program.",
        max_words=300,
    ),
    "conclusion": Narrative(
        "الخاتمة",
        "Conclusion",
        "Close with the overall judgement and the next measurement step.",
        max_words=130,
    ),
}
TITLES: dict[str, tuple[str, str]] = {
    "key_figures": ("أرقام رئيسية", "Key figures"),
    "methodology": ("المنهجية", "Methodology"),
    "dimensions_chart": ("درجات الأبعاد", "Dimension scores"),
    "dimensions_table": ("درجات الأبعاد حسب القياس", "Dimension scores by wave"),
    "comparisons_table": ("المقارنة بين القياسات", "Comparison between waves"),
    "indicators_table": ("المؤشرات", "Indicators"),
    "questions_table": ("نتائج الأسئلة", "Question results"),
    "themes_table": ("موضوعات الإجابات المفتوحة", "Themes in open answers"),
    "insights": ("الاستنتاجات", "Insights"),
    "risks": ("المخاطر ونقاط الانتباه", "Risks and watch points"),
    "recommendations": ("التوصيات", "Recommendations"),
    "action_plan": ("خطة العمل", "Action plan"),
    "limitations": ("حدود النتائج", "Limitations"),
    "appendix": ("ملحق: الأرقام المستشهد بها", "Appendix: facts cited"),
}
LAYOUTS: dict[ReportType, list[str]] = {
    ReportType.EXECUTIVE: [
        "summary",
        "key_figures",
        "findings",
        "dimensions_chart",
        "indicators_table",
        "recommendations",
        "limitations",
        "appendix",
    ],
    ReportType.DETAILED: [
        "summary",
        "introduction",
        "key_figures",
        "methodology",
        "findings",
        "dimensions_chart",
        "dimensions_table",
        "comparisons_table",
        "indicators_table",
        "questions_table",
        "themes_table",
        "insights",
        "discussion",
        "recommendations",
        "limitations",
        "conclusion",
        "appendix",
    ],
    ReportType.IMPACT: [
        "summary",
        "key_figures",
        "impact",
        "comparisons_table",
        "dimensions_chart",
        "indicators_table",
        "sustainability",
        "methodology",
        "limitations",
        "conclusion",
        "appendix",
    ],
    ReportType.MANAGEMENT: [
        "status",
        "key_figures",
        "indicators_table",
        "risks",
        "decisions",
        "action_plan",
        "limitations",
        "appendix",
    ],
    ReportType.ACADEMIC: [
        "abstract",
        "introduction",
        "methodology",
        "dimensions_table",
        "comparisons_table",
        "questions_table",
        "themes_table",
        "discussion",
        "limitations",
        "conclusion",
        "appendix",
    ],
}


@dataclass
class Inputs:
    """Everything a report is composed from, loaded once."""

    data: analytics.Loaded
    t: _Text
    lang: str
    pack: Pack
    insights: list[Insight]
    recommendations: list[Recommendation]
    themes: list[tuple[Theme, int]]  # theme, answers analyzed for its question
    data_range: dict[str, str] | None


def _section(key: str, kind: str, t: _Text, **fields: Any) -> dict[str, Any]:
    title = NARRATIVE[key] if key in NARRATIVE else None
    name = t(title.ar, title.en) if title else t(*TITLES[key])
    return {"key": key, "kind": kind, "title": name, "hidden": False, **fields}


def _wave_label(t: _Text, wave: str) -> str:
    return t.wave(wave)


# ------------------------------------------------------- deterministic parts
def _key_figures(x: Inputs) -> dict[str, Any] | None:
    t, s = x.t, x.data.summary
    c = s["counts"]
    items = [
        {
            "label": t("إجابات في التحليل", "Responses analyzed"),
            "value": str(c["included"]),
            "note": t(f"من أصل {c['total']}", f"of {c['total']}"),
        }
    ]
    for w in s["waves"]:
        items.append({"label": _wave_label(t, w["wave"]), "value": str(w["n"]), "note": t("عدد الإجابات", "responses")})
    if s["overall_score"] is not None:
        items.append(
            {
                "label": t("الدرجة العامة", "Overall score"),
                "value": f"{_num(s['overall_score'])}",
                "note": t("من 100، آخر قياس لكل بُعد", "of 100, latest wave per dimension"),
            }
        )
    if s["nps"]:
        items.append({"label": t("صافي نقاط الترويج", "NPS"), "value": _signed(s["nps"]["score"], 0), "note": ""})
    if s["csat"] and s["csat"].get("estimate") is not None:
        items.append({"label": t("نسبة الرضا", "CSAT"), "value": f"{_num(s['csat']['estimate'] * 100)}%", "note": ""})
    if s["median_duration_seconds"] is not None:
        minutes = s["median_duration_seconds"] / 60
        items.append(
            {
                "label": t("الوقت الوسيط للإجابة", "Median completion time"),
                "value": _num(minutes, 1),
                "note": t("دقيقة", "minutes"),
            }
        )
    return _section("key_figures", "kpis", t, items=items)


def _methodology(x: Inputs) -> dict[str, Any] | None:
    t, s, ds = x.t, x.data.summary, x.data.ds
    level = s["evidence_level"]
    design = s.get("design")
    c = s["counts"]
    waves = "، ".join(f"{_wave_label(t, w['wave'])} ({w['n']})" for w in s["waves"])
    if x.lang != "ar":
        waves = ", ".join(f"{_wave_label(t, w['wave'])} ({w['n']})" for w in s["waves"])
    questions = sum(1 for q in ds.questions.values() if q.answerable)
    items = [
        {"label": t("تصميم القياس", "Design"), "value": t(*DESIGN_NAMES[design]) if design in DESIGN_NAMES else "—"},
        {"label": t("مستوى الدليل", "Evidence level"), "value": t(*LEVEL_NAMES.get(level, (level, level)))},
        {"label": t("القياسات وحجم العينة", "Waves and sample size"), "value": waves or "—"},
        {
            "label": t("فترة جمع البيانات", "Data collection period"),
            "value": f"{x.data_range['from']} — {x.data_range['to']}" if x.data_range else "—",
        },
        {
            "label": t("الأداة", "Instrument"),
            "value": t(
                f"الأسئلة: {questions} · الأبعاد: {len(x.data.dims)}",
                f"{questions} questions across {len(x.data.dims)} dimensions",
            ),
        },
        {
            "label": t("الإجابات المشمولة", "Responses included"),
            "value": t(
                f"{c['included']} من {c['total']} (استُبعدت الإجابات منخفضة الجودة: {c['low_quality'] + c['excluded']})",
                f"{c['included']} of {c['total']} (low-quality responses excluded: {c['low_quality'] + c['excluded']})",
            ),
        },
    ]
    paragraphs = [
        t(
            "تُحسب درجة كل بُعد لكل مستجيب بمتوسط بنوده (بعد عكس البنود السلبية) ثم تُحوَّل إلى مقياس من 0 إلى 100. "
            "تُقارن القياسات باختبار t للعينات المترابطة عندما يمكن ربط 10 مستجيبين على الأقل بين القياسين عبر رمز "
            "مستعار، وإلا باختبار Welch للعينات المستقلة، مع حجم الأثر (Cohen's d). النسب مصحوبة بفترات ثقة Wilson، "
            "وثبات الأبعاد بمعامل ألفا كرونباخ. لا تُعرض أي نتيجة تقل عيّنتها عن 5 إجابات حفاظًا على الخصوصية.",
            "Each respondent's dimension score is the mean of its items (reverse-scored items flipped), rescaled to "
            "0–100. Waves are compared with a paired t-test when at least 10 respondents can be linked across waves "
            "through a pseudonymous code, otherwise with Welch's test for independent groups, with Cohen's d as the "
            "effect size. Proportions carry Wilson confidence intervals and reliability is Cronbach's alpha. No "
            "result based on fewer than 5 answers is shown, to protect privacy.",
        ),
        result_caveat(AIEvidenceLevel(level), x.lang),
    ]
    if x.themes:
        paragraphs.append(
            t(
                "صنّف الذكاء الاصطناعي الإجابات المفتوحة في موضوعات، ثم عدّت المنصة الإجابات في كل موضوع.",
                "Open answers were grouped into themes by AI; the platform counted the answers in each theme.",
            )
        )
    return _section("methodology", "definitions", t, items=items, paragraphs=paragraphs)


def _dimension_waves(x: Inputs) -> list[str]:
    seen: list[str] = []
    for d in x.data.summary["dimensions"]:
        for w in d["waves"]:
            if w["wave"] not in seen:
                seen.append(w["wave"])
    order = list(x.data.ds.wave_rows())
    return sorted(seen, key=lambda w: order.index(w) if w in order else len(order))


def _dimensions_chart(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    waves = _dimension_waves(x)
    rows = []
    for d in x.data.summary["dimensions"]:
        by_wave = {w["wave"]: w for w in d["waves"]}
        values = [
            None if (w := by_wave.get(wave)) is None or w.get("masked") or w.get("score") is None else w["score"]
            for wave in waves
        ]
        if any(v is not None for v in values):
            rows.append({"label": d["name"], "values": values})
    if not rows:
        return None
    return _section(
        "dimensions_chart",
        "bars",
        t,
        series=[{"key": w, "label": _wave_label(t, w)} for w in waves],
        rows=rows,
        max=100,
        note=t("الدرجة من 100.", "Score out of 100."),
    )


def _dimensions_table(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    waves = _dimension_waves(x)
    if not waves:
        return None
    rows = []
    for d in x.data.summary["dimensions"]:
        by_wave = {w["wave"]: w for w in d["waves"]}
        cells = [d["name"]]
        for wave in waves:
            w = by_wave.get(wave)
            if w is None:
                cells.append("—")
            elif w.get("masked"):
                cells.append(t("أقل من 5", "< 5"))
            else:
                cells.append(f"{_num(w['score'])} (n={w['n']})" if w.get("score") is not None else "—")
        latest = next((w for w in reversed(d["waves"]) if w.get("alpha") is not None), None)
        cells.append(_num(latest["alpha"], 2) if latest else "—")
        rows.append(cells)
    columns = [t("البُعد", "Dimension"), *(_wave_label(t, w) for w in waves), t("ألفا كرونباخ", "Cronbach's α")]
    return _section(
        "dimensions_table",
        "table",
        t,
        columns=columns,
        rows=rows,
        note=t("الدرجة من 100، وبين القوسين عدد الإجابات.", "Score out of 100; n in brackets."),
    )


def _comparison_pairs(x: Inputs) -> list[tuple[str, str]]:
    waves = list(x.data.ds.wave_rows())
    pairs: list[tuple[str, str]] = []
    if len(waves) >= 2:
        pairs.append((waves[0], waves[-1]))
    post, follow = WaveType.POST.value, WaveType.FOLLOW_UP.value
    if post in waves and follow in waves and (post, follow) not in pairs:
        pairs.append((post, follow))
        if waves[0] != post and (waves[0], post) not in pairs:
            pairs.insert(0, (waves[0], post))
    return pairs


def _comparisons_table(x: Inputs, *, academic: bool = False) -> dict[str, Any] | None:
    t = x.t
    rows = []
    for a, b in _comparison_pairs(x):
        for dim in x.data.dims:
            cmp = analytics.compare_scores(x.data.ds, analytics._items_for(x.data.ds, dimension_id=dim.id), a, b)
            if not cmp or cmp.get("masked") or cmp["from_mean"] is None:
                continue
            test = cmp["test"]
            digits = 2 if cmp["scale"] == "native" else 1
            effect = EFFECT_NAMES.get(test.get("effect_label") or "", ("", ""))
            row = [
                dim.name,
                t(f"{_wave_label(t, a)} ← {_wave_label(t, b)}", f"{_wave_label(t, a)} → {_wave_label(t, b)}"),
                _num(cmp["from_mean"], digits),
                _num(cmp["to_mean"], digits),
                _signed(cmp["change"]["absolute"] or 0, digits),
                (f"{_num(test['effect_size'], 2)} ({t(*effect)})" if test.get("effect_size") is not None else "—"),
                (_p(test["p_value"]).removeprefix("= ") if test.get("p_value") is not None else "—"),
            ]
            if academic:
                row.append(
                    f"t = {_num(test['statistic'], 2)}, df = {_num(test['df'], 1)}"
                    if test.get("statistic") is not None
                    else "—"
                )
            row.append(
                t("مترابطة", "paired") + f" (n={cmp['n_pairs']})"
                if cmp["paired"]
                else t("مستقلة", "independent") + f" (n={cmp['n_from']}/{cmp['n_to']})"
            )
            rows.append(row)
    if not rows:
        return None
    columns = [
        t("البُعد", "Dimension"),
        t("المقارنة", "Comparison"),
        t("قبل", "Before"),
        t("بعد", "After"),
        t("التغير", "Change"),
        t("حجم الأثر d", "Effect size d"),
        "p",
        *([t("الإحصاءة", "Statistic")] if academic else []),
        t("العينة", "Sample"),
    ]
    return _section(
        "comparisons_table",
        "table",
        t,
        columns=columns,
        rows=rows,
        note=t(
            "المتوسطات على مقياس الأسئلة الأصلي عند توحده، وإلا من 100. «مترابطة»: نفس المستجيبين في القياسين.",
            "Means on the items' own scale when shared, otherwise out of 100. “Paired”: the same respondents in both waves.",
        ),
    )


def _indicators_table(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    rows = []
    for ind in x.data.summary["indicators"]:
        shown = indicator_display(ind, t)
        where = shown["where"]
        ar, en = STATUS_NAMES.get(ind["status"], (ind["status"], ind["status"]))
        rows.append(
            [
                ind["code"],
                ind["name"],
                shown["baseline"],
                shown["value"] + (f" ({where['label']})" if where else ""),
                shown["target"],
                t(ar, en),
            ]
        )
    if not rows:
        return None
    return _section(
        "indicators_table",
        "table",
        t,
        columns=[
            t("الرمز", "Code"),
            t("المؤشر", "Indicator"),
            t("خط الأساس", "Baseline"),
            t("القيمة الحالية", "Current value"),
            t("المستهدف", "Target"),
            t("الحالة", "Status"),
        ],
        rows=rows,
        status_column=5,
        statuses=[ind["status"] for ind in x.data.summary["indicators"]],
    )


def _questions_table(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    items = question_summaries(x.data.ds, t, limit=60)
    if not items:
        return None
    wave = items[0]["wave"]
    return _section(
        "questions_table",
        "table",
        t,
        columns=[t("السؤال", "Question"), "n", t("النتيجة", "Result")],
        rows=[[q["text"], str(q["n"]), q["value"]] for q in items],
        note=t(f"من {_wave_label(t, wave)}.", f"From the {_wave_label(t, wave)} wave."),
    )


def _themes_table(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    rows = []
    for theme, total in x.themes:
        ar, en = CATEGORY_NAMES.get(theme.category.value, ("", ""))
        rows.append(
            [
                t.question(theme.question_key),
                theme.name,
                t(ar, en),
                str(theme.mention_count),
                f"{_num(theme.mention_count / total * 100)}%",
            ]
        )
    if not rows:
        return None
    return _section(
        "themes_table",
        "table",
        t,
        columns=[
            t("السؤال", "Question"),
            t("الموضوع", "Theme"),
            t("التصنيف", "Category"),
            t("عدد الإجابات", "Answers"),
            t("النسبة", "Share"),
        ],
        rows=rows,
        note=t(
            "النسبة من الإجابات التي حُلّلت لكل سؤال؛ قد تذكر الإجابة أكثر من موضوع.",
            "Share of the analyzed answers to each question; an answer can mention several themes.",
        ),
    )


def _insight_items(t: _Text, insights: list[Insight]) -> list[dict[str, Any]]:
    return [
        {
            "kind": i.kind.value,
            "label": t(*KIND_NAMES[i.kind]),
            "severity": i.severity.value,
            "severity_label": t(*SEVERITY_NAMES[i.severity]),
            "title": i.title,
            "body": i.body,
        }
        for i in insights
    ]


def _insights(x: Inputs) -> dict[str, Any] | None:
    items = [i for i in x.insights if i.kind != InsightKind.SAMPLE][:12]
    return _section("insights", "insights", x.t, items=_insight_items(x.t, items)) if items else None


def _risks(x: Inputs) -> dict[str, Any] | None:
    items = [i for i in x.insights if i.kind in RISK_KINDS and i.severity in (Severity.HIGH, Severity.MEDIUM)][:8]
    return _section("risks", "insights", x.t, items=_insight_items(x.t, items)) if items else None


def _recommendations(x: Inputs, limit: int = 8) -> dict[str, Any] | None:
    t = x.t
    items = [
        {
            "recommendation": r.recommendation,
            "problem": r.problem,
            "possible_cause": r.possible_cause,
            "expected_outcome": r.expected_outcome,
            "priority": r.priority.value,
            "priority_label": t(*PRIORITY_NAMES[r.priority]),
            "status": r.status.value,
            "status_label": t(*REC_STATUS_NAMES[r.status]),
            "owner": r.owner,
            "timeframe": r.timeframe,
        }
        for r in x.recommendations[:limit]
    ]
    return _section("recommendations", "recommendations", t, items=items) if items else None


def _action_plan(x: Inputs) -> dict[str, Any] | None:
    t = x.t
    rows = [
        [
            r.recommendation,
            r.owner or "—",
            r.timeframe or (r.due_on.isoformat() if r.due_on else "—"),
            t(*PRIORITY_NAMES[r.priority]),
            t(*REC_STATUS_NAMES[r.status]),
        ]
        for r in x.recommendations
    ]
    if not rows:
        return None
    return _section(
        "action_plan",
        "table",
        t,
        columns=[
            t("الإجراء", "Action"),
            t("المسؤول", "Owner"),
            t("المدة", "Timeframe"),
            t("الأولوية", "Priority"),
            t("الحالة", "Status"),
        ],
        rows=rows,
    )


def _limitations(x: Inputs) -> dict[str, Any] | None:
    t, s = x.t, x.data.summary
    bullets = [result_caveat(AIEvidenceLevel(s["evidence_level"]), x.lang)]
    small = [w for w in s["waves"] if w["n"] < 30]
    for w in small:
        bullets.append(
            t(
                f"عدد الإجابات في {_wave_label(t, w['wave'])} ({w['n']}) أقل من 30، لذا تُقرأ نتائجه بحذر.",
                f"The {_wave_label(t, w['wave'])} wave has {w['n']} responses (fewer than 30); read its results with care.",
            )
        )
    c = s["counts"]
    dropped = c["low_quality"] + c["excluded"]
    if c["total"] and dropped / c["total"] >= 0.05:
        bullets.append(
            t(
                f"استُبعدت إجابات منخفضة الجودة عددها {dropped} من أصل {c['total']} ({_num(dropped / c['total'] * 100)}%).",
                f"{dropped} of {c['total']} responses were excluded as low quality ({_num(dropped / c['total'] * 100)}%).",
            )
        )
    masked = any(w.get("masked") for d in s["dimensions"] for w in d["waves"])
    if masked:
        bullets.append(
            t(
                "حُجبت نتائج المجموعات التي تقل عن 5 إجابات حفاظًا على الخصوصية.",
                "Results for groups with fewer than 5 answers are withheld to protect privacy.",
            )
        )
    for a, b in _comparison_pairs(x)[:1]:
        cmp = None
        for dim in x.data.dims:
            cmp = analytics.compare_scores(x.data.ds, analytics._items_for(x.data.ds, dimension_id=dim.id), a, b)
            if cmp and not cmp.get("masked"):
                break
        if cmp and cmp.get("paired") and cmp["n_from"]:
            bullets.append(
                t(
                    f"اعتمدت المقارنة المترابطة على من شاركوا في القياسين معًا (عددهم {cmp['n_pairs']})، "
                    f"بينما بلغ عدد المشاركين في {_wave_label(t, a)} {cmp['n_from']} وفي {_wave_label(t, b)} {cmp['n_to']}.",
                    f"The paired comparison uses the {cmp['n_pairs']} respondents who took part in both waves; "
                    f"{cmp['n_from']} answered the {_wave_label(t, a)} wave and {cmp['n_to']} the {_wave_label(t, b)} wave.",
                )
            )
    bullets.append(
        t(
            "تعتمد النتائج على تقدير المشاركين لأنفسهم في الاستبيانات، وقد تتأثر بالميل إلى الإجابات المقبولة اجتماعيًا.",
            "Results rely on self-reported survey answers and may be affected by social desirability.",
        )
    )
    if x.themes:
        bullets.append(
            t(
                "تصنيف الإجابات المفتوحة آلي، وقد يختلف قليلًا عن قراءة بشرية.",
                "Open answers were classified automatically and may differ slightly from a human reading.",
            )
        )
    return _section("limitations", "narrative", t, paragraphs=[], bullets=bullets, evidence_ids=[], source="RULE")


BUILDERS: dict[str, Callable[[Inputs, ReportType], dict[str, Any] | None]] = {
    "key_figures": lambda x, _: _key_figures(x),
    "methodology": lambda x, _: _methodology(x),
    "dimensions_chart": lambda x, _: _dimensions_chart(x),
    "dimensions_table": lambda x, _: _dimensions_table(x),
    "comparisons_table": lambda x, rt: _comparisons_table(x, academic=rt == ReportType.ACADEMIC),
    "indicators_table": lambda x, _: _indicators_table(x),
    "questions_table": lambda x, _: _questions_table(x),
    "themes_table": lambda x, _: _themes_table(x),
    "insights": lambda x, _: _insights(x),
    "risks": lambda x, _: _risks(x),
    "recommendations": lambda x, rt: _recommendations(x, limit=5 if rt == ReportType.EXECUTIVE else 8),
    "action_plan": lambda x, _: _action_plan(x),
    "limitations": lambda x, _: _limitations(x),
}


# ------------------------------------------------------------- narratives
def _applies(key: str, x: Inputs) -> bool:
    waves = list(x.data.ds.wave_rows())
    if key == "sustainability":
        return WaveType.POST.value in waves and WaveType.FOLLOW_UP.value in waves
    if key == "impact":
        return len(waves) >= 2
    if key == "status":
        return bool(x.data.summary["indicators"])
    return True


def _bodies(insights: list[Insight], kinds: set[InsightKind] | None = None, limit: int = 6) -> list[str]:
    chosen = [i for i in insights if (kinds is None or i.kind in kinds) and i.kind != InsightKind.SAMPLE]
    return [i.body for i in chosen[:limit]]


def _rule_narrative(key: str, x: Inputs) -> dict[str, Any] | None:
    """Narrative assembled from computed insights when the writer is not used."""
    t, s = x.t, x.data.summary
    paragraphs: list[str] = []
    bullets: list[str] = []
    ranked = sorted(
        (i for i in x.insights if i.severity != Severity.INFO), key=lambda i: -SEVERITY_RANK[i.severity]
    ) or list(x.insights)
    if key in ("summary", "abstract"):
        waves = "، ".join(f"{_wave_label(t, w['wave'])} ({w['n']})" for w in s["waves"])
        if x.lang != "ar":
            waves = ", ".join(f"{_wave_label(t, w['wave'])} ({w['n']})" for w in s["waves"])
        paragraphs.append(
            t(
                f"يعرض هذا التقرير نتائج «{x.data.project.title}» استنادًا إلى الإجابات المعتمدة (وعددها {s['counts']['included']})"
                + (f" في {waves}." if waves else "."),
                f"This report presents the results of “{x.data.project.title}” from {s['counts']['included']} "
                "accepted responses" + (f" across {waves}." if waves else "."),
            )
        )
        bullets = [i.title for i in ranked if i.kind != InsightKind.SAMPLE][:4]  # findings carry the bodies
    elif key == "findings":
        bullets = _bodies(ranked, limit=6)
    elif key == "impact":
        bullets = _bodies(x.insights, {InsightKind.IMPROVEMENT, InsightKind.DECLINE}, limit=6)
    elif key == "sustainability":
        bullets = _bodies(x.insights, {InsightKind.PERSISTENCE}, limit=6)
    elif key == "status":
        counts: dict[str, int] = {}
        for ind in s["indicators"]:
            counts[ind["status"]] = counts.get(ind["status"], 0) + 1
        parts = [f"{t(*STATUS_NAMES[k])}: {n}" for k, n in counts.items() if k in STATUS_NAMES]
        paragraphs.append(
            t(
                f"حالة المؤشرات (عددها {len(s['indicators'])}): " + "، ".join(parts) + ".",
                f"Indicator status ({len(s['indicators'])} indicators): " + ", ".join(parts) + ".",
            )
        )
        bullets = _bodies(x.insights, {InsightKind.RISK, InsightKind.SUCCESS}, limit=5)
    elif key == "decisions":
        bullets = [r.recommendation for r in x.recommendations[:5]]
    elif key == "introduction":
        project = x.data.project
        paragraphs = [p for p in (project.description or "",) if p.strip()]
        plan = x.data.ds.plan
        if plan is not None and plan.purpose.strip():
            paragraphs.append(plan.purpose.strip())
    if not paragraphs and not bullets:
        return None
    return _section(key, "narrative", t, paragraphs=paragraphs, bullets=bullets, evidence_ids=[], source="RULE")


def _context(x: Inputs) -> list[dict[str, str]]:
    project, plan = x.data.project, x.data.ds.plan
    items: list[tuple[str, str, str]] = []
    if project.description:
        items.append(("C1", x.t("وصف المشروع", "Project description"), project.description))
    if plan is not None and plan.purpose.strip():
        items.append(("C2", x.t("هدف القياس", "Measurement purpose"), plan.purpose.strip()))
    if project.target_population:
        items.append(("C3", x.t("الفئة المستهدفة", "Target population"), project.target_population))
    if plan is not None and plan.follow_up_days:
        items.append(
            (
                "C4",
                x.t("موعد قياس المتابعة في الخطة", "Planned follow-up timing"),
                x.t(
                    f"بعد {plan.follow_up_days} يومًا من القياس البعدي",
                    f"{plan.follow_up_days} days after the post measurement",
                ),
            )
        )
    return [{"id": i, "label": label, "text": text[:1500]} for i, label, text in items]


async def _write(
    session: AsyncSession,
    ctx: OrgContext,
    x: Inputs,
    keys: list[str],
    *,
    report_type: ReportType,
    tone: ReportTone,
    audience: str,
) -> tuple[dict[str, dict[str, Any]], list[str], uuid.UUID | None]:
    """Sections the writer produced that pass every check, the keys it failed, and the run id."""
    data = ReportWriterInput.model_validate(
        {
            "language": x.lang,
            "report_type": report_type.value,
            "tone": tone.value,
            "audience": audience,
            "project_title": x.data.project.title,
            "measurement_type": x.pack.measurement_type,
            "target_population": x.data.project.target_population or "",
            "evidence_level": x.pack.evidence_level,
            "caveat": x.pack.caveat,
            "context": _context(x),
            "facts": x.pack.for_agent(),
            "sections": [
                {
                    "key": k,
                    "title": x.t(NARRATIVE[k].ar, NARRATIVE[k].en),
                    "purpose": NARRATIVE[k].purpose,
                    "form": NARRATIVE[k].form,
                    "max_words": NARRATIVE[k].max_words,
                }
                for k in keys
            ],
        }
    )
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_writer,
        data=data,
        entity_type="project",
        entity_id=x.data.project.id,
    )
    written: dict[str, dict[str, Any]] = {}
    rejected: list[str] = []
    for sec in result.output.sections:
        # The runner keeps its last attempt even when checks still fail; nothing unverified is printed.
        if _writer.section_issues(data, sec) or not (sec.paragraphs or sec.bullets):
            rejected.append(sec.key)
            continue
        written[sec.key] = _section(
            sec.key,
            "narrative",
            x.t,
            paragraphs=sec.paragraphs,
            bullets=sec.bullets,
            evidence_ids=sec.evidence_ids,
            source="AI",
        )
    rejected += [k for k in keys if k not in written and k not in rejected]
    return written, rejected, run.id


# ------------------------------------------------------------------ compose
async def _inputs(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, lang: str | None) -> Inputs:
    data = await analytics.load_project(session, ctx, project_id)
    if data.summary["counts"]["included"] == 0:
        raise Unprocessable("There are no accepted responses to report on yet", code="no_data")
    # Insights are deterministic and cheap: refresh them so the report reflects today's data.
    insights = [
        i
        for i in await insight_svc.generate_insights(session, ctx, data.project.id, data=data)
        if i.current and i.status != InsightStatus.DISMISSED
    ]
    lang = lang or language(data.ds)
    t = _Text(lang, data.ds)
    pack = await assemble_pack(session, data, lang)
    recs = [
        r
        for r in await insight_svc.list_recommendations(session, ctx, data.project.id)
        if r.status != RecommendationStatus.DISMISSED
    ]
    totals = {
        a.question_key: a.answers_total
        for a in (await session.scalars(select(TextAnalysis).where(TextAnalysis.project_id == data.project.id))).all()
    }
    themes = [
        (th, totals[th.question_key])
        for th in (
            await session.scalars(
                select(Theme).where(Theme.project_id == data.project.id).order_by(Theme.question_key, Theme.sort_order)
            )
        ).all()
        if totals.get(th.question_key, 0) >= analytics.K_ANON
    ]
    return Inputs(data, t, lang, pack, insights, recs, themes, insight_svc._range(data.ds))


async def _compose(
    session: AsyncSession,
    ctx: OrgContext,
    x: Inputs,
    *,
    report_type: ReportType,
    tone: ReportTone,
    audience: str,
    title: str,
    use_ai: bool,
) -> tuple[dict[str, Any], dict[str, Any], uuid.UUID | None]:
    t, s = x.t, x.data.summary
    keys = [k for k in LAYOUTS[report_type] if k == "appendix" or k not in NARRATIVE or _applies(k, x)]
    narrative_keys = [k for k in keys if k in NARRATIVE]
    written: dict[str, dict[str, Any]] = {}
    ai: dict[str, Any] = {"requested": use_ai, "used": False, "error": None, "rejected": []}
    run_id: uuid.UUID | None = None
    if use_ai and narrative_keys:
        try:
            written, ai["rejected"], run_id = await _write(
                session, ctx, x, narrative_keys, report_type=report_type, tone=tone, audience=audience
            )
            ai["used"] = bool(written)
            if not written:
                ai["error"] = "unverified"
        except AIError as exc:  # the report is still produced from computed insights
            ai["error"] = exc.code
    sections: list[dict[str, Any]] = []
    for key in keys:
        if key == "appendix":
            continue
        if key in NARRATIVE:
            sec = written.get(key) or _rule_narrative(key, x)
        else:
            sec = BUILDERS[key](x, report_type)
        if sec is not None:
            sections.append(sec)
    cited = list(dict.fromkeys(i for sec in sections for i in sec.get("evidence_ids", [])))
    facts = x.pack.by_id()
    if "appendix" in keys and cited:
        sections.append(
            _section(
                "appendix",
                "facts",
                t,
                items=[{k: facts[i][k] for k in ("id", "label", "value", "n")} for i in cited if i in facts],
            )
        )
    level = s["evidence_level"]
    now = datetime.now(UTC).isoformat()
    content = {
        "schema": CONTENT_SCHEMA,
        "title": title,
        "type_label": t(*TYPE_NAMES[report_type]),
        "project_title": x.data.project.title,
        "organization": ctx.organization.name,
        "language": x.lang,
        "tone": tone.value,
        "audience": audience,
        "generated_at": now,
        "data_range": x.data_range,
        "evidence_level": level,
        "evidence_label": t(*LEVEL_NAMES.get(level, (level, level))),
        "caveat": x.pack.caveat,
        "ai": ai,
        "sections": sections,
    }
    snapshot = {
        "generated_at": now,
        "filters": {"include_flagged": False},
        "counts": s["counts"],
        "waves": [{"wave": w["wave"], "n": w["n"]} for w in s["waves"]],
        "evidence_level": level,
        "design": s.get("design"),
        "overall_score": s["overall_score"],
        "facts": x.pack.facts,
    }
    return content, snapshot, run_id


# ------------------------------------------------------------------- CRUD
def _default_title(t: _Text, report_type: ReportType, project: Project) -> str:
    return f"{t(*TYPE_NAMES[report_type])} — {project.title}"[:300]


async def create_report(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, payload: dict[str, Any]
) -> tuple[Report, ReportVersion]:
    ctx.require(Permission.REPORTS_CREATE)
    project = await get_owned(session, Project, project_id, ctx)
    report_type = ReportType(payload["report_type"])
    tone = ReportTone(payload.get("tone") or ReportTone.FORMAL)
    x = await _inputs(session, ctx, project.id, payload.get("language"))
    title = (payload.get("title") or "").strip() or _default_title(x.t, report_type, project)
    audience = (payload.get("audience") or "").strip()
    content, snapshot, run_id = await _compose(
        session,
        ctx,
        x,
        report_type=report_type,
        tone=tone,
        audience=audience,
        title=title,
        use_ai=payload.get("use_ai", True),
    )
    report = Report(
        organization_id=ctx.organization_id,
        project_id=project.id,
        report_type=report_type,
        tone=tone,
        language=x.lang,
        title=title,
        audience=audience,
        current_version=1,
        created_by_id=ctx.user_id,
    )
    session.add(report)
    await session.flush()
    version = ReportVersion(
        organization_id=ctx.organization_id,
        report_id=report.id,
        version_number=1,
        reason="generated",
        content=content,
        data_snapshot=snapshot,
        ai_run_id=run_id,
        created_by_id=ctx.user_id,
    )
    session.add(version)
    audit(
        session,
        action="report.create",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="report",
        entity_id=report.id,
        meta={"type": report_type.value, "ai": content["ai"]["used"]},
    )
    await session.commit()
    return report, version


async def _version(session: AsyncSession, report: Report, number: int | None = None) -> ReportVersion:
    version = await session.scalar(
        select(ReportVersion).where(
            ReportVersion.report_id == report.id, ReportVersion.version_number == (number or report.current_version)
        )
    )
    if version is None:
        raise NotFound("Report version not found")
    return version


async def get_report(
    session: AsyncSession, ctx: OrgContext, report_id: uuid.UUID, version: int | None = None
) -> tuple[Report, ReportVersion]:
    ctx.require(Permission.REPORTS_READ)
    report = await get_owned(session, Report, report_id, ctx)
    return report, await _version(session, report, version)


async def list_versions(session: AsyncSession, ctx: OrgContext, report_id: uuid.UUID) -> list[dict[str, Any]]:
    ctx.require(Permission.REPORTS_READ)
    report = await get_owned(session, Report, report_id, ctx)
    rows = (
        await session.execute(
            select(ReportVersion, User.full_name)
            .outerjoin(User, User.id == ReportVersion.created_by_id)
            .where(ReportVersion.report_id == report.id)
            .order_by(ReportVersion.version_number.desc())
        )
    ).all()
    return [
        {
            "version_number": v.version_number,
            "reason": v.reason,
            "created_at": v.created_at,
            "created_by": name,
            "ai_used": bool((v.content.get("ai") or {}).get("used")),
            "data_generated_at": v.data_snapshot.get("generated_at"),
            "responses": (v.data_snapshot.get("counts") or {}).get("included"),
        }
        for v, name in rows
    ]


async def list_reports(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    ctx.require(Permission.REPORTS_READ)
    stmt = (
        select(Report, Project.title)
        .join(Project, Project.id == Report.project_id)
        .where(Report.organization_id == ctx.organization_id)
        .order_by(Report.updated_at.desc())
    )
    if project_id is not None:
        project = await get_owned(session, Project, project_id, ctx)
        stmt = stmt.where(Report.project_id == project.id)
    rows = (await session.execute(stmt)).all()
    return [_summary(report, title) for report, title in rows]


def _summary(report: Report, project_title: str) -> dict[str, Any]:
    return {
        "id": report.id,
        "project_id": report.project_id,
        "project_title": project_title,
        "report_type": report.report_type.value,
        "tone": report.tone.value,
        "language": report.language,
        "title": report.title,
        "audience": report.audience,
        "current_version": report.current_version,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


async def _next_version(session: AsyncSession, report: Report) -> int:
    latest = await session.scalar(
        select(func.max(ReportVersion.version_number)).where(ReportVersion.report_id == report.id)
    )
    return (latest or 0) + 1


async def regenerate(
    session: AsyncSession, ctx: OrgContext, report_id: uuid.UUID, payload: dict[str, Any]
) -> tuple[Report, ReportVersion]:
    """A new version from today's data (and optionally a new tone or audience)."""
    ctx.require(Permission.REPORTS_CREATE)
    report = await get_owned(session, Report, report_id, ctx)
    if payload.get("tone"):
        report.tone = ReportTone(payload["tone"])
    if payload.get("audience") is not None:
        report.audience = payload["audience"].strip()
    x = await _inputs(session, ctx, report.project_id, report.language)
    content, snapshot, run_id = await _compose(
        session,
        ctx,
        x,
        report_type=report.report_type,
        tone=report.tone,
        audience=report.audience,
        title=report.title,
        use_ai=payload.get("use_ai", True),
    )
    number = await _next_version(session, report)
    version = ReportVersion(
        organization_id=ctx.organization_id,
        report_id=report.id,
        version_number=number,
        reason="refreshed",
        content=content,
        data_snapshot=snapshot,
        ai_run_id=run_id,
        created_by_id=ctx.user_id,
    )
    session.add(version)
    report.current_version = number
    report.updated_at = datetime.now(UTC)
    audit(
        session,
        action="report.refresh",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="report",
        entity_id=report.id,
        meta={"version": number, "ai": content["ai"]["used"]},
    )
    await session.commit()
    return report, version


async def edit(
    session: AsyncSession, ctx: OrgContext, report_id: uuid.UUID, payload: dict[str, Any]
) -> tuple[Report, ReportVersion]:
    """A new version with the user's text edits: narrative text can change, numbers in tables cannot."""
    ctx.require(Permission.REPORTS_CREATE)
    report = await get_owned(session, Report, report_id, ctx)
    base = await _version(session, report)
    content = {**base.content, "sections": [dict(s) for s in base.content.get("sections", [])]}
    changed = False
    if payload.get("title"):
        title = payload["title"].strip()[:300]
        if title and title != report.title:
            report.title = content["title"] = title
            changed = True
    by_key = {s["key"]: s for s in content["sections"]}
    for patch in payload.get("sections") or []:
        sec = by_key.get(patch["key"])
        if sec is None:
            raise Unprocessable(f"Unknown section {patch['key']}", code="unknown_section")
        if patch.get("hidden") is not None and patch["hidden"] != sec.get("hidden", False):
            sec["hidden"] = bool(patch["hidden"])
            changed = True
        for field in ("paragraphs", "bullets"):
            if patch.get(field) is None:
                continue
            if sec["kind"] != "narrative":
                raise Unprocessable("Only narrative sections can be edited", code="not_editable")
            text = [p.strip() for p in patch[field] if p and p.strip()]
            if text != sec.get(field, []):
                sec[field] = text
                sec["source"] = "USER"
                changed = True
    if not changed:
        return report, base
    number = await _next_version(session, report)
    version = ReportVersion(
        organization_id=ctx.organization_id,
        report_id=report.id,
        version_number=number,
        reason="edited",
        content=content,
        data_snapshot=base.data_snapshot,
        ai_run_id=base.ai_run_id,
        created_by_id=ctx.user_id,
    )
    session.add(version)
    report.current_version = number
    report.updated_at = datetime.now(UTC)
    audit(
        session,
        action="report.edit",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="report",
        entity_id=report.id,
        meta={"version": number},
    )
    await session.commit()
    return report, version


async def delete_report(session: AsyncSession, ctx: OrgContext, report_id: uuid.UUID) -> None:
    ctx.require(Permission.REPORTS_CREATE)
    report = await get_owned(session, Report, report_id, ctx)
    audit(
        session,
        action="report.delete",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="report",
        entity_id=report.id,
        meta={"type": report.report_type.value},
    )
    await session.delete(report)
    await session.commit()


async def project_title(session: AsyncSession, report: Report) -> str:
    return await session.scalar(select(Project.title).where(Project.id == report.project_id)) or ""
