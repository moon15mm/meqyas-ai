# Analytics

> **ملخص:** كل الأرقام تُحسب برمجيًا (Statistical Engine) — لا يُستخدم LLM لحساب أي رقم. الذكاء الاصطناعي يفسّر ويصوغ فقط، وكل Insight يحمل دليله (Evidence) القابل للتتبع حتى الإجابات الأصلية.

## 1. Pipeline

```mermaid
flowchart LR
  A[answers] --> B[Projection<br/>numeric_value · text_value]
  B --> Q[Quality filter<br/>exclude LOW_QUALITY by default]
  Q --> S[Statistical engine<br/>descriptives · CI · tests]
  S --> IND[Indicator computation<br/>per wave / segment]
  IND --> CMP[Wave comparison<br/>change · % change · effect size]
  S --> SEG[Segmentation & cross-tabs]
  T[open text] --> TA[Text analytics<br/>keywords (deterministic) · sentiment/themes (AI)]
  CMP & SEG & TA --> RI[Rule-based insight generator<br/>with evidence]
  RI --> AI[AI narrative + recommendations<br/>grounded on evidence ids]
```

## 2. Statistical engine (`apps/api/app/domain/stats`)

Pure functions over numpy arrays — fully unit-tested against known values (scipy reference).

| Function | Notes |
|---|---|
| `describe(x)` | n, mean, median, mode(s), sd (sample), min, max, quartiles |
| `mean_ci(x, 0.95)` | t-based CI; n < 2 → None |
| `proportion_ci(k, n)` | Wilson score interval — estimate and bounds are **proportions (0–1)** |
| `distribution(values, categories)` | counts + percentages (sum to 100 with largest-remainder rounding) |
| `top_box(x, threshold)` | share ≥ threshold (0–1, Wilson CI); top-2 box = `max − 1` on the item's own scale |
| `change(a, b)` | absolute and percentage change (None if base = 0) |
| `independent_t(a, b)` | Welch t-test, df, p |
| `paired_t(a, b)` | paired t-test on matched respondents |
| `cohens_d(a, b)` / `cohens_dz(diff)` | with magnitude label (negligible < 0.2 ≤ small < 0.5 ≤ medium < 0.8 ≤ large) |
| `correlation(x, y, method)` | Pearson / Spearman + p |
| `crosstab(a, b)` | counts, row %, chi-square + Cramér's V (when expected counts ≥ 5) |
| `nps(scores)` | promoters %, passives %, detractors % (0–100), NPS with normal-approximation CI; `suitable` from n ≥ 10 |
| `trend(series)` | slope (OLS), direction |
| `cronbach_alpha(matrix)` | internal consistency of a dimension's items (≥ 2 items) with a label (excellent … poor) |

**Suitability guards:** each function reports `suitable: false, reason` when assumptions fail (n too small, zero variance, sparse cells). The UI shows the reason instead of a misleading number.

## 3. Dashboard KPIs

| KPI | Definition (as implemented in Phase 5) |
|---|---|
| Responses analyzed | included responses, with total and how many were excluded (low quality or review) |
| Overall Score | mean of dimension scores (0–100) in each dimension's latest wave with n ≥ 5 |
| NPS / CSAT | from the latest wave that asked it (n ≥ 5); CSAT = share answering 4–5 |
| Median completion time | median duration (robust to outliers); hidden below n = 5 |
| Top Strength / Top Problem | highest / lowest dimension score (needs ≥ 2 scored dimensions) |
| Responses over time | included responses per UTC day (weekly once the range exceeds 120 days), empty days kept |

Completion rate and response rate need started-but-unfinished sessions and the population size; they arrive with the reports phase.

## 4. Segmentation & cross analysis

Any categorical variable can segment results: single-choice/dropdown answers (e.g. «الصف», profile questions first) or response metadata (`wave`, `device`, `channel`). Output per segment: `n`, describe, distribution, top-box, NPS, options or matrix rows. Segments with n < 5 are masked (`stats: null`) to protect anonymity (**k-anonymity**, `K_ANONYMITY = 5`).

