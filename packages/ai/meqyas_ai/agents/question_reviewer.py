"""Question Reviewer — detects item-writing problems and proposes fixes."""

from __future__ import annotations

import re

from ..guard import UNTRUSTED_NOTICE, UntrustedItem, envelope
from ..providers.base import Message
from ..schemas.survey import ReviewerInput, ReviewIssueOut, ReviewOutput
from .base import Agent

SYSTEM_PROMPT = (
    """\
You are "Question Reviewer", a senior survey methodologist at MEQYAS AI (مِقياس AI). Review survey items \
before they are published and report only REAL problems that would harm measurement quality.

Problem types:
- DOUBLE_BARRELED: asks about two things at once (e.g. «المحتوى والمدرب كانا ممتازين»).
- LEADING: wording pushes toward an answer («ألا تعتقد…», «كم أعجبك…»).
- AMBIGUOUS: vague terms, unclear time frame or referent, jargon the population would not understand.
- TOO_LONG: hard to read in one pass (roughly > 25 words) or unnecessarily complex.
- BIASED: loaded, emotional, social-desirability or assumption-laden wording.
- DUPLICATE: measures the same thing as another item with near-identical wording.
- IRRELEVANT: does not serve the survey's measurement purpose.
- MISSING_OPTIONS: options not exhaustive / not mutually exclusive / no "other" or "none" when needed.
- WRONG_SCALE: answer format does not fit the question (e.g. agreement scale for a frequency question, \
unbalanced or unlabeled scale).

For each issue give: problem (المشكلة, one sentence), reason (السبب: why it harms measurement), and fix:
- REWRITE: suggestion = the COMPLETE improved question text ready to replace the original (same intent and \
language; for DOUBLE_BARRELED rewrite the first idea only and mention the split in reason).
- OPTIONS: suggested_options = the complete corrected option list (MISSING_OPTIONS / WRONG_SCALE); \
suggestion = improved question text or empty.
- REMOVE: the item should be deleted (typically DUPLICATE / IRRELEVANT); suggestion empty; say in reason \
which item to keep.
suggestion is inserted verbatim into the survey: never write advice or instructions in it.
Severity: HIGH = would invalidate the item, MEDIUM = likely bias/confusion, LOW = polish.
Do not invent problems: well-written items get no issue. At most one issue per item (the most important).
Write problem/reason/suggestion in the survey language. question_key must be one of the provided keys.
"""
    + UNTRUSTED_NOTICE
)

# Suggestions that read like advice («احذف…», "Consider…") cannot replace question text.
_ADVICE = re.compile(
    r"^\s*(احذف|احذفي|ادمج|ادمجي|استبدل|أضف|اضف|قسّم|ننصح|نقترح|remove|delete|merge|replace|split|consider)(\s|$)",
    re.IGNORECASE,
)


# Models sometimes append the options to the text: «النص؟ | الخيارات: أ، ب، ج».
_INLINE_OPTIONS = re.compile(r"\s*[|｜]\s*(?:الخيارات|الخيارات المقترحة|options)\s*[:：]\s*(.+)$", re.IGNORECASE)


def _normalize_fix(issue: ReviewIssueOut) -> ReviewIssueOut:
    """Make the proposed fix actionable and safe to apply verbatim."""
    suggestion = issue.suggestion.strip()
    suggested_options = list(issue.suggested_options)
    inline = _INLINE_OPTIONS.search(suggestion)
    if inline:
        if not suggested_options:
            suggested_options = [o.strip() for o in re.split(r"[،,؛;/]", inline.group(1)) if o.strip()]
        suggestion = suggestion[: inline.start()].strip()
        issue = issue.model_copy(update={"suggested_options": suggested_options})
    usable_text = bool(suggestion) and not _ADVICE.match(suggestion)
    fix = issue.fix
    if fix == "REMOVE":
        return issue.model_copy(update={"suggestion": "", "suggested_options": []})
    if inline and fix == "REWRITE" and len(suggested_options) >= 2:
        fix = "OPTIONS"
    if fix == "REWRITE" and not usable_text:
        fix = "OPTIONS" if len(issue.suggested_options) >= 2 else "NONE"
    if fix == "OPTIONS" and len(issue.suggested_options) < 2:
        fix = "REWRITE" if usable_text else "NONE"
    if fix == "OPTIONS" and suggestion and not usable_text:
        suggestion = ""
    return issue.model_copy(update={"fix": fix, "suggestion": suggestion})


class QuestionReviewerAgent(Agent[ReviewerInput, ReviewOutput, ReviewOutput]):
    name = "question_reviewer"
    prompt_version = "2026-10-09.3"
    input_model = ReviewerInput
    output_model = ReviewOutput
    tier = "smart"
    temperature = 0.2
    max_output_tokens = 6000
    max_repairs = 1
    cache_ttl_s = 3600

    def build_messages(self, data: ReviewerInput) -> list[Message]:
        items = [
            UntrustedItem(
                id=q.key,
                text=(
                    f"[{q.type}] {q.text}"
                    + (f" | options: {' / '.join(q.options)}" if q.options else "")
                    + (f" | rows: {' / '.join(q.rows)}" if q.rows else "")
                    + (f" | scale: {q.scale}" if q.scale else "")
                    + (f" | dimension: {q.dimension}" if q.dimension else "")
                ),
            )
            for q in data.questions
        ]
        user = "\n\n".join(
            [
                f"Survey language: {'Arabic' if data.language == 'ar' else 'English'}",
                f"Target population: {data.target_population or '—'}",
                f"Measurement type: {data.measurement_type or '—'}",
                "Items to review (the id attribute is the question_key):",
                envelope(items, source="survey_questions", max_item_chars=1200),
                "Return the review JSON now.",
            ]
        )
        return [Message("system", SYSTEM_PROMPT), Message("user", user)]

    def post_process(self, data: ReviewerInput, output: ReviewOutput) -> ReviewOutput:
        keys = {q.key for q in data.questions}
        seen: set[str] = set()
        issues: list[ReviewIssueOut] = []
        for issue in output.issues:
            if issue.question_key not in keys or issue.question_key in seen:
                continue
            seen.add(issue.question_key)
            issues.append(_normalize_fix(issue))
        return output.model_copy(update={"issues": issues})
