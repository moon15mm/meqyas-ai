# مِقياس AI — MEQYAS AI

> **من الفكرة إلى الدليل** · AI Measurement & Impact Platform

مِقياس AI مستشار قياس ذكي: تكتب «ماذا تريد أن تقيس؟» بلغتك، فيحوّلها إلى خطة قياس منهجية (أهداف، أبعاد، مؤشرات، تصميم قبلي/بعدي/متابعة)، ثم استبيانات وتحليل وأدلة وتقارير أثر — دون مبالغة في ادعاء السببية.

| | |
|---|---|
| **Web** | Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn-style UI (RTL) · next-intl · TanStack Query |
| **API** | FastAPI · SQLAlchemy 2 (async) · Alembic · Pydantic v2 |
| **AI** | `packages/ai` — AIProvider (OpenAI & compatible, Ollama, Anthropic), agents, structured output + repair, prompt-injection guard |
| **Data** | PostgreSQL 17 · Redis 7 (cache, rate limits, arq jobs) |

📚 Documentation: [`docs/`](./docs) — [Product](./docs/PRODUCT.md) · [Architecture](./docs/ARCHITECTURE.md) · [Database/ERD](./docs/DATABASE.md) · [API](./docs/API.md) · [AI](./docs/AI_ARCHITECTURE.md) · [Measurement engine](./docs/MEASUREMENT_ENGINE.md) · [Survey engine](./docs/SURVEY_ENGINE.md) · [Analytics](./docs/ANALYTICS.md) · [Security](./docs/SECURITY.md) · [Roadmap](./docs/ROADMAP.md) · [Decisions](./docs/DECISIONS.md)

---

