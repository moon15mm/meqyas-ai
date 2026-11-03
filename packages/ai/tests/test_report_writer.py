"""Report writer: grounded prose around computed facts (Phase 7)."""

from __future__ import annotations

from meqyas_ai.agents import ReportWriterAgent
from meqyas_ai.providers.factory import ModelTiers
from meqyas_ai.runtime import AgentRunner
from meqyas_ai.testing import ScriptedProvider

FACTS = [
    {"id": "F1", "label": "إجابات في التحليل", "value": "64 (من أصل 70)"},
    {"id": "F2", "label": "درجة بُعد «الثقة» — القياس البعدي", "value": "75.5 / 100", "n": 35},
    {"id": "F3", "label": "تغير «المعرفة» من القياس القبلي إلى قياس المتابعة", "value": "2.33 → 3.64 (+1.31)", "n": 29},
]
SECTIONS = [
    {"key": "summary", "title": "الملخص التنفيذي", "purpose": "Summarize the results.", "max_words": 120},
    {"key": "findings", "title": "أبرز النتائج", "purpose": "Key findings.", "form": "bullets", "max_words": 120},
]
DATA = {
    "language": "ar",
    "report_type": "EXECUTIVE",
    "tone": "FORMAL",
    "project_title": "برنامج تدريبي",
    "evidence_level": "CHANGE",
    "context": [{"id": "C1", "label": "هدف المشروع", "text": "تمكين 120 معلمًا من توظيف الأدوات"}],
    "facts": FACTS,
    "sections": SECTIONS,
}


def _runner(outputs: list[object]) -> tuple[AgentRunner, ScriptedProvider]:
    provider = ScriptedProvider(outputs)  # type: ignore[arg-type]
    return AgentRunner(provider, ModelTiers(fast="f", smart="s")), provider


async def test_writer_cites_facts_and_cleans_output() -> None:
    runner, provider = _runner(
        [
            {
                "sections": [
                    {
                        "key": "findings",
                        "paragraphs": ["- **ارتفع** متوسط المعرفة من 2.33 إلى 3.64.", "• بلغت درجة الثقة 75.5 من 100."],
                        "evidence_ids": ["F3", "F2", "F3"],
                    },
                    {
                        "key": "summary",
                        "paragraphs": "شمل التحليل 64 إجابة، ويستهدف المشروع 120 معلمًا.",
                        "evidence_ids": ["F1", "C1"],
                    },
                ]
            }
        ]
    )
    result = await runner.run(ReportWriterAgent(), DATA)
    out = result.output.sections
    assert [s.key for s in out] == ["summary", "findings"]  # requested order
    assert out[0].paragraphs == ["شمل التحليل 64 إجابة، ويستهدف المشروع 120 معلمًا."]  # 120 is in the context
    assert out[0].evidence_ids == ["F1"]  # only fact ids survive
    # "bullets" form: paragraphs become bullets, list marks and markdown are stripped
    assert out[1].bullets == ["ارتفع متوسط المعرفة من 2.33 إلى 3.64.", "بلغت درجة الثقة 75.5 من 100."]
    assert out[1].evidence_ids == ["F3", "F2"]
    # Facts and context travel as untrusted data.
    user = provider.calls[0]["messages"][-1].content
    assert '<untrusted_data source="analytics_pack">' in user and '<untrusted_data source="project_context">' in user


async def test_invented_numbers_missing_sections_and_causal_claims_are_repaired() -> None:
    bad = {
        "sections": [
            {
                "key": "summary",
                "paragraphs": ["أدى البرنامج إلى رفع المعرفة بنسبة 56%."],
                "evidence_ids": ["F3", "F99"],
            }
        ]
    }
    good = {
        "sections": [
            {"key": "summary", "paragraphs": ["ارتفع متوسط المعرفة من 2.33 إلى 3.64."], "evidence_ids": ["F3"]},
            {"key": "findings", "bullets": ["درجة الثقة 75.5 من 100."], "evidence_ids": ["F2"]},
        ]
    }
    runner, provider = _runner([bad, good])
    result = await runner.run(ReportWriterAgent(), DATA)
    assert len(provider.calls) == 2
    repair = provider.calls[1]["messages"][-1].content
    assert "missing or empty" in repair and "findings" in repair
    assert "56" in repair  # the invented percentage
    assert "Causal wording" in repair
    assert "unknown evidence_ids ['F99']" in repair
    assert result.output.sections[0].paragraphs == ["ارتفع متوسط المعرفة من 2.33 إلى 3.64."]


async def test_numbers_without_citations_are_sent_back() -> None:
    uncited = {
        "sections": [
            {"key": "summary", "paragraphs": ["بلغت درجة الثقة 75.5 من 100."]},
            {"key": "findings", "bullets": ["تحسنت المعرفة بوضوح."]},
        ]
    }
    cited = {
        "sections": [
            {"key": "summary", "paragraphs": ["بلغت درجة الثقة 75.5 من 100."], "evidence_ids": ["F2"]},
            {"key": "findings", "bullets": ["تحسنت المعرفة بوضوح."], "evidence_ids": ["F3"]},
        ]
    }
    runner, provider = _runner([uncited, cited])
    result = await runner.run(ReportWriterAgent(), DATA)
    assert len(provider.calls) == 2 and "evidence_ids" in provider.calls[1]["messages"][-1].content
    assert result.output.sections[0].evidence_ids == ["F2"]


async def test_units_inline_ids_and_labels() -> None:
    wrong_unit = {
        "sections": [
            {"key": "summary", "paragraphs": ["بلغت درجة الثقة 75.5% [F2]."], "evidence_ids": ["F2"]},
            {"key": "findings", "bullets": ["النتيجة الأولى: درجة الثقة 75.5 من 100 (F2)."], "evidence_ids": ["F2"]},
        ]
    }
    fixed = {
        "sections": [
            {"key": "summary", "paragraphs": ["بلغت درجة الثقة 75.5 من 100 [F2]."], "evidence_ids": ["F2"]},
            {"key": "findings", "bullets": ["النتيجة الأولى: درجة الثقة 75.5 من 100 (F2)."], "evidence_ids": ["F2"]},
        ]
    }
    runner, provider = _runner([wrong_unit, fixed])
    result = await runner.run(ReportWriterAgent(), DATA)
    assert len(provider.calls) == 2 and "percentages" in provider.calls[1]["messages"][-1].content
    summary, findings = result.output.sections
    assert summary.paragraphs == ["بلغت درجة الثقة 75.5 من 100."]  # citation moved out of the prose
    assert findings.bullets == ["درجة الثقة 75.5 من 100."]  # label and citation stripped
