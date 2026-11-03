"""Statistical engine (ANALYTICS.md §2) — the only place numbers are computed.

Pure functions over plain sequences / numpy arrays. Every result says whether it
is *suitable* (assumptions met, enough data) and, if not, why — the UI shows the
reason instead of a misleading number. No LLM ever computes a figure.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Hashable, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
from scipy import stats as sps

#: Below this n a mean / CI is reported as unsuitable.
MIN_N = 2
#: Below this cell count a segment is masked (k-anonymity) and a chi-square is unreliable.
K_ANONYMITY = 5


def _clean(values: Sequence[float | int | None]) -> np.ndarray:
    arr = np.asarray([v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))], dtype=float)
    return arr


def _r(x: float | None, digits: int = 4) -> float | None:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), digits)


@dataclass(slots=True)
class Result:
    suitable: bool = True
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# ------------------------------------------------------------- descriptives
@dataclass(slots=True)
class Describe(Result):
    n: int = 0
    mean: float | None = None
    median: float | None = None
    sd: float | None = None
    min: float | None = None
    max: float | None = None
    q1: float | None = None
    q3: float | None = None
    modes: list[float] = field(default_factory=list)


def describe(values: Sequence[float | int | None]) -> Describe:
    x = _clean(values)
    if x.size == 0:
        return Describe(suitable=False, reason="no_data")
    counts = Counter(x.tolist())
    top = max(counts.values())
    modes = sorted(v for v, c in counts.items() if c == top) if top > 1 or x.size == 1 else []
    return Describe(
        n=int(x.size),
        mean=_r(x.mean()),
        median=_r(float(np.median(x))),
        sd=_r(x.std(ddof=1)) if x.size >= 2 else None,
        min=_r(x.min()),
        max=_r(x.max()),
        q1=_r(float(np.percentile(x, 25))),
        q3=_r(float(np.percentile(x, 75))),
        modes=[_r(m) for m in modes][:5],  # type: ignore[misc]
    )


@dataclass(slots=True)
class Interval(Result):
    estimate: float | None = None
    low: float | None = None
    high: float | None = None
    level: float = 0.95


def mean_ci(values: Sequence[float | int | None], level: float = 0.95) -> Interval:
    x = _clean(values)
    if x.size < MIN_N:
        return Interval(suitable=False, reason="n_too_small", estimate=_r(x.mean()) if x.size else None, level=level)
    mean = float(x.mean())
    sem = float(x.std(ddof=1) / math.sqrt(x.size))
    if sem == 0:
        return Interval(estimate=_r(mean), low=_r(mean), high=_r(mean), level=level)
    t = float(sps.t.ppf((1 + level) / 2, df=x.size - 1))
    return Interval(estimate=_r(mean), low=_r(mean - t * sem), high=_r(mean + t * sem), level=level)


def proportion_ci(k: int, n: int, level: float = 0.95) -> Interval:
    """Wilson score interval (good coverage for small n and extreme p)."""
    if n <= 0:
        return Interval(suitable=False, reason="no_data", level=level)
    p = k / n
    z = float(sps.norm.ppf((1 + level) / 2))
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return Interval(estimate=_r(p), low=_r(max(0.0, centre - half)), high=_r(min(1.0, centre + half)), level=level)


@dataclass(slots=True)
class Distribution(Result):
    n: int = 0
    counts: dict[str, int] = field(default_factory=dict)
    percentages: dict[str, float] = field(default_factory=dict)


def _largest_remainder(counts: dict[str, int], total: int, decimals: int = 1) -> dict[str, float]:
    """Percentages rounded so they add up to exactly 100 (Hamilton method)."""
    if total == 0:
        return {k: 0.0 for k in counts}
    scale = 10**decimals
    raw = {k: v * 100 * scale / total for k, v in counts.items()}
    floored = {k: math.floor(v) for k, v in raw.items()}
    leftover = 100 * scale - sum(floored.values())
    for k in sorted(raw, key=lambda k: raw[k] - floored[k], reverse=True)[: max(0, leftover)]:
        floored[k] += 1
    return {k: v / scale for k, v in floored.items()}


def distribution(values: Sequence[Hashable | None], categories: Sequence[Hashable] | None = None) -> Distribution:
    """Counts + percentages over ``categories`` (all listed, zeros included)."""
    observed = [str(v) for v in values if v is not None]
    keys = [str(c) for c in categories] if categories is not None else sorted(set(observed))
    counter = Counter(observed)
    counts = {k: int(counter.get(k, 0)) for k in keys}
    for k, v in counter.items():  # values outside the declared categories are still counted
        if k not in counts:
            counts[k] = int(v)
    total = sum(counts.values())
    if total == 0:
        return Distribution(suitable=False, reason="no_data", counts=counts, percentages={k: 0.0 for k in counts})
    return Distribution(n=total, counts=counts, percentages=_largest_remainder(counts, total))


def top_box(values: Sequence[float | int | None], threshold: float) -> Interval:
    """Share of values ≥ threshold, with a Wilson CI."""
    x = _clean(values)
    if x.size == 0:
        return Interval(suitable=False, reason="no_data")
    return proportion_ci(int((x >= threshold).sum()), int(x.size))


@dataclass(slots=True)
class Change(Result):
    from_value: float | None = None
    to_value: float | None = None
    absolute: float | None = None
    percent: float | None = None


def change(a: float | None, b: float | None) -> Change:
    if a is None or b is None:
        return Change(suitable=False, reason="missing_value", from_value=a, to_value=b)
    pct = None if a == 0 else (b - a) / abs(a) * 100
    return Change(from_value=_r(a), to_value=_r(b), absolute=_r(b - a), percent=_r(pct, 2))


# --------------------------------------------------------------- inference
def effect_label(d: float | None) -> str | None:
    if d is None:
        return None
    a = abs(d)
    return "negligible" if a < 0.2 else "small" if a < 0.5 else "medium" if a < 0.8 else "large"


@dataclass(slots=True)
class TestResult(Result):
    test: str = ""
    n_a: int = 0
    n_b: int = 0
    mean_a: float | None = None
    mean_b: float | None = None
    difference: float | None = None
    statistic: float | None = None
    df: float | None = None
    p_value: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    effect_size: float | None = None
    effect_label: str | None = None


def cohens_d(a: Sequence[float], b: Sequence[float]) -> float | None:
    """Independent groups, pooled SD; positive when ``b`` > ``a``."""
    x, y = _clean(a), _clean(b)
    if x.size < MIN_N or y.size < MIN_N:
        return None
    pooled = math.sqrt(((x.size - 1) * x.var(ddof=1) + (y.size - 1) * y.var(ddof=1)) / (x.size + y.size - 2))
    return None if pooled == 0 else float((y.mean() - x.mean()) / pooled)


def cohens_dz(diffs: Sequence[float]) -> float | None:
    """Paired design: mean difference / SD of differences."""
    d = _clean(diffs)
    if d.size < MIN_N:
        return None
    sd = d.std(ddof=1)
    return None if sd == 0 else float(d.mean() / sd)


def independent_t(a: Sequence[float], b: Sequence[float], level: float = 0.95) -> TestResult:
    """Welch's t-test (no equal-variance assumption); difference = mean(b) − mean(a)."""
    x, y = _clean(a), _clean(b)
    base = TestResult(test="welch_t", n_a=int(x.size), n_b=int(y.size))
    if x.size < MIN_N or y.size < MIN_N:
        return TestResult(**{**asdict(base), "suitable": False, "reason": "n_too_small"})
    va, vb = x.var(ddof=1) / x.size, y.var(ddof=1) / y.size
    diff = float(y.mean() - x.mean())
    se = math.sqrt(va + vb)
    if se == 0:
        return TestResult(
            **{
                **asdict(base),
                "suitable": False,
                "reason": "zero_variance",
                "mean_a": _r(x.mean()),
                "mean_b": _r(y.mean()),
                "difference": _r(diff),
            }
        )
    df = (va + vb) ** 2 / (va**2 / (x.size - 1) + vb**2 / (y.size - 1))
    t = diff / se
    p = float(2 * sps.t.sf(abs(t), df))
    q = float(sps.t.ppf((1 + level) / 2, df))
    d = cohens_d(x, y)
    return TestResult(
        test="welch_t",
        n_a=int(x.size),
        n_b=int(y.size),
        mean_a=_r(x.mean()),
        mean_b=_r(y.mean()),
        difference=_r(diff),
        statistic=_r(t),
        df=_r(df, 2),
        p_value=_r(p, 6),
        ci_low=_r(diff - q * se),
        ci_high=_r(diff + q * se),
        effect_size=_r(d, 3),
        effect_label=effect_label(d),
    )


