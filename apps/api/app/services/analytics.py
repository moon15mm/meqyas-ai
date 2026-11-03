"""Project analytics (ANALYTICS.md): dataset loading with the quality filter,
question summaries, dimension scores, indicators, wave comparison, segments and
cross-tabs. Every number comes from ``app.domain.stats``; nothing is estimated
by a model. Small segments are masked (k-anonymity) and raw text is only shown
to roles allowed to read raw responses.
"""

from __future__ import annotations

import statistics
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.domain.causality import allows_causal_language
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.errors import NotFound, Unprocessable
from ..domain import stats
from ..domain.enums import (
    EvidenceLevel,
    IndicatorDirection,
    IndicatorStatus,
    IndicatorType,
    ProjectStatus,
    QualityStatus,
    QuestionType,
    ReviewStatus,
    WaveType,
)
from ..domain.permissions import Permission
from ..domain.survey.document import CHOICE_TYPES, SCALE_TYPES, TEXT_TYPES, QuestionDoc, SurveyDoc
from ..models import (
    Answer,
    Dimension,
    Indicator,
    MeasurementPlan,
    MeasurementWave,
    Project,
    Response,
    Survey,
    SurveyVersion,
)
from .projects import get_owned
from .surveys import load_doc

K_ANON = stats.K_ANONYMITY
WAVE_ORDER = [WaveType.BASELINE, WaveType.MIDLINE, WaveType.POST, WaveType.FOLLOW_UP, WaveType.ROUND, WaveType.SINGLE]
NO_WAVE = "SINGLE"
#: Response metadata usable as segments; "product"/"store" come from store invitations,
#: "location" from branch links, kiosks and POS transactions.
META_SEGMENTS = {"wave", "device", "channel", "product", "store", "location"}


# ------------------------------------------------------------------ dataset
@dataclass(slots=True)
class Row:
    id: uuid.UUID
    survey_id: uuid.UUID
    wave: str
    respondent_id: uuid.UUID | None
    device: str
    channel: str
    created_at: datetime
    duration: int | None
    quality: QualityStatus
    review: ReviewStatus
    #: Store invitation context (product-level and store-level analysis).
    product_key: str | None = None
    product_name: str | None = None
    store_id: str | None = None
    store_name: str | None = None
    #: Physical location (branch, kiosk, counter) the response came from (CX.md §2).
    location_id: str | None = None
    location_name: str | None = None


@dataclass(slots=True)
class Item:
    """One measured item of a dimension/indicator (matrix rows are separate items)."""

    key: str
    row: str | None
    lo: float
    hi: float
    reverse: bool


@dataclass
class Dataset:
    project: Project
    plan: MeasurementPlan | None
    surveys: dict[uuid.UUID, Survey]
    docs: dict[uuid.UUID, SurveyDoc]
    waves: dict[str, MeasurementWave]
    rows: list[Row]
    #: response id → question key → raw value (matrix: {row: value})
    raw: dict[uuid.UUID, dict[str, Any]] = field(default_factory=dict)
    #: response id → (question key, row key) → numeric projection
    num: dict[uuid.UUID, dict[tuple[str, str | None], float]] = field(default_factory=dict)
    #: question key → reference definition (latest published version that contains it)
    questions: dict[str, QuestionDoc] = field(default_factory=dict)
    sections: dict[str, str] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)

    def wave_rows(self) -> dict[str, list[Row]]:
        out: dict[str, list[Row]] = defaultdict(list)
        for r in self.rows:
            out[r.wave].append(r)
        return dict(sorted(out.items(), key=lambda kv: _wave_rank(kv[0])))


def _wave_rank(wave: str) -> int:
    base, _, number = wave.partition("-")
    try:
        rank = [w.value for w in WAVE_ORDER].index(base)
    except ValueError:
        rank = len(WAVE_ORDER)
    return rank * 100 + (int(number) if number.isdigit() else 0)


#: Wave types a design may repeat (repeated measurement): each occurrence is its own wave.
REPEATABLE = {WaveType.ROUND, WaveType.MIDLINE}


def wave_keys(waves: list[MeasurementWave]) -> dict[uuid.UUID, str]:
    """Analysis key of each wave: its type — except repeated rounds, numbered ROUND-1, ROUND-2…
    when a project has several, so rounds are compared rather than merged."""
    by_type: dict[WaveType, list[MeasurementWave]] = defaultdict(list)
    for w in sorted(waves, key=lambda w: (w.sort_order, w.created_at)):
        by_type[w.wave_type].append(w)
    keys: dict[uuid.UUID, str] = {}
    for wave_type, group in by_type.items():
        numbered = wave_type in REPEATABLE and len(group) > 1
        for i, w in enumerate(group, 1):
            keys[w.id] = f"{wave_type.value}-{i}" if numbered else wave_type.value
    return keys


def store_context(r: Response) -> dict[str, Any]:
    return ((r.meta or {}).get("store") or {}) if isinstance(r.meta, dict) else {}


def location_context(r: Response) -> dict[str, Any]:
    return ((r.meta or {}).get("location") or {}) if isinstance(r.meta, dict) else {}


def is_test_response(r: Response) -> bool:
    """Answers to "send a test order" invitations never count (analytics, exports, counts)."""
    return bool(store_context(r).get("test"))


