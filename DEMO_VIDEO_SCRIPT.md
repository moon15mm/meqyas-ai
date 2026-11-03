# Meqyas AI — 3-Minute Demo Video Script & Storyboard
**Target Event:** Meta Global AI Developer Hackathon ($1,000,000 Prize Pool)  
**Track:** Startup Track  
**Total Video Length:** Exactly 03:00 (180 Seconds)  
**Tone:** Confident, technical, transparent, and founder-led product walkthrough.  
**Language:** English Voiceover (with authentic Arabic on-screen demonstrations).

---

## Storyboard & Timeline Breakdown

```
[00:00 - 00:45] Part 1: The Problem (GCC Retention Fragility & Dialect Blindness)
[00:45 - 01:45] Part 2: The Solution (CXRetentionAgent & Meta Llama 3 in Action)
[01:45 - 02:25] Part 3: Architecture & The Meta Open-Weights Advantage
[02:25 - 03:00] Part 4: Production Verification & The Live Platform
```

---

### Part 1: The Problem (00:00 – 00:45)
* **Screen Visuals:**
  - Brief capture of the GCC e-commerce landscape (quick-commerce and food delivery apps).
  - An unhappy customer comment on social media:  
    `"والله ما قصرتوا بس الطلب مدهوك والشوربة كبت في الكيس والأكل واصل بارد!"`
  - Highlighting why standard models fail: generic NLP classifies *"ما قصرتوا"* as positive, missing the severe negative complaint.
* **Voiceover (English):**
  > "In the fast-growing GCC e-commerce market, customer retention is remarkably fragile.  
  > When a customer receives a damaged delivery or missing items, traditional customer support takes hours to respond.  
  > Worse, conventional NLP tools fail on nuanced Gulf and Saudi Arabic dialects. When a customer writes 'والله ما قصرتوا بس الشوربة كبت والأكل مدهوك', standard sentiment analyzers see the phrase 'ما قصرتوا' and mislabel it as positive, completely missing the fact that the meal was ruined.  
  > By the time human support wakes up, the customer has churned to a competitor."

---

### Part 2: Live Agent Walkthrough (00:45 – 01:45)
* **Screen Visuals:**
  - Screen switch to VS Code / terminal running a live call to `CXRetentionAgent` with Meta Llama 3.
  - Feeding the Saudi complaint into the agent.
  - Showing the structured JSON output returned in real time:
    ```json
    {
      "detected_dialect": "saudi_najdi",
      "sentiment": "negative",
      "sentiment_score": -0.85,
      "sarcasm_detected": false,
      "root_cause": "packaging_spill_and_cold_food",
      "urgency": "high",
      "churn_risk_score": 0.82,
      "suggested_action": "instant_wallet_credit",
      "suggested_compensation_amount": 35.0,
      "customer_response_message": "أهلاً بك يا فهد، نعتذر منك بشدة على وصول الطلب بهذا الشكل..."
    }
    ```
  - Showing second example with sarcasm:  
    `"ما شاء الله أسرع مطعم في العالم.. ساعتين أنتظر الوجبة وجاتني مثلجة!"`  
    -> `sarcasm_detected: true`, `urgency: critical`, `suggested_action: vip_call_escalation`.
* **Voiceover (English):**
  > "This is Meqyas AI — an autonomous customer intelligence and retention engine built for Arabic commerce, powered by Meta Llama 3.  
  > Instead of passive dashboards, our CXRetentionAgent intercepts customer complaints in real time.  
  > Here is a live run of our verified agent pipeline: We evaluate an authentic Saudi dialect complaint. Meta Llama 3 accurately detects the Najdi vernacular, identifies the spilled packaging without hallucination, and computes a calibrated churn probability—such as this 82% risk calculation.  
  > It then autonomously synthesizes an authorized remedy: issuing wallet credit, alongside an authentic, culturally tuned apology message.  
  > Even with subtle sarcasm—like a customer calling a restaurant 'the fastest in the world' after a two-hour delay—the agent flags sarcastic distress and escalates to a VIP call."

---

### Part 3: Architecture & Meta Llama Advantage (01:45 – 02:25)
* **Screen Visuals:**
  - Code walkthrough of `packages/ai/meqyas_ai/agents/cx_retention_agent.py` and `providers/factory.py`.
  - Zooming in on the Pydantic schemas: `RetentionAnalysisIn` and `RetentionAnalysisOut`.
  - Showing the deterministic safety rail in `post_process`:  
    Compensation is mathematically clamped to order value to protect merchant margins.
  - Highlighting Meta Llama 3 tiered inference: Llama 3.3 70B for smart reasoning alongside lightweight fast models (Llama 3.1 8B via Groq or Llama 3.2 3B via edge/vLLM) for zero-PII real-time processing.
* **Voiceover (English):**
  > "Under the hood, Meqyas AI is engineered for strict enterprise reliability.  
  > In `packages/ai`, every agent has a rigid Pydantic contract. Notice our deterministic safety rails: our Python post-processor automatically clamps compensation amounts against customer lifetime value, preventing margin leakage.  
  > Why Meta open weights? In Saudi Arabia, enterprise clients are subject to strict Personal Data Protection Laws. By supporting Meta Llama 3 via Ollama and vLLM on-premise, merchants can analyze sensitive customer feedback with zero PII leaving their infrastructure, achieving sub-second latency and complete regulatory compliance."

---

### Part 4: Verified Production Quality (02:25 – 03:00)
* **Screen Visuals:**
  - Terminal executing: `pytest packages/ai/tests/ -v`.
  - Showing all **83 tests passing cleanly in under 5 seconds**.
  - Quick browser view of the live production app running at `https://meqyas.wardat.xyz/`.
  - Closing card with founder info:
    - **Meqyas AI • Wardat AI Technologies**
    - Founder: Eng. Maher Sulaiman (`contact@wardat.xyz`)
    - GitHub: `https://github.com/moon15mm/meqyas-ai`
* **Voiceover (English):**
  > "Meqyas AI is fully test-driven. Our entire AI test suite—83 unit tests covering dialect parsing, structured output repair, and prompt injection defense—passes cleanly in under five seconds.  
  > The full system is live in production today at meqyas.wardat.xyz, with open-source code available on GitHub.  
  > By combining Meta’s frontier open-weights with deep regional intelligence, Meqyas AI turns negative moments into lifelong customer loyalty.  
  > Thank you."
