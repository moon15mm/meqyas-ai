"""Schemas for customer retention, dialect sentiment, and churn prevention agents."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ArabicDialect(StrEnum):
    NAJDI = "saudi_najdi"
    HIJAZI = "saudi_hijazi"
    EASTERN = "saudi_eastern"
    SOUTHERN = "saudi_southern"
    GULF = "gulf_general"
    EGYPTIAN = "egyptian"
    LEVANTINE = "levantine"
    MSA = "modern_standard_arabic"
    OTHER = "other"


class SentimentLabel(StrEnum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    CRITICAL_CHURN = "critical_churn"


class UrgencyLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ActionType(StrEnum):
    INSTANT_WALLET_CREDIT = "instant_wallet_credit"
    DISCOUNT_COUPON = "discount_coupon"
    FREE_REPLACEMENT = "free_replacement"
    VIP_CALL_ESCALATION = "vip_call_escalation"
    THANK_YOU_NOTE = "thank_you_note"
    NONE = "none"


class RetentionAnalysisIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback_text: str = Field(min_length=2, max_length=2000, description="Raw feedback or complaint text")
    customer_id: str | None = Field(default=None, description="Unique customer identifier")
    customer_name: str | None = Field(default=None, description="Customer name for personalized addressing")
    order_id: str | None = Field(default=None, description="Associated order reference")
    order_amount: float | None = Field(default=None, ge=0.0, description="Order total in local currency (SAR)")
    customer_clv: float | None = Field(default=None, ge=0.0, description="Historical Customer Lifetime Value in SAR")
    order_count: int | None = Field(default=1, ge=1, description="Total completed orders by this customer")
    channel: Literal["delivery_app", "online_store", "branch_review", "whatsapp", "social_media"] = "delivery_app"


class RetentionAnalysisOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detected_dialect: ArabicDialect = Field(description="Detected Arabic dialect or vernacular")
    sentiment: SentimentLabel = Field(description="Categorical sentiment label")
    sentiment_score: float = Field(ge=-1.0, le=1.0, description="Continuous sentiment from -1.0 to +1.0")
    sarcasm_detected: bool = Field(description="True if criticism is masked as superficial praise")
    root_cause: str = Field(description="Specific operational root cause: e.g. packaging_spill, courier_delay")
    urgency: UrgencyLevel = Field(description="Operational urgency level")
    churn_risk_score: float = Field(ge=0.0, le=1.0, description="Probability of customer churn (0.0 to 1.0)")
    churn_risk_factors: list[str] = Field(default_factory=list, description="Key factors contributing to churn risk")
    suggested_action: ActionType = Field(description="Autonomous remediation action")
    suggested_compensation_amount: float = Field(ge=0.0, description="Suggested compensation value in SAR")
    customer_response_message: str = Field(description="Empathetic, dialect-calibrated response message in Arabic")
    internal_ops_summary: str = Field(description="Internal diagnostic summary for store managers")