def _included(r: Response, include_flagged: bool) -> bool:
    if r.review_status == ReviewStatus.EXCLUDE:
        return False
    if r.review_status == ReviewStatus.KEEP or include_flagged:
        return True
    return r.quality_status != QualityStatus.LOW_QUALITY


async def load_dataset(
    session: AsyncSession,
    ctx: OrgContext,
    project_id: uuid.UUID,
    *,
    survey_id: uuid.UUID | None = None,
    include_flagged: bool = False,
) -> Dataset:
    ctx.require(Permission.ANALYTICS_READ)
    project = await get_owned(session, Project, project_id, ctx)
    plan = await session.scalar(select(MeasurementPlan).where(MeasurementPlan.project_id == project.id))
    survey_q = select(Survey).where(Survey.project_id == project.id, Survey.published_version_id.is_not(None))
    if survey_id is not None:
        survey_q = survey_q.where(Survey.id == survey_id)
    surveys = {s.id: s for s in (await session.scalars(survey_q)).all()}
    if survey_id is not None and survey_id not in surveys:
        raise NotFound("Survey not found or not published")
    waves_by_id = {
        w.id: w
        for w in (await session.scalars(select(MeasurementWave).where(MeasurementWave.project_id == project.id))).all()
    }
    wave_key = wave_keys(list(waves_by_id.values()))
    docs: dict[uuid.UUID, SurveyDoc] = {}
    for s in sorted(surveys.values(), key=lambda s: s.created_at):
        version = await session.get(SurveyVersion, s.published_version_id)
        if version is not None:
            docs[s.id] = await load_doc(session, version)

    ds = Dataset(
        project=project,
        plan=plan,
        surveys=surveys,
        docs=docs,
        waves={wave_key[w.id]: w for w in waves_by_id.values()},
        rows=[],
    )
    # Reference question definitions: later surveys (post/follow-up) override earlier ones.
    for doc in docs.values():
        for section in doc.sections:
            for q in section.questions:
                ds.questions[q.key] = q
                ds.sections[q.key] = section.title

    if not surveys:
        return ds
    responses = (
        await session.scalars(
            select(Response).where(Response.project_id == project.id, Response.survey_id.in_(list(surveys)))
        )
    ).all()
    counts: dict[str, int] = defaultdict(int)
    for r in responses:
        if is_test_response(r):
            continue
        counts["total"] += 1
        counts[r.quality_status.value] += 1
        if r.review_status == ReviewStatus.EXCLUDE:
            counts["EXCLUDED"] += 1
        if not _included(r, include_flagged):
            continue
        wave = waves_by_id.get(surveys[r.survey_id].wave_id) if surveys[r.survey_id].wave_id else None
        store = store_context(r)
        place = location_context(r)
        ds.rows.append(
            Row(
                id=r.id,
                survey_id=r.survey_id,
                wave=wave_key.get(wave.id, wave.wave_type.value) if wave else NO_WAVE,
                respondent_id=r.respondent_id,
                device=r.device,
                channel=r.channel.value,
                created_at=r.created_at,
                duration=r.duration_seconds,
                quality=r.quality_status,
                review=r.review_status,
                product_key=store.get("product_key"),
                product_name=store.get("product_name"),
                store_id=store.get("connection_id"),
                store_name=store.get("name"),
                location_id=place.get("id"),
                location_name=place.get("name"),
            )
        )
    counts["included"] = len(ds.rows)
    ds.counts = dict(counts)
    if not ds.rows:
        return ds

    included = {r.id for r in ds.rows}
    answers = await session.execute(
        select(Answer.response_id, Answer.question_key, Answer.row_key, Answer.value, Answer.numeric_value).where(
            Answer.survey_id.in_(list(surveys)), Answer.is_followup.is_(False)
        )
    )
    for rid, key, row, value, numeric in answers.all():
        if rid not in included:
            continue
        bucket = ds.raw.setdefault(rid, {})
        if row is not None:
            bucket.setdefault(key, {})[row] = value
        else:
            bucket[key] = value
        if numeric is not None:
            ds.num.setdefault(rid, {})[(key, row)] = float(numeric)
    return ds


# --------------------------------------------------------------- utilities
def _bounds(q: QuestionDoc) -> tuple[float, float] | None:
    """Numeric range of a measured question (scale, Likert/matrix columns or option scores)."""
    if q.type in (QuestionType.LIKERT, QuestionType.MATRIX):
        nums = [float(o.value) for o in q.options if _is_number(o.value)]
        if len(nums) >= 2:
            return min(nums), max(nums)
    if q.type in SCALE_TYPES and q.scale is not None:
        return float(q.scale.min), float(q.scale.max)
    if q.type in CHOICE_TYPES and q.type != QuestionType.MULTIPLE_CHOICE:
        scores = [o.score for o in q.options if o.score is not None]
        if len(scores) >= 2 and len(scores) == len([o for o in q.options if not o.is_other]):
            return float(min(scores)), float(max(scores))
    return None