def paired_t(before: Sequence[float], after: Sequence[float], level: float = 0.95) -> TestResult:
    """Paired t-test on matched respondents (same order, same length); difference = after − before."""
    if len(before) != len(after):
        raise ValueError("paired samples must have the same length")
    pairs = [(a, b) for a, b in zip(before, after, strict=True) if a is not None and b is not None]
    x = np.asarray([p[0] for p in pairs], dtype=float)
    y = np.asarray([p[1] for p in pairs], dtype=float)
    base = TestResult(test="paired_t", n_a=int(x.size), n_b=int(y.size))
    if x.size < MIN_N:
        return TestResult(**{**asdict(base), "suitable": False, "reason": "n_too_small"})
    d = y - x
    sd = d.std(ddof=1)
    mean_diff = float(d.mean())
    if sd == 0:
        return TestResult(
            **{
                **asdict(base),
                "suitable": False,
                "reason": "zero_variance",
                "mean_a": _r(x.mean()),
                "mean_b": _r(y.mean()),
                "difference": _r(mean_diff),
            }
        )
    se = sd / math.sqrt(d.size)
    t = mean_diff / se
    df = d.size - 1
    p = float(2 * sps.t.sf(abs(t), df))
    q = float(sps.t.ppf((1 + level) / 2, df))
    dz = cohens_dz(d)
    return TestResult(
        test="paired_t",
        n_a=int(x.size),
        n_b=int(y.size),
        mean_a=_r(x.mean()),
        mean_b=_r(y.mean()),
        difference=_r(mean_diff),
        statistic=_r(t),
        df=float(df),
        p_value=_r(p, 6),
        ci_low=_r(mean_diff - q * se),
        ci_high=_r(mean_diff + q * se),
        effect_size=_r(dz, 3),
        effect_label=effect_label(dz),
    )


