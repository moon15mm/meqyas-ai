"""Survey logic engine (SURVEY_ENGINE.md §4).

Identical semantics in TypeScript (packages/shared/src/survey/logic.ts);
parity is enforced by tests/fixtures/logic-cases.json, executed by both
test suites.

Rules
- Conditions: {"all": [...]}, {"any": [...]}, {"not": {...}} or a leaf
  {"question": key, "op": op, "value": v, "row"?: matrix_row_key}.
- Unanswered values never satisfy comparisons (only ``not_answered``),
  negative operators included.
- DISPLAY rules: a target (question or section) is shown only if ALL its
  display rules hold.
- SKIP rules: evaluated after a visible question, in order; the first match
  jumps FORWARD to a question or section. END rules finish the survey.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from ..enums import QuestionType
from .document import ANSWERABLE_TYPES, CHOICE_TYPES, LogicRuleDoc, QuestionDoc, SurveyDoc

OPERATORS = frozenset(
    {"eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "contains", "not_contains", "answered", "not_answered"}
)
VALUELESS_OPS = frozenset({"answered", "not_answered"})
NUMERIC_OPS = frozenset({"gt", "gte", "lt", "lte"})
MAX_CONDITION_DEPTH = 6
MAX_CONDITION_LEAVES = 50

PIPE_RE = re.compile(r"\{\{\s*answer:([a-z][a-z0-9_]{0,59})\s*\}\}")

Answers = Mapping[str, Any]


# --------------------------------------------------------------- primitives
def is_answered(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, list | dict | tuple):
        return len(value) > 0
    return True


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _eq(a: Any, b: Any) -> bool:
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return na == nb
    return str(a) == str(b)


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list | tuple):
        return list(value)
    return [value]


def _compare(op: str, value: Any, expected: Any) -> bool:
    a, b = _num(value), _num(expected)
    if a is None or b is None:
        return False
    if op == "gt":
        return a > b
    if op == "gte":
        return a >= b
    if op == "lt":
        return a < b
    return a <= b


# ---------------------------------------------------------------- evaluate
def evaluate(condition: Mapping[str, Any] | None, answers: Answers) -> bool:
    """Evaluate a condition tree. An empty condition is always true."""
    if not condition:
        return True
    if "all" in condition:
        return all(evaluate(c, answers) for c in condition.get("all") or [])
    if "any" in condition:
        return any(evaluate(c, answers) for c in condition.get("any") or [])
    if "not" in condition:
        return not evaluate(condition.get("not") or {}, answers)

    op = condition.get("op")
    expected = condition.get("value")
    value = answers.get(str(condition.get("question", "")))
    row = condition.get("row")
    if row is not None:
        value = value.get(str(row)) if isinstance(value, dict) else None

    if op == "answered":
        return is_answered(value)
    if op == "not_answered":
        return not is_answered(value)
    if not is_answered(value):
        return False

    if isinstance(value, list | tuple):
        items = list(value)
        if op in ("eq", "contains"):
            return any(_eq(v, expected) for v in items)
        if op in ("neq", "not_contains"):
            return not any(_eq(v, expected) for v in items)
        if op == "in":
            return any(_eq(v, e) for v in items for e in _as_list(expected))
        if op == "not_in":
            return not any(_eq(v, e) for v in items for e in _as_list(expected))
        if op in NUMERIC_OPS:  # number of selected options
            return _compare(op, len(items), expected)
        return False

    if isinstance(value, dict):
        return False
    if op == "eq":
        return _eq(value, expected)
    if op == "neq":
        return not _eq(value, expected)
    if op == "in":
        return any(_eq(value, e) for e in _as_list(expected))
    if op == "not_in":
        return not any(_eq(value, e) for e in _as_list(expected))
    if op in NUMERIC_OPS:
        return _compare(op, value, expected)
    if op == "contains":
        return str(expected).lower() in str(value).lower()
    if op == "not_contains":
        return str(expected).lower() not in str(value).lower()
    return False


def condition_questions(condition: Mapping[str, Any] | None) -> list[str]:
    """All question keys referenced by a condition tree."""
    keys: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, Mapping):
            return
        for group in ("all", "any"):
            if group in node:
                for child in node.get(group) or []:
                    walk(child)
                return
        if "not" in node:
            walk(node.get("not"))
            return
        if node.get("question"):
            keys.append(str(node["question"]))

    walk(condition)
    return keys


# -------------------------------------------------------------------- path
@dataclass(slots=True)
class PathResult:
    #: Question keys on the respondent's path that are visible, in order.
    visible: list[str] = field(default_factory=list)
    #: Key of the question whose END rule fired (None if the survey ran to completion).
    ended_by: str | None = None

    def is_visible(self, key: str) -> bool:
        return key in self.visible


def _group_rules(rules: Iterable[LogicRuleDoc]) -> tuple[dict[str, list[LogicRuleDoc]], ...]:
    display: dict[str, list[LogicRuleDoc]] = defaultdict(list)
    skip: dict[str, list[LogicRuleDoc]] = defaultdict(list)
    end: dict[str, list[LogicRuleDoc]] = defaultdict(list)
    for rule in rules:
        if not rule.enabled:
            continue
        if rule.type == "DISPLAY" and rule.target_key:
            display[rule.target_key].append(rule)
        elif rule.type == "SKIP" and rule.source_key and rule.target_key:
            skip[rule.source_key].append(rule)
        elif rule.type == "END" and rule.source_key:
            end[rule.source_key].append(rule)
    return display, skip, end


def compute_path(doc: SurveyDoc, answers: Answers) -> PathResult:
    display, skip, end = _group_rules(doc.logic)
    order = doc.order()
    index = {q: i for i, (_, q) in enumerate(order)}
    section_first: dict[str, int] = {}
    section_after: dict[str, int] = {}
    for i, (s, _) in enumerate(order):
        section_first.setdefault(s, i)
        section_after[s] = i + 1

    def shown(key: str) -> bool:
        return all(evaluate(r.condition, answers) for r in display.get(key, []))

    result = PathResult()
    i = 0
    while i < len(order):
        section_key, key = order[i]
        if not shown(section_key):
            i = section_after[section_key]
            continue
        if shown(key):
            result.visible.append(key)
            if any(evaluate(r.condition, answers) for r in end.get(key, [])):
                result.ended_by = key
                return result
            jump: int | None = None
            for rule in skip.get(key, []):
                if evaluate(rule.condition, answers):
                    target = rule.target_key or ""
                    j = index.get(target, section_first.get(target))
                    if j is not None and j > i:
                        jump = j
                        break
            if jump is not None:
                i = jump
                continue
        i += 1
    return result


# ------------------------------------------------------------------ piping
def display_value(question: QuestionDoc | None, value: Any, language: str = "ar") -> str:
    if question is None or not is_answered(value):
        return ""
    labels = {o.value: o.label for o in question.options}
    if isinstance(value, list | tuple):
        sep = "، " if language == "ar" else ", "
        return sep.join(labels.get(str(v), str(v)) for v in value)
    if isinstance(value, dict):
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return labels.get(str(value), str(value))


def pipe(text: str, doc: SurveyDoc, answers: Answers) -> str:
    """Replace {{answer:key}} with the (plain-text) answer label."""
    if "{{" not in text:
        return text
    qmap = doc.question_map()
    return PIPE_RE.sub(lambda m: display_value(qmap.get(m.group(1)), answers.get(m.group(1)), doc.language), text)


# -------------------------------------------------------------- validation
@dataclass(frozen=True, slots=True)
class LogicIssue:
    rule_index: int
    rule_id: str | None
    code: str
    message: str


def _validate_condition(
    condition: Any,
    qmap: Mapping[str, QuestionDoc],
    *,
    depth: int = 0,
    counter: list[int] | None = None,
) -> list[tuple[str, str]]:
    counter = counter if counter is not None else [0]
    problems: list[tuple[str, str]] = []
    if not isinstance(condition, Mapping):
        return [("invalid_condition", "condition must be an object")]
    if depth > MAX_CONDITION_DEPTH:
        return [("condition_too_deep", "condition is nested too deeply")]
    for group in ("all", "any"):
        if group in condition:
            children = condition.get(group)
            if not isinstance(children, list) or not children:
                return [("empty_group", f"'{group}' needs at least one condition")]
            for child in children:
                problems += _validate_condition(child, qmap, depth=depth + 1, counter=counter)
            return problems
    if "not" in condition:
        return _validate_condition(condition.get("not"), qmap, depth=depth + 1, counter=counter)

    counter[0] += 1
    if counter[0] > MAX_CONDITION_LEAVES:
        return [("condition_too_large", "too many conditions")]
    key = condition.get("question")
    op = condition.get("op")
    question = qmap.get(str(key)) if key else None
    if question is None:
        return [("unknown_question", f"condition references unknown question '{key}'")]
    if question.type not in ANSWERABLE_TYPES:
        return [("not_answerable", f"question '{key}' does not collect answers")]
    if op not in OPERATORS:
        return [("unknown_operator", f"unknown operator '{op}'")]
    if op not in VALUELESS_OPS and "value" not in condition:
        problems.append(("missing_value", f"operator '{op}' needs a value"))
    row = condition.get("row")
    if question.type == QuestionType.MATRIX:
        rows = {r.key for r in question.settings.rows}
        if row is not None and str(row) not in rows:
            problems.append(("unknown_row", f"matrix '{key}' has no row '{row}'"))
    if question.type in CHOICE_TYPES and op in ("eq", "neq", "in", "not_in", "contains", "not_contains"):
        valid = {o.value for o in question.options}
        for v in _as_list(condition.get("value")):
            if str(v) not in valid:
                problems.append(("unknown_option", f"question '{key}' has no option '{v}'"))
    return problems


def validate_logic(doc: SurveyDoc) -> list[LogicIssue]:
    qmap = doc.question_map()
    order = doc.order()
    index = {q: i for i, (_, q) in enumerate(order)}
    sections = {s.key: s for s in doc.sections}
    section_first: dict[str, int] = {}
    question_section: dict[str, str] = {}
    for i, (s, q) in enumerate(order):
        section_first.setdefault(s, i)
        question_section[q] = s

    issues: list[LogicIssue] = []

    def add(i: int, rule: LogicRuleDoc, code: str, message: str) -> None:
        issues.append(LogicIssue(rule_index=i, rule_id=rule.id, code=code, message=message))

    def position(key: str) -> int | None:
        if key in index:
            return index[key]
        return section_first.get(key)

    for i, rule in enumerate(doc.logic):
        if rule.condition:  # an empty condition means "always"
            for code, message in _validate_condition(rule.condition, qmap):
                add(i, rule, code, message)
        referenced = condition_questions(rule.condition)

        if rule.type == "DISPLAY":
            target = rule.target_key or ""
            if target not in qmap and target not in sections:
                add(i, rule, "unknown_target", f"display target '{target}' does not exist")
                continue
            if target in referenced:
                add(i, rule, "self_reference", "a question cannot depend on itself")
            target_pos = position(target)
            if target_pos is not None:
                for ref in referenced:
                    ref_pos = index.get(ref)
                    if ref_pos is not None and ref_pos >= target_pos:
                        add(i, rule, "forward_reference", f"display logic must depend on earlier questions ('{ref}')")
        elif rule.type in ("SKIP", "END"):
            source = rule.source_key or ""
            if source not in qmap:
                add(i, rule, "unknown_source", f"rule source '{source}' does not exist")
                continue
            source_pos = index[source]
            for ref in referenced:
                ref_pos = index.get(ref)
                if ref_pos is not None and ref_pos > source_pos:
                    add(i, rule, "forward_reference", f"condition uses a later question ('{ref}')")
            if rule.type == "SKIP":
                target = rule.target_key or ""
                target_pos = position(target)
                if target_pos is None:
                    add(i, rule, "unknown_target", f"skip target '{target}' does not exist")
                elif target_pos <= source_pos:
                    add(i, rule, "backward_skip", "skip logic can only jump forward")
                elif target in qmap and sections[question_section[target]].randomize_questions:
                    add(i, rule, "randomized_target", "cannot skip to a question inside a randomized section")
        elif rule.type == "QUOTA":
            if not rule.condition:
                add(i, rule, "empty_condition", "a quota needs a condition")
            if not rule.limit:
                add(i, rule, "missing_limit", "a quota needs a limit")
    return issues