def _is_number(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


def _items_for(
    ds: Dataset, *, dimension_id: uuid.UUID | None = None, indicator_id: uuid.UUID | None = None
) -> list[Item]:
    items: list[Item] = []
    for q in ds.questions.values():
        if q.settings.is_profile:
            continue
        if dimension_id is not None and q.dimension_id != dimension_id:
            continue
        if indicator_id is not None and q.indicator_id != indicator_id:
            continue
        bounds = _bounds(q)
        if bounds is None:
            continue
        reverse = bool(q.scale and q.scale.reverse_scored)
        if q.type == QuestionType.MATRIX:
            items.extend(Item(q.key, r.key, bounds[0], bounds[1], reverse) for r in q.settings.rows)
        else:
            items.append(Item(q.key, None, bounds[0], bounds[1], reverse))
    return items


def _item_value(ds: Dataset, rid: uuid.UUID, item: Item) -> float | None:
    value = ds.num.get(rid, {}).get((item.key, item.row))
    if value is None:
        return None
    return item.lo + item.hi - value if item.reverse else value


def _respondent_scores(ds: Dataset, rows: list[Row], items: list[Item]) -> dict[uuid.UUID, tuple[float, float]]:
    """response id → (native mean, 0–100 score) over the items it answered."""
    out: dict[uuid.UUID, tuple[float, float]] = {}
    for r in rows:
        native: list[float] = []
        norm: list[float] = []
        for item in items:
            v = _item_value(ds, r.id, item)
            if v is None:
                continue
            native.append(v)
            norm.append((v - item.lo) / (item.hi - item.lo) * 100 if item.hi > item.lo else 0.0)
        if native:
            out[r.id] = (statistics.fmean(native), statistics.fmean(norm))
    return out


def _homogeneous(items: list[Item]) -> tuple[float, float] | None:
    ranges = {(i.lo, i.hi) for i in items}
    return next(iter(ranges)) if len(ranges) == 1 else None


def _top_box_threshold(lo: float, hi: float) -> float:
    """Top-2-box on the item's own scale: 4–5 of 1–5, 3–4 of 1–4, 6–7 of 1–7, 9–10 of 0–10."""
    return hi - 1


def _option_label(q: QuestionDoc, value: Any) -> str:
    text = str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)
    for o in q.options:
        if o.value == text:
            return o.label
    return text


# --------------------------------------------------------- question stats
def question_stats(ds: Dataset, q: QuestionDoc, rows: list[Row], *, raw_text: bool) -> dict[str, Any]:
    out: dict[str, Any] = {
        "key": q.key,
        "text": q.text,
        "type": q.type.value,
        "section": ds.sections.get(q.key, ""),
        "dimension_id": q.dimension_id,
        "indicator_id": q.indicator_id,
        "is_profile": q.settings.is_profile,
    }
    answered = [r for r in rows if q.key in ds.raw.get(r.id, {})]
    out["n"] = len(answered)
    out["masked"] = 0 < len(answered) < K_ANON
    if out["masked"]:  # k-anonymity: an aggregate of fewer than K answers reveals individuals
        return out

    if q.type == QuestionType.MATRIX:
        bounds = _bounds(q)
        cats = [o.value for o in q.options]
        labels = {o.value: o.label for o in q.options}
        out["rows"] = []
        for row in q.settings.rows:
            vals = [ds.raw[r.id][q.key].get(row.key) for r in answered if isinstance(ds.raw[r.id][q.key], dict)]
            numeric = [float(v) for v in vals if v is not None]
            dist = stats.distribution([_code(v) for v in vals], categories=cats)
            entry: dict[str, Any] = {
                "key": row.key,
                "text": row.text,
                "describe": stats.describe(numeric).as_dict(),
                "distribution": _dist_out(dist, labels),
            }
            if bounds:
                entry["top_box"] = stats.top_box(numeric, _top_box_threshold(*bounds)).as_dict()
            out["rows"].append(entry)
        return out

    values = [ds.raw[r.id][q.key] for r in answered]
    if q.type in SCALE_TYPES or q.type == QuestionType.NUMBER:
        numeric = [float(v) for v in values if isinstance(v, int | float) and not isinstance(v, bool)]
        out["describe"] = stats.describe(numeric).as_dict()
        out["ci"] = stats.mean_ci(numeric).as_dict()
        bounds = _bounds(q)
        if bounds and q.type != QuestionType.SLIDER:
            lo, hi = bounds
            cats = (
                [o.value for o in q.options]
                if q.type == QuestionType.LIKERT
                else [str(int(v)) for v in range(int(lo), int(hi) + 1)]
            )
            labels = {o.value: o.label for o in q.options} or _scale_end_labels(q, lo, hi)
            out["distribution"] = _dist_out(stats.distribution([_code(v) for v in numeric], categories=cats), labels)
            out["top_box"] = {**stats.top_box(numeric, _top_box_threshold(lo, hi)).as_dict(), "threshold": hi - 1}
        if q.type == QuestionType.NPS:
            out["nps"] = stats.nps(numeric).as_dict()
        return out

    if q.type in (QuestionType.SINGLE_CHOICE, QuestionType.DROPDOWN):
        labels = {o.value: o.label for o in q.options}
        out["distribution"] = _dist_out(stats.distribution([str(v) for v in values], categories=list(labels)), labels)
        scored = [ds.num.get(r.id, {}).get((q.key, None)) for r in answered]
        scored_values = [v for v in scored if v is not None]
        if scored_values:
            out["describe"] = stats.describe(scored_values).as_dict()
        return out

    if q.type == QuestionType.MULTIPLE_CHOICE:
        n = len(values)
        options = []
        for o in q.options:
            k = sum(1 for v in values if isinstance(v, list) and o.value in v)
            ci = stats.proportion_ci(k, n)
            options.append(
                {
                    "value": o.value,
                    "label": o.label,
                    "count": k,
                    "pct": round(k / n * 100, 1) if n else 0.0,
                    "ci": ci.as_dict(),
                }
            )
        out["options"] = options
        return out

    if q.type == QuestionType.RANKING:
        ranking = []
        for o in q.options:
            positions = [v.index(o.value) + 1 for v in values if isinstance(v, list) and o.value in v]
            first = sum(1 for v in values if isinstance(v, list) and v and v[0] == o.value)
            ranking.append(
                {
                    "value": o.value,
                    "label": o.label,
                    "mean_rank": round(statistics.fmean(positions), 2) if positions else None,
                    "first_pct": round(first / len(values) * 100, 1) if values else 0.0,
                }
            )
        out["ranking"] = sorted(ranking, key=lambda r: (r["mean_rank"] is None, r["mean_rank"] or 0))
        return out

    if q.type in TEXT_TYPES:
        texts = [str(v) for v in values if isinstance(v, str) and v.strip()]
        out["text_count"] = len(texts)
        if raw_text:
            latest = sorted(answered, key=lambda r: r.created_at, reverse=True)
            out["text_samples"] = [str(ds.raw[r.id][q.key]) for r in latest if isinstance(ds.raw[r.id][q.key], str)][:8]
        return out

    if q.type == QuestionType.DATE:
        out["distribution"] = _dist_out(stats.distribution([str(v)[:7] for v in values]), {})
    return out


