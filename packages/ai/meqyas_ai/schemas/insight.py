"""Phase 6 contracts: sentiment, themes, recommendations and the grounded data analyst.

LLM-facing models are flat (D-018) and tolerant of common label variants (lower case,
Arabic labels); everything is normalized before it reaches the application.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Language = Literal["ar", "en"]
Sentiment = Literal["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"]
ThemeCategory = Literal["TOPIC", "PAIN_POINT", "STRENGTH", "SUGGESTION"]
Level = Literal["HIGH", "MEDIUM", "LOW"]

_SENTIMENT_ALIASES = {
    "positive": "POSITIVE",
    "pos": "POSITIVE",
    "إيجابي": "POSITIVE",
    "ايجابي": "POSITIVE",
    "negative": "NEGATIVE",
    "neg": "NEGATIVE",
    "سلبي": "NEGATIVE",
    "neutral": "NEUTRAL",
    "محايد": "NEUTRAL",
    "mixed": "MIXED",
    "مختلط": "MIXED",
}
_CATEGORY_ALIASES = {
    "topic": "TOPIC",
    "موضوع": "TOPIC",
    "pain_point": "PAIN_POINT",
    "pain point": "PAIN_POINT",
    "painpoint": "PAIN_POINT",
    "problem": "PAIN_POINT",
    "مشكلة": "PAIN_POINT",
    "strength": "STRENGTH",
    "نقطة قوة": "STRENGTH",
    "suggestion": "SUGGESTION",
    "اقتراح": "SUGGESTION",
}
_LEVEL_ALIASES = {
    "high": "HIGH",
    "عالية": "HIGH",
    "عالي": "HIGH",
    "medium": "MEDIUM",
    "متوسطة": "MEDIUM",
    "متوسط": "MEDIUM",
    "low": "LOW",
    "منخفضة": "LOW",
    "منخفض": "LOW",
}


def _alias(value: Any, table: dict[str, str], default: str) -> Any:
    if isinstance(value, str):
        key = value.strip()
        return table.get(key.lower(), table.get(key, key.upper() if key.upper() in table.values() else default))
    return default if value is None else value


def _clamp(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, number))


class TextItem(BaseModel):
    id: str
    text: str


# ---------------------------------------------------------------- sentiment
class SentimentInput(BaseModel):
    language: Language = "ar"
    question: str = ""
    items: list[TextItem] = Field(default_factory=list, max_length=40)


class SentimentResultOut(BaseModel):
    id: str
    label: Sentiment = "NEUTRAL"
    #: −1 (very negative) … +1 (very positive)
    score: float = 0.0
    confidence: float = 0.7

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, v: Any) -> Any:
        return _alias(v, _SENTIMENT_ALIASES, "NEUTRAL")

    @field_validator("score", mode="before")
    @classmethod
    def _score(cls, v: Any) -> float:
        return _clamp(v, -1.0, 1.0, 0.0)

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, v: Any) -> float:
        return _clamp(v, 0.0, 1.0, 0.7)


class SentimentOutput(BaseModel):
    results: list[SentimentResultOut] = Field(default_factory=list)


# ------------------------------------------------------------------- themes
class ThemeInput(BaseModel):
    language: Language = "ar"
    question: str = ""
    survey_title: str = ""
    population: str = ""
    items: list[TextItem] = Field(default_factory=list, max_length=200)
    max_themes: int = Field(default=6, ge=2, le=10)


class ThemeOut(BaseModel):
    key: str
    name: str
    description: str = ""
    category: ThemeCategory = "TOPIC"
    sentiment: Sentiment = "NEUTRAL"
    keywords: list[str] = Field(default_factory=list)

    @field_validator("category", mode="before")
    @classmethod
    def _category(cls, v: Any) -> Any:
        return _alias(v, _CATEGORY_ALIASES, "TOPIC")

    @field_validator("sentiment", mode="before")
    @classmethod
    def _sentiment(cls, v: Any) -> Any:
        return _alias(v, _SENTIMENT_ALIASES, "NEUTRAL")


class ThemeAssignmentOut(BaseModel):
    id: str
    themes: list[str] = Field(default_factory=list)


class ThemeOutput(BaseModel):
    themes: list[ThemeOut] = Field(default_factory=list, max_length=12)
    assignments: list[ThemeAssignmentOut] = Field(default_factory=list)


class ThemeResult(BaseModel):
    """After post-processing: counts come from the assignments, never from the model."""

    themes: list[ThemeOut]
    assignments: dict[str, list[str]]
    counts: dict[str, int]


# ---------------------------------------------------------- recommendations
class InsightBrief(BaseModel):
    id: str
    kind: str
    severity: str = "MEDIUM"
    title: str
    body: str = ""
    evidence: str = ""


class RecommendationInput(BaseModel):
    language: Language = "ar"
    project_title: str = ""
    measurement_type: str = ""
    target_population: str = ""
    evidence_level: str = "DESCRIPTIVE"
    insights: list[InsightBrief] = Field(default_factory=list, max_length=25)
    max_recommendations: int = Field(default=6, ge=1, le=10)


class RecommendationOut(BaseModel):
    insight_ids: list[str] = Field(default_factory=list)
    problem: str
    recommendation: str
    possible_cause: str = ""
    expected_outcome: str = ""
    priority: Level = "MEDIUM"
    confidence: Level = "MEDIUM"
    owner_hint: str = ""
    timeframe: str = ""

    @field_validator("priority", "confidence", mode="before")
    @classmethod
    def _level(cls, v: Any) -> Any:
        return _alias(v, _LEVEL_ALIASES, "MEDIUM")


class RecommendationOutput(BaseModel):
    recommendations: list[RecommendationOut] = Field(default_factory=list)


# -------------------------------------------------------------- data analyst
class Fact(BaseModel):
    """One computed number (or label) from the analytics pack, citable by id."""

    id: str
    label: str
    value: str
    n: int | None = None
    note: str = ""


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AnalystInput(BaseModel):
    language: Language = "ar"
    project_title: str = ""
    measurement_type: str = ""
    evidence_level: str = "DESCRIPTIVE"
    caveat: str = ""
    facts: list[Fact] = Field(default_factory=list, max_length=400)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    question: str = Field(min_length=1, max_length=2000)


class AnalystOutput(BaseModel):
    answer: str
    evidence_ids: list[str] = Field(default_factory=list)
    follow_ups: list[str] = Field(default_factory=list, max_length=6)
