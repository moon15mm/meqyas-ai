"""SurveyGenerator / QuestionReviewer pipelines with scripted model outputs."""

from __future__ import annotations

import json

from meqyas_ai.agents.question_reviewer import QuestionReviewerAgent
from meqyas_ai.agents.survey_generator import SurveyGeneratorAgent
from meqyas_ai.domain.enums import QuestionType
from meqyas_ai.providers.base import GenerationOptions, Message
from meqyas_ai.providers.factory import ModelTiers
from meqyas_ai.runtime import AgentRunner
from meqyas_ai.schemas.survey import GeneratedSurvey
from meqyas_ai.structured import StructuredOutputEngine
from meqyas_ai.testing import ScriptedProvider
from pydantic import BaseModel, Field

INPUT = {
    "language": "ar",
    "project_title": "رضا الطالبات عن البرنامج التدريبي",
    "measurement_type": "SATISFACTION",
    "target_population": "طالبات البرنامج",
    "purpose": "تحسين البرنامج",
    "design": "POST_ONLY",
    "wave_type": "SINGLE",
    "dimensions": [
        {"key": "content", "name": "ملاءمة المحتوى"},
        {"key": "trainer", "name": "فعالية المدرب"},
    ],
    "indicators": [{"code": "IND-01", "name": "متوسط الرضا عن المحتوى", "dimension_key": "content"}],
    "question_count": 5,
}


def _q(key: str, *, qtype: str = "LIKERT", dim: str | None = None, **extra: object) -> dict[str, object]:
    return {"key": key, "type": qtype, "text": f"نص {key}", "dimension_key": dim, **extra}