@dataclass(slots=True)
class Correlation(Result):
    method: str = "pearson"
    n: int = 0
    r: float | None = None
    p_value: float | None = None


def correlation(x: Sequence[float | None], y: Sequence[float | None], method: str = "pearson") -> Correlation:
    pairs = [(a, b) for a, b in zip(x, y, strict=True) if a is not None and b is not None]
    if len(pairs) < 3:
        return Correlation(suitable=False, reason="n_too_small", method=method, n=len(pairs))
    a = np.asarray([p[0] for p in pairs], dtype=float)
    b = np.asarray([p[1] for p in pairs], dtype=float)
    if a.std() == 0 or b.std() == 0:
        return Correlation(suitable=False, reason="zero_variance", method=method, n=len(pairs))
    res = sps.spearmanr(a, b) if method == "spearman" else sps.pearsonr(a, b)
    return Correlation(method=method, n=len(pairs), r=_r(float(res[0])), p_value=_r(float(res[1]), 6))


@dataclass(slots=True)
class Crosstab(Result):
    rows: list[str] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    counts: list[list[int]] = field(default_factory=list)
    row_percentages: list[list[float]] = field(default_factory=list)
    n: int = 0
    chi2: float | None = None
    df: int | None = None
    p_value: float | None = None
    cramers_v: float | None = None
    min_expected: float | None = None


def crosstab(
    a: Sequence[Hashable | None],
    b: Sequence[Hashable | None],
    rows: Sequence[Hashable] | None = None,
    columns: Sequence[Hashable] | None = None,
) -> Crosstab:
    pairs = [(str(x), str(y)) for x, y in zip(a, b, strict=True) if x is not None and y is not None]
    row_keys = [str(r) for r in rows] if rows is not None else sorted({p[0] for p in pairs})
    col_keys = [str(c) for c in columns] if columns is not None else sorted({p[1] for p in pairs})
    index_r = {k: i for i, k in enumerate(row_keys)}
    index_c = {k: i for i, k in enumerate(col_keys)}
    table = np.zeros((len(row_keys), len(col_keys)), dtype=int)
    for x, y in pairs:
        if x in index_r and y in index_c:
            table[index_r[x], index_c[y]] += 1
    n = int(table.sum())
    row_pct = [
        list(_largest_remainder({str(j): int(v) for j, v in enumerate(row)}, int(row.sum())).values())
        if row.sum()
        else [0.0] * len(col_keys)
        for row in table
    ]
    out = Crosstab(rows=row_keys, columns=col_keys, counts=table.tolist(), row_percentages=row_pct, n=n)
    # Drop empty rows/columns for the test itself.
    used = table[table.sum(axis=1) > 0][:, table.sum(axis=0) > 0]
    if n == 0 or used.shape[0] < 2 or used.shape[1] < 2:
        out.suitable, out.reason = False, "not_enough_categories"
        return out
    chi2, p, df, expected = sps.chi2_contingency(used, correction=False)
    out.chi2, out.df, out.p_value = _r(float(chi2)), int(df), _r(float(p), 6)
    out.min_expected = _r(float(expected.min()), 2)
    k = min(used.shape) - 1
    out.cramers_v = _r(math.sqrt(chi2 / (n * k)) if k > 0 else None, 4)
    if expected.min() < K_ANONYMITY:
        out.suitable, out.reason = False, "expected_counts_below_5"
    return out


