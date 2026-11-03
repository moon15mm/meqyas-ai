"""Subscription plans: the feature catalog, the limits and the default plans (SUBSCRIPTIONS.md).

Pure data — the database copy of the plans is what is enforced; administrators edit it from
«الباقات». ``DEFAULT_PLANS`` only fills a fresh database (and the test database between tests).
"""

from __future__ import annotations

from dataclasses import dataclass

#: Modules a plan can include. Everything else is part of every plan.
FEATURES: tuple[str, ...] = ("cx", "integrations", "exports", "ai_analysis", "ai_followup")

#: Limits a plan sets and a subscription may override. ``None`` = unlimited, except
#: ``ai_daily_tokens`` where ``None`` means the platform default (AI is never unlimited).
LIMIT_KEYS: tuple[str, ...] = ("surveys", "responses_per_month", "members", "ai_daily_tokens")

#: The plan feature an AI agent needs. Agents not listed (measurement architect, survey
#: generator, question reviewer, theory of change) are part of every plan.
AGENT_FEATURES: dict[str, str] = {
    "adaptive_interviewer": "ai_followup",
    "recommendation_agent": "ai_analysis",
    "data_analyst": "ai_analysis",
    "report_writer": "ai_analysis",
    "sentiment_analyzer": "ai_analysis",
    "theme_analyzer": "ai_analysis",
}


@dataclass(frozen=True, slots=True)
class PlanDefaults:
    code: str
    name_ar: str
    name_en: str
    description_ar: str
    description_en: str
    is_trial: bool
    default_days: int | None
    max_surveys: int | None
    max_responses_per_month: int | None
    max_members: int | None
    ai_daily_tokens: int | None
    features: tuple[str, ...]
    sort_order: int


DEFAULT_PLANS: tuple[PlanDefaults, ...] = (
    PlanDefaults(
        code="trial",
        name_ar="تجريبية",
        name_en="Trial",
        description_ar="لتجربة المنصة كاملة لفترة محدودة.",
        description_en="Try the whole platform for a limited time.",
        is_trial=True,
        default_days=14,
        max_surveys=3,
        max_responses_per_month=300,
        max_members=3,
        ai_daily_tokens=300_000,
        features=FEATURES,
        sort_order=1,
    ),
    PlanDefaults(
        code="basic",
        name_ar="أساسية",
        name_en="Basic",
        description_ar="لقياس الأثر والرضا في جهة واحدة.",
        description_en="Impact and satisfaction measurement for one organization.",
        is_trial=False,
        default_days=365,
        max_surveys=10,
        max_responses_per_month=1_000,
        max_members=3,
        ai_daily_tokens=500_000,
        features=("exports", "ai_analysis", "ai_followup"),
        sort_order=2,
    ),
    PlanDefaults(
        code="pro",
        name_ar="احترافية",
        name_en="Professional",
        description_ar="كل الوحدات، ومنها تجربة العملاء وتكامل المتاجر.",
        description_en="Every module, including customer experience and store integrations.",
        is_trial=False,
        default_days=365,
        max_surveys=50,
        max_responses_per_month=5_000,
        max_members=10,
        ai_daily_tokens=1_500_000,
        features=FEATURES,
        sort_order=3,
    ),
    PlanDefaults(
        code="enterprise",
        name_ar="مؤسسات",
        name_en="Enterprise",
        description_ar="بلا حدود للاستبانات والردود والأعضاء.",
        description_en="No limits on surveys, responses or members.",
        is_trial=False,
        default_days=None,
        max_surveys=None,
        max_responses_per_month=None,
        max_members=None,
        ai_daily_tokens=None,
        features=FEATURES,
        sort_order=4,
    ),
)

#: The plan of a workspace that has no subscription row (should not happen) and of the demo.
UNLIMITED_PLAN = "enterprise"
