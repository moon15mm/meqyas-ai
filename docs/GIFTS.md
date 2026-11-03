# Gifts — الإهداءات (trial accounts)

> **ملخص:** يستطيع مدير المنصة أن يُهدي أي شخص حسابًا تجريبيًا: يملأ نموذجًا قصيرًا (الاسم، البريد، عدد الاستبانات، مدة التجربة، رسالة شخصية)، فتُنشأ للمُهدى إليه **مساحة عمل** محدودة بعدد الاستبانات، وتُجهَّز **رسالة** فيها تفاصيل حسابه ورابط تفعيل لمرة واحدة يختار منه كلمة مروره، وشرح مختصر لطريقة البدء. تُرسل الرسالة بالبريد إن كان مهيأً، وتظهر دائمًا لنسخها أو مشاركتها عبر واتساب.

## 1. Who can send gifts

Platform administrators only — `users.is_superuser`, shown to the web app as `user.is_platform_admin`. There is no UI to grant it (no escalation path from the app); use the CLI on the server:

```bash
pnpm admin grant someone@example.com     # the person must have an account
pnpm admin revoke someone@example.com
pnpm admin list
```

The «الإهداءات» page (`/admin/gifts`) and its navigation item appear only for administrators; every admin endpoint checks the flag (`403 platform_admin_only`).

## 2. Flow

```mermaid
sequenceDiagram
  participant Admin
  participant API
  participant Recipient
  Admin->>API: POST /admin/gifts {name, email, survey_limit, trial_days, note}
  API->>API: account (no usable password) + workspace (survey_limit, AI budget) + one-time token (hash stored)
  API-->>Admin: message {subject, body, link} — shown once; e-mailed if SMTP is configured
  Admin->>Recipient: e-mail / WhatsApp / any channel
  Recipient->>API: GET /gifts/{token} (preview) → POST /gifts/claim {password}
  API->>API: password set · trial starts · gift ACTIVE · signed in
  API-->>Recipient: session → the dashboard, with the trial banner
```

- **New e-mail:** the account is created without a usable password (nobody can sign in until the recipient sets one), with an OWNER membership in the new workspace. The message carries the sign-in e-mail and an activation link valid `GIFT_LINK_TTL_DAYS` (14) days.
- **E-mail that already has an account:** the workspace is added to that account at once (status ACTIVE, trial starts now) and the message points to the sign-in page — no link, no password change.
- **Message:** greeting, the personal note, what the gift contains (workspace, surveys, trial length), the account details, and three steps (describe what to measure on the home page or pick a template → publish and share the link/QR → follow answers, analytics and recommendations). Arabic or English (the workspace's language too).
- **Resend** creates a new link (the previous one stops working) and shows the message again; for an active gift it shows the sign-in variant. **Revoke** (pending gifts only) removes the prepared workspace and — if the gift created the account and it was never used — the account; the gift stays in the list as «ملغى».

## 3. Limits of a gifted workspace

A gifted workspace is a subscription on the **trial plan** (`GIFT_PLAN`, SUBSCRIPTIONS.md) with the gift's own number of surveys:

| Limit | Rule |
|---|---|
| Surveys | the subscription's own `surveys` limit = the gift's number: how many surveys may be **published** (first publication). Drafts are unlimited; new versions of a published survey are free; deleting a published survey does not give the slot back. → `409 survey_limit_reached` |
| Trial | the subscription period = `trial_days` from activation (or none). After it, nothing new can be published (`409 subscription_ended`) and published surveys stop collecting after the grace days; results, responses and exports stay available. |
| Answers, members, AI, modules | those of the trial plan (300 answers a month, 3 members, 300 000 AI tokens a day, every module by default). |

The web app shows a banner in a trial workspace: «حساب تجريبي · نُشر 1 من 3 استبانات · يتبقى 12 يومًا». To turn a gift into a paid subscription, change its plan or renew it from the subscriber's page («المشتركون»).

## 4. Security & privacy

- **No password ever travels in a message.** The recipient chooses one on `/gift/{token}` (same strength rules as registration).
- The token is 256-bit random; only its SHA-256 is stored (`gifts.token_hash`); single use (status), expiring, replaced on resend. The message (and link) is returned once and never stored.
- Public endpoints are rate-limited (preview 30/min, claim 10/min per IP); every create/resend/revoke/activation is audited (`gift.*`), as are admin grants (`platform_admin.*`).
- The optional phone number in the form only builds the WhatsApp link in the browser — it is never sent to the server or stored.

## 5. API

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/gifts` | list with state (`pending`, `expired`, `active`, `revoked`), surveys used, trial end, last sign-in |
| POST | `/admin/gifts` | `{recipient_name, recipient_email, organization_name?, sector?, survey_limit, trial_days?, locale, note?, send_email}` → `{gift, subject, body, link, emailed, email_available}` |
| POST | `/admin/gifts/{id}/resend` | `{send_email}` → a new message (new link for pending gifts) |
| POST | `/admin/gifts/{id}/revoke` | pending gifts only (`409 gift_not_pending`) |
| GET | `/gifts/{token}` | public preview: `{state: valid|expired|used|revoked|invalid, …}` |
| POST | `/gifts/claim` | public: `{token, password, full_name?}` → session (like login) |

## 6. Configuration

```
GIFT_LINK_TTL_DAYS=14
GIFT_PLAN=trial          # the plan of gifted workspaces (SUBSCRIPTIONS.md)
SMTP_URL=…   # optional: without it the message is shared by hand
```
