"""Customer retention and dialect sentiment agent for GCC e-commerce.

Leverages Meta Llama 3 for deep understanding of nuanced Arabic dialects (Saudi Najdi,
Hijazi, Gulf, etc.), sarcasm detection, operational root-cause classification, and
autonomous retention compensation formulation.
"""

from __future__ import annotations

import json
from typing import ClassVar

from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope
from ..providers.base import Message
from ..schemas.retention import (
    ActionType,
    RetentionAnalysisIn,
    RetentionAnalysisOut,
    SentimentLabel,
)
from .base import Agent

RETENTION_SYSTEM_PROMPT = (
    """\
You are an expert GCC customer experience and retention AI agent for MEQYAS AI (مِقياس AI),
powered by Meta Llama 3.

Your mission:
Analyze customer feedback from e-commerce, delivery apps, or store visits, decode nuanced
Arabic dialects, accurately detect sarcasm, diagnose the root operational cause, assess churn
risk, and formulate an immediate, authorized retention action.

### Arabic Dialect & Nuance Recognition:
- Recognize regional vocabulary and idioms across Saudi Arabia and the Gulf:
  * Saudi Najdi / Central: "مدهوك", "مبطي", "حايس", "طش", "ما يسوى", "وش السالفة", "خلوه يولي"
  * Saudi Hijazi / Western: "دحين", "يا سيدي", "كبت الشوربة", "هرجة", "مرة مو تمام", "ايش دا"
  * Saudi Eastern / Gulf: "وايد", "عيزان", "ما ياز لي", "صدق عاد", "چنه"
  * Southern Saudi: "ذلحين", "غبني", "ما ثنى لي"
- Detect Sarcasm:
  * "والله مطعم عالمي.. الأكل وصل بعد سنتين ومثلج!" -> Sarcasm=True, Sentiment=CRITICAL_CHURN.
  * "ما قصرتوا يعطيك العافية بس الكيس مقطوع والطلب ناقص" -> Sarcasm=False, Sentiment=NEGATIVE.

### Churn Risk Assessment:
- If a high-CLV or repeat customer experiences a delivery failure or damaged order, churn risk is High/Critical (0.75 - 1.0).
- If it's a first-time customer experiencing severe delay or missing items, churn risk is elevated (0.6 - 0.9).
- For positive feedback or minor constructive suggestions, churn risk is Low (0.0 - 0.25).

### Autonomous Remediation Strategy:
- Critical churn / damaged order / cold spilled food: INSTANT_WALLET_CREDIT or FREE_REPLACEMENT.
- Moderate delay / service dissatisfaction: DISCOUNT_COUPON (15% - 25% value).
- VIP / Extreme frustration / severe grievance: VIP_CALL_ESCALATION.
- Satisfied / Praise: THANK_YOU_NOTE with 0.0 compensation.
- Cap suggested compensation appropriately relative to order amount and customer CLV.

### Response Message Requirements:
- Write in warm, culturally authentic Arabic matching the customer's dialect tone.
- Never sound robotic or generic. Acknowledge the specific issue immediately and present the remedy.
"""
    + UNTRUSTED_NOTICE
)


class CXRetentionAgent(Agent[RetentionAnalysisIn, RetentionAnalysisOut, RetentionAnalysisOut]):
    name: ClassVar[str] = "cx_retention"
    prompt_version: ClassVar[str] = "1"
    input_model: ClassVar[type] = RetentionAnalysisIn
    output_model: ClassVar[type] = RetentionAnalysisOut
    tier: ClassVar[str] = "smart"
    temperature: ClassVar[float] = 0.2
    max_output_tokens: ClassVar[int] = 1500
    cache_ttl_s: ClassVar[int] = 0

    def build_messages(self, data: RetentionAnalysisIn) -> list[Message]:
        feedback_envelope = envelope(
            [UntrustedItem(id=data.order_id or "feedback_1", text=data.feedback_text)],
            source="customer_feedback",
        )
        payload = {
            "customer_id": data.customer_id,
            "customer_name": data.customer_name,
            "order_id": data.order_id,
            "order_amount_sar": data.order_amount,
            "customer_clv_sar": data.customer_clv,
            "order_count": data.order_count,
            "channel": data.channel,
        }

        user_content = (
            "Analyze the following customer interaction and return the structured retention plan:\n"
            + json.dumps(payload, ensure_ascii=False, indent=2)
            + "\n\nCustomer Message:\n"
            + feedback_envelope
        )

        return [
            Message(role="system", content=RETENTION_SYSTEM_PROMPT),
            Message(role="user", content=user_content),
        ]

    def post_process(self, data: RetentionAnalysisIn, output: RetentionAnalysisOut) -> RetentionAnalysisOut:
        """Deterministic safety rails and policy guardrails."""
        # Policy rule: Compensation amount cannot exceed order amount for non-VIPs (CLV < 500 SAR)
        order_amt = data.order_amount or 0.0
        clv = data.customer_clv or 0.0
        comp = output.suggested_compensation_amount

        if clv < 500.0 and order_amt > 0.0 and comp > order_amt:
            # Clamp compensation to order amount max
            output = output.model_copy(update={"suggested_compensation_amount": order_amt})

        # Policy rule: Positive sentiment must not trigger churn compensation
        if output.sentiment == SentimentLabel.POSITIVE and comp > 0.0:
            output = output.model_copy(
                update={
                    "suggested_compensation_amount": 0.0,
                    "suggested_action": ActionType.THANK_YOU_NOTE,
                    "churn_risk_score": min(output.churn_risk_score, 0.1),
                }
            )

        return output
