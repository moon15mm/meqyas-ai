# Reports (Phase 7)

A report turns a project's computed results into a document that can be shared, printed and saved as PDF.
It combines **sections the platform renders itself** with **narrative sections the AI drafts around those
figures**. Numbers are never computed by a model (PRODUCT.md principle 4).

## 1. Report types

| Type | For | Sections (in order) |
|---|---|---|
| `EXECUTIVE` | decision makers | summary · key figures · findings · dimension chart · indicators · top 5 recommendations · limitations · appendix |
| `DETAILED` | the project team | summary · introduction · key figures · methodology · findings · dimension chart · dimension table · comparisons · indicators · questions · themes · insights · discussion · recommendations · limitations · conclusion · appendix |
| `IMPACT` | funders, partners | summary · key figures · what changed · comparisons · dimension chart · indicators · did the change last (only with POST and FOLLOW_UP) · methodology · limitations · conclusion · appendix |
| `MANAGEMENT` | management follow-up | where we stand (only with indicators) · key figures · indicators · risks · decisions needed · action plan · limitations · appendix |
| `ACADEMIC` | researchers | abstract · introduction · methodology · dimension table · comparisons (with t and df) · questions · themes · discussion · limitations · conclusion · appendix |

A section with no data (no indicators, no themes, no recommendations…) is omitted rather than shown empty.
Tone: `FORMAL` (institutional), `PLAIN` (short sentences, statistics in everyday words), `ANALYTICAL`
(effect sizes, significance, contrasts). Language: Arabic or English, independent of the interface language.

## 2. Who writes what

| Part | Source |
|---|---|
| Key figures, methodology, every table, the chart data, indicator status | `services/reports.py`, from the analytics engine |
| Insights, risks | the deterministic insight rules (refreshed when a report is generated) |
| Recommendations, action plan | the project's recommendations (dismissed ones excluded) |
| Limitations | rules: evidence-level caveat, waves under 30 responses, excluded low-quality share, privacy masking, paired attrition, self-report, AI-classified themes |
| Summary, findings, introduction, discussion, conclusion, abstract, impact, persistence, status, decisions | **ReportWriterAgent** (or, without AI, text assembled from the computed insights) |
| Appendix | the facts the narrative cites (id, label, value, n) |

## 3. The report writer

Input: the analytics pack (facts `F1…` — aggregates only, never individual answers), the project context
(`C1…`: description, measurement purpose, target population, planned follow-up timing), the evidence level
and its caveat, and the list of sections with their purpose, form and word limit — all inside untrusted-data
envelopes (AI_ARCHITECTURE §6).

Checks on every section (a failure triggers a repair round):

- every number must appear in a fact or the context (±0.5; integers ≤ 12 are free for wording);
- a number written as a percentage must be a percentage in its fact — a score "75.5 / 100" may not become "75.5%";
- numbers require the ids of the facts used; unknown ids are rejected;
- no causal wording below the ATTRIBUTION evidence level;
- word limit (twice the limit triggers a rewrite).

The structured-output engine accepts its last attempt even when checks still fail after the repairs, so the
report service **re-checks every section**: a section that still fails is not printed — its place is taken by
text assembled from the computed insights, and `content.ai.rejected` lists it. Inline citations ("[F12]"),
markdown and list labels are stripped; sources are printed under each section and link to the appendix.

The output budget is sized to the requested sections (≈ 3 tokens per Arabic word), because providers such as
Groq count the requested `max_tokens` against per-request limits.

Known limit: the checks guarantee every printed number exists in the data with its unit, but not that two
real figures are never juxtaposed misleadingly. The prompt forbids mixing measures; the sources line and the
appendix let a reader verify each claim, and the text can be edited.

## 4. Versions

- `reports` holds the type, tone, language, title, audience and `current_version`.
- `report_versions` are immutable: `content` (the rendered sections) and `data_snapshot` (counts, waves,
  evidence level, design, overall score and the full facts list), plus the AI run that wrote the narrative.
- **Refresh** (`POST /reports/{id}/regenerate`) builds a new version from today's data, optionally with a
  new tone or audience. **Edit** (`PATCH /reports/{id}`) creates a new version with the user's text changes
  or hidden sections; tables and figures cannot be edited (`422 not_editable`). An edit with no change
  creates no version. Earlier versions stay readable (`GET /reports/{id}?version=n`).

## 5. Rendering, print and PDF

The web renders `content` as an A4-like sheet (`components/reports/report-document.tsx`):

- the sheet takes the report's language and direction, not the interface's, and always uses the light
  palette (`.paper-light` re-declares the light tokens) so the screen matches the printed page;
- "Print / PDF" calls the browser's print dialog; `@media print` hides the app chrome, sets A4 margins,
  keeps table headers on every page and avoids breaking cards and rows; the document title becomes the
  suggested PDF file name;
- the dimension chart is grouped horizontal bars (one ordinal hue per wave, values at the bar ends, a
  screen-reader table twin); indicator statuses show an icon and a label;
- in Arabic text, left-to-right expressions ("d = 1.30 (p < 0.001)", "IND-03", "+1.04") are isolated with
  `<bdi>`, while separate numbers keep the sentence's right-to-left order.

Server-side PDF rendering (for scheduled e-mailing) is deferred: see D-042.

## 6. Permissions and privacy

Reading needs `reports.read` (every role, including viewers); creating, refreshing, editing and deleting need
`reports.create` (analysts, editors, admins, owners). Reports contain aggregates only — no answer text, no
respondent identifiers; groups under 5 answers are never shown. `report.create`, `report.refresh`,
`report.edit` and `report.delete` are audited.