def _scale_end_labels(q: QuestionDoc, lo: float, hi: float) -> dict[str, str]:
    """Name the scale's end points the way the respondent saw them ("1 — غير راضٍ")."""
    if q.scale is None:
        return {}
    labels = {}
    if q.scale.min_label:
        labels[str(int(lo))] = f"{int(lo)} — {q.scale.min_label}"
    if q.scale.max_label:
        labels[str(int(hi))] = f"{int(hi)} — {q.scale.max_label}"
    return labels


def _code(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _dist_out(dist: stats.Distribution, labels: dict[str, str]) -> dict[str, Any]:
    return {
        "n": dist.n,
        "suitable": dist.suitable,
        "categories": [
            {"value": k, "label": labels.get(k, k), "count": dist.counts[k], "pct": dist.percentages.get(k, 0.0)}
            for k in dist.counts
        ],
    }


# ------------------------------------------------------------- dimensions
_MASKED_WAVE: dict[str, Any] = {
    "masked": True,
    "mean": None,
    "scale_min": None,
    "scale_max": None,
    "score": None,
    "ci_low": None,
    "ci_high": None,
    "top_box": None,
    "alpha": None,
    "alpha_label": None,
}


def dimension_results(ds: Dataset, dimensions: list[Dimension]) -> list[dict[str, Any]]:
    out = []
    for dim in dimensions:
        items = _items_for(ds, dimension_id=dim.id)
        entry: dict[str, Any] = {"id": str(dim.id), "key": dim.key, "name": dim.name, "items": len(items), "waves": []}
        if not items:
            out.append(entry)
            continue
        native_range = _homogeneous(items)
        for wave, rows in ds.wave_rows().items():
            scores = _respondent_scores(ds, rows, items)
            if 0 < len(scores) < K_ANON:
                entry["waves"].append({**_MASKED_WAVE, "wave": wave, "n": len(scores)})
                continue
            native = [s[0] for s in scores.values()]
            norm = [s[1] for s in scores.values()]
            ci = stats.mean_ci(norm)
            matrix = [[_item_value(ds, r.id, it) for it in items] for r in rows if r.id in scores]
            reliability = stats.cronbach_alpha(matrix) if len(items) >= 2 else None
            top = (
                stats.top_box(native, _top_box_threshold(*native_range)).as_dict() if native_range and native else None
            )
            entry["waves"].append(
                {
                    "wave": wave,
                    "n": len(scores),
                    "masked": False,
                    "mean": _round(statistics.fmean(native)) if native and native_range else None,
                    "scale_min": native_range[0] if native_range else None,
                    "scale_max": native_range[1] if native_range else None,
                    "score": _round(statistics.fmean(norm), 1) if norm else None,
                    "ci_low": ci.low,
                    "ci_high": ci.high,
                    "top_box": top,
                    "alpha": reliability.alpha if reliability else None,
                    "alpha_label": reliability.label if reliability else None,
                }
            )
        out.append(entry)
    return out


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


# -------------------------------------------------------------- indicators
def _indicator_value(
    ds: Dataset, ind: Indicator, rows: list[Row], items: list[Item]
) -> tuple[float | None, int, str | None]:
    """(value, n, reason) of an indicator for one wave's rows."""
    method = (ind.computation or {}).get("method") or {
        IndicatorType.AVERAGE_SCORE: "mean",
        IndicatorType.PERCENTAGE: "top_box_pct",
        IndicatorType.COUNT: "count",
    }.get(ind.indicator_type, "mean")
    if method == "count":
        n = sum(1 for r in rows if any(_item_value(ds, r.id, it) is not None for it in items)) if items else len(rows)
        return float(n), n, None
    if not items:
        return None, 0, "no_linked_questions"
    scores = _respondent_scores(ds, rows, items)
    n = len(scores)
    if n == 0:
        return None, 0, "no_data"
    if n < K_ANON:
        return None, n, "below_k_anonymity"
    native_range = _homogeneous(items)
    if method == "top_box_pct":
        comp = ind.computation or {}
        if native_range:
            lo, hi = native_range
            threshold = comp.get("threshold")
            if threshold is None or float(comp.get("scale_max", hi)) != hi:
                threshold = _top_box_threshold(lo, hi)
            hits = sum(1 for s in scores.values() if s[0] >= float(threshold))
        else:  # mixed scales: compare on the 0–100 score
            hits = sum(1 for s in scores.values() if s[1] >= 75)
        return round(hits / n * 100, 1), n, None
    if method == "rate":
        return None, n, "population_size_unknown"
    # mean (and the base of change/effect computations)
    if native_range:
        return round(statistics.fmean(s[0] for s in scores.values()), 2), n, None
    return round(statistics.fmean(s[1] for s in scores.values()), 1), n, None


def _status(ind: Indicator, current: float | None, *, collecting: bool = False) -> IndicatorStatus:
    if current is None:
        return IndicatorStatus.COLLECTING if collecting else IndicatorStatus.NOT_STARTED
    target = ind.target_value
    if target is None:
        return IndicatorStatus.ON_TRACK
    lower_better = ind.direction == IndicatorDirection.LOWER_IS_BETTER
    met = current <= target if lower_better else current >= target
    if met:
        return IndicatorStatus.ACHIEVED
    if target == 0:
        return IndicatorStatus.AT_RISK
    ratio = target / current if lower_better and current else current / target
    if ratio >= 0.9:
        return IndicatorStatus.ON_TRACK
    if ratio >= 0.75:
        return IndicatorStatus.AT_RISK
    return IndicatorStatus.OFF_TRACK


def indicator_results(ds: Dataset, indicators: list[Indicator]) -> list[dict[str, Any]]:
    out = []
    wave_rows = ds.wave_rows()
    for ind in indicators:
        items = _items_for(ds, indicator_id=ind.id)
        items_from: str | None = "indicator" if items else None
        if not items and ind.dimension_id is not None:
            # A question links to one indicator, so a dimension's second indicator (e.g. «% positive»
            # next to its average) has no questions of its own: it is measured on the dimension's.
            items = _items_for(ds, dimension_id=ind.dimension_id)
            items_from = "dimension" if items else None
        comp = ind.computation or {}
        method = comp.get("method")
        per_wave = []
        for wave, rows in wave_rows.items():
            value, n, reason = _indicator_value(ds, ind, rows, items)
            per_wave.append({"wave": wave, "value": value, "n": n, "reason": reason})
        entry: dict[str, Any] = {
            "id": str(ind.id),
            "code": ind.code,
            "name": ind.name,
            "indicator_type": ind.indicator_type.value,
            "unit": ind.unit,
            "direction": ind.direction.value,
            "target_value": ind.target_value,
            "method": method,
            "items": len(items),
            "items_from": items_from,
            "waves": per_wave,
        }
        with_data = [w for w in per_wave if w["value"] is not None]
        if ind.indicator_type in (IndicatorType.CHANGE, IndicatorType.EFFECT_SIZE):
            from_wave = comp.get("from_wave", "BASELINE")
            to_wave = comp.get("to_wave", "POST")
            a = next((w for w in per_wave if w["wave"] == from_wave), None)
            b = next((w for w in per_wave if w["wave"] == to_wave), None)
            entry["from_wave"], entry["to_wave"] = from_wave, to_wave
            if ind.indicator_type == IndicatorType.CHANGE:
                ch = stats.change(a["value"] if a else None, b["value"] if b else None)
                entry["current_value"] = ch.absolute
                entry["change"] = ch.as_dict()
            else:
                comparison = compare_scores(ds, items, from_wave, to_wave)
                entry["current_value"] = comparison["test"]["effect_size"] if comparison else None
                entry["comparison"] = comparison
            entry["baseline_value"] = a["value"] if a else None
        else:
            entry["current_value"] = with_data[-1]["value"] if with_data else None
            base = next((w for w in per_wave if w["wave"] == WaveType.BASELINE.value), None)
            entry["baseline_value"] = base["value"] if base else None
            if base and with_data and with_data[-1]["wave"] != base["wave"]:
                entry["change"] = stats.change(base["value"], with_data[-1]["value"]).as_dict()
        collecting = any(w["reason"] == "below_k_anonymity" and w["n"] > 0 for w in per_wave)
        entry["status"] = _status(ind, entry.get("current_value"), collecting=collecting).value
        out.append(entry)
    return out


# ------------------------------------------------------------- comparison
def compare_scores(ds: Dataset, items: list[Item], from_wave: str, to_wave: str) -> dict[str, Any] | None:
    waves = ds.wave_rows()
    a_rows, b_rows = waves.get(from_wave, []), waves.get(to_wave, [])
    if not items or not a_rows or not b_rows:
        return None
    a = _respondent_scores(ds, a_rows, items)
    b = _respondent_scores(ds, b_rows, items)
    if not a or not b:  # not measured in one of the waves: nothing to compare
        return None
    native_range = _homogeneous(items)
    use_native = native_range is not None
    lo, hi = native_range or (0.0, 100.0)
    if len(a) < K_ANON or len(b) < K_ANON:  # k-anonymity: no means or tests for tiny groups
        return {
            "from_wave": from_wave,
            "to_wave": to_wave,
            "scale": "native" if use_native else "score_100",
            "scale_min": lo,
            "scale_max": hi,
            "n_from": len(a),
            "n_to": len(b),
            "n_pairs": 0,
            "paired": False,
            "masked": True,
            "from_mean": None,
            "to_mean": None,
            "change": stats.change(None, None).as_dict(),
            "test": stats.TestResult(suitable=False, reason="below_k_anonymity", n_a=len(a), n_b=len(b)).as_dict(),
        }
    idx = 0 if use_native else 1
    by_person_a = {r.respondent_id: a[r.id][idx] for r in a_rows if r.id in a and r.respondent_id}
    by_person_b = {r.respondent_id: b[r.id][idx] for r in b_rows if r.id in b and r.respondent_id}
    paired_ids = sorted(set(by_person_a) & set(by_person_b), key=str)
    if len(paired_ids) >= 10:
        test = stats.paired_t([by_person_a[p] for p in paired_ids], [by_person_b[p] for p in paired_ids])
        paired = True
    else:
        test = stats.independent_t([v[idx] for v in a.values()], [v[idx] for v in b.values()])
        paired = False
    mean_a = statistics.fmean(v[idx] for v in a.values()) if a else None
    mean_b = statistics.fmean(v[idx] for v in b.values()) if b else None
    return {
        "from_wave": from_wave,
        "to_wave": to_wave,
        "scale": "native" if use_native else "score_100",
        "scale_min": lo,
        "scale_max": hi,
        "n_from": len(a),
        "n_to": len(b),
        "n_pairs": len(paired_ids),
        "paired": paired,
        "masked": False,
        "from_mean": _round(mean_a),
        "to_mean": _round(mean_b),
        "change": stats.change(_round(mean_a), _round(mean_b)).as_dict(),
        "test": test.as_dict(),
    }


def wave_comparison(ds: Dataset, dimensions: list[Dimension], from_wave: str, to_wave: str) -> dict[str, Any]:
    results = []
    for dim in dimensions:
        cmp = compare_scores(ds, _items_for(ds, dimension_id=dim.id), from_wave, to_wave)
        if cmp is not None:
            results.append({"dimension_id": str(dim.id), "key": dim.key, "name": dim.name, **cmp})
    questions = []
    for q in ds.questions.values():
        if q.settings.is_profile or _bounds(q) is None or q.type == QuestionType.MATRIX:
            continue
        bounds = _bounds(q)
        if bounds is None:  # pragma: no cover - filtered above
            continue
        item = Item(q.key, None, bounds[0], bounds[1], bool(q.scale and q.scale.reverse_scored))
        cmp = compare_scores(ds, [item], from_wave, to_wave)
        if cmp is not None:
            questions.append({"key": q.key, "text": q.text, **cmp})
    return {"from_wave": from_wave, "to_wave": to_wave, "dimensions": results, "questions": questions}


# ------------------------------------------------------- segments & crosstab
def segment_values(ds: Dataset, segment: str) -> tuple[dict[uuid.UUID, str], dict[str, str]]:
    """response id → segment value, and value → label."""
    if segment == "wave":
        return {r.id: r.wave for r in ds.rows}, {}
    if segment == "device":
        return {r.id: r.device for r in ds.rows}, {}
    if segment == "channel":
        return {r.id: r.channel for r in ds.rows}, {}
    if segment == "product":
        rows = [r for r in ds.rows if r.product_key]
        return {r.id: str(r.product_key) for r in rows}, {str(r.product_key): r.product_name or "" for r in rows}
    if segment == "store":
        rows = [r for r in ds.rows if r.store_id]
        return {r.id: str(r.store_id) for r in rows}, {str(r.store_id): r.store_name or "" for r in rows}
    if segment == "location":
        rows = [r for r in ds.rows if r.location_id]
        return {r.id: str(r.location_id) for r in rows}, {str(r.location_id): r.location_name or "" for r in rows}
    q = ds.questions.get(segment)
    if q is None or q.type not in (QuestionType.SINGLE_CHOICE, QuestionType.DROPDOWN):
        raise Unprocessable("Segments must be single-choice questions, wave, device or channel", code="invalid_segment")
    values = {r.id: str(ds.raw[r.id][q.key]) for r in ds.rows if q.key in ds.raw.get(r.id, {})}
    return values, {o.value: o.label for o in q.options}


def segmented_stats(ds: Dataset, q: QuestionDoc, segment: str) -> list[dict[str, Any]]:
    values, labels = segment_values(ds, segment)
    groups: dict[str, list[Row]] = defaultdict(list)
    for r in ds.rows:
        if r.id in values:
            groups[values[r.id]].append(r)
    order = list(labels) if labels else sorted(groups, key=_wave_rank if segment == "wave" else str)
    out = []
    for value in order:
        rows = groups.get(value, [])
        if not rows:
            continue
        summary = question_stats(ds, q, rows, raw_text=False)
        masked = summary["n"] < K_ANON
        out.append(
            {
                "value": value,
                "label": labels.get(value, value),
                "n": summary["n"],
                "masked": masked,
                "stats": None if masked else _compact(summary),
            }
        )
    return out


def _compact(summary: dict[str, Any]) -> dict[str, Any]:
    keep = ("describe", "top_box", "distribution", "nps", "options", "rows")
    return {k: summary[k] for k in keep if k in summary}


def crosstab(ds: Dataset, row_key: str, col_key: str) -> dict[str, Any]:
    rv, rl = segment_values(ds, row_key)
    cv, cl = segment_values(ds, col_key)
    used = [r for r in ds.rows if r.id in rv and r.id in cv]
    ids = [r.id for r in used]
    rows_order = list(rl) if rl else sorted({rv[i] for i in ids}, key=_wave_rank if row_key == "wave" else str)
    cols_order = list(cl) if cl else sorted({cv[i] for i in ids}, key=_wave_rank if col_key == "wave" else str)
    ct = stats.crosstab([rv[i] for i in ids], [cv[i] for i in ids], rows=rows_order, columns=cols_order)
    result = ct.as_dict()
    # The chi-square test assumes independent observations: one person answering several
    # waves is counted once per wave, so the test is withheld (the counts stay descriptive).
    people = [r.respondent_id for r in used if r.respondent_id is not None]
    if ct.suitable and len(people) != len(set(people)):
        result["suitable"], result["reason"] = False, "repeated_respondents"
    result["row_labels"] = [rl.get(r, r) for r in ct.rows]
    result["column_labels"] = [cl.get(c, c) for c in ct.columns]
    # k-anonymity: hide rows (segments) smaller than K.
    masked_rows = []
    for i, counts in enumerate(ct.counts):
        if 0 < sum(counts) < K_ANON:
            masked_rows.append(i)
            result["counts"][i] = None
            result["row_percentages"][i] = None
    result["masked_rows"] = masked_rows
    return result


# --------------------------------------------------------------- summary
CAUSAL_NOTES = {
    EvidenceLevel.DESCRIPTIVE: "descriptive_only",
    EvidenceLevel.PERCEIVED_CHANGE: "perceived_change",
    EvidenceLevel.TREND: "trend_only",
    EvidenceLevel.CHANGE: "change_not_cause",
    EvidenceLevel.CHANGE_PERSISTENCE: "change_not_cause",
    EvidenceLevel.CONTRIBUTION: "contribution",
    EvidenceLevel.ATTRIBUTION: "attribution",
}


def summary(ds: Dataset, dimensions: list[Dimension], indicators: list[Indicator]) -> dict[str, Any]:
    wave_rows = ds.wave_rows()
    durations = [r.duration for r in ds.rows if r.duration is not None]
    by_day: dict[str, int] = defaultdict(int)
    for r in ds.rows:
        by_day[r.created_at.astimezone(UTC).date().isoformat()] += 1
    dims = dimension_results(ds, dimensions)
    latest_scores = []
    for d in dims:
        waves = [w for w in d["waves"] if w["score"] is not None and w["n"] >= K_ANON]
        if waves:
            latest_scores.append((d, waves[-1]))
    overall = round(statistics.fmean(w["score"] for _, w in latest_scores), 1) if latest_scores else None
    strength = max(latest_scores, key=lambda x: x[1]["score"], default=None)
    problem = min(latest_scores, key=lambda x: x[1]["score"], default=None)

    nps_value = None
    csat_value = None
    latest_rows = list(wave_rows.values())[-1] if wave_rows else []
    for q in ds.questions.values():
        vals = [ds.raw[r.id][q.key] for r in latest_rows if q.key in ds.raw.get(r.id, {})]
        numeric = [float(v) for v in vals if isinstance(v, int | float) and not isinstance(v, bool)]
        if len(numeric) < K_ANON:
            continue
        if q.type == QuestionType.NPS and nps_value is None:
            nps_value = stats.nps(numeric).as_dict()
        if q.type == QuestionType.CSAT and csat_value is None:
            csat_value = stats.top_box(numeric, 4).as_dict()

    level = ds.plan.evidence_level if ds.plan else EvidenceLevel.DESCRIPTIVE
    return {
        "project_id": str(ds.project.id),
        "generated_at": datetime.now(UTC).isoformat(),
        "counts": {
            "total": ds.counts.get("total", 0),
            "included": ds.counts.get("included", 0),
            "valid": ds.counts.get(QualityStatus.VALID.value, 0),
            "suspicious": ds.counts.get(QualityStatus.SUSPICIOUS.value, 0),
            "low_quality": ds.counts.get(QualityStatus.LOW_QUALITY.value, 0),
            "excluded": ds.counts.get("EXCLUDED", 0),
        },
        "median_duration_seconds": round(statistics.median(durations)) if len(durations) >= K_ANON else None,
        "last_response_at": max((r.created_at for r in ds.rows), default=None),
        "responses_by_day": [{"date": d, "count": c} for d, c in sorted(by_day.items())],
        "waves": [
            {
                "wave": wave,
                "name": ds.waves[wave].name if wave in ds.waves else None,
                "n": len(rows),
                "survey_ids": sorted({str(r.survey_id) for r in rows}),
            }
            for wave, rows in wave_rows.items()
        ],
        "overall_score": overall,
        "top_strength": {"dimension_id": strength[0]["id"], "name": strength[0]["name"], "score": strength[1]["score"]}
        if strength and len(latest_scores) > 1
        else None,
        "top_problem": {"dimension_id": problem[0]["id"], "name": problem[0]["name"], "score": problem[1]["score"]}
        if problem and len(latest_scores) > 1
        else None,
        "nps": nps_value,
        "csat": csat_value,
        "dimensions": dims,
        "indicators": indicator_results(ds, indicators),
        "evidence_level": level.value,
        "design": ds.plan.recommended_design.value if ds.plan else None,
        "causality": {"allows_causal_language": allows_causal_language(level), "note": CAUSAL_NOTES.get(level)},
        "k_anonymity": K_ANON,
        "channels": dict(Counter(r.channel for r in ds.rows)),
        "products": len({r.product_key for r in ds.rows if r.product_key}),
    }


# -------------------------------------------------------------- portfolio
async def portfolio(session: AsyncSession, ctx: OrgContext) -> list[dict[str, Any]]:
    """Per-project collection status for the results hub. Counts only — no answers are read."""
    ctx.require(Permission.ANALYTICS_READ)
    projects = (
        await session.scalars(
            select(Project)
            .where(Project.organization_id == ctx.organization_id, Project.status != ProjectStatus.ARCHIVED)
            .order_by(Project.is_demo.asc(), Project.updated_at.desc())
        )
    ).all()
    if not projects:
        return []
    ids = [p.id for p in projects]
    included = and_(
        Response.review_status != ReviewStatus.EXCLUDE,
        or_(Response.review_status == ReviewStatus.KEEP, Response.quality_status != QualityStatus.LOW_QUALITY),
    )
    scope = (Response.organization_id == ctx.organization_id, Response.project_id.in_(ids))
    counts = {
        pid: (total, kept, last)
        for pid, total, kept, last in (
            await session.execute(
                select(
                    Response.project_id,
                    func.count(),
                    func.count().filter(included),
                    func.max(Response.created_at),
                )
                .where(*scope)
                .group_by(Response.project_id)
            )
        ).all()
    }
    waves: dict[uuid.UUID, set[str]] = defaultdict(set)
    for pid, wave_type in (
        await session.execute(
            select(Response.project_id, MeasurementWave.wave_type)
            .join(MeasurementWave, MeasurementWave.id == Response.wave_id)
            .where(*scope, included)
            .distinct()
        )
    ).all():
        waves[pid].add(wave_type.value)
    published: dict[uuid.UUID, int] = {
        pid: n
        for pid, n in (
            await session.execute(
                select(Survey.project_id, func.count())
                .where(Survey.project_id.in_(ids), Survey.published_version_id.is_not(None))
                .group_by(Survey.project_id)
            )
        ).all()
    }
    plans = {
        p.project_id: p
        for p in (await session.scalars(select(MeasurementPlan).where(MeasurementPlan.project_id.in_(ids)))).all()
    }
    out = []
    for p in projects:
        total, kept, last = counts.get(p.id, (0, 0, None))
        plan = plans.get(p.id)
        out.append(
            {
                "id": str(p.id),
                "title": p.title,
                "measurement_type": p.measurement_type.value if p.measurement_type else None,
                "status": p.status.value,
                "is_demo": p.is_demo,
                "evidence_level": plan.evidence_level.value if plan else None,
                "published_surveys": int(published.get(p.id, 0)),
                "responses_total": int(total),
                "responses_included": int(kept),
                "last_response_at": last,
                "waves": sorted(waves.get(p.id, set()), key=_wave_rank),
            }
        )
    return out


async def plan_refs(session: AsyncSession, project_id: uuid.UUID) -> tuple[list[Dimension], list[Indicator]]:
    dims = (
        await session.scalars(
            select(Dimension).where(Dimension.project_id == project_id).order_by(Dimension.sort_order)
        )
    ).all()
    inds = (
        await session.scalars(
            select(Indicator).where(Indicator.project_id == project_id).order_by(Indicator.sort_order)
        )
    ).all()
    return list(dims), list(inds)


__all__ = [
    "Dataset",
    "compare_scores",
    "crosstab",
    "dimension_results",
    "indicator_results",
    "load_dataset",
    "plan_refs",
    "portfolio",
    "question_stats",
    "segmented_stats",
    "summary",
    "wave_comparison",
]


# ------------------------------------------------------------------ bundle
@dataclass
class Loaded:
    """Everything computed once per request: the dataset, plan references and summary."""

    project: Project
    ds: Dataset
    dims: list[Dimension]
    inds: list[Indicator]
    summary: dict[str, Any]


async def load_project(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> Loaded:
    project = await get_owned(session, Project, project_id, ctx)
    ds = await load_dataset(session, ctx, project.id)
    dims, inds = await plan_refs(session, project.id)
    return Loaded(project, ds, list(dims), list(inds), summary(ds, dims, inds))
