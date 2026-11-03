# Meqyas AI — Demo Video Voiceover (Recording Sheet)

This is the final narration for the 3-minute demo video. Record it **before** the screen
capture: the visuals are cut to fit your voice, not the other way around.

## How to record

- Record **one audio file per segment**, named exactly: `seg1.wav`, `seg2.wav`, `seg3.wav`, `seg4.wav`.
- Format: WAV (or high-quality M4A/MP3), 48 kHz, mono is fine.
- Leave about **1 second of silence** at the start and end of each file.
- Quiet room, phone or USB mic about 20 cm from your mouth, no music.
- Keep each segment **within its time budget** (shown below). Slightly shorter is fine — the
  visuals will fill the gap. If a take runs long, re-record rather than speeding it up.
- Read the Arabic sentences naturally, in Saudi dialect, the way a real customer would say them.
- Pace: calm and confident, about 140–150 words per minute.
- Short pauses are marked with `…` — take a breath there.

---

## Segment 1 — The problem · 00:00 – 00:45 · max 43 s

> In the fast-growing GCC e-commerce market, customer retention is fragile.
> When a delivery arrives damaged or late, support teams often take hours to respond.
>
> And most sentiment tools struggle with Gulf and Saudi dialects. Take this message:
>
> **(Arabic, read slowly)** والله ما قصرتوا بس الطلب مدهوك، والشوربة كبت في الكيس، والأكل واصل بارد!
>
> A generic model sees "ما قصرتوا" — "you did great" — and can label it positive… missing
> that the meal was ruined.
>
> By the time someone replies, the customer may already be gone.

---

## Segment 2 — Live agent · 00:45 – 01:45 · max 58 s

> This is Meqyas AI: a customer-intelligence and retention engine for Arabic commerce,
> running on Meta Llama 3.
>
> Our CX Retention Agent reads each complaint the moment it arrives. Let's run it live, on
> Llama 3.3 70B.
>
> We send the same Saudi complaint, with the order value and customer history.
> In seconds, it returns a structured result: the dialect… the sentiment… the root cause —
> a spilled, cold order… the urgency… and a churn-risk score.
>
> It then proposes a remedy within policy, and drafts an apology in the customer's own
> dialect, ready to send.
>
> Now a harder case: sarcasm.
>
> **(Arabic)** ما شاء الله أسرع مطعم في العالم… ساعتين أنتظر الوجبة وجاتني مثلجة!
>
> "The fastest restaurant in the world… two hours, and the food arrived frozen."
> The agent sees through the praise, flags the sarcasm, and raises the urgency.

---

## Segment 3 — Architecture & why Meta open weights · 01:45 – 02:25 · max 38 s

> Under the hood, every agent in Meqyas has a strict Pydantic contract. If the model returns
> invalid output, the platform asks it to repair the response before anything reaches the
> merchant.
>
> On top of the model, deterministic rules keep it safe: compensation is capped at the order
> value for new customers, and positive feedback never triggers a payout.
>
> Why Meta open weights? Under Saudi Arabia's Personal Data Protection Law, data residency
> matters. Because Llama can run on Ollama or vLLM inside the merchant's own
> infrastructure, customer messages never have to leave it.

---

## Segment 4 — Proof & close · 02:25 – 03:00 · max 33 s

> Meqyas is built test-first. Our AI test suite — eighty-three tests covering
> structured-output repair, prompt-injection defense and the retention rules — runs in
> seconds.
>
> The platform is live today at meqyas dot wardat dot x-y-z, and the code is open source on
> GitHub.
>
> Meqyas AI… turning a bad moment into a loyal customer.
>
> Thank you.

---

## Why some lines differ from the earlier draft

Every spoken claim has to survive a judge opening the repo, and the live run is recorded
**after** the voiceover, so the narration must hold whatever the model actually returns:

- No exact churn percentage or latency is spoken — the live number is shown on screen instead.
- The sarcasm example says "raises the urgency" rather than naming a specific action.
- Compensation is described as capped at the order value for new customers, which is what
  `post_process` in `packages/ai/meqyas_ai/agents/cx_retention_agent.py` does.
- "Sub-second latency" and "complete regulatory compliance" were removed: neither is measured
  or certified in the repo.
- The test-suite claim (83 tests, repair, prompt-injection, retention rules) matches
  `packages/ai/tests/`.
