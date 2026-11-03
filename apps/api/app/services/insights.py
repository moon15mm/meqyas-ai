"""Evidence-linked insights and recommendations (ANALYTICS.md §8–9).

Insights are produced by deterministic rules over the analytics dataset: every number
in a title or body is formatted from the evidence object the rule computed, and the
same object is stored so the UI can show where it came from. Regeneration keeps the
user's decisions (pinned / dismissed) through a stable fingerprint per insight.
Recommendations are proposed by the RecommendationAgent from current insights, or
written by people.
"""

from __future__ import annotations

import statistics
import uuid
from dataclasses import dataclass, field
from typing import Any

from meqyas_ai.agents import RecommendationAgent
from meqyas_ai.domain.causality import allows_causal_language
from meqyas_ai.schemas.insight import RecommendationInput
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import Unprocessable
from ..domain import stats
from ..domain.enums import (
    Confidence,
    EvidenceLevel,
    IndicatorStatus,
    InsightKind,
    InsightStatus,
    Priority,
    QuestionType,
    RecommendationStatus,
    Severity,
    ThemeCategory,
    WaveType,
)
from ..domain.permissions import Permission
from ..domain.survey.templates import PLACEHOLDER_FALLBACK, fill_placeholders
from ..models import Insight, Project, Recommendation, TextAnalysis, Theme
from . import analytics
from . import indicators as indicator_svc
from .ai import run_agent
from .projects import get_owned

SEVERITY_RANK = {Severity.HIGH: 3, Severity.MEDIUM: 2, Severity.LOW: 1, Severity.INFO: 0}
WAVE_NAMES = {
    "BASELINE": ("القياس القبلي", "Baseline"),
    "MIDLINE": ("القياس المرحلي", "Midline"),
    "POST": ("القياس البعدي", "Post"),
    "FOLLOW_UP": ("قياس المتابعة", "Follow-up"),
    "ROUND": ("جولة القياس", "Round"),
    "SINGLE": ("القياس", "Measurement"),
}
EFFECT_NAMES = {
    "negligible": ("ضئيل", "negligible"),
    "small": ("صغير", "small"),
    "medium": ("متوسط", "medium"),
    "large": ("كبير", "large"),
}
SCALE_TYPES = {QuestionType.LIKERT, QuestionType.CSAT, QuestionType.CES, QuestionType.RATING, QuestionType.STAR}
_recommender = RecommendationAgent()


@dataclass
class Candidate:
    kind: InsightKind
    fingerprint: str
    severity: Severity
    confidence: Confidence
    title: str
    body: str
    evidence: dict[str, Any] = field(default_factory=dict)
    weight: float = 0.0