Cross-tabs (`/analytics/crosstab?row&col&wave`) return counts and row percentages for two categorical variables, plus chi-square, p and Cramér's V. The test is **withheld** (`suitable: false`) when:
- an expected cell count is below 5 (`expected_counts_below_5`) — merge categories or collect more;
- the same respondent appears more than once (`repeated_respondents`), e.g. pooling waves — the test assumes independent observations. The UI therefore defaults to the latest wave.

Rows (segments) with fewer than 5 responses are masked.

## 5. Pre/Post comparison

For each dimension (and each comparable scale item) × wave pair (`/analytics/compare?from_wave&to_wave`):
- `from_mean`, `to_mean`, `change.absolute`, `change.percent` on the item's **native scale** (or 0–100 when a dimension mixes scales; `scale_min`/`scale_max` say which);
- **paired t-test** with Cohen's `d_z` when at least 10 respondents can be matched across the two waves by their pseudonymous code; otherwise **Welch's t-test** with Cohen's `d`; p-value and CI of the difference;
- `paired`, `n_from`, `n_to`, `n_pairs`; a wave with fewer than 5 responses is `masked` (no means, no test); a dimension not measured in one of the waves is omitted;
- a `causality` note derived from the project's **evidence level** (see MEASUREMENT_ENGINE §4): CHANGE/CHANGE_PERSISTENCE → «change, not cause»; only CONTRIBUTION/ATTRIBUTION designs allow causal language.

Example: الثقة Baseline = 3.1 → Post = 4.0 → Follow-up = 4.2 ⇒ +0.9 (+29.0%) then +0.2.

## 6. Response quality engine

Never deletes data — it **labels**: `VALID`, `SUSPICIOUS`, `LOW_QUALITY`.

| Check | Rule (defaults) |
|---|---|
| Speeder | duration < max(⅓ × median duration, 2 s × answered items) |
| Straight-lining | ≥ 6 consecutive scale items with identical answers (or SD = 0 across ≥ 8 items) |
| Duplicate | same `dedupe_hash` + identical answer fingerprint within the survey |
| Gibberish | open text with low letter ratio, repeated chars (`aaaa`), keyboard mash, no vowels/Arabic letters |
| Contradiction | configured reverse pairs (e.g. high satisfaction + "would not recommend" 0–2) |
| Suspicious pattern | burst submissions from the same `dedupe_hash` |

Score = 100 − Σ penalties → status thresholds (≥ 70 VALID, 40–69 SUSPICIOUS, < 40 LOW_QUALITY). Analysts can override (KEEP/EXCLUDE).

## 7. Text analytics

- **Deterministic**: Arabic normalization (alef/ya/ta-marbuta, diacritics, tatweel), stopwords, n-gram keywords (TF-IDF across answers).
- **AI**: SentimentAnalyzer (batched 25/answer-batch, fast tier), ThemeAnalyzer (themes + categories: TOPIC, PAIN_POINT, STRENGTH, SUGGESTION, with answer assignments → `answer_themes`).
- Answers are untrusted data (prompt-injection envelopes, see AI_ARCHITECTURE §6).

## 8. Insights & evidence traceability

Insight generator rules (deterministic) produce candidates with an **evidence object**:

```json
{
  "indicator_id": "…", "question_keys": ["speed_1"], "metric": "top_box_pct",
  "value": 41.2, "comparison": { "type": "wave", "from": 63.0, "to": 41.2 },
  "n": 117, "data_range": { "from": "2026-09-01", "to": "2026-09-30" },
  "filters": { "quality": "exclude_low" }, "sample_answer_ids": ["…"]
}
```

AI may rephrase titles/bodies but numbers are rendered from the evidence object. Clicking an insight opens the evidence panel: indicator → question → response distribution → sample answers → comparison → data range.

