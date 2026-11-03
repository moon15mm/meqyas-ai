"""Platform enums. Measurement vocabulary is re-exported from meqyas_ai so
there is exactly one definition shared by the AI layer and the database."""

from __future__ import annotations

from enum import StrEnum

from meqyas_ai.domain.enums import (
    EvidenceLevel,
    IndicatorDirection,
    IndicatorFrequency,
    IndicatorType,
    MeasurementDesign,
    MeasurementType,
    OutcomeLevel,
    QuestionType,
    WaveType,
)

__all__ = [
    "AIRunStatus",
    "EvidenceLevel",
    "IndicatorDirection",
    "IndicatorFrequency",
    "IndicatorStatus",
    "IndicatorType",
    "MeasurementDesign",
    "MeasurementType",
    "OutcomeLevel",
    "PlanStatus",
    "ProjectStatus",
    "QualityStatus",
    "QuestionType",
    "ResponseChannel",
    "ResponseStatus",
    "ReviewStatus",
    "Role",
    "Sector",
    "SubscriptionState",
    "SurveyStatus",
    "TokenPurpose",
    "VersionStatus",
    "WaveStatus",
    "WaveType",
]


class Role(StrEnum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    EDITOR = "EDITOR"
    ANALYST = "ANALYST"
    VIEWER = "VIEWER"


ROLE_RANK = {Role.VIEWER: 0, Role.ANALYST: 1, Role.EDITOR: 2, Role.ADMIN: 3, Role.OWNER: 4}


class Sector(StrEnum):
    EDUCATION = "EDUCATION"
    CORPORATE = "CORPORATE"
    NONPROFIT = "NONPROFIT"
    GOVERNMENT = "GOVERNMENT"
    INITIATIVE = "INITIATIVE"
    EVENTS = "EVENTS"
    HR = "HR"
    CUSTOMER = "CUSTOMER"
    OTHER = "OTHER"


class ProjectStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"


class PlanStatus(StrEnum):
    DRAFT = "DRAFT"
    ACCEPTED = "ACCEPTED"


class IndicatorStatus(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    #: Answers are coming in, but fewer than the privacy minimum (k = 5) to show a value yet.
    COLLECTING = "COLLECTING"
    ON_TRACK = "ON_TRACK"
    AT_RISK = "AT_RISK"
    OFF_TRACK = "OFF_TRACK"
    ACHIEVED = "ACHIEVED"


class WaveStatus(StrEnum):
    PLANNED = "PLANNED"
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class AIRunStatus(StrEnum):
    SUCCESS = "SUCCESS"
    REPAIRED = "REPAIRED"
    CACHED = "CACHED"
    FAILED = "FAILED"


class SurveyStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    PAUSED = "PAUSED"
    CLOSED = "CLOSED"
    ARCHIVED = "ARCHIVED"


class VersionStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    RETIRED = "RETIRED"


class ResponseStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class QualityStatus(StrEnum):
    VALID = "VALID"
    SUSPICIOUS = "SUSPICIOUS"
    LOW_QUALITY = "LOW_QUALITY"


class ReviewStatus(StrEnum):
    """Owner decision that overrides the automatic quality status in analytics."""

    NONE = "NONE"
    KEEP = "KEEP"
    EXCLUDE = "EXCLUDE"


class ResponseChannel(StrEnum):
    LINK = "LINK"
    QR = "QR"
    EMBED = "EMBED"
    IMPORT = "IMPORT"
    DEMO = "DEMO"
    #: Invitation created from an e-commerce order (store connections).
    STORE = "STORE"
    #: A tablet at a branch in kiosk mode (customer experience).
    KIOSK = "KIOSK"


# ------------------------------------------------------------ store connections
class StorePlatform(StrEnum):
    SALLA = "SALLA"
    ZID = "ZID"
    SHOPIFY = "SHOPIFY"
    WOOCOMMERCE = "WOOCOMMERCE"
    #: Any system that can POST the documented JSON with an HMAC signature.
    CUSTOM = "CUSTOM"


class StoreTrigger(StrEnum):
    """Order stage at which customers are invited."""

    FULFILLED = "FULFILLED"  # shipped / handed to delivery
    DELIVERED = "DELIVERED"  # delivered / completed


class ConnectionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"


class InvitationDelivery(StrEnum):
    #: MEQYAS creates the link; the store's own messages/automation deliver it (no paid service).
    LINK = "LINK"
    #: MEQYAS e-mails the customer through the configured SMTP server.
    EMAIL = "EMAIL"


class InvitationStatus(StrEnum):
    READY = "READY"  # link available, delivered by the store
    SCHEDULED = "SCHEDULED"  # waiting for the e-mail send time
    SENT = "SENT"
    OPENED = "OPENED"
    RESPONDED = "RESPONDED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"  # order cancelled/refunded before the customer answered
    OPTED_OUT = "OPTED_OUT"


class StoreEventStatus(StrEnum):
    ACCEPTED = "ACCEPTED"
    DUPLICATE = "DUPLICATE"
    IGNORED = "IGNORED"
    REJECTED = "REJECTED"


# ------------------------------------------------------------ intelligence
class SentimentLabel(StrEnum):
    POSITIVE = "POSITIVE"
    NEUTRAL = "NEUTRAL"
    NEGATIVE = "NEGATIVE"
    MIXED = "MIXED"


class ThemeCategory(StrEnum):
    TOPIC = "TOPIC"
    PAIN_POINT = "PAIN_POINT"
    STRENGTH = "STRENGTH"
    SUGGESTION = "SUGGESTION"


class InsightKind(StrEnum):
    STRENGTH = "STRENGTH"  # highest dimension / theme of praise
    WEAKNESS = "WEAKNESS"  # lowest dimension
    IMPROVEMENT = "IMPROVEMENT"  # significant positive change between waves
    DECLINE = "DECLINE"  # significant negative change
    PERSISTENCE = "PERSISTENCE"  # change held (or faded) at follow-up
    RISK = "RISK"  # indicator off track / at risk
    SUCCESS = "SUCCESS"  # indicator achieved
    GAP = "GAP"  # difference between groups
    ATTENTION = "ATTENTION"  # low agreement on an item, low NPS
    PAIN_POINT = "PAIN_POINT"  # recurring complaint in open answers
    DATA_QUALITY = "DATA_QUALITY"
    SAMPLE = "SAMPLE"  # small sample caution


class Severity(StrEnum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class Confidence(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class InsightStatus(StrEnum):
    NEW = "NEW"
    PINNED = "PINNED"
    DISMISSED = "DISMISSED"


class RecommendationStatus(StrEnum):
    PROPOSED = "PROPOSED"
    ACCEPTED = "ACCEPTED"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    DISMISSED = "DISMISSED"


class Priority(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class ReportType(StrEnum):
    EXECUTIVE = "EXECUTIVE"
    DETAILED = "DETAILED"
    IMPACT = "IMPACT"
    MANAGEMENT = "MANAGEMENT"
    ACADEMIC = "ACADEMIC"


class ReportTone(StrEnum):
    FORMAL = "FORMAL"
    PLAIN = "PLAIN"
    ANALYTICAL = "ANALYTICAL"


# ---------------------------------------------------------- customer experience
class LocationKind(StrEnum):
    BRANCH = "BRANCH"
    KIOSK = "KIOSK"
    COUNTER = "COUNTER"
    EVENT = "EVENT"
    OTHER = "OTHER"


class CaseReason(StrEnum):
    DETRACTOR = "DETRACTOR"  # NPS 0–6
    LOW_SATISFACTION = "LOW_SATISFACTION"  # CSAT 1–2 of 5
    HIGH_EFFORT = "HIGH_EFFORT"  # CES 1–3 of 7


class CaseStatus(StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"


class GiftStatus(StrEnum):
    PENDING = "PENDING"  # the message was prepared; the recipient has not activated the account yet
    ACTIVE = "ACTIVE"  # activated (or added to an account the recipient already had)
    REVOKED = "REVOKED"  # cancelled before activation: the prepared account was removed


class TokenPurpose(StrEnum):
    RESET = "RESET"  # «forgot password», or a recovery link prepared by an administrator
    ACTIVATE = "ACTIVATE"  # a new account chooses its first password (invitation / new subscriber)


class SubscriptionState(StrEnum):
    """Derived from a subscription's dates and flags (SUBSCRIPTIONS.md §2), never stored."""

    PENDING = "PENDING"  # the owner has not activated the account yet: the period starts then
    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"  # the period ended: nothing new is published, collection stops after the grace
    SUSPENDED = "SUSPENDED"  # stopped by a platform administrator: the workspace is closed
