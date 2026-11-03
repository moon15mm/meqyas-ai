from __future__ import annotations

import json

import pytest
from meqyas_ai.errors import AIStructuredOutputError
from meqyas_ai.providers.base import GenerationOptions, Message
from meqyas_ai.schemas.plan import ArchitectOutput
from meqyas_ai.structured import (
    JSONExtractionError,
    StructuredOutputEngine,
    extract_json_object,
    to_strict_json_schema,
)
from meqyas_ai.testing import ScriptedProvider
from pydantic import BaseModel, Field


class Item(BaseModel):
    title: str = Field(min_length=1, max_length=20)
    score: int


class Wrapper(BaseModel):
    items: list[Item] = Field(min_length=1)
    note: str | None = None


# ----------------------------------------------------------- extraction
@pytest.mark.parametrize(
    "text",
    [
        '{"a": 1}',
        '```json\n{"a": 1}\n```',
        'Here is the result:\n{"a": 1}\nThanks!',
        '"{\\"a\\": 1}"',
        'noise {not json} then {"a": 1}',
    ],
)
def test_extract_json_object_variants(text: str) -> None:
    assert extract_json_object(text) == {"a": 1}


def test_extract_json_handles_braces_inside_strings() -> None:
    assert extract_json_object('prefix {"t": "a } b { c", "n": 2} suffix') == {"t": "a } b { c", "n": 2}


@pytest.mark.parametrize("text", ["", "   ", "no json here", "{broken"])
def test_extract_json_rejects_garbage(text: str) -> None:
    with pytest.raises(JSONExtractionError):
        extract_json_object(text)


# --------------------------------------------------------------- schema
def _walk(node, fn):
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            _walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            _walk(v, fn)


def test_strict_schema_is_self_contained_and_strict() -> None:
    schema = to_strict_json_schema(ArchitectOutput)
    dumped = json.dumps(schema)
    assert "$ref" not in dumped and "$defs" not in dumped

    def check(node: dict) -> None:
        if node.get("type") == "object":
            assert node["additionalProperties"] is False
            assert set(node["required"]) == set(node["properties"].keys())
        for banned in ("default", "minLength", "maxItems", "title"):
            # "title" may exist as a *property name*, never as a schema keyword on an object node
            if banned == "title":
                assert not isinstance(node.get("title"), str)
            else:
                assert banned not in node

    _walk(schema, check)
    # property literally named "title" inside objectives survives
    objective = schema["properties"]["objectives"]["items"]
    assert "title" in objective["properties"]


# --------------------------------------------------------------- engine
async def test_engine_returns_valid_output_first_try() -> None:
    provider = ScriptedProvider([{"items": [{"title": "x", "score": 1}], "note": None}])
    result = await StructuredOutputEngine().run(
        provider,
        [Message("system", "s"), Message("user", "u")],
        Wrapper,
        GenerationOptions(model="m"),
        schema_name="wrapper",
    )
    assert result.attempts == 1
    assert result.value.items[0].score == 1
    assert provider.calls[0]["schema"]["additionalProperties"] is False


async def test_engine_repairs_invalid_output() -> None:
    provider = ScriptedProvider(
        [
            "not even json",
            {"items": []},  # violates min_length
            {"items": [{"title": "ok", "score": 3}], "note": "fixed"},
        ]
    )
    result = await StructuredOutputEngine().run(
        provider, [Message("user", "u")], Wrapper, GenerationOptions(model="m"), schema_name="w", max_repairs=2
    )
    assert result.attempts == 3
    assert result.value.note == "fixed"
    # repair prompts carry the precise validation errors
    last_user = provider.calls[2]["messages"][-1].content
    assert "items" in last_user and "not accepted" in last_user


async def test_engine_raises_after_max_repairs() -> None:
    provider = ScriptedProvider(["{}", "{}", "{}"])
    with pytest.raises(AIStructuredOutputError) as info:
        await StructuredOutputEngine().run(
            provider, [Message("user", "u")], Wrapper, GenerationOptions(model="m"), schema_name="w", max_repairs=2
        )
    assert info.value.details["attempts"] == 3


async def test_engine_injects_schema_for_non_native_providers() -> None:
    provider = ScriptedProvider([{"items": [{"title": "x", "score": 1}], "note": None}], native_json_schema=False)
    await StructuredOutputEngine().run(
        provider,
        [Message("system", "base"), Message("user", "u")],
        Wrapper,
        GenerationOptions(model="m"),
        schema_name="w",
    )
    system = provider.calls[0]["messages"][0].content
    assert system.startswith("base") and "JSON Schema" in system


async def test_semantic_issue_triggers_repair_then_accepts() -> None:
    provider = ScriptedProvider(
        [{"items": [{"title": "bad", "score": 1}], "note": None}, {"items": [{"title": "good", "score": 1}]}]
    )

    def validator(value: Wrapper) -> list[str]:
        return ["title must not be 'bad'"] if value.items[0].title == "bad" else []

    result = await StructuredOutputEngine().run(
        provider,
        [Message("user", "u")],
        Wrapper,
        GenerationOptions(model="m"),
        schema_name="w",
        semantic_validator=validator,
    )
    assert result.value.items[0].title == "good"
    assert result.attempts == 2
    assert result.semantic_issues == []


async def test_semantic_issue_persisting_is_accepted_with_issues() -> None:
    provider = ScriptedProvider([{"items": [{"title": "bad", "score": 1}]}] * 2)
    result = await StructuredOutputEngine().run(
        provider,
        [Message("user", "u")],
        Wrapper,
        GenerationOptions(model="m"),
        schema_name="w",
        max_repairs=1,
        semantic_validator=lambda v: ["still bad"],
    )
    assert result.value.items[0].title == "bad"
    assert result.semantic_issues == ["still bad"]
