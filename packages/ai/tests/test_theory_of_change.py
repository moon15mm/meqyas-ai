"""Theory of Change agent: real indicator codes only, cleaned lists."""

from __future__ import annotations

from meqyas_ai.agents import TheoryOfChangeAgent
from meqyas_ai.providers.factory import ModelTiers
from meqyas_ai.runtime import AgentRunner
from meqyas_ai.testing import ScriptedProvider

DATA = {
    "language": "ar",
    "project_title": "برنامج تدريبي في الذكاء الاصطناعي",
    "purpose": "قياس أثر البرنامج على المعلمين",
    "objectives": ["رفع المعرفة بالأدوات", "زيادة الاستخدام الفعلي في الصف"],
    "dimensions": ["المعرفة", "الاستخدام الفعلي"],
    "indicators": [
        {"code": "IND-01", "name": "متوسط درجة المعرفة", "dimension": "المعرفة"},
        {"code": "IND-04", "name": "نسبة المستخدمين أسبوعيًا", "dimension": "الاستخدام الفعلي"},
    ],
    "waves": ["القياس القبلي", "القياس البعدي"],
}


def _toc(codes: list[str]) -> dict:
    return {
        "inputs": ["مدربون متخصصون", "مدربون متخصصون", {"text": "  منصة تدريب  "}],
        "activities": ["- تنفيذ ورش تطبيقية"],
        "outputs": ["ورش منفذة"],
        "short_term_outcomes": [{"text": "ارتفاع المعرفة بالأدوات", "indicator_codes": codes[:1]}],
        "medium_term_outcomes": ["استخدام الأدوات في الدروس"],
        "long_term_impact": [{"text": "تعلم أفضل للطلاب", "indicator_codes": codes[1:]}],
        "assumptions": ["توفر الأجهزة"],
        "risks": ["ضعف الإنترنت"],
    }


async def test_unknown_codes_are_repaired_and_lists_cleaned() -> None:
    provider = ScriptedProvider([_toc(["IND-01", "IND-99"]), _toc(["IND-01", "IND-04, IND-01"])])  # type: ignore[list-item]
    runner = AgentRunner(provider, ModelTiers(fast="f", smart="s"))
    result = await runner.run(TheoryOfChangeAgent(), DATA)
    assert len(provider.calls) == 2 and "IND-99" in provider.calls[1]["messages"][-1].content
    out = result.output
    assert out.inputs == ["مدربون متخصصون", "منصة تدريب"]  # deduped, trimmed, {text} accepted
    assert out.activities == ["تنفيذ ورش تطبيقية"]
    assert (
        out.medium_term_outcomes[0].text == "استخدام الأدوات في الدروس"
        and out.medium_term_outcomes[0].indicator_codes == []
    )
    assert out.long_term_impact[0].indicator_codes == ["IND-04", "IND-01"]  # "a, b" string split
    user = provider.calls[0]["messages"][-1].content
    assert '<untrusted_data source="measurement_plan">' in user and '<item id="IND-04">' in user
