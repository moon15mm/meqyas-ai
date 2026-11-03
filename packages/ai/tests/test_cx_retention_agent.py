"""Tests for CXRetentionAgent (Meta Llama 3 retention & dialect sentiment)."""

from __future__ import annotations

import pytest

from meqyas_ai.agents.cx_retention_agent import CXRetentionAgent
from meqyas_ai.providers.factory import ModelTiers, ProviderConfig, build_provider
from meqyas_ai.runtime import AgentRunner
from meqyas_ai.schemas.retention import (
    ActionType,
    ArabicDialect,
    RetentionAnalysisIn,
    SentimentLabel,
    UrgencyLevel,
)
from meqyas_ai.testing import ScriptedProvider


def _runner(outputs: list[object]) -> tuple[AgentRunner, ScriptedProvider]:
    provider = ScriptedProvider(outputs)  # type: ignore[arg-type]
    return AgentRunner(provider, ModelTiers(fast="llama-fast", smart="llama-smart")), provider


@pytest.mark.asyncio
async def test_retention_agent_analyzes_saudi_dialect_complaint() -> None:
    runner, provider = _runner(
        [
            {
                "detected_dialect": "saudi_najdi",
                "sentiment": "negative",
                "sentiment_score": -0.85,
                "sarcasm_detected": False,
                "root_cause": "packaging_spill_and_cold_food",
                "urgency": "high",
                "churn_risk_score": 0.82,
                "churn_risk_factors": ["damaged_packaging", "spilled_soup", "delivery_cold"],
                "suggested_action": "instant_wallet_credit",
                "suggested_compensation_amount": 35.0,
                "customer_response_message": "أهلاً بك يا فهد، نعتذر منك بشدة على وصول الطلب بهذا الشكل. تم إيداع 35 ريال في محفظتك فوراً، وبإذن الله ما يتكرر هذا الخطأ أبداً.",
                "internal_ops_summary": "Order delivered with spilled soup and damaged bag. Recommended courier review.",
            }
        ]
    )

    input_data = RetentionAnalysisIn(
        feedback_text="والله ما قصرتوا بس الطلب مدهوك والشوربة كبت في الكيس والأكل بارد!",
        customer_id="cust_123",
        customer_name="فهد",
        order_id="ord_9981",
        order_amount=85.0,
        customer_clv=650.0,
        order_count=4,
        channel="delivery_app",
    )

    result = await runner.run(CXRetentionAgent(), input_data)
    out = result.output

    assert out.detected_dialect == ArabicDialect.NAJDI
    assert out.sentiment == SentimentLabel.NEGATIVE
    assert out.sentiment_score == -0.85
    assert out.sarcasm_detected is False
    assert out.urgency == UrgencyLevel.HIGH
    assert out.churn_risk_score == 0.82
    assert out.suggested_action == ActionType.INSTANT_WALLET_CREDIT
    assert out.suggested_compensation_amount == 35.0
    assert "محفظتك" in out.customer_response_message

    # Ensure prompt includes envelope
    messages = provider.calls[0]["messages"]
    assert "customer_feedback" in messages[-1].content


@pytest.mark.asyncio
async def test_retention_agent_detects_sarcasm() -> None:
    runner, provider = _runner(
        [
            {
                "detected_dialect": "saudi_hijazi",
                "sentiment": "critical_churn",
                "sentiment_score": -0.95,
                "sarcasm_detected": True,
                "root_cause": "extreme_delivery_delay",
                "urgency": "critical",
                "churn_risk_score": 0.94,
                "churn_risk_factors": ["sarcastic_distress", "two_hour_delay", "first_time_order"],
                "suggested_action": "vip_call_escalation",
                "suggested_compensation_amount": 50.0,
                "customer_response_message": "حقك علينا يا أستاذنا، التأخير ساعتين غير مقبول تماماً. مدير الفرع سيتواصل معك هاتفياً الآن للاعتذار وتعويضك.",
                "internal_ops_summary": "Sarcastic complaint over 2h delivery delay. High churn risk.",
            }
        ]
    )

    input_data = RetentionAnalysisIn(
        feedback_text="ما شاء الله عليكم أسرع مطعم في العالم.. ساعتين أنتظر الوجبة وجاتني مثلجة!",
        customer_id="cust_555",
        order_id="ord_4421",
        order_amount=50.0,
        customer_clv=50.0,
        order_count=1,
        channel="social_media",
    )

    result = await runner.run(CXRetentionAgent(), input_data)
    out = result.output

    assert out.sarcasm_detected is True
    assert out.sentiment == SentimentLabel.CRITICAL_CHURN
    assert out.urgency == UrgencyLevel.CRITICAL
    assert out.suggested_action == ActionType.VIP_CALL_ESCALATION


@pytest.mark.asyncio
async def test_retention_agent_clamps_compensation_safeguards() -> None:
    runner, _ = _runner(
        [
            {
                "detected_dialect": "gulf_general",
                "sentiment": "negative",
                "sentiment_score": -0.6,
                "sarcasm_detected": False,
                "root_cause": "minor_delay",
                "urgency": "medium",
                "churn_risk_score": 0.45,
                "churn_risk_factors": ["15_min_delay"],
                "suggested_action": "discount_coupon",
                "suggested_compensation_amount": 100.0,  # Excessive: exceeds order amount
                "customer_response_message": "نعتذر منك على التأخير البسيط.",
                "internal_ops_summary": "Minor delay.",
            }
        ]
    )

    # Low CLV customer (150 SAR), order total 40 SAR
    input_data = RetentionAnalysisIn(
        feedback_text="الطلب تأخر ربع ساعة يا ريت تنتبهون للوقت.",
        customer_id="cust_888",
        order_id="ord_1102",
        order_amount=40.0,
        customer_clv=150.0,
        order_count=2,
    )

    result = await runner.run(CXRetentionAgent(), input_data)
    out = result.output

    # Safeguard must clamp compensation to order amount (40.0 SAR max)
    assert out.suggested_compensation_amount == 40.0


def test_meta_llama_provider_factory() -> None:
    cfg = ProviderConfig(
        provider="meta_llama",
        openai_api_key="mock_key",
        openai_base_url="https://api.groq.com/openai/v1",
    )
    provider, tiers = build_provider(cfg)
    assert provider.name == "meta_llama"
    assert tiers.fast == "meta-llama/Llama-3.2-3B-Instruct"
    assert tiers.smart == "meta-llama/Llama-3.3-70B-Instruct"
