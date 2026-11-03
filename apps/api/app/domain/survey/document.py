"""Canonical survey document (SURVEY_ENGINE.md §3).

The builder edits a whole ``SurveyDoc``; the API stores it in normalized
tables (sections/questions/options/logic_rules) and rebuilds it on read.
TypeScript mirror: packages/shared/src/survey/document.ts
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..enums import QuestionType

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,59}$")

#: Types that collect an answer.
ANSWERABLE_TYPES = frozenset(t for t in QuestionType if t not in (QuestionType.INFORMATION, QuestionType.SECTION))
CHOICE_TYPES = frozenset({QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE, QuestionType.DROPDOWN})
#: Types whose answer is a number (on a scale or free numeric).
NUMERIC_TYPES = frozenset(
    {
        QuestionType.RATING,
        QuestionType.STAR,
        QuestionType.LIKERT,
        QuestionType.SLIDER,
        QuestionType.NPS,
        QuestionType.CSAT,
        QuestionType.CES,
        QuestionType.NUMBER,
    }
)
SCALE_TYPES = NUMERIC_TYPES - {QuestionType.NUMBER}
TEXT_TYPES = frozenset({QuestionType.SHORT_TEXT, QuestionType.LONG_TEXT})

#: Fixed scales for standard instruments.
FIXED_SCALES: dict[QuestionType, tuple[int, int]] = {
    QuestionType.NPS: (0, 10),
    QuestionType.CSAT: (1, 5),
    QuestionType.CES: (1, 7),
}

LIKERT_LABELS = {
    "ar": ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"],
    "en": ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
}


class _Doc(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def _check_key(value: str) -> str:
    if not KEY_RE.match(value):
        raise ValueError("keys must be snake_case latin: start with a letter, up to 60 chars")
    return value


class OptionDoc(_Doc):
    value: str = Field(min_length=1, max_length=60)
    #: May be empty while drafting; publishing requires it (see ``completeness_issues``).
    label: str = Field(default="", max_length=300)
    score: float | None = None
    is_other: bool = False
    is_exclusive: bool = False


class ScaleDoc(_Doc):
    min: int = 1
    max: int = 5
    step: float = 1
    min_label: str = Field(default="", max_length=120)
    max_label: str = Field(default="", max_length=120)
    reverse_scored: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> ScaleDoc:
        if self.max <= self.min:
            raise ValueError("scale.max must be greater than scale.min")
        if self.max - self.min > 100:
            raise ValueError("scale range too large")
        if self.step <= 0:
            raise ValueError("scale.step must be positive")
        return self


class ValidationDoc(_Doc):
    min_length: int | None = Field(default=None, ge=0, le=10_000)
    max_length: int | None = Field(default=None, ge=1, le=10_000)
    min: float | None = None
    max: float | None = None
    min_choices: int | None = Field(default=None, ge=0, le=100)
    max_choices: int | None = Field(default=None, ge=1, le=100)
    pattern: str | None = Field(default=None, max_length=200)
    date_min: str | None = None
    date_max: str | None = None

    @field_validator("pattern")
    @classmethod
    def _compilable(cls, v: str | None) -> str | None:
        if v:
            try:
                re.compile(v)
            except re.error as exc:
                raise ValueError(f"invalid pattern: {exc}") from exc
        return v or None


class MatrixRowDoc(_Doc):
    key: str
    text: str = Field(default="", max_length=500)

    @field_validator("key")
    @classmethod
    def _valid_key(cls, v: str) -> str:
        return _check_key(v)


class QuestionSettingsDoc(_Doc):
    randomize_options: bool = False
    rows: list[MatrixRowDoc] = Field(default_factory=list, max_length=40)
    placeholder: str = Field(default="", max_length=200)
    ai_followup: bool = False
    #: Profile/segment variable (e.g. grade, school) — used for segmentation, not a measure.
    is_profile: bool = False
    #: Customer experience (CX.md): the loyalty/satisfaction outcome, or a driver of it (key driver analysis).
    cx_role: Literal["outcome", "driver"] | None = None
    #: The customer types a phone or e-mail only to be called back (closed loop). It is moved to the
    #: follow-up case, encrypted, and never stored as an answer.
    contact_field: Literal["phone", "email"] | None = None


class ScoringDoc(_Doc):
    weight: float = 1.0
    correct_values: list[str] = Field(default_factory=list, max_length=20)
    points: float | None = None


class QuestionDoc(_Doc):
    key: str
    type: QuestionType
    text: str = Field(default="", max_length=1000)
    description: str = Field(default="", max_length=2000)
    required: bool = False
    dimension_id: uuid.UUID | None = None
    indicator_id: uuid.UUID | None = None
    options: list[OptionDoc] = Field(default_factory=list, max_length=60)
    scale: ScaleDoc | None = None
    validation: ValidationDoc = Field(default_factory=ValidationDoc)
    settings: QuestionSettingsDoc = Field(default_factory=QuestionSettingsDoc)
    scoring: ScoringDoc = Field(default_factory=ScoringDoc)
    ai_generated: bool = False
    lineage_id: uuid.UUID | None = None

    @field_validator("key")
    @classmethod
    def _valid_key(cls, v: str) -> str:
        return _check_key(v)

    @property
    def answerable(self) -> bool:
        return self.type in ANSWERABLE_TYPES

    @model_validator(mode="after")
    def _type_rules(self) -> QuestionDoc:
        t = self.type
        if t in (QuestionType.INFORMATION, QuestionType.SECTION):
            self.required = False
            return self
        values = [o.value for o in self.options]
        if len(values) != len(set(values)):
            raise ValueError(f"question '{self.key}' has duplicate option values")
        if t in CHOICE_TYPES or t == QuestionType.RANKING:
            if len(self.options) < 2:
                raise ValueError(f"question '{self.key}' needs at least 2 options")
        if t == QuestionType.MATRIX:
            if not self.settings.rows:
                raise ValueError(f"matrix question '{self.key}' needs at least one row")
            if len(self.options) < 2:
                raise ValueError(f"matrix question '{self.key}' needs at least 2 columns (options)")
            rows = [r.key for r in self.settings.rows]
            if len(rows) != len(set(rows)):
                raise ValueError(f"matrix question '{self.key}' has duplicate row keys")
        if t in FIXED_SCALES:
            lo, hi = FIXED_SCALES[t]
            base = self.scale or ScaleDoc(min=lo, max=hi)
            self.scale = base.model_copy(update={"min": lo, "max": hi, "step": 1})
        elif t in SCALE_TYPES:
            if self.scale is None:
                self.scale = ScaleDoc(min=1, max=5)
            if t == QuestionType.STAR and self.scale.max > 10:
                raise ValueError("star rating supports up to 10 stars")
        return self


class SectionDoc(_Doc):
    key: str
    title: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=2000)
    randomize_questions: bool = False
    questions: list[QuestionDoc] = Field(default_factory=list, max_length=200)

    @field_validator("key")
    @classmethod
    def _valid_key(cls, v: str) -> str:
        return _check_key(v)


RuleType = Literal["DISPLAY", "SKIP", "END", "QUOTA"]


class LogicRuleDoc(_Doc):
    id: str | None = Field(default=None, max_length=60)
    type: RuleType
    #: SKIP/END: evaluated after this question. DISPLAY: unused.
    source_key: str | None = None
    #: DISPLAY: question/section shown when the condition holds. SKIP: jump destination.
    target_key: str | None = None
    condition: dict[str, Any] = Field(default_factory=dict)
    limit: int | None = Field(default=None, ge=1, le=1_000_000)
    enabled: bool = True


AnonymityMode = Literal["ANONYMOUS", "PSEUDONYMOUS", "IDENTIFIED"]


class SurveySettingsDoc(_Doc):
    one_question_per_page: bool = False
    show_progress: bool = True
    allow_back: bool = True
    anonymity_mode: AnonymityMode = "ANONYMOUS"
    collect_respondent_code: bool = False
    ai_followup_enabled: bool = False
    ai_followup_max: int = Field(default=2, ge=0, le=3)
    #: "pulse": the fast customer-experience mode — one tap per screen, faces, stars and auto-advance.
    experience: Literal["standard", "pulse"] = "standard"
    #: Shown on the thank-you screen (e.g. a discount code for the next visit); plain text.
    reward_text: str = Field(default="", max_length=300)
    #: Open a follow-up case when a customer gives a low score (closed loop, CX.md §5).
    closed_loop: bool = False


class SurveyDoc(_Doc):
    #: May be empty while drafting; publishing requires it.
    title: str = Field(default="", max_length=300)
    introduction: str = Field(default="", max_length=5000)
    thank_you_message: str = Field(default="", max_length=2000)
    language: Literal["ar", "en"] = "ar"
    sections: list[SectionDoc] = Field(min_length=1, max_length=30)
    logic: list[LogicRuleDoc] = Field(default_factory=list, max_length=300)
    settings: SurveySettingsDoc = Field(default_factory=SurveySettingsDoc)

    @model_validator(mode="after")
    def _unique_keys_and_defaults(self) -> SurveyDoc:
        seen: set[str] = set()
        for section in self.sections:
            if section.key in seen:
                raise ValueError(f"duplicate key '{section.key}'")
            seen.add(section.key)
            for q in section.questions:
                if q.key in seen:
                    raise ValueError(f"duplicate key '{q.key}'")
                seen.add(q.key)
                if q.type == QuestionType.LIKERT and not q.options and q.scale:
                    q.options = default_likert_options(q.scale, self.language)
        total = sum(len(s.questions) for s in self.sections)
        if total > 300:
            raise ValueError("a survey can have at most 300 questions")
        return self

    # ------------------------------------------------------------ helpers
    def questions(self) -> list[QuestionDoc]:
        return [q for s in self.sections for q in s.questions]

    def question_map(self) -> dict[str, QuestionDoc]:
        return {q.key: q for q in self.questions()}

    def order(self) -> list[tuple[str, str]]:
        """Canonical order of (section_key, question_key)."""
        return [(s.key, q.key) for s in self.sections for q in s.questions]


def completeness_issues(doc: SurveyDoc) -> list[dict[str, str]]:
    """What still has to be written before publishing. Drafts may be incomplete
    (autosave never fails because a new question has no text yet)."""
    issues: list[dict[str, str]] = []
    if not doc.title.strip():
        issues.append({"code": "missing_title", "question_key": ""})
    for q in doc.questions():
        if not q.text.strip():
            issues.append({"code": "missing_text", "question_key": q.key})
        if q.answerable and any(not o.label.strip() for o in q.options):
            issues.append({"code": "missing_option_label", "question_key": q.key})
        if q.type == QuestionType.MATRIX and any(not r.text.strip() for r in q.settings.rows):
            issues.append({"code": "missing_row_text", "question_key": q.key})
    return issues


def default_likert_options(scale: ScaleDoc, language: str) -> list[OptionDoc]:
    points = list(range(scale.min, scale.max + 1))
    labels = LIKERT_LABELS.get(language, LIKERT_LABELS["ar"])
    if len(points) == len(labels):
        return [OptionDoc(value=str(p), label=lbl, score=float(p)) for p, lbl in zip(points, labels, strict=True)]
    return [OptionDoc(value=str(p), label=str(p), score=float(p)) for p in points]


def blank_document(title: str, language: str = "ar") -> SurveyDoc:
    return SurveyDoc(
        title=title,
        language="en" if language == "en" else "ar",
        sections=[SectionDoc(key="s1", title="")],
    )
