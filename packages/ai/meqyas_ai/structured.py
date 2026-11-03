"""Structured-output engine: schema → generate → validate → repair.

The JSON Schema sent to the provider is derived from the *same* Pydantic model
used for validation, so the contract has a single source of truth. We never
regex free text: only a bounded, string-aware scanner that extracts the first
balanced JSON object when a model wraps its answer in prose or code fences.
"""

from __future__ import annotations

import copy
import json
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from .errors import AIStructuredOutputError
from .providers.base import AIProvider, GenerationOptions, Message, Usage

T = TypeVar("T", bound=BaseModel)

#: JSON-Schema keywords removed for strict providers. Constraints are still
#: enforced by Pydantic after generation (and fixed through repair prompts).
_STRIP_KEYWORDS = {
    "title",
    "default",
    "examples",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minItems",
    "maxItems",
    "uniqueItems",
    "format",
    "minProperties",
    "maxProperties",
    "discriminator",
}

_MAX_SCAN_CHARS = 200_000
_MAX_ERRORS_IN_REPAIR = 15


class JSONExtractionError(ValueError):
    pass


# --------------------------------------------------------------------- schema
def to_strict_json_schema(model: type[BaseModel] | dict[str, Any]) -> dict[str, Any]:
    """Inline ``$ref``s and make every object strict (all properties required,
    no additional properties). Accepted by OpenAI strict mode, Ollama ``format``
    and Anthropic tool ``input_schema`` alike."""
    schema = model.model_json_schema() if isinstance(model, type) else copy.deepcopy(model)
    defs: dict[str, Any] = schema.get("$defs", {}) or {}

    def resolve(node: Any, depth: int = 0) -> Any:
        if depth > 40:
            raise ValueError("Schema nesting too deep (recursive model?)")
        if isinstance(node, list):
            return [resolve(item, depth + 1) for item in node]
        if not isinstance(node, dict):
            return node

        if "$ref" in node:
            name = str(node["$ref"]).rsplit("/", 1)[-1]
            target = copy.deepcopy(defs[name])
            siblings = {k: v for k, v in node.items() if k != "$ref"}
            return resolve({**target, **siblings}, depth + 1)

        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in ("$defs", "definitions") or key in _STRIP_KEYWORDS:
                continue
            if key == "properties" and isinstance(value, dict):
                out[key] = {prop: resolve(sub, depth + 1) for prop, sub in value.items()}
            else:
                out[key] = resolve(value, depth + 1)

        if "allOf" in out and len(out["allOf"]) == 1:
            inner = out.pop("allOf")[0]
            out = {**inner, **out}

        if out.get("type") == "object" or "properties" in out:
            props = out.get("properties", {})
            out["type"] = "object"
            out["properties"] = props
            out["required"] = list(props.keys())
            out["additionalProperties"] = False
        return out

    return resolve(schema)


# ----------------------------------------------------------------- extraction
def extract_json_object(text: str) -> Any:
    """Parse a JSON object from model output, tolerating code fences or prose
    around it. Raises JSONExtractionError when nothing parseable is found."""
    s = (text or "").strip()
    if not s:
        raise JSONExtractionError("empty output")
    s = s[:_MAX_SCAN_CHARS]

    try:
        value = json.loads(s)
        return _unwrap_string(value)
    except json.JSONDecodeError:
        pass

    if s.startswith("```"):
        body = s.split("\n", 1)[1] if "\n" in s else ""
        body = body.rstrip()
        if body.endswith("```"):
            body = body[:-3]
        try:
            return _unwrap_string(json.loads(body))
        except json.JSONDecodeError:
            pass

    start = s.find("{")
    while start != -1:
        depth = 0
        in_str = False
        escaped = False
        for i in range(start, len(s)):
            ch = s[i]
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = s.find("{", start + 1)
    raise JSONExtractionError("no JSON object found in output")


def _unwrap_string(value: Any) -> Any:
    # Some models double-encode: "{\"a\": 1}"
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise JSONExtractionError("output is a string, not an object") from exc
    return value


def format_validation_errors(exc: ValidationError) -> list[str]:
    lines: list[str] = []
    for err in exc.errors()[:_MAX_ERRORS_IN_REPAIR]:
        loc = ".".join(str(p) for p in err.get("loc", ())) or "(root)"
        lines.append(f"- {loc}: {err.get('msg', 'invalid')}")
    return lines


# Pydantic error types raised when a container (object/array) was expected.
_CONTAINER_ERRORS = frozenset({"model_type", "model_attributes_type", "dict_type", "list_type"})


def _set_at(data: Any, loc: Sequence[Any], value: Any) -> bool:
    target = data
    for part in loc[:-1]:
        if isinstance(target, dict) and isinstance(part, str) and part in target:
            target = target[part]
        elif isinstance(target, list) and isinstance(part, int) and 0 <= part < len(target):
            target = target[part]
        else:
            return False
    last = loc[-1] if loc else None
    if isinstance(target, dict) and isinstance(last, str) and last in target:
        target[last] = value
        return True
    if isinstance(target, list) and isinstance(last, int) and 0 <= last < len(target):
        target[last] = value
        return True
    return False


