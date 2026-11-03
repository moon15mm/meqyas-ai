"""Statistical engine checked against scipy / textbook reference values."""

from __future__ import annotations

import math

import numpy as np
import pytest
from app.domain import stats
from scipy import stats as sps

RNG = np.random.default_rng(42)
A = RNG.normal(3.0, 0.8, 40).round(2).tolist()
B = RNG.normal(3.6, 0.9, 35).round(2).tolist()


def test_describe_matches_numpy() -> None:
    d = stats.describe([*A, None])
    assert d.n == 40 and d.suitable
    assert d.mean == pytest.approx(np.mean(A), abs=1e-4)
    assert d.median == pytest.approx(np.median(A), abs=1e-4)
    assert d.sd == pytest.approx(np.std(A, ddof=1), abs=1e-4)
    assert stats.describe([]).suitable is False
    assert stats.describe([4, 4, 5]).modes == [4.0]


def test_mean_ci_matches_scipy_t_interval() -> None:
    ci = stats.mean_ci(A)
    low, high = sps.t.interval(0.95, len(A) - 1, loc=np.mean(A), scale=sps.sem(A))
    assert ci.low == pytest.approx(low, abs=1e-4) and ci.high == pytest.approx(high, abs=1e-4)
    single = stats.mean_ci([3])
    assert single.suitable is False and single.reason == "n_too_small"


def test_wilson_interval_reference_values() -> None:
    ci = stats.proportion_ci(8, 10)  # statsmodels proportion_confint(8, 10, method="wilson")
    assert (
        ci.estimate == 0.8 and ci.low == pytest.approx(0.4902, abs=1e-4) and ci.high == pytest.approx(0.9433, abs=1e-4)
    )
    edge = stats.proportion_ci(0, 20)
    assert edge.low == 0.0 and 0 < edge.high < 0.2


def test_distribution_percentages_sum_to_100_and_keep_empty_categories() -> None:
    dist = stats.distribution(["1", "2", "2", "3", "3", "3"], categories=["1", "2", "3", "4"])
    assert dist.counts == {"1": 1, "2": 2, "3": 3, "4": 0}
    assert sum(dist.percentages.values()) == pytest.approx(100.0)
    thirds = stats.distribution(["a", "b", "c"])
    assert sum(thirds.percentages.values()) == pytest.approx(100.0) and sorted(thirds.percentages.values()) == [
        33.3,
        33.3,
        33.4,
    ]


def test_top_box_and_change() -> None:
    tb = stats.top_box([5, 4, 3, 2, 4], threshold=4)
    assert tb.estimate == 0.6
    ch = stats.change(3.1, 4.0)
    assert ch.absolute == pytest.approx(0.9) and ch.percent == pytest.approx(29.03, abs=0.01)
    assert stats.change(0, 2).percent is None and stats.change(None, 2).suitable is False


def test_welch_t_matches_scipy() -> None:
    res = stats.independent_t(A, B)
    ref = sps.ttest_ind(B, A, equal_var=False)
    assert res.statistic == pytest.approx(ref.statistic, abs=1e-4)
    assert res.p_value == pytest.approx(ref.pvalue, abs=1e-6)
    assert res.difference == pytest.approx(np.mean(B) - np.mean(A), abs=1e-4)
    assert res.ci_low < res.difference < res.ci_high
    assert res.effect_label in {"small", "medium", "large"}


def test_paired_t_matches_scipy() -> None:
    before = A[:30]
    after = [round(v + 0.5 + RNG.normal(0, 0.4), 2) for v in before]
    res = stats.paired_t(before, after)
    ref = sps.ttest_rel(after, before)
    assert res.statistic == pytest.approx(ref.statistic, abs=1e-4)
    assert res.p_value == pytest.approx(ref.pvalue, abs=1e-6)
    diffs = np.array(after) - np.array(before)
    assert res.effect_size == pytest.approx(diffs.mean() / diffs.std(ddof=1), abs=1e-3)
    with pytest.raises(ValueError):
        stats.paired_t([1, 2], [1])
    assert stats.paired_t([1, 2, 3], [2, 3, 4]).reason == "zero_variance"


def test_cohens_d_reference() -> None:
    # Mean difference 0.5; pooled sample SD of {-1, 0, 1} × 10 is sqrt(20 / 29).
    a = [-1.0, 0.0, 1.0] * 10
    b = [-0.5, 0.5, 1.5] * 10
    assert stats.cohens_d(a, b) == pytest.approx(0.5 / math.sqrt(20 / 29), abs=1e-9)
    assert stats.effect_label(0.1) == "negligible" and stats.effect_label(-0.9) == "large"


def test_correlation_matches_scipy() -> None:
    x = A[:30]
    y = [v * 0.7 + RNG.normal(0, 0.3) for v in x]
    res = stats.correlation(x, y)
    ref = sps.pearsonr(x, y)
    assert res.r == pytest.approx(ref[0], abs=1e-4)
    sp = stats.correlation(x, y, method="spearman")
    assert sp.r == pytest.approx(sps.spearmanr(x, y)[0], abs=1e-4)
    assert stats.correlation([1, 2], [2, 3]).suitable is False


def test_crosstab_chi_square_and_cramers_v() -> None:
    grade = ["10"] * 30 + ["11"] * 30
    answer = ["yes"] * 22 + ["no"] * 8 + ["yes"] * 12 + ["no"] * 18
    ct = stats.crosstab(grade, answer, rows=["10", "11"], columns=["yes", "no"])
    table = np.array([[22, 8], [12, 18]])
    chi2, p, df, _ = sps.chi2_contingency(table, correction=False)
    assert ct.counts == table.tolist() and ct.df == df
    assert ct.chi2 == pytest.approx(chi2, abs=1e-4) and ct.p_value == pytest.approx(p, abs=1e-6)
    assert ct.cramers_v == pytest.approx(math.sqrt(chi2 / 60), abs=1e-4)
    assert ct.row_percentages[0] == [73.3, 26.7]
    sparse = stats.crosstab(["a", "a", "b"], ["x", "y", "x"])
    assert sparse.suitable is False and sparse.reason == "expected_counts_below_5"


def test_nps() -> None:
    res = stats.nps([10, 9, 8, 7, 6, 0, 10, 9, 9, 3])
    assert res.promoters == 50.0 and res.detractors == 30.0 and res.score == 20.0
    assert res.ci_low < 20 < res.ci_high and res.suitable
    assert stats.nps([10, 9]).suitable is False


def test_trend_and_reliability() -> None:
    assert stats.trend([3.1, 4.0, 4.2]).direction == "up"
    assert stats.trend([3.0, 3.0, 3.0]).direction == "flat"
    consistent = [[v, v, v + (i % 2) * 0.0] for i, v in enumerate([1, 2, 3, 4, 5] * 4)]
    assert stats.cronbach_alpha(consistent).alpha == pytest.approx(1.0)
    noise = RNG.integers(1, 6, size=(50, 4)).tolist()
    weak = stats.cronbach_alpha(noise)
    assert weak.alpha is not None and weak.alpha < 0.5 and weak.label in {"poor", "questionable"}
    assert stats.cronbach_alpha([[1, 2]] * 5).reason == "n_too_small"
