"""Schemas for the survey agents (SurveyGenerator, QuestionReviewer).

LLM-facing shapes are deliberately flat (single-leaf logic conditions,
explicit scale fields) — the API maps them to the canonical SurveyDoc.
"""

from __future__ import annotations

import json
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from ..domain.enums import QuestionType
from .plan import _enum, _list, _text

QType = Annotated[
    QuestionType,
    _enum(
        {
            "TEXT": "SHORT_TEXT",
            "OPEN": "LONG_TEXT",
            "OPEN_TEXT": "LONG_TEXT",
            "CHOICE": "SINGLE_CHOICE",
            "RADIO": "SINGLE_CHOICE",
            "CHECKBOX": "MULTIPLE_CHOICE",
            "SELECT": "DROPDOWN",
            "SCALE": "LIKERT",
        }
    ),
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


def _opt_number(v: Any) -> Any:
    if v in ("", None):
        return None
    return v


OptNumber = Annotated[float | None, BeforeValidator(_opt_number)]
OptInt = Annotated[int | None, BeforeValidator(_opt_number)]


# ------------------------------------------------------------- generator
class GenDimension(_Model):
    key: str
    name: str
    description: str = ""


class GenIndicator(_Model):
    code: str
    name: str
    indicator_type: str = ""
    dimension_key: str | None = None


class ExistingItem(_Model):
    key: str
    type: str
    text: str


class SurveyGeneratorInput(_Model):
    language: Literal["ar", "en"] = "ar"
    project_title: str = Field(max_length=300)
    measurement_type: str
    target_population: str = Field(default="", max_length=300)
    purpose: str = Field(default="", max_length=1000)
    design: str = ""
    wave_type: str = "SINGLE"
    wave_name: str = ""
    dimensions: list[GenDimension] = Field(default_factory=list, max_length=12)
    indicators: list[GenIndicator] = Field(default_factory=list, max_length=24)
    question_count: int = Field(default=12, ge=3, le=60)
    include_open_questions: bool = True
    include_profile_questions: bool = True
    #: "addendum" = generate only wave-specific items to append to repeated items copied from the baseline.
    mode: Literal["full", "addendum"] = "full"
    existing_items: list[ExistingItem] = Field(default_factory=list, max_length=120)
    extra_instructions: str | None = Field(default=None, max_length=1000)


class GenOption(_Model):
    value: Annotated[str, _text(60)] = Field(description="Short stable code, e.g. yes, no, 1, 2")
    label: Annotated[str, _text(300)]
    score: OptNumber = Field(default=None, description="Numeric score when the option is ordinal")


class GenRow(_Model):
    key: Annotated[str, _text(60)]
    text: Annotated[str, _text(500)]


class GenQuestion(_Model):
    key: Annotated[str, _text(60)] = Field(description="snake_case English id, unique in the survey")
    type: QType
    text: Annotated[str, _text(1000)]
    description: Annotated[str, _text(500)] = ""
    required: bool = True
    dimension_key: Annotated[str, _text(60)] | None = Field(default=None, description="Dimension measured")
    indicator_code: Annotated[str, _text(40)] | None = Field(default=None, description="Indicator fed, e.g. IND-01")
    is_profile: bool = Field(default=False, description="Profile/segment question (grade, role…)")
    options: Annotated[list[GenOption], _list(30)] = Field(default_factory=list)
    rows: Annotated[list[GenRow], _list(20)] = Field(default_factory=list, description="Matrix rows")
    scale_min: OptInt = None
    scale_max: OptInt = None
    min_label: Annotated[str, _text(120)] = ""
    max_label: Annotated[str, _text(120)] = ""
    correct_value: Annotated[str, _text(60)] | None = Field(default=None, description="Knowledge-check answer")
    ai_followup: bool = False


class GenSection(_Model):
    key: Annotated[str, _text(60)]
    title: Annotated[str, _text(300)] = ""
    description: Annotated[str, _text(1000)] = ""
    questions: Annotated[list[GenQuestion], _list(60)] = Field(min_length=1)


class GenLogic(_Model):
    type: Literal["DISPLAY", "SKIP", "END"]
    #: SKIP/END: question after which the rule is evaluated
    source_key: Annotated[str, _text(60)] | None = None
    #: DISPLAY: question/section to show; SKIP: destination
    target_key: Annotated[str, _text(60)] | None = None
    question_key: Annotated[str, _text(60)] = Field(description="Question tested by the condition")
    op: Literal["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "answered", "not_answered"]
    values: Annotated[list[Annotated[str, _text(60)]], _list(10)] = Field(default_factory=list)


class GeneratedSurvey(_Model):
    title: Annotated[str, _text(300)]
    introduction: Annotated[str, _text(2000)] = ""
    thank_you_message: Annotated[str, _text(600)] = ""
    sections: Annotated[list[GenSection], _list(10)] = Field(min_length=1)
    logic: Annotated[list[GenLogic], _list(12)] = Field(default_factory=list)


class GenSectionHeader(_Model):
    key: Annotated[str, _text(60)]
    title: Annotated[str, _text(300)] = ""
    description: Annotated[str, _text(1000)] = ""


class GenItem(GenQuestion):
    section_key: Annotated[str, _text(60)] = Field(default="", description="key of the section holding this item")


def _decoded(value: Any) -> Any:
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


class SurveyDraftOut(_Model):
    """What the LLM returns. Flat on purpose: several models (e.g. gpt-oss) degrade on arrays of
    objects nested inside arrays of objects (stringified or broken JSON). The agent regroups the
    items into :class:`GeneratedSurvey`."""

    title: Annotated[str, _text(300)]
    introduction: Annotated[str, _text(2000)] = ""
    thank_you_message: Annotated[str, _text(600)] = ""
    sections: Annotated[list[GenSectionHeader], _list(10)] = Field(min_length=1)
    questions: Annotated[list[GenItem], _list(80)] = Field(min_length=1)
    logic: Annotated[list[GenLogic], _list(12)] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _accept_nested_shape(cls, data: Any) -> Any:
        """Also accept ``sections[].questions[]`` (the canonical nested shape) when a model insists on it."""
        if not isinstance(data, dict) or data.get("questions") or not isinstance(data.get("sections"), list):
            return data
        sections: list[dict[str, Any]] = []
        questions: list[Any] = []
        for raw in data["sections"]:
            section = _decoded(raw)
            if not isinstance(section, dict):
                continue
            key = str(section.get("key") or f"s{len(sections) + 1}")
            for item in section.get("questions") or []:
                q = _decoded(item)
                if isinstance(q, dict):
                    questions.append({**q, "section_key": q.get("section_key") or key})
            sections.append({**{k: v for k, v in section.items() if k != "questions"}, "key": key})
        return {**data, "sections": sections, "questions": questions}


# --------------------------------------------------------------- reviewer
class IssueType(StrEnum):
    DOUBLE_BARRELED = "DOUBLE_BARRELED"
    LEADING = "LEADING"
    AMBIGUOUS = "AMBIGUOUS"
    TOO_LONG = "TOO_LONG"
    BIASED = "BIASED"
    DUPLICATE = "DUPLICATE"
    IRRELEVANT = "IRRELEVANT"
    MISSING_OPTIONS = "MISSING_OPTIONS"
    WRONG_SCALE = "WRONG_SCALE"
    OTHER = "OTHER"


class ReviewQuestion(_Model):
    key: str
    type: str
    text: str
    options: list[str] = Field(default_factory=list)
    #: Matrix statements (each row is rated on the options scale)
    rows: list[str] = Field(default_factory=list)
    scale: str = ""
    dimension: str | None = None


class ReviewerInput(_Model):
    language: Literal["ar", "en"] = "ar"
    target_population: str = ""
    measurement_type: str = ""
    questions: list[ReviewQuestion] = Field(min_length=1, max_length=150)


class ReviewIssueOut(_Model):
    question_key: Annotated[str, _text(60)]
    type: Annotated[IssueType, _enum({"DOUBLE": "DOUBLE_BARRELED", "DOUBLE_BARREL": "DOUBLE_BARRELED"})]
    severity: Annotated[Literal["LOW", "MEDIUM", "HIGH"], _enum()]
    problem: Annotated[str, _text(400)] = Field(description="المشكلة — what is wrong")
    reason: Annotated[str, _text(600)] = Field(description="السبب — why it harms measurement")
    fix: Annotated[
        Literal["REWRITE", "OPTIONS", "REMOVE", "NONE"],
        _enum({"DELETE": "REMOVE", "DROP": "REMOVE", "REPLACE": "REWRITE", "EDIT": "REWRITE", "REPHRASE": "REWRITE"}),
    ] = Field(
        default="REWRITE",
        description="REWRITE: suggestion is the full new text; OPTIONS: suggested_options replace the options; "
        "REMOVE: delete the item",
    )
    suggestion: Annotated[str, _text(1000)] = Field(
        default="", description="REWRITE: complete replacement question text (never advice)"
    )
    suggested_options: Annotated[list[Annotated[str, _text(300)]], _list(20)] = Field(default_factory=list)


class ReviewOutput(_Model):
    issues: Annotated[list[ReviewIssueOut], _list(60)] = Field(default_factory=list)
    overall_comment: Annotated[str, _text(800)] = ""


# ----------------------------------------------------- adaptive follow-up
class FollowupInput(_Model):
    language: Literal["ar", "en"] = "ar"
    survey_title: str = Field(default="", max_length=300)
    question_type: str
    question_text: str = Field(max_length=1000)
    #: Human-readable rendering of the respondent's answer (e.g. "2 — أعارض").
    answer: str = Field(max_length=2000)
    #: Scale context so the agent knows what "2" means (e.g. "1 = أعارض بشدة … 5 = أوافق بشدة").
    scale_hint: str = Field(default="", max_length=300)


class FollowupOutput(_Model):
    ask: bool = Field(description="True only when one short follow-up would add real insight")
    question: Annotated[str, _text(240)] = Field(default="", description="The follow-up question, or empty")