## 9. Recommendations

`problem, evidence, possible_cause, recommendation, priority, confidence, expected_outcome` — generated by RecommendationAgent from insights; `possible_cause` is explicitly labeled as a hypothesis.

## 10. AI Data Analyst (chat)

Grounded Q&A over an **analytics pack** (aggregates only). Answers must cite evidence ids from the pack; unknown ids → answer rejected/regenerated. Typical prompts: «ما أهم مشكلة؟»، «قارن الصف الأول والثاني»، «اكتب ملخصًا للمدير».

## 11. Phase 5 implementation notes

**Dataset** (`services/analytics.load_dataset`): published surveys of the project, responses filtered by the quality rule — `EXCLUDE` never counts, `KEEP` always counts, `LOW_QUALITY` only with `include_flagged=true`. Each response is tagged with its survey's wave. The reference definition of a question key is the latest published version that contains it.

**Question statistics** by type: Likert/CSAT/CES/rating/star → describe, mean CI, distribution over the full scale (end points labelled with the scale's `min_label`/`max_label`), top-2 box; NPS → NPS block; single choice → distribution (+ describe of option scores when scored); multiple choice → share of respondents per option with Wilson CI; matrix → per row; ranking → mean rank and first-choice share; text → count (+ the 8 latest answers for roles with `responses.read_raw`); date → by month.

**Dimension scores:** each respondent's dimension score is the mean of their items (reverse-scored items flipped) rescaled to 0–100 (`(x − min) / (max − min) × 100`); the wave score is the mean of respondent scores with a 95% CI, plus the native-scale mean when all items share one scale, top-2 box and Cronbach's alpha.

**Indicators:** computed from linked questions with `computation.method` (`mean` default for AVERAGE_SCORE, `top_box_pct` for PERCENTAGE, `count`, `rate` → needs population size, CHANGE → `from_wave`/`to_wave` difference, EFFECT_SIZE → Cohen's d from the comparison). Status vs target: met → ACHIEVED; ≥ 90% of target → ON_TRACK; ≥ 75% → AT_RISK; else OFF_TRACK (inverted for LOWER_IS_BETTER); no value → NOT_STARTED.

**k-anonymity (everywhere):** every aggregate with fewer than 5 underlying answers is withheld — question statistics (`masked: true`, only `n`), dimension waves, indicator wave values (`reason: below_k_anonymity`), comparisons, NPS/CSAT KPIs, median duration, segments and cross-tab rows.

**Exports** (`/surveys/{id}/responses/export.csv|xlsx`): analyst/admin/owner only, audited (`data.export`); one row per included response with labels (choices) and numeric values (scales); CSV is UTF-8 with BOM and a labels row above the keys row; Excel sheets are right-to-left; cells starting with `= + - @` are prefixed with `'` (formula injection).

**Dashboard** (`/projects/[id]/analytics`): Overview (evidence banner, KPI tiles, dimension scores by wave, indicator cards with status icon + label, responses over time), Compare waves (dumbbell chart + full statistics table, item-level table), Questions (wave filter + breakdown selector, one card per question), Cross-tabs. Every chart has a table twin and keyboard-focusable marks with tooltips; refetches keep the previous render dimmed. The results hub (`/results`) lists every project's collection status from counts only.

**Chart colors** (validated with the dataviz palette script against the card surfaces, light `#ffffff` and dark `#131823`; dark steps are selected, not flipped): one hue for single series (`--viz-1`); one-hue ordinal ramp for waves, earliest → latest (`--viz-seq-1…5`); blue↔red diverging arms with a gray midpoint for agreement/satisfaction/effort scales and NPS groups (`--viz-pos-*`, `--viz-neg-*`, `--viz-mid`). Text never uses series colors; status uses icon + label. Time runs right-to-left in Arabic.

## 12. Phase 6 implementation notes

**Open answers** (`services/textanalysis.py`, `domain/text.py`): per text question, up to the 300 latest included answers.
- *Keywords* are always computed live (no model): Arabic folding (alef forms, ya/alef maqsura, ta marbuta, diacritics, tatweel), a stop list folded the same way, the definite article stripped for counting, and two-word phrases only from words that were adjacent in the answer (a stop word, number or punctuation breaks a phrase). Counts are answers containing the term, not occurrences; a word already covered by a chosen phrase of similar frequency is not repeated.
- *Sentiment* (SentimentAnalyzer, fast tier, batches of 25, cached 7 days) only rates answers that have no rating yet; unknown ids from the model are dropped, and more than 20% missing ids triggers a repair round.
- *Themes* (ThemeAnalyzer, smart tier, at most 150 distinct answers after normalization; duplicates inherit their twin's themes). The model only names themes and assigns answer ids; **counts and shares are computed from the assignments** by the platform. Themes with no assignment are dropped; a run that assigns nothing does not replace the previous themes (`parts.themes.error = no_assignments`).
- Running needs `AI_ANALYZE`; reading the summary needs `analytics.read`; sample answers need `responses.read_raw`. Fewer than 5 answers → `masked`.

**Insights** (`services/insights.py`) are produced by deterministic rules over the analytics engine — no model is involved, so every number is computed:

| Kind | Rule | Severity |
|---|---|---|
| SAMPLE | included responses < 30 | INFO |
| DATA_QUALITY | low-quality share ≥ 10% | MEDIUM (HIGH ≥ 25%) |
| WEAKNESS / STRENGTH | lowest / highest dimension score in its latest wave | HIGH < 50, MEDIUM < 65 |
| IMPROVEMENT / DECLINE | first vs last wave: p < 0.05 and abs(d) ≥ 0.2 | LOW / HIGH |
| PERSISTENCE | POST → FOLLOW_UP: held vs faded | INFO / MEDIUM |
| RISK / SUCCESS | indicator OFF_TRACK, AT_RISK / ACHIEVED (change indicators cite their two waves) | HIGH, MEDIUM / INFO |
| ATTENTION | top-2 box < 50% (n ≥ 10, worst 3); NPS < 0 | LOW |
| GAP | profile question × dimension: gap ≥ 10 points, groups n ≥ 5, Welch test, top 3; non-significant gaps say so | MEDIUM ≥ 15 |
| PAIN_POINT / STRENGTH | theme share ≥ 15% / ≥ 20% with ≥ 3 mentions | MEDIUM / INFO |

Wording follows the evidence level (D-004): change designs carry «هذا يصف التغير ولا يثبت وحده أن البرنامج هو السبب». Each insight has a **fingerprint** (`KIND:subject`); regeneration upserts by fingerprint so a user's decision (PINNED / DISMISSED) survives, pinned insights that no longer hold stay with `current = false`, other stale ones are removed. Confidence: HIGH when n ≥ 30 and p < 0.01; MEDIUM when n ≥ 10 and p < 0.05; else LOW.

**Recommendations**: RecommendationAgent receives only the insights (short ids N1…, titles, bodies, evidence numbers). Semantic checks reject unknown insight ids, causal claims and numbers in `problem` that are not in the insights (grounding check, ±0.5); `possible_cause` is prefixed «فرضية:» when not hedged. Regeneration replaces only PROPOSED AI recommendations; accepted, in-progress, done and manual ones are kept.

**AI analyst** (`services/pack.py`): the analytics pack is a list of facts `{id, label, value, n, note}` (counts, waves, overall score, NPS/CSAT, durations, dimension scores per wave, indicators, comparisons, up to 40 question facts, themes, up to 20 insights). The question goes in `<user_request>`, the facts in an `<untrusted_data source="analytics_pack">` envelope. Answers must cite fact ids; unknown ids, numbers not present in the facts and causal language trigger a repair round. The response returns the cited facts so the UI shows the source of every number. Rate limit: 20 AI calls per user per minute.