def _parent_list(data: Any, loc: Sequence[Any]) -> list[Any] | None:
    target = data
    for part in loc[:-1]:
        if isinstance(target, dict) and isinstance(part, str) and part in target:
            target = target[part]
        elif isinstance(target, list) and isinstance(part, int) and 0 <= part < len(target):
            target = target[part]
        else:
            return None
    return target if isinstance(target, list) else None


def decode_nested_json(data: Any, exc: ValidationError) -> bool:
    """Some models emit nested objects as JSON-encoded strings (``"sections": ["{\"key\":…}"]``)
    or pad arrays with empty strings. Decode the former in place and drop the latter wherever the
    schema expected a container. Returns True if anything changed."""
    changed = False
    empties: list[tuple[list[Any], int]] = []
    for err in exc.errors():
        value = err.get("input")
        loc = tuple(err.get("loc", ()))
        if err.get("type") not in _CONTAINER_ERRORS or not isinstance(value, str):
            continue
        text = value.strip()
        if not text:
            parent = _parent_list(data, loc)
            if parent is not None and loc and isinstance(loc[-1], int):
                empties.append((parent, loc[-1]))
            continue
        if text[0] not in "{[":
            continue
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            continue
        changed = _set_at(data, loc, decoded) or changed
    # Remove padding last, highest index first, so earlier locations stay valid.
    for parent, index in sorted(empties, key=lambda pair: pair[1], reverse=True):
        if 0 <= index < len(parent) and isinstance(parent[index], str) and not parent[index].strip():
            del parent[index]
            changed = True
    return changed


def validate_lenient(model: type[T], data: Any, *, max_passes: int = 3) -> T:
    """``model_validate`` plus deterministic fixes for common LLM encoding slips."""
    for _ in range(max_passes):
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            if not decode_nested_json(data, exc):
                raise
    return model.model_validate(data)


# --------------------------------------------------------------------- engine
@dataclass(slots=True)
class StructuredResult(Generic[T]):
    value: T
    attempts: int
    usage: Usage
    model: str
    provider: str
    latency_ms: int
    semantic_issues: list[str] = field(default_factory=list)


SemanticValidator = Callable[[Any], list[str]]

_SCHEMA_INSTRUCTION = (
    "Respond with ONE JSON object only — no prose, no markdown fences. It must conform to this JSON Schema:\n{schema}"
)

_REPAIR_INSTRUCTION = (
    "Your previous output was not accepted.\nProblems:\n{problems}\n\n"
    "Return the COMPLETE corrected JSON object (all fields), conforming to the schema. "
    "Return JSON only."
)


class StructuredOutputEngine:
    async def run(
        self,
        provider: AIProvider,
        messages: Sequence[Message],
        output_model: type[T],
        options: GenerationOptions,
        *,
        schema_name: str,
        max_repairs: int = 2,
        semantic_validator: SemanticValidator | None = None,
    ) -> StructuredResult[T]:
        strict_schema = to_strict_json_schema(output_model)
        convo: list[Message] = list(messages)
        if not provider.capabilities.native_json_schema:
            instruction = _SCHEMA_INSTRUCTION.format(schema=json.dumps(strict_schema, ensure_ascii=False))
            convo = _append_to_system(convo, instruction)

        started = time.perf_counter()
        usage = Usage()
        attempts = 0
        model_name = options.model
        last_problems: list[str] = []
        last_valid: T | None = None
        semantic: list[str] = []

        while attempts <= max_repairs:
            attempts += 1
            result = await provider.generate_structured(
                convo, options, schema_name=schema_name, json_schema=strict_schema
            )
            usage = usage + result.usage
            model_name = result.model or model_name
            try:
                data = extract_json_object(result.text)
                value = validate_lenient(output_model, data)
            except JSONExtractionError as exc:
                last_problems = [f"- output is not valid JSON ({exc})"]
            except ValidationError as exc:
                last_problems = format_validation_errors(exc)
            else:
                semantic = semantic_validator(value) if semantic_validator else []
                if not semantic:
                    return StructuredResult(
                        value=value,
                        attempts=attempts,
                        usage=usage,
                        model=model_name,
                        provider=provider.name,
                        latency_ms=int((time.perf_counter() - started) * 1000),
                    )
                last_valid = value
                last_problems = [f"- {issue}" for issue in semantic]

            if attempts > max_repairs:
                break
            convo = [
                *convo,
                Message("assistant", (result.text or "")[:12_000]),
                Message("user", _REPAIR_INSTRUCTION.format(problems="\n".join(last_problems))),
            ]

        if last_valid is not None:
            # Schema-valid but semantically imperfect: accept, surface the issues.
            return StructuredResult(
                value=last_valid,
                attempts=attempts,
                usage=usage,
                model=model_name,
                provider=provider.name,
                latency_ms=int((time.perf_counter() - started) * 1000),
                semantic_issues=semantic,
            )

        err = AIStructuredOutputError(
            f"Model output did not match schema '{schema_name}' after {attempts} attempt(s)",
            details={"problems": last_problems[:5], "attempts": attempts},
        )
        err.details["usage"] = {"prompt_tokens": usage.prompt_tokens, "completion_tokens": usage.completion_tokens}
        raise err


def _append_to_system(messages: list[Message], text: str) -> list[Message]:
    for idx, msg in enumerate(messages):
        if msg.role == "system":
            updated = Message("system", f"{msg.content}\n\n{text}")
            return [*messages[:idx], updated, *messages[idx + 1 :]]
    return [Message("system", text), *messages]