@dataclass(slots=True)
class NPS(Result):
    n: int = 0
    promoters: float | None = None
    passives: float | None = None
    detractors: float | None = None
    score: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None


def nps(scores: Sequence[float | int | None]) -> NPS:
    x = _clean(scores)
    if x.size == 0:
        return NPS(suitable=False, reason="no_data")
    n = int(x.size)
    pro = float((x >= 9).mean())
    det = float((x <= 6).mean())
    pas = 1 - pro - det
    score = (pro - det) * 100
    # Variance of (promoter − detractor) indicator → normal-approximation CI.
    var = (pro + det - (pro - det) ** 2) / n
    half = 1.96 * math.sqrt(max(var, 0.0)) * 100
    return NPS(
        n=n,
        promoters=_r(pro * 100, 2),
        passives=_r(pas * 100, 2),
        detractors=_r(det * 100, 2),
        score=_r(score, 2),
        ci_low=_r(max(-100.0, score - half), 2),
        ci_high=_r(min(100.0, score + half), 2),
        suitable=n >= 10,
        reason=None if n >= 10 else "n_too_small",
    )


@dataclass(slots=True)
class Trend(Result):
    n: int = 0
    slope: float | None = None
    direction: str | None = None


def trend(values: Sequence[float | None]) -> Trend:
    """OLS slope over equally spaced points (e.g. waves); direction = up/down/flat."""
    pts = [(i, v) for i, v in enumerate(values) if v is not None]
    if len(pts) < 2:
        return Trend(suitable=False, reason="n_too_small", n=len(pts))
    xs = np.asarray([p[0] for p in pts], dtype=float)
    ys = np.asarray([p[1] for p in pts], dtype=float)
    slope = float(np.polyfit(xs, ys, 1)[0])
    scale = max(1e-9, float(np.abs(ys).mean()))
    direction = "flat" if abs(slope) / scale < 0.01 else ("up" if slope > 0 else "down")
    return Trend(n=len(pts), slope=_r(slope), direction=direction)


@dataclass(slots=True)
class Reliability(Result):
    items: int = 0
    n: int = 0
    alpha: float | None = None
    label: str | None = None


def cronbach_alpha(matrix: Sequence[Sequence[float | None]]) -> Reliability:
    """Internal consistency of a multi-item scale (rows = respondents, complete cases only)."""
    rows = [r for r in matrix if all(v is not None for v in r)]
    k = len(rows[0]) if rows else 0
    if k < 2:
        return Reliability(suitable=False, reason="needs_two_items", items=k, n=len(rows))
    if len(rows) < 10:
        return Reliability(suitable=False, reason="n_too_small", items=k, n=len(rows))
    data = np.asarray(rows, dtype=float)
    item_var = data.var(axis=0, ddof=1).sum()
    total_var = data.sum(axis=1).var(ddof=1)
    if total_var == 0:
        return Reliability(suitable=False, reason="zero_variance", items=k, n=len(rows))
    alpha = (k / (k - 1)) * (1 - item_var / total_var)
    label = (
        "excellent"
        if alpha >= 0.9
        else "good"
        if alpha >= 0.8
        else "acceptable"
        if alpha >= 0.7
        else "questionable"
        if alpha >= 0.6
        else "poor"
    )
    return Reliability(items=k, n=len(rows), alpha=_r(alpha, 3), label=label)
