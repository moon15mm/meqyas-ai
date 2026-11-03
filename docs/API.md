# API

> **ملخص:** REST API تحت `/api/v1`، موثّق تلقائيًا عبر OpenAPI (`/api/docs` و`/api/openapi.json`). المصادقة عبر `Authorization: Bearer <access_token>`، وتحديد المؤسسة النشطة عبر `X-Organization-Id`. الأخطاء بصيغة موحدة.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api/v1` (web proxies `/api/*` → API) |
| Docs | Swagger UI `/api/docs`, ReDoc `/api/redoc`, schema `/api/openapi.json` |
| Auth | `Authorization: Bearer <jwt>` · refresh via HttpOnly cookie |
| Tenant | `X-Organization-Id: <uuid>` required on org-scoped endpoints |
| IDs | UUID strings |
| Time | ISO-8601 UTC |
| Pagination | `?limit=20&offset=0` → `{ items, total, limit, offset }` |
| Errors | `{ "error": { "code": "not_found", "message": "…", "details": {…} } }` + HTTP status |
| Idempotency | `Idempotency-Key` header honored on public response submission |
| Locale | `Accept-Language: ar|en` for messages |

### Error codes
`validation_error (422)`, `unauthorized (401)`, `forbidden (403)`, `not_found (404)`, `conflict (409)`, `rate_limited (429)`, `ai_unavailable (503)`, `ai_invalid_output (502)`, `survey_closed (410)`, `internal_error (500)`.

## 2. Endpoints

### /auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | email, password → access token (+ refresh cookie). There is **no** self-registration (SUBSCRIPTIONS.md §4). |
| POST | `/auth/refresh` | cookie → new access token (rotation) · requires `X-Requested-With` |
| POST | `/auth/logout` | revoke refresh family |
| POST | `/auth/forgot-password` | always 202 |
| POST | `/auth/reset-password` | token + new password (RESET links only; every session is signed out) |
| GET | `/auth/activation/{token}` | public: what an activation link opens (`valid|expired|used|invalid`, name, e-mail, workspace) |
| POST | `/auth/activate` | public: token + password (+ full_name) → signed in; waiting subscription periods start |
| POST | `/auth/change-password` | current + new password; other sessions are signed out |
| GET | `/auth/me` | current user + memberships (each with its `subscription`: plan, state, period, limits, usage, modules) |

### /organizations
| GET | `/organizations` | my organizations |
|---|---|---|
| GET/PATCH | `/organizations/{id}` | read / update (ADMIN+) |
| GET | `/organizations/{id}/members` | list |
| POST | `/organizations/{id}/members` | add by e-mail (ADMIN+); a new account is created with an invitation → `{member, message}` (activation link shown once) · `409 member_limit_reached` |
| POST | `/organizations/{id}/members/{member_id}/access-link` | new activation link or recovery link — accounts of this workspace only (`409 member_in_other_workspaces`) |
| PATCH/DELETE | `/organizations/{id}/members/{member_id}` | change role / remove |

Workspaces are created by platform administrators (`/admin/subscribers`), not from this API.

### /projects (org-scoped)
| GET | `/projects` | list (`?status=&q=`) |
|---|---|---|
| POST | `/projects` | create manually |
| GET/PATCH/DELETE | `/projects/{id}` | |
| GET | `/projects/{id}/overview` | plan + counts + waves + status |
| GET | `/project-types` | measurement type catalog (labels, descriptions, default designs) |

### /ai
| POST | `/ai/measurement-architect` | `{request, language}` → creates a DRAFT measurement plan → `MeasurementPlanOut` |
|---|---|---|
| GET | `/ai/status` | configured provider, models, health |
| GET | `/ai/runs` | usage log (ADMIN+) |

### /measurement-plans
| GET | `/measurement-plans/{id}` | plan (draft or accepted) |
|---|---|---|
| PATCH | `/measurement-plans/{id}` | edit draft (validated + deterministic rules re-applied) |
| POST | `/measurement-plans/{id}/regenerate` | AI regenerate with feedback |
| POST | `/measurement-plans/{id}/accept` | materialize → project (goal, objectives, dimensions, indicators, waves) |
| GET | `/projects/{id}/measurement-plan` | accepted plan of a project |

### /indicators, /dimensions, /objectives
CRUD under `/projects/{project_id}/indicators|dimensions|objectives` + `GET /indicators/{id}/values` (per wave).

### /surveys & /questions (Phase 3)
| POST | `/projects/{id}/surveys` | create (blank or from AI) |
|---|---|---|
| POST | `/projects/{id}/surveys/generate` | AI SurveyGenerator for a wave |
| GET/PATCH/DELETE | `/surveys/{id}` | |
| GET | `/surveys/{id}/versions/{n}` | version tree (sections, questions, options, logic) |
| PUT | `/surveys/{id}/draft` | replace draft content (builder save) |
| POST | `/surveys/{id}/review` | QuestionReviewer + quality score |
| POST | `/surveys/{id}/publish` · `/pause` · `/resume` · `/close` · `/archive` | state machine |
| GET | `/surveys/{id}/qr.svg` · `/qr.png` | QR |

### /public (no auth)
| GET | `/public/surveys/{public_id}` | respondent-safe published version + availability + signed `session` |
|---|---|---|
| POST | `/public/surveys/{public_id}/responses` | submit `{session, answers, other_texts, followups, respondent_code?, respondent_name?, respondent_email?, client_id?, channel}` → 201 `{response_id}`; 422 `invalid_answers` with `details.errors[key] = {code, min?, max?}`; 422 `invalid_session`; 409 `survey_paused|survey_closed|survey_full|survey_not_started` |
| POST | `/public/surveys/{public_id}/followup` | `{session, question_key, answer, other_text?}` → `{ask, question}` (bounded; never errors on AI problems) |

### Responses (Phase 4)
| GET | `/projects/{id}/responses` · `/surveys/{id}/responses` | page `{items, total, limit, offset, counts}`; filters `survey_id`, `quality`, `review`; needs-attention first (analyst+) |
|---|---|---|
| GET | `/responses/{id}` | answers with labels, matrix rows, other texts, follow-ups; identity decrypted for identified surveys (analyst+) |
| PATCH | `/responses/{id}` | `{review_status: NONE|KEEP|EXCLUDE}` (analyst+) |
| DELETE | `/responses/{id}` | hard delete, audited (admin+) |
| PATCH | `/surveys/{id}` | also `opens_at`, `closes_at`, `response_limit` (collection window) |

### Analytics (Phase 5)
All analytics endpoints need `analytics.read` (every role) and accept `include_flagged` (count LOW_QUALITY responses; EXCLUDE never counts). Aggregates of fewer than 5 answers are withheld (`masked`).

| GET | `/analytics/projects` | results hub: per project `responses_total`, `responses_included`, `waves`, `published_surveys`, `evidence_level`, `last_response_at` (counts only) |
|---|---|---|
| GET | `/projects/{id}/analytics/summary` | `?survey_id` — counts, KPIs, `responses_by_day`, waves, dimension scores per wave, indicators with status, evidence level + `causality` note |
| GET | `/projects/{id}/analytics/questions` | `?survey_id&wave&segment` — statistics for every question (`text_samples` only with `responses.read_raw`); with `segment`, each question gets `segments` |
| GET | `/projects/{id}/analytics/questions/{key}` | one question, `?segment&survey_id&wave`; 404 unknown key |
| GET | `/projects/{id}/analytics/compare` | `?from_wave&to_wave` — dimension and item comparisons (paired/Welch, d, p, CI); 422 `same_wave` |
| GET | `/projects/{id}/analytics/crosstab` | `?row&col&wave` — counts, row %, χ², Cramér's V (withheld when unsuitable); 422 `same_variable`, `invalid_segment` |
| GET | `/surveys/{id}/responses/export.csv` · `.xlsx` | raw data export (analyst/admin/owner, audited) |

Segments/variables: a single-choice or dropdown question key, or `wave`, `device`, `channel` (plus `product`, `store` and `location` once such answers exist).

### Store connections (e-commerce)
Full reference and platform setup: INTEGRATIONS.md §7.

| GET/POST | `/projects/{id}/store-connections` | list with stats · create (`integrations.manage`; `secret` returned once) |
|---|---|---|
| GET/PATCH/DELETE | `/store-connections/{id}` | details · settings, pause (`status`) · delete |
| POST | `/store-connections/{id}/secret` · `/test` | rotate/paste the signing secret · sample order |
| GET | `/store-connections/{id}/events` · `/invitations` | delivery log · invitation links (`responses.read_raw`) |
| POST | `/projects/{id}/surveys/from-template` | `store_experience` / `product_feedback` / `store_visit` drafts |
| POST | `/integrations/stores/{webhook_id}/webhook` | public, signed per platform |
| GET | `/public/surveys/{public_id}?inv=` | invitation state + piped product/store names |
| POST | `/public/surveys/{public_id}/invitations/{token}/opt-out` | stop future requests |

### Customer experience (CX.md)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/projects/{id}/locations` | branches & service points · create (`project.write`; code generated when empty, 409 `location_code_taken`) |
| PATCH/DELETE | `/locations/{id}` | name, city, kind, `is_active` · delete |
| GET | `/surveys/{id}/qr.{svg,png}?loc=&kiosk=` | a branch's QR code / tablet link |
| GET | `/projects/{id}/cx` | NPS/CSAT/CES overall, by branch, channel and week; key drivers; follow-up summary (`analytics.read`, k = 5) |
| GET | `/projects/{id}/cx/cases?status=open\|resolved\|all` | follow-up cases (customer comments with `responses.read_raw`) |
| PATCH | `/cx/cases/{id}` | `{assign_to_me?, status?, resolution_note?}` (`responses.read_raw`) |
| POST | `/cx/cases/{id}/contact` | reveal the consented contact (audited) |

### Gifts (GIFTS.md)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/gifts` | platform admins only: list · prepare a gift (account, workspace with survey limit, one-time activation link, message returned once) |
| POST | `/admin/gifts/{id}/resend` · `/revoke` | new link and message · cancel a gift that was not activated |
| GET | `/gifts/{token}` | public preview (`valid|expired|used|revoked|invalid`) |
| POST | `/gifts/claim` | public: choose a password → activated and signed in |

### Platform administration (SUBSCRIPTIONS.md §5)
| | | |
|---|---|---|
| GET/POST | `/admin/subscribers` · `/admin/subscribers/bulk` | list with filters and counts · new subscriber (message shown once) · one workspace per row (≤ 200) |
| GET/PATCH | `/admin/subscribers/{org}` | detail (members, events) · plan, own limits, end date, note, name |
| POST | `/admin/subscribers/{org}/renew` · `/suspend` · `/reactivate` | |
| POST/DELETE | `/admin/subscribers/{org}/members` · `/members/{member}` | add people (≤ 200) · remove |
| POST | `/admin/users/{user}/access-link` · `/disable` · `/enable` | |
| GET/POST/PATCH | `/admin/plans` · `/admin/plans/{id}` | plans and their subscriber counts |

Plan modules answer `403 feature_not_in_plan` (`details.feature`), AI agents outside the plan `403 ai_not_in_plan`; an ended subscription `409 subscription_ended` / `409 ai_subscription_inactive`; a suspended workspace `403 organization_suspended`.

### Intelligence (Phase 6)
| Method | Path | Notes |
|---|---|---|
| GET | `/projects/{id}/text-analysis` | per text question: answers, keywords (live), sentiment counts/%, themes with count/share (+ samples with `responses.read_raw`) |
| POST | `/projects/{id}/text-analysis/{question_key}` | `{use_ai}` — runs sentiment + themes (`AI_ANALYZE`); returns the updated summary with `parts` status |
| GET | `/projects/{id}/insights?include_dismissed=` | current + pinned insights with evidence |
| POST | `/projects/{id}/insights/generate` | rules run; upsert by fingerprint (decisions kept) |
| PATCH | `/insights/{id}` | `{status: NEW, PINNED or DISMISSED}` |
| GET/POST | `/projects/{id}/recommendations` | list / add manually |
| POST | `/projects/{id}/recommendations/generate` | AI from current insights (422 `no_insights`) |
| PATCH/DELETE | `/recommendations/{id}` | edit fields and status (PROPOSED → ACCEPTED → IN_PROGRESS → DONE, or DISMISSED) |
| POST | `/projects/{id}/analyst/chat` | `{message, history[]}` → `{answer, evidence[{id,label,value,n}], follow_ups[]}` |
| GET | `/projects/{id}/analytics/pack` | the facts the analyst sees (aggregates only) |

AI endpoints share the `ai-user:{user_id}` rate limit (20/min).

### Reports (Phase 7, REPORTS.md)
| Method | Path | Notes |
|---|---|---|
| GET | `/reports?project_id=` | reports across the organization (with project titles) |
| GET/POST | `/projects/{id}/reports` | list / generate `{report_type, tone, language?, title?, audience?, use_ai}` (422 `no_data`) |
| GET | `/reports/{id}?version=` | the report with one version's content (default: current) |
| GET | `/reports/{id}/versions` | version history: reason, author, AI used, data date, responses |
| POST | `/reports/{id}/regenerate` | new version from today's data `{tone?, audience?, use_ai}` |
| PATCH | `/reports/{id}` | new version with text edits / hidden sections `{title?, sections[{key, hidden?, paragraphs?, bullets?}]}` |
| DELETE | `/reports/{id}` | delete the report and its versions |

PDF: the print-optimized view in the web app ("Print / PDF"); no server endpoint yet (D-042).

### Impact & library (Phase 8)
| Method | Path | Notes |
|---|---|---|
| POST | `/projects/{id}/indicators/recompute` | compute and store indicator values (`ai.analyze`) |
| GET | `/projects/{id}/indicators/values` | stored value per indicator and wave, in wave order |
| GET/PUT | `/projects/{id}/theory-of-change` | the theory + indicators with values + evidence level / save (`project.write`) |
| POST | `/projects/{id}/theory-of-change/generate` | `{notes}` — AI draft linked to real indicators (`ai.use`) |
| POST | `/surveys/{id}/copies` | `{wave_id, title?}` — draft copy for another wave, same question keys |
| GET | `/templates?lang=` · `/templates/{code}` | template summaries / full blueprint with questionnaires |
| POST | `/templates/{code}/use` | plan draft from the template (no AI; methodology rules applied) |
| GET | `/question-bank?q=&type=&scope=` | system + organization items (Arabic-folded search) |
| POST/DELETE | `/question-bank` · `/question-bank/{id}` | save a question / delete an organization item (`survey.edit`) |

### /templates (original sketch)
`GET /templates`, `GET /templates/{id}`, `POST /templates/{id}/use` (creates a plan draft from a blueprint), `POST /templates/ai` (Template AI).

### Webhooks (architecture)
Events: `response.created`, `survey.completed`, `survey.closed`, `threshold.exceeded`, `report.generated`.
Delivery: `POST <url>` JSON `{id, event, created_at, data}`, header `X-Meqyas-Signature: t=<ts>,v1=<hex HMAC-SHA256(secret, ts + "." + body)>`, retries with exponential backoff (1m, 5m, 30m, 2h, 12h).
