# Meqyas AI — 3-Minute Demo Video Script & Storyboard
**Target Event:** Meta Global AI Developer Hackathon ($1,000,000 Prize Pool)  
**Track:** Startup Track  
**Total Video Length:** 03:00 (180 Seconds)  
**Tone:** Confident, fast-paced, high-tech, founder-led product walkthrough.  
**Language:** English Voiceover (with authentic Saudi dialect Arabic on-screen customer text).

---

## Storyboard & Timeline Breakdown

```
[00:00 - 00:40] Part 1: The GCC Retention Problem & Dialect Blindness
[00:40 - 01:40] Part 2: The Live Multi-Agent Solution (Meta Llama 3.3 in Action)
[01:40 - 02:25] Part 3: Architecture & The Meta Open-Weights Advantage
[02:25 - 03:00] Part 4: Production Traction, Metrics & Vision
```

---

### Part 1: The Problem (00:00 – 00:40)
* **Screen Visuals:**
  - Fast cuts of e-commerce delivery trucks in Riyadh and Jeddah.
  - Social media screen showing an angry customer tweeting: *"طلبي واصل بارد والشوربة كبت وما في أي رد من الدعم.. حسبي الله!"*
  - An e-commerce store dashboard showing customer churn graphs and high Customer Acquisition Costs (CAC).
* **Voiceover (English):**
  > "In the $30 billion GCC e-commerce and fast-delivery market, customer acquisition costs have surged by 40%. Yet, customer retention remains astonishingly fragile.  
  > When a customer receives damaged groceries or cold food, traditional customer support takes hours to respond. Worse, standard NLP models fail completely on colloquial Gulf and Saudi Arabic dialects, sarcasm, and local slang.  
  > By the time human support replies, the customer has already vented on X or TikTok, and churned forever."

---

### Part 2: Live Multi-Agent Retention Engine (00:40 – 01:40)
* **Screen Visuals:**
  - Transition to **Meqyas AI Production Dashboard** (`https://meqyas.wardat.xyz/`).
  - Terminal / Webhook simulation sending an incoming order complaint:  
    `"والله ما قصرتوا بس الطلب مدهوك والشوربة كبت في الكيس ومحد رد علي!"`
  - Split-screen showing the **Meta Llama 3 Multi-Agent pipeline** running:
    1. **Dialect Sentiment Agent (Llama 3.3 70B):** Deconstructs the sentence into structured JSON in 185ms:
       - `sentiment`: `"strongly_negative"`
       - `root_cause`: `"packaging_damage_and_spill"`
       - `dialect`: `"Saudi_Najdi"`
       - `urgency`: `"critical"`
    2. **Autonomous Retention Agent:** 
       - Calculates Customer Lifetime Value (CLV: 1,850 SAR).
       - Churn Risk: 91%.
       - Synthesizes instant remedy: 35 SAR wallet credit + VIP apology message sent via webhook.
* **Voiceover (English):**
  > "Meet Meqyas AI — the autonomous customer intelligence and retention engine built for GCC commerce.  
  > Instead of passive dashboards, Meqyas intercepts unhappy feedback through live webhooks from platforms like Salla and Zid.  
  > Watch this live: A customer sends a deeply colloquial complaint in Saudi dialect. Within 180 milliseconds, our Meta Llama 3.3 agent parses the exact nuanced sentiment, identifies the spill without hallucination, and categorizes churn risk.  
  > Instantly, our Autonomous Retention Agent executes an authorized resolution: it credits the customer's in-app wallet and issues a respectful, dialect-aware apology before the customer even closes the app. Churn prevented in under a second."

---

### Part 3: Why Meta Open Weights Win (01:40 – 02:25)
* **Screen Visuals:**
  - Architectural diagram zooming in on `packages/ai` and local inference pipelines.
  - Side-by-side comparison:
    - *Closed Cloud APIs:* High latency, unpredictable rate limits, customer PII exported outside national borders.
    - *Meta Llama 3 (Ollama / vLLM on-prem):* Zero-PII export, sub-200ms latency, 100% compliant with Saudi Personal Data Protection Law (PDPL).
  - Terminal showing `uv sync` and clean Pydantic structured output validation.
* **Voiceover (English):**
  > "Why Meta models? In Saudi Arabia and the GCC, enterprises have strict data residency laws under PDPL. Closed cloud models leak customer private data abroad and introduce latency bottlenecks.  
  > With Meta’s open weights—combining Llama 3.3 70B for deep sentiment reasoning with Llama 3.2 3B for sub-second classification—we run on-premise and private cloud inference with zero customer PII leakage.  
  > We enforce strict Pydantic schemas with automated self-repair loops, ensuring zero-hallucination structured responses in production."

---

### Part 4: Production Traction & The Future (02:25 – 03:00)
* **Screen Visuals:**
  - Live customer metrics on `https://meqyas.wardat.xyz/`:
    - 92% retention salvage rate.
    - 350ms median decision latency.
    - Partner logos and integration ecosystem (Salla, Zid, Delivery fleets).
  - Founder Eng. Maher Sulaiman on camera or closing brand card:
    - Wardat AI Technologies • Meqyas AI.
    - Contact: `contact@wardat.xyz` • GitHub: `github.com/moon15mm/meqyas-ai`.
* **Voiceover (English):**
  > "Meqyas AI is not a concept—it is a live, production-grade engine running today. We have tested over 5,000 real customer interactions, delivering a 92% retention salvage rate.  
  > By bringing Meta's frontier models into our world, we are turning unhappy customers into lifelong brand advocates.  
  > Check out our open-source repo on GitHub and test the live engine on meqyas.wardat.xyz. Thank you!"

---

## Recording Checklist for the Founder
1. **Screen Capture:** Record the UI of `https://meqyas.wardat.xyz/` and code execution of `packages/ai/meqyas_ai/agents/text_analysis.py`.
2. **Audio Narration:** Record the voiceover cleanly using a USB microphone (or generate an AI master voiceover using ElevenLabs).
3. **Export Settings:** 1080p 60fps MP4, exactly 3 minutes (03:00) or under.
4. **Host Video:** Upload as Unlisted on YouTube or Vimeo and paste the link into the Cerebral Valley submission form.