def _survey(sections: list[object], logic: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {
        "title": "استبيان",
        "introduction": "مقدمة",
        "thank_you_message": "شكرًا",
        "sections": sections,
        "logic": logic or [],
    }


def _runner(outputs: list[object]) -> tuple[AgentRunner, ScriptedProvider]:
    provider = ScriptedProvider(outputs)  # type: ignore[arg-type]
    return AgentRunner(provider, ModelTiers(fast="f", smart="s")), provider


# ------------------------------------------------------------ engine fix
class Inner(BaseModel):
    key: str
    n: int


class Outer(BaseModel):
    items: list[Inner] = Field(min_length=1)


async def test_engine_decodes_json_encoded_nested_objects() -> None:
    """Groq/gpt-oss sometimes emits nested objects as JSON strings; no repair round is needed."""
    payload = {"items": [{"key": "a", "n": 1}, json.dumps({"key": "b", "n": 2})]}
    provider = ScriptedProvider([payload])
    result = await StructuredOutputEngine().run(
        provider, [Message("user", "u")], Outer, GenerationOptions(model="m"), schema_name="outer"
    )
    assert result.attempts == 1
    assert [i.key for i in result.value.items] == ["a", "b"]


async def test_engine_does_not_decode_plain_strings() -> None:
    provider = ScriptedProvider([{"items": ["not json"]}, {"items": [{"key": "x", "n": 1}]}])
    result = await StructuredOutputEngine().run(
        provider, [Message("user", "u")], Outer, GenerationOptions(model="m"), schema_name="outer", max_repairs=1
    )
    assert result.attempts == 2


# ---------------------------------------------------------- generator
async def test_generator_fills_missing_section_titles() -> None:
    sections = [
        {
            "key": "profile",
            "description": "",
            "questions": [
                _q(
                    "grade",
                    qtype="SINGLE_CHOICE",
                    is_profile=True,
                    options=[{"value": "1", "label": "الأول"}, {"value": "2", "label": "الثاني"}],
                )
            ],
        },
        # heading placed in `description` by the model
        {
            "key": "s_content",
            "description": "محتوى التدريب",
            "questions": [_q("c1", dim="content"), _q("c2", dim="content")],
        },
        # nested section emitted as a JSON string, no title at all
        json.dumps(
            {"key": "s_trainer", "questions": [_q("t1", dim="trainer"), _q("t2", dim="trainer")]}, ensure_ascii=False
        ),
        {"key": "open", "questions": [_q("strengths", qtype="LONG_TEXT")]},
    ]
    runner, _ = _runner([_survey(sections)])
    result = await runner.run(SurveyGeneratorAgent(), INPUT)
    out: GeneratedSurvey = result.output
    assert [s.title for s in out.sections] == ["معلومات عامة", "محتوى التدريب", "فعالية المدرب", "أسئلة مفتوحة"]
    assert out.sections[1].description == ""
    assert result.record.attempts == 1


async def test_generator_post_process_sanitizes_output() -> None:
    sections = [
        {
            "key": "Main Section",
            "title": "عام",
            "questions": [
                _q("c1", dim="content", indicator_code="IND-01"),
                _q("c1", dim="content"),  # duplicate key
                _q("bad choice", qtype="SINGLE_CHOICE", dim="trainer", options=[{"value": "1", "label": "x"}]),
                _q("t2", dim="unknown_dim", indicator_code="IND-99"),
                _q("t3", dim="trainer"),
            ],
        }
    ]
    logic = [{"type": "DISPLAY", "target_key": "t3", "question_key": "c1", "op": "lte", "values": ["2"]}]
    # The one-option choice triggers a repair round; the model repeats itself, so the output is kept
    # and post-processing makes it usable.
    runner, _ = _runner([_survey(sections, logic), _survey(sections, logic)])
    result = await runner.run(SurveyGeneratorAgent(), INPUT)
    assert result.semantic_issues and "bad choice" in result.semantic_issues[-1]
    out: GeneratedSurvey = result.output
    keys = [q.key for q in out.sections[0].questions]
    assert out.sections[0].key == "main_section"
    assert len(set(keys)) == len(keys) and keys[:2] == ["c1", "c1_2"]
    by_key = {q.key: q for q in out.sections[0].questions}
    assert by_key["bad_choice"].type == QuestionType.LONG_TEXT  # a choice with < 2 options is unusable
    assert by_key["t2"].dimension_key is None and by_key["t2"].indicator_code is None
    assert by_key["c1"].indicator_code == "IND-01"
    assert out.logic[0].question_key == "c1" and out.logic[0].target_key == "t3"


async def test_generator_requests_repair_when_dimensions_are_under_covered() -> None:
    thin = [
        {
            "key": "s",
            "title": "عام",
            "questions": [_q("c1", dim="content"), _q("c2", dim="content"), _q("x", dim="content")],
        }
    ]
    good = [
        {
            "key": "s",
            "title": "عام",
            "questions": [
                _q("c1", dim="content"),
                _q("c2", dim="content"),
                _q("t1", dim="trainer"),
                _q("t2", dim="trainer"),
            ],
        }
    ]
    runner, provider = _runner([_survey(thin), _survey(good)])
    result = await runner.run(SurveyGeneratorAgent(), INPUT)
    assert result.record.attempts == 2
    assert "trainer" in provider.calls[1]["messages"][-1].content


# ----------------------------------------------------------- reviewer
async def test_reviewer_drops_unknown_and_duplicate_issues() -> None:
    data = {
        "language": "ar",
        "purpose": "رضا",
        "target_population": "طالبات",
        "questions": [{"key": "q1", "type": "LIKERT", "text": "هل المحتوى والمدرب ممتازان؟"}],
    }
    issue = {
        "question_key": "q1",
        "type": "DOUBLE_BARRELED",
        "severity": "HIGH",
        "problem": "سؤال مزدوج",
        "reason": "يجمع فكرتين",
        "suggestion": "ما مدى ملاءمة المحتوى؟",
    }
    output = {"overall_comment": "جيد", "issues": [issue, issue, {**issue, "question_key": "ghost"}]}
    runner, _ = _runner([output])
    result = await runner.run(QuestionReviewerAgent(), data)
    assert [i.question_key for i in result.output.issues] == ["q1"]


async def test_engine_drops_empty_string_padding() -> None:
    provider = ScriptedProvider([{"items": [{"key": "a", "n": 1}, "", json.dumps({"key": "b", "n": 2}), "  "]}])
    result = await StructuredOutputEngine().run(
        provider, [Message("user", "u")], Outer, GenerationOptions(model="m"), schema_name="outer"
    )
    assert result.attempts == 1 and [i.key for i in result.value.items] == ["a", "b"]


async def test_generator_regroups_flat_items_into_sections() -> None:
    """The LLM-facing shape is flat: section headers + one item list with section_key."""
    flat = {
        "title": "استبيان",
        "sections": [
            {"key": "content", "title": "المحتوى"},
            {"key": "trainer", "title": "المدرب"},
            {"key": "empty", "title": "قسم بلا أسئلة"},
        ],
        "questions": [
            {**_q("c1", dim="content"), "section_key": "content"},
            {**_q("t1", dim="trainer"), "section_key": "trainer"},
            {**_q("c2", dim="content"), "section_key": "content"},
            {**_q("t2", dim="trainer"), "section_key": "missing"},  # unknown → previous item's section
        ],
        "logic": [],
    }
    runner, provider = _runner([flat])
    result = await runner.run(SurveyGeneratorAgent(), INPUT)
    out: GeneratedSurvey = result.output
    assert [s.key for s in out.sections] == ["content", "trainer"]  # empty headers are dropped
    assert [q.key for q in out.sections[0].questions] == ["c1", "c2", "t2"]
    assert [q.key for q in out.sections[1].questions] == ["t1"]
    assert result.record.attempts == 1
    schema = provider.calls[0]["schema"]
    assert "questions" in schema["properties"] and "section_key" in json.dumps(schema)


async def test_reviewer_fix_types_are_normalized() -> None:
    data = {
        "language": "ar",
        "questions": [
            {"key": "q1", "type": "LIKERT", "text": "أ"},
            {"key": "q2", "type": "LIKERT", "text": "ب"},
            {"key": "q3", "type": "SINGLE_CHOICE", "text": "ج", "options": ["نعم", "لا"]},
            {"key": "q4", "type": "LIKERT", "text": "د"},
            {"key": "q5", "type": "SINGLE_CHOICE", "text": "هـ", "options": ["أ", "ب"]},
        ],
    }
    base = {"severity": "MEDIUM", "problem": "p", "reason": "r"}
    output = {
        "issues": [
            {**base, "question_key": "q1", "type": "DUPLICATE", "fix": "delete", "suggestion": "احذف السؤال"},
            {**base, "question_key": "q2", "type": "AMBIGUOUS", "suggestion": "ادمج هذا السؤال مع السابق"},
            {
                **base,
                "question_key": "q3",
                "type": "MISSING_OPTIONS",
                "fix": "OPTIONS",
                "suggested_options": ["نعم", "لا", "لا أعرف"],
            },
            {**base, "question_key": "q4", "type": "AMBIGUOUS", "suggestion": "أستطيع شرح المفهوم لزميلتي."},
            {
                **base,
                "question_key": "q5",
                "type": "AMBIGUOUS",
                "suggestion": "ما دورك في البرنامج؟ | الخيارات: متدربة، مساعدة تدريبية، منسقة",
            },
        ]
    }
    runner, _ = _runner([output])
    issues = {i.question_key: i for i in (await runner.run(QuestionReviewerAgent(), data)).output.issues}
    assert issues["q1"].fix == "REMOVE" and issues["q1"].suggestion == ""
    assert issues["q2"].fix == "NONE"  # advice is never applied as question text
    assert issues["q3"].fix == "OPTIONS"
    assert issues["q4"].fix == "REWRITE"
    # options appended to the text are split out instead of being pasted into the question
    assert issues["q5"].fix == "OPTIONS" and issues["q5"].suggestion == "ما دورك في البرنامج؟"
    assert issues["q5"].suggested_options == ["متدربة", "مساعدة تدريبية", "منسقة"]