def _num(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    text = f"{value:.{digits}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def _signed(value: float, digits: int = 2) -> str:
    return ("+" if value > 0 else "−" if value < 0 else "") + _num(abs(value), digits)


def _p(value: float | None) -> str:
    return "< 0.001" if value is not None and value < 0.001 else f"= {_num(value, 3)}"


def _confidence(n: int, p: float | None = None) -> Confidence:
    if n >= 30 and (p is None or p < 0.01):
        return Confidence.HIGH
    if n >= 10 and (p is None or p < 0.05):
        return Confidence.MEDIUM
    return Confidence.LOW


class _Text:
    """Bilingual phrasing; Arabic first."""

    def __init__(self, lang: str, ds: analytics.Dataset) -> None:
        self.lang = lang
        self.ds = ds

    def __call__(self, ar: str, en: str) -> str:
        return ar if self.lang == "ar" else en

    def wave(self, wave: str) -> str:
        plan_wave = self.ds.waves.get(wave)
        if plan_wave is not None and plan_wave.name:
            return plan_wave.name
        base, _, number = wave.partition("-")  # repeated rounds: ROUND-2
        ar, en = WAVE_NAMES.get(base, (wave, wave))
        return self(ar, en) + (f" {number}" if number else "")

    def effect(self, label: str | None) -> str:
        ar, en = EFFECT_NAMES.get(label or "", ("", ""))
        return self(ar, en)

    def question(self, key: str) -> str:
        q = self.ds.questions.get(key)
        if q is None:
            return key
        return fill_placeholders(q.text, PLACEHOLDER_FALLBACK.get(self.lang, PLACEHOLDER_FALLBACK["ar"]))


def language(ds: analytics.Dataset) -> str:
    langs = [d.language for d in ds.docs.values()]
    return langs[-1] if langs else "ar"


def _range(ds: analytics.Dataset) -> dict[str, str] | None:
    if not ds.rows:
        return None
    times = [r.created_at for r in ds.rows]
    return {"from": min(times).date().isoformat(), "to": max(times).date().isoformat()}


# -------------------------------------------------------------------- rules
def _sample_and_quality(s: dict[str, Any], t: _Text) -> list[Candidate]:
    out: list[Candidate] = []
    counts = s["counts"]
    n = counts["included"]
    if 0 < n < 30:
        out.append(
            Candidate(
                InsightKind.SAMPLE,
                "SAMPLE:included",
                Severity.INFO,
                Confidence.HIGH,
                t("حجم العينة صغير", "Small sample"),
                t(
                    f"تستند النتائج إلى عدد محدود من الإجابات ({n})، لذا فسّر الفروق الصغيرة بحذر واجمع إجابات أكثر قبل القرارات الكبيرة.",
                    f"Results rest on only {n} responses: read small differences with care and collect more before big decisions.",
                ),
                {"metric": "responses_included", "value": n, "n": n},
            )
        )
    total, low = counts["total"], counts["low_quality"]
    if total >= 10 and low / total >= 0.10:
        pct = low / total * 100
        out.append(
            Candidate(
                InsightKind.DATA_QUALITY,
                "DATA_QUALITY:low_quality_share",
                Severity.HIGH if pct >= 25 else Severity.MEDIUM,
                Confidence.HIGH,
                t("نسبة مرتفعة من الإجابات منخفضة الجودة", "High share of low-quality responses"),
                t(
                    f"صُنّفت {_num(pct)}% من الإجابات ({low} من أصل {total}) منخفضة الجودة واستُبعدت من التحليل. راجعها من تبويب الإجابات، "
                    "وتحقق من طول الاستبيان ووضوح أسئلته.",
                    f"{low} of {total} responses ({_num(pct)}%) were flagged low quality and excluded. Review them in Responses "
                    "and check the survey's length and clarity.",
                ),
                {"metric": "low_quality_share", "value": round(pct, 1), "unit": "%", "n": total, "count": low},
                weight=pct,
            )
        )
    return out


def _latest_wave(waves: list[dict[str, Any]]) -> dict[str, Any] | None:
    usable = [w for w in waves if not w.get("masked") and w.get("score") is not None]
    return usable[-1] if usable else None


def _dimensions(s: dict[str, Any], t: _Text) -> list[Candidate]:
    latest = [(d, w) for d in s["dimensions"] if (w := _latest_wave(d["waves"])) is not None]
    if len(latest) < 2:
        return []
    low_d, low_w = min(latest, key=lambda x: x[1]["score"])
    high_d, high_w = max(latest, key=lambda x: x[1]["score"])
    out = []
    score = low_w["score"]
    out.append(
        Candidate(
            InsightKind.WEAKNESS,
            f"WEAKNESS:{low_d['key']}",
            Severity.HIGH if score < 50 else Severity.MEDIUM if score < 65 else Severity.LOW,
            _confidence(low_w["n"]),
            t(f"أضعف بُعد: {low_d['name']}", f"Weakest dimension: {low_d['name']}"),
            t(
                f"سجّل بُعد «{low_d['name']}» {_num(score)} من 100 في {t.wave(low_w['wave'])} (n={low_w['n']})، "
                "وهو الأدنى بين أبعاد القياس.",
                f"“{low_d['name']}” scored {_num(score)} out of 100 at {t.wave(low_w['wave'])} (n={low_w['n']}), "
                "the lowest of the dimensions.",
            ),
            {
                "metric": "dimension_score",
                "dimension_id": low_d["id"],
                "dimension_key": low_d["key"],
                "dimension": low_d["name"],
                "wave": low_w["wave"],
                "value": score,
                "unit": "/100",
                "mean": low_w["mean"],
                "n": low_w["n"],
            },
            weight=100 - score,
        )
    )
    if high_d["id"] != low_d["id"]:
        out.append(
            Candidate(
                InsightKind.STRENGTH,
                f"STRENGTH:{high_d['key']}",
                Severity.INFO,
                _confidence(high_w["n"]),
                t(f"أقوى بُعد: {high_d['name']}", f"Strongest dimension: {high_d['name']}"),
                t(
                    f"سجّل بُعد «{high_d['name']}» {_num(high_w['score'])} من 100 في {t.wave(high_w['wave'])} "
                    f"(n={high_w['n']})، وهو الأعلى بين الأبعاد.",
                    f"“{high_d['name']}” scored {_num(high_w['score'])} out of 100 at {t.wave(high_w['wave'])} "
                    f"(n={high_w['n']}), the highest of the dimensions.",
                ),
                {
                    "metric": "dimension_score",
                    "dimension_id": high_d["id"],
                    "dimension_key": high_d["key"],
                    "dimension": high_d["name"],
                    "wave": high_w["wave"],
                    "value": high_w["score"],
                    "unit": "/100",
                    "mean": high_w["mean"],
                    "n": high_w["n"],
                },
                weight=high_w["score"],
            )
        )
    return out


def _caveat(t: _Text, level: EvidenceLevel) -> str:
    if allows_causal_language(level):
        return ""
    return t(
        " هذا يصف التغير ولا يثبت وحده أن البرنامج هو السبب.",
        " This describes change; it does not by itself prove the program caused it.",
    )


def _comparison_evidence(cmp: dict[str, Any], dim: Any) -> dict[str, Any]:
    test = cmp["test"]
    return {
        "metric": "dimension_change",
        "dimension_id": str(dim.id),
        "dimension_key": dim.key,
        "dimension": dim.name,
        "from_wave": cmp["from_wave"],
        "to_wave": cmp["to_wave"],
        "from_value": cmp["from_mean"],
        "to_value": cmp["to_mean"],
        "change": cmp["change"]["absolute"],
        "scale": cmp["scale"],
        "p_value": test["p_value"],
        "effect_size": test["effect_size"],
        "effect_label": test["effect_label"],
        "test": test["test"],
        "paired": cmp["paired"],
        "n": cmp["n_pairs"] if cmp["paired"] else min(cmp["n_from"], cmp["n_to"]),
        "n_from": cmp["n_from"],
        "n_to": cmp["n_to"],
    }


def _significant(cmp: dict[str, Any] | None) -> bool:
    if not cmp or cmp.get("masked"):
        return False
    test = cmp["test"]
    return bool(
        test["suitable"]
        and test["p_value"] is not None
        and test["p_value"] < 0.05
        and test["effect_size"] is not None
        and abs(test["effect_size"]) >= 0.2
    )


def _changes(ds: analytics.Dataset, dims: list[Any], t: _Text, level: EvidenceLevel) -> list[Candidate]:
    waves = list(ds.wave_rows())
    if len(waves) < 2:
        return []
    first, last = waves[0], waves[-1]
    out: list[Candidate] = []
    for dim in dims:
        items = analytics._items_for(ds, dimension_id=dim.id)
        cmp = analytics.compare_scores(ds, items, first, last)
        if not _significant(cmp):
            continue
        assert cmp is not None
        test = cmp["test"]
        change = cmp["change"]["absolute"] or 0.0
        up = change > 0
        unit_digits = 2 if cmp["scale"] == "native" else 1
        how = t(
            "بقياسات مترابطة لنفس المشاركين" if cmp["paired"] else "بمقارنة مجموعتين مستقلتين",
            "paired on the same participants" if cmp["paired"] else "comparing independent groups",
        )
        ev = _comparison_evidence(cmp, dim)
        severity = (
            (Severity.LOW if (test["effect_label"] in ("medium", "large")) else Severity.INFO)
            if up
            else (Severity.HIGH if abs(test["effect_size"]) >= 0.5 else Severity.MEDIUM)
        )
        out.append(
            Candidate(
                InsightKind.IMPROVEMENT if up else InsightKind.DECLINE,
                f"{'IMPROVEMENT' if up else 'DECLINE'}:{dim.key}:{first}>{last}",
                severity,
                _confidence(ev["n"], test["p_value"]),
                t(
                    f"{'ارتفاع' if up else 'تراجع'} في «{dim.name}»",
                    f"{'Increase' if up else 'Decrease'} in “{dim.name}”",
                ),
                t(
                    f"{'ارتفع' if up else 'انخفض'} متوسط «{dim.name}» من {_num(cmp['from_mean'], unit_digits)} في "
                    f"{t.wave(first)} إلى {_num(cmp['to_mean'], unit_digits)} في {t.wave(last)} "
                    f"(تغير {_signed(change, unit_digits)}، حجم أثر {t.effect(test['effect_label'])} d = "
                    f"{_num(test['effect_size'], 2)}، p {_p(test['p_value'])}، {how})." + _caveat(t, level),
                    f"The mean of “{dim.name}” moved from {_num(cmp['from_mean'], unit_digits)} at {t.wave(first)} to "
                    f"{_num(cmp['to_mean'], unit_digits)} at {t.wave(last)} (change {_signed(change, unit_digits)}, "
                    f"{t.effect(test['effect_label'])} effect d = {_num(test['effect_size'], 2)}, p {_p(test['p_value'])}, {how})."
                    + _caveat(t, level),
                ),
                ev,
                weight=abs(test["effect_size"]) * 10,
            )
        )
    if WaveType.POST.value in waves and WaveType.FOLLOW_UP.value in waves:
        base = waves[0]
        for dim in dims:
            items = analytics._items_for(ds, dimension_id=dim.id)
            gained = (
                analytics.compare_scores(ds, items, base, WaveType.POST.value) if base != WaveType.POST.value else None
            )
            after = analytics.compare_scores(ds, items, WaveType.POST.value, WaveType.FOLLOW_UP.value)
            if not after or after.get("masked") or after["to_mean"] is None:
                continue
            faded = _significant(after) and (after["change"]["absolute"] or 0) < 0
            held = _significant(gained) and (gained or {}).get("change", {}).get("absolute", 0) > 0 and not faded
            if not (faded or held):
                continue
            digits = 2 if after["scale"] == "native" else 1
            out.append(
                Candidate(
                    InsightKind.PERSISTENCE,
                    f"PERSISTENCE:{dim.key}",
                    Severity.MEDIUM if faded else Severity.INFO,
                    _confidence(min(after["n_from"], after["n_to"]), after["test"]["p_value"] if faded else None),
                    t(
                        f"{'تراجع' if faded else 'استمر'} {'الأثر في' if faded else 'التحسن في'} «{dim.name}» بعد البرنامج",
                        f"“{dim.name}” {'faded' if faded else 'held'} at follow-up",
                    ),
                    t(
                        f"كان المتوسط {_num(after['from_mean'], digits)} في {t.wave('POST')} وأصبح "
                        f"{_num(after['to_mean'], digits)} في {t.wave('FOLLOW_UP')}"
                        + (
                            "؛ قد يحتاج التحسن إلى متابعة ودعم مستمرين."
                            if faded
                            else "، أي أن التحسن حافظ على مستواه تقريبًا."
                        ),
                        f"The mean was {_num(after['from_mean'], digits)} at {t.wave('POST')} and "
                        f"{_num(after['to_mean'], digits)} at {t.wave('FOLLOW_UP')}"
                        + ("; the gain may need continued support." if faded else ", so the gain largely held."),
                    ),
                    _comparison_evidence(after, dim),
                )
            )
    return out


def indicator_display(ind: dict[str, Any], t: _Text) -> dict[str, Any]:
    """Formatted value/target of an indicator and where it was measured. Change and effect
    indicators are computed between two waves, so they cite both (and the smaller n)."""
    kind = ind["indicator_type"]

    def fmt(v: float | None, signed: bool = False) -> str:
        if v is None:
            return "—"
        if kind == "PERCENTAGE":
            return f"{_num(v)}%"
        unit = f" {ind['unit']}" if ind.get("unit") and kind not in ("EFFECT_SIZE", "COUNT") else ""
        return f"{_signed(v) if signed else _num(v, 2)}{unit}"

    where: dict[str, Any] | None
    if ind.get("from_wave"):
        ends = [next((w for w in ind["waves"] if w["wave"] == ind[k]), None) for k in ("from_wave", "to_wave")]
        a, b = t.wave(ind["from_wave"]), t.wave(ind["to_wave"])
        where = {
            "wave": ind["to_wave"],
            "n": min((w["n"] for w in ends if w), default=0),
            "label": t(f"{a} ← {b}", f"{a} → {b}"),
        }
    else:
        latest = next((w for w in reversed(ind["waves"]) if w["value"] is not None), None)
        where = {**latest, "label": t.wave(latest["wave"])} if latest else None
    return {
        "value": fmt(ind["current_value"], signed=kind == "CHANGE"),
        "target": fmt(ind["target_value"]),
        "baseline": fmt(ind.get("baseline_value")) if kind not in ("CHANGE", "EFFECT_SIZE") else "—",
        "where": where,
    }


def _indicators(s: dict[str, Any], t: _Text) -> list[Candidate]:
    out = []
    for ind in s["indicators"]:
        status = ind["status"]
        if ind["current_value"] is None or ind["target_value"] is None:
            continue
        if status not in (
            IndicatorStatus.OFF_TRACK.value,
            IndicatorStatus.AT_RISK.value,
            IndicatorStatus.ACHIEVED.value,
        ):
            continue
        shown = indicator_display(ind, t)
        value, target = shown["value"], shown["target"]
        achieved = status == IndicatorStatus.ACHIEVED.value
        latest = shown["where"]
        out.append(
            Candidate(
                InsightKind.SUCCESS if achieved else InsightKind.RISK,
                f"{'SUCCESS' if achieved else 'RISK'}:{ind['code']}",
                Severity.INFO
                if achieved
                else Severity.HIGH
                if status == IndicatorStatus.OFF_TRACK.value
                else Severity.MEDIUM,
                _confidence(latest["n"] if latest else 0),
                t(
                    f"{'مؤشر حقق مستهدفه' if achieved else 'مؤشر خارج المسار' if status == 'OFF_TRACK' else 'مؤشر معرض للخطر'}: {ind['name']}",
                    f"{'Indicator met its target' if achieved else 'Indicator off track' if status == 'OFF_TRACK' else 'Indicator at risk'}: {ind['name']}",
                ),
                t(
                    f"القيمة الحالية للمؤشر {ind['code']} هي {value} مقابل مستهدف {target}"
                    + (f" ({latest['label']}، n={latest['n']})." if latest else "."),
                    f"{ind['code']} is at {value} against a target of {target}"
                    + (f" ({latest['label']}, n={latest['n']})." if latest else "."),
                ),
                {
                    "metric": "indicator",
                    "indicator_id": ind["id"],
                    "indicator_code": ind["code"],
                    "indicator": ind["name"],
                    "value": ind["current_value"],
                    "target": ind["target_value"],
                    "status": status,
                    "n": latest["n"] if latest else None,
                    **(
                        {"from_wave": ind["from_wave"], "to_wave": ind["to_wave"]}
                        if ind.get("from_wave")
                        else {"wave": latest["wave"] if latest else None}
                    ),
                },
                weight=0 if achieved else 50,
            )
        )
    return out


def _questions(ds: analytics.Dataset, s: dict[str, Any], t: _Text) -> list[Candidate]:
    rows_by_wave = ds.wave_rows()
    if not rows_by_wave:
        return []
    wave, rows = list(rows_by_wave.items())[-1]
    low: list[tuple[float, Any, dict[str, Any]]] = []
    for q in ds.questions.values():
        if q.type not in SCALE_TYPES or q.settings.is_profile:
            continue
        st = analytics.question_stats(ds, q, rows, raw_text=False)
        top = st.get("top_box") or {}
        if st.get("masked") or st["n"] < 10 or top.get("estimate") is None:
            continue
        share = top["estimate"] * 100
        if share < 50:
            low.append((share, q, st))
    out = []
    for share, q, st in sorted(low, key=lambda x: x[0])[:3]:
        text = t.question(q.key)
        out.append(
            Candidate(
                InsightKind.ATTENTION,
                f"ATTENTION:{q.key}",
                Severity.MEDIUM if share < 40 else Severity.LOW,
                _confidence(st["n"]),
                t(f"موافقة منخفضة: {text[:120]}", f"Low agreement: {text[:120]}"),
                t(
                    f"اختار {_num(share)}% فقط أعلى فئتين في «{text}» ({t.wave(wave)}، n={st['n']}).",
                    f"Only {_num(share)}% chose the top two options for “{text}” ({t.wave(wave)}, n={st['n']}).",
                ),
                {
                    "metric": "top_box",
                    "question_key": q.key,
                    "question": text,
                    "value": round(share, 1),
                    "unit": "%",
                    "wave": wave,
                    "n": st["n"],
                    "mean": (st.get("describe") or {}).get("mean"),
                },
                weight=50 - share,
            )
        )
    nps = s.get("nps")
    if nps and nps.get("score") is not None:
        score = nps["score"]
        if score < 0 or score >= 50:
            out.append(
                Candidate(
                    InsightKind.ATTENTION if score < 0 else InsightKind.STRENGTH,
                    "NPS:latest",
                    Severity.HIGH if score < 0 else Severity.INFO,
                    _confidence(nps["n"]),
                    t(
                        f"صافي نقاط الترويج {'سلبي' if score < 0 else 'مرتفع'}",
                        f"{'Negative' if score < 0 else 'High'} Net Promoter Score",
                    ),
                    t(
                        f"بلغ صافي نقاط الترويج {_signed(score, 0)} (المروجون {_num(nps['promoters'])}%، المنتقدون "
                        f"{_num(nps['detractors'])}%، n={nps['n']}).",
                        f"NPS is {_signed(score, 0)} (promoters {_num(nps['promoters'])}%, detractors {_num(nps['detractors'])}%, n={nps['n']}).",
                    ),
                    {
                        "metric": "nps",
                        "value": score,
                        "n": nps["n"],
                        "promoters": nps["promoters"],
                        "detractors": nps["detractors"],
                    },
                )
            )
    return out


def _gaps(ds: analytics.Dataset, dims: list[Any], t: _Text) -> list[Candidate]:
    rows_by_wave = ds.wave_rows()
    if not rows_by_wave:
        return []
    found: list[tuple[float, Candidate]] = []
    profile = [
        q
        for q in ds.questions.values()
        if q.settings.is_profile and q.type in (QuestionType.SINGLE_CHOICE, QuestionType.DROPDOWN)
    ]
    for q in profile:
        values, labels = analytics.segment_values(ds, q.key)
        for dim in dims:
            items = analytics._items_for(ds, dimension_id=dim.id)
            if not items:
                continue
            # Latest wave that has this dimension.
            for wave in reversed(list(rows_by_wave)):
                scores = analytics._respondent_scores(ds, rows_by_wave[wave], items)
                if scores:
                    break
            else:
                continue
            groups: dict[str, list[float]] = {}
            for rid, (_, norm) in scores.items():
                if rid in values:
                    groups.setdefault(values[rid], []).append(norm)
            groups = {k: v for k, v in groups.items() if len(v) >= analytics.K_ANON}
            if len(groups) < 2:
                continue
            means = {k: statistics.fmean(v) for k, v in groups.items()}
            hi = max(means, key=lambda k: means[k])
            lo = min(means, key=lambda k: means[k])
            gap = means[hi] - means[lo]
            if gap < 10:
                continue
            test = stats.independent_t(groups[lo], groups[hi])
            q_text = t.question(q.key)
            tentative = not (test.suitable and test.p_value is not None and test.p_value < 0.05)
            cand = Candidate(
                InsightKind.GAP,
                f"GAP:{dim.key}:{q.key}",
                Severity.MEDIUM if gap >= 15 else Severity.LOW,
                _confidence(min(len(groups[hi]), len(groups[lo])), test.p_value if test.suitable else None),
                t(f"فرق بين الفئات في «{dim.name}»", f"Group gap in “{dim.name}”"),
                t(
                    f"حسب «{q_text}»: سجّلت فئة «{labels.get(hi, hi)}» {_num(means[hi])} من 100 مقابل {_num(means[lo])} "
                    f"لفئة «{labels.get(lo, lo)}» (فرق {_num(gap)} نقطة، {t.wave(wave)}"
                    + (f"، p {_p(test.p_value)}" if test.suitable else "")
                    + ")."
                    + (
                        " الفرق غير دال إحصائيًا مع هذا الحجم من العينة، فاقرأه مؤشرًا للمتابعة لا نتيجة."
                        if tentative
                        else ""
                    ),
                    f"By “{q_text}”: “{labels.get(hi, hi)}” scored {_num(means[hi])} vs {_num(means[lo])} for "
                    f"“{labels.get(lo, lo)}” (gap {_num(gap)} points, {t.wave(wave)}"
                    + (f", p {_p(test.p_value)}" if test.suitable else "")
                    + ")."
                    + (
                        " The gap is not statistically significant at this sample size — treat it as a lead, not a finding."
                        if tentative
                        else ""
                    ),
                ),
                {
                    "metric": "segment_gap",
                    "dimension_id": str(dim.id),
                    "dimension": dim.name,
                    "segment": q.key,
                    "segment_question": q_text,
                    "high": {
                        "value": hi,
                        "label": labels.get(hi, hi),
                        "score": round(means[hi], 1),
                        "n": len(groups[hi]),
                    },
                    "low": {
                        "value": lo,
                        "label": labels.get(lo, lo),
                        "score": round(means[lo], 1),
                        "n": len(groups[lo]),
                    },
                    "value": round(gap, 1),
                    "unit": "points",
                    "wave": wave,
                    "p_value": test.p_value if test.suitable else None,
                    "n": len(groups[hi]) + len(groups[lo]),
                },
                weight=gap,
            )
            found.append((gap, cand))
    return [c for _, c in sorted(found, key=lambda x: -x[0])[:3]]


async def _themes(session: AsyncSession, ds: analytics.Dataset, t: _Text) -> list[Candidate]:
    analyses = {
        a.question_key: a
        for a in (await session.scalars(select(TextAnalysis).where(TextAnalysis.project_id == ds.project.id))).all()
    }
    themes = (await session.scalars(select(Theme).where(Theme.project_id == ds.project.id))).all()
    out = []
    for theme in themes:
        analysis = analyses.get(theme.question_key)
        total = analysis.answers_total if analysis else 0
        if total < analytics.K_ANON or theme.mention_count < 3:
            continue
        share = theme.mention_count / total * 100
        q_text = t.question(theme.question_key)
        evidence = {
            "metric": "theme_share",
            "theme_id": str(theme.id),
            "theme": theme.name,
            "category": theme.category.value,
            "question_key": theme.question_key,
            "question": q_text,
            "value": round(share, 1),
            "unit": "%",
            "count": theme.mention_count,
            "n": total,
        }
        if theme.category == ThemeCategory.PAIN_POINT and share >= 15:
            out.append(
                Candidate(
                    InsightKind.PAIN_POINT,
                    f"PAIN_POINT:{theme.question_key}:{theme.key}",
                    Severity.HIGH if share >= 30 else Severity.MEDIUM,
                    _confidence(total),
                    t(f"شكوى متكررة: {theme.name}", f"Recurring complaint: {theme.name}"),
                    t(
                        f"ذكر {_num(share)}% ممن أجابوا عن «{q_text}» موضوع «{theme.name}» "
                        f"({theme.mention_count} من أصل {total}).",
                        f"{_num(share)}% of those answering “{q_text}” raised “{theme.name}” "
                        f"({theme.mention_count} of {total}).",
                    ),
                    evidence,
                    weight=share,
                )
            )
        elif theme.category == ThemeCategory.STRENGTH and share >= 20:
            out.append(
                Candidate(
                    InsightKind.STRENGTH,
                    f"STRENGTH_THEME:{theme.question_key}:{theme.key}",
                    Severity.LOW,
                    _confidence(total),
                    t(f"نقطة قوة يذكرها المشاركون: {theme.name}", f"Strength participants mention: {theme.name}"),
                    t(
                        f"أشار {_num(share)}% ممن أجابوا عن «{q_text}» إلى «{theme.name}» "
                        f"({theme.mention_count} من أصل {total}).",
                        f"{_num(share)}% of those answering “{q_text}” mentioned “{theme.name}” "
                        f"({theme.mention_count} of {total}).",
                    ),
                    evidence,
                    weight=share,
                )
            )
    return out


# ----------------------------------------------------------------- service
async def generate_insights(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: analytics.Loaded | None = None
) -> list[Insight]:
    ctx.require(Permission.AI_ANALYZE)
    data = data or await analytics.load_project(session, ctx, project_id)
    project, ds, dims, s = data.project, data.ds, data.dims, data.summary
    t = _Text(language(ds), ds)
    level = EvidenceLevel(s["evidence_level"])
    candidates: list[Candidate] = []
    if s["counts"]["included"] >= analytics.K_ANON:
        candidates += _sample_and_quality(s, t)
        candidates += _dimensions(s, t)
        candidates += _changes(ds, dims, t, level)
        candidates += _indicators(s, t)
        candidates += _questions(ds, s, t)
        candidates += _gaps(ds, dims, t)
        candidates += await _themes(session, ds, t)
    elif s["counts"]["total"]:
        candidates += _sample_and_quality(s, t)
    data_range = _range(ds)
    for c in candidates:
        c.evidence.setdefault("filters", {"include_flagged": False})
        if data_range:
            c.evidence.setdefault("data_range", data_range)
    candidates.sort(key=lambda c: (-SEVERITY_RANK[c.severity], -c.weight))
    await indicator_svc.persist(session, data)  # the same computation feeds the indicator values

    existing = {
        i.fingerprint: i for i in (await session.scalars(select(Insight).where(Insight.project_id == project.id))).all()
    }
    seen: set[str] = set()
    for order, c in enumerate(candidates):
        if c.fingerprint in seen:
            continue
        seen.add(c.fingerprint)
        row = existing.get(c.fingerprint)
        if row is None:
            row = Insight(organization_id=ctx.organization_id, project_id=project.id, fingerprint=c.fingerprint)
            session.add(row)
        row.kind, row.severity, row.confidence = c.kind, c.severity, c.confidence
        row.title, row.body, row.evidence = c.title[:300], c.body, c.evidence
        row.current, row.sort_order = True, order
    for fingerprint, row in existing.items():
        if fingerprint in seen:
            continue
        if row.status == InsightStatus.PINNED:
            row.current = False
        else:
            await session.delete(row)
    await session.commit()
    return await list_insights(session, ctx, project.id)


async def list_insights(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, *, include_dismissed: bool = False
) -> list[Insight]:
    ctx.require(Permission.ANALYTICS_READ)
    project = await get_owned(session, Project, project_id, ctx)
    stmt = select(Insight).where(Insight.project_id == project.id)
    if not include_dismissed:
        stmt = stmt.where(Insight.status != InsightStatus.DISMISSED)
    rows = (await session.scalars(stmt.order_by(Insight.current.desc(), Insight.sort_order))).all()
    return list(rows)


async def set_insight_status(
    session: AsyncSession, ctx: OrgContext, insight_id: uuid.UUID, status: InsightStatus
) -> Insight:
    ctx.require(Permission.AI_ANALYZE)
    insight = await get_owned(session, Insight, insight_id, ctx)
    insight.status = status
    await session.commit()
    await session.refresh(insight)
    return insight


# ---------------------------------------------------------- recommendations
def _brief_evidence(evidence: dict[str, Any]) -> str:
    keys = ("value", "unit", "n", "from_value", "to_value", "change", "p_value", "effect_size", "target", "wave")
    return ", ".join(f"{k}={evidence[k]}" for k in keys if evidence.get(k) is not None)


async def generate_recommendations(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID
) -> list[Recommendation]:
    ctx.require(Permission.AI_ANALYZE)
    project = await get_owned(session, Project, project_id, ctx)
    insights = [
        i
        for i in await list_insights(session, ctx, project.id)
        if i.current and i.kind not in (InsightKind.SAMPLE,) and i.severity != Severity.INFO
    ][:20]
    if not insights:
        raise Unprocessable(
            "Generate insights first: recommendations respond to the problems the data shows",
            code="no_insights",
        )
    ds = await analytics.load_dataset(session, ctx, project.id)
    short = {f"N{i + 1}": ins for i, ins in enumerate(insights)}
    plan = ds.plan
    rec_input = {
        "language": language(ds),
        "project_title": project.title,
        "measurement_type": project.measurement_type.value if project.measurement_type else "",
        "target_population": project.target_population or "",
        "evidence_level": plan.evidence_level.value if plan else EvidenceLevel.DESCRIPTIVE.value,
        "insights": [
            {
                "id": sid,
                "kind": ins.kind.value,
                "severity": ins.severity.value,
                "title": ins.title,
                "body": ins.body,
                "evidence": _brief_evidence(ins.evidence),
            }
            for sid, ins in short.items()
        ],
    }
    result, run = await run_agent(
        session,
        organization=ctx.organization,
        user_id=ctx.user_id,
        agent=_recommender,
        data=rec_input,
        entity_type="project",
        entity_id=project.id,
    )
    proposed = result.output.recommendations
    if result.semantic_issues:  # the runner kept its last attempt: drop what is still unverified
        brief = RecommendationInput.model_validate(rec_input)
        proposed = [r for r in proposed if not _recommender.recommendation_issues(brief, r)]
        if not proposed:
            raise Unprocessable(
                "The suggested recommendations could not be verified against the insights; try again",
                code="ai_unverified",
            )
    await session.execute(
        delete(Recommendation).where(
            Recommendation.project_id == project.id,
            Recommendation.source == "AI",
            Recommendation.status == RecommendationStatus.PROPOSED,
        )
    )
    for rec in proposed:
        session.add(
            Recommendation(
                organization_id=ctx.organization_id,
                project_id=project.id,
                insight_ids=[str(short[i].id) for i in rec.insight_ids if i in short],
                problem=rec.problem,
                recommendation=rec.recommendation,
                possible_cause=rec.possible_cause,
                expected_outcome=rec.expected_outcome,
                priority=Priority(rec.priority),
                confidence=Confidence(rec.confidence),
                owner=rec.owner_hint[:200],
                timeframe=rec.timeframe[:120],
                source="AI",
                ai_run_id=run.id,
                created_by_id=ctx.user_id,
            )
        )
    await session.commit()
    return await list_recommendations(session, ctx, project.id)


async def list_recommendations(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> list[Recommendation]:
    ctx.require(Permission.ANALYTICS_READ)
    project = await get_owned(session, Project, project_id, ctx)
    order = {Priority.HIGH: 0, Priority.MEDIUM: 1, Priority.LOW: 2}
    rows = list(
        (
            await session.scalars(
                select(Recommendation)
                .where(Recommendation.project_id == project.id)
                .order_by(Recommendation.created_at)
            )
        ).all()
    )
    done = (RecommendationStatus.DONE, RecommendationStatus.DISMISSED)
    rows.sort(key=lambda r: (r.status in done, order[r.priority]))
    return rows


async def create_recommendation(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, data: dict[str, Any]
) -> Recommendation:
    ctx.require(Permission.AI_ANALYZE)
    project = await get_owned(session, Project, project_id, ctx)
    rec = Recommendation(
        organization_id=ctx.organization_id,
        project_id=project.id,
        source="MANUAL",
        created_by_id=ctx.user_id,
        **data,
    )
    session.add(rec)
    await session.commit()
    await session.refresh(rec)
    return rec


async def update_recommendation(
    session: AsyncSession, ctx: OrgContext, rec_id: uuid.UUID, changes: dict[str, Any]
) -> Recommendation:
    ctx.require(Permission.AI_ANALYZE)
    rec = await get_owned(session, Recommendation, rec_id, ctx)
    for key, value in changes.items():
        setattr(rec, key, value)
    await session.commit()
    await session.refresh(rec)
    return rec


async def delete_recommendation(session: AsyncSession, ctx: OrgContext, rec_id: uuid.UUID) -> None:
    ctx.require(Permission.AI_ANALYZE)
    rec = await get_owned(session, Recommendation, rec_id, ctx)
    await session.delete(rec)
    await session.commit()