## 1. Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20.9 |
| pnpm | 9.x (`corepack enable`) |
| Python | 3.12 |
| [uv](https://docs.astral.sh/uv/) | ≥ 0.5 |
| Docker + Compose | for PostgreSQL/Redis (or the full stack) |

## 2. Installation

```bash
pnpm install          # web + shared + ui
uv sync               # api + ai (single .venv at the repo root)
cp .env.example .env  # then edit secrets (see §3)
```

## 3. Environment

All variables are documented in [`.env.example`](./.env.example). Minimum for local development:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL (async driver added automatically) |
| `REDIS_URL` | optional in dev (in-memory fallback), required in production |
| `JWT_SECRET` | ≥ 32 random chars (`python -c "import secrets;print(secrets.token_urlsafe(48))"`) |
| `ENCRYPTION_KEY` | Fernet key for PII at rest (required in production) |
| `AI_PROVIDER` + key | see §5 |

## 4. Database

```bash
pnpm docker:infra     # PostgreSQL + Redis containers
pnpm db:migrate       # alembic upgrade head
pnpm db:seed          # reference data + DEMO DATA (development only)
```

New migration after changing models: `pnpm db:revision "describe change"`.

There is no self-registration: accounts are created by platform administrators from «المشتركون» (`docs/SUBSCRIPTIONS.md`), by gifts (`docs/GIFTS.md`) or by a workspace inviting its team. The first administrator is created on the server — `pnpm admin create-admin someone@example.com "Full Name"` prints a one-time activation link; an existing account becomes administrator with `pnpm admin grant someone@example.com` (also `revoke`, `list`, and `link` for a new activation / recovery link).

## 5. AI setup

The platform **never fabricates AI output**. If no provider is configured, the UI says so and the API returns `503 ai_not_configured`.

**OpenAI (default)**
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
# optional: AI_MODEL_FAST=gpt-4.1-mini  AI_MODEL_SMART=gpt-4.1
```

**Any OpenAI-compatible API** (OpenRouter, Groq, vLLM, LM Studio, Azure gateway…)
```env
AI_PROVIDER=openai_compatible
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=...
AI_MODEL_FAST=...   AI_MODEL_SMART=...
OPENAI_STRUCTURED_MODE=json_schema   # or json_object if the API lacks json_schema
```

**Anthropic**
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

## 6. Ollama setup (local / private AI)

For organizations that must not send respondent data to the cloud:

```bash
# native: https://ollama.com/download  then
ollama pull qwen2.5:7b
# or with docker compose:
docker compose --profile ollama up -d ollama
docker compose exec ollama ollama pull qwen2.5:7b
```
```env
AI_PROVIDER=ollama              # use Ollama for everything, or
OLLAMA_ENABLED=true             # keep a cloud provider and enable local AI for orgs that disable cloud AI
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL_FAST=qwen2.5:7b
OLLAMA_MODEL_SMART=qwen2.5:7b
```
Per organization: **Settings → Organization → “Allow cloud AI providers”** off ⇒ all AI runs go to Ollama.

## 7. Development

```bash
pnpm dev
```
Starts PostgreSQL/Redis (docker), applies migrations, then runs the API (`:8000`, reload) and the web app (`:3000`).

- Web: http://localhost:3000 · API docs (OpenAPI): http://localhost:8000/api/docs
- **DEMO DATA** (development only): `demo@meqyas.example` / `Demo-Meqyas-2026` — every new account is also added to the demo school so the demo project is visible immediately.
- `Ctrl/Cmd + K` opens the command palette; the ✨ button opens the AI assistant.

Other scripts: `pnpm build` · `pnpm lint` · `pnpm format` · `pnpm docker:up` · `pnpm docker:down`.

## 8. Testing

```bash
pnpm test        # = pnpm test:api && pnpm test:web
pnpm test:api    # pytest: AI layer + API integration tests (real PostgreSQL: meqyas_test)
pnpm test:web    # vitest: shared schemas/enums parity + web components
pnpm test:e2e    # Playwright (needs the app running)
```
API tests use a scripted fake AI provider — they never call real AI services. Covered: auth & token rotation, RBAC, tenant isolation, measurement-plan journey, AI structured output & repair, prompt-injection guard, migrations up/down, survey builder documents & versioning, logic engine parity (Python ↔ TypeScript fixtures), answer-validation parity, public collection (sessions, idempotency, anonymity modes, pseudonymous pairing), response quality engine, bounded AI follow-ups, response permissions/isolation, QR, DEMO seed, analytics (statistics, k-anonymity, comparisons, cross-tabs, exports), store connections (per-platform signatures, invitations, opt-out, e-mail delivery).

## 9. Production

```bash
cp .env.example .env    # ENVIRONMENT=production, strong JWT_SECRET, ENCRYPTION_KEY, REDIS_URL, AI keys
docker compose up -d --build
```
- `api` runs `alembic upgrade head` on start, then uvicorn with `API_WORKERS` workers; `worker` runs arq jobs.
- `proxy` (Caddy) is the only public entry point: `/api/*` → API, everything else → `web`. Set `SITE_ADDRESS=your.domain` for automatic HTTPS; API and web ports are bound to localhost.
- The API trusts exactly one proxy hop (`TRUSTED_PROXY_HOPS=1`) to read the real client IP for rate limits — keep it at 0 if the API is ever exposed directly.
- Public survey links look like `https://your.domain/s/<public_id>`; QR codes encode `WEB_BASE_URL`, so set it to the public origin.
- **Store connections** (Salla, Zid, Shopify, WooCommerce, custom): webhook URLs are `WEB_BASE_URL/api/v1/integrations/stores/<id>/webhook`, so the origin must be public HTTPS. E-mail invitations need `SMTP_URL` and the `worker` service (sends every minute). See `docs/INTEGRATIONS.md`.
- The API refuses to start in production without a strong `JWT_SECRET`, `ENCRYPTION_KEY` and `REDIS_URL`.

## Repository layout

```
apps/web        Next.js app (RTL, i18n)          packages/shared  TS enums, zod schemas, API types
apps/api        FastAPI service                   packages/ui      UI components (RTL-safe)
docs/           Product & engineering docs        packages/ai      AI providers, agents, rules (Python)
infrastructure/ Dockerfiles, postgres init        scripts/         dev & tooling scripts
tests/          E2E + cross-language fixtures
```
