"""DEMO DATA — surveys and responses for the demo project (development only).

Three published waves (baseline, post, follow-up) of the same instrument for 40
teachers identified only by pseudonymous codes, with realistic change, attrition,
open answers and a few low-quality submissions. Deterministic (fixed seed) so
demos and screenshots are reproducible. Everything is flagged ``is_demo``.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.crypto import stable_hash
from ..core.ids import public_id
from ..domain.enums import ResponseChannel, ResponseStatus, SurveyStatus, VersionStatus, WaveType
from ..domain.survey.answers import normalize_answer
from ..domain.survey.document import SurveyDoc
from ..domain.survey.logic import compute_path, is_answered
from ..domain.survey.response_quality import assess_response
from ..models import (
    Answer,
    Dimension,
    Indicator,
    MeasurementWave,
    Organization,
    Project,
    Question,
    Respondent,
    Response,
    Survey,
    SurveyVersion,
)
from ..services.surveys import write_doc

logger = logging.getLogger("meqyas.seed")

TEACHERS = 40
SEED = 2026

LIKERT = {"min": 1, "max": 5}
MEASURES: dict[str, list[tuple[str, str, str]]] = {
    # dimension key → [(question key, indicator code, text)]
    "knowledge": [
        ("know_tools", "IND-01", "أعرف أدوات الذكاء الاصطناعي المناسبة لمادتي."),
        ("know_limits", "IND-01", "أعرف حدود أدوات الذكاء الاصطناعي ومخاطر الاعتماد عليها."),
        ("know_ethics", "IND-01", "أعرف ضوابط الاستخدام الأخلاقي لأدوات الذكاء الاصطناعي مع الطلاب."),
    ],
    "confidence": [
        ("conf_use", "IND-02", "أشعر بالثقة عند استخدام أدوات الذكاء الاصطناعي في التحضير للدروس."),
        ("conf_explain", "IND-02", "أستطيع شرح طريقة عمل أداة ذكاء اصطناعي لزميل."),
        ("conf_verify", "IND-02", "أعرف ماذا أفعل عندما تعطي الأداة نتيجة غير دقيقة."),
    ],
    "application": [
        ("apply_design", "IND-03", "أستطيع تصميم نشاط صفي يوظف أداة ذكاء اصطناعي."),
        ("apply_assess", "IND-03", "أستطيع استخدام الأدوات في إعداد أسئلة تقويم مناسبة."),
    ],
}
SECTION_TITLES = {"knowledge": "المعرفة", "confidence": "الثقة", "application": "القدرة على التطبيق"}
BASE_MEAN = {"knowledge": 2.4, "confidence": 2.7, "application": 2.2}
GAIN = {"knowledge": 1.45, "confidence": 1.2, "application": 1.35}

OPEN_POOLS = {
    "challenge": [
        "لا أعرف من أين أبدأ ولا أي أداة مناسبة لمادتي.",
        "ضيق الوقت مع كثرة الحصص.",
        "أخشى أن تعطي الأدوات معلومات غير دقيقة للطلاب.",
        "ضعف الإنترنت في بعض الفصول.",
        "لم أتلقَّ تدريبًا سابقًا على هذه الأدوات.",
        "قلقي من استخدام الطلاب لها في الغش.",
        "صعوبة كتابة الأوامر المناسبة للحصول على نتائج جيدة.",
    ],
    "best_part": [
        "الأمثلة العملية على تحضير الدروس كانت مفيدة جدًا.",
        "تعلمت كتابة أوامر واضحة للحصول على نتائج أدق.",
        "ورشة تصميم الأنشطة الصفية.",
        "تبادل التجارب مع الزملاء من تخصصات مختلفة.",
        "معرفة كيفية التحقق من صحة ما تنتجه الأدوات.",
    ],
    "suggestion": [
        "زيادة وقت التطبيق العملي داخل الورش.",
        "توفير أدلة مختصرة لكل مادة دراسية.",
        "متابعة بعد البرنامج مع المدرب لمدة شهر.",
        "تقسيم المتدربين حسب التخصص.",
        "مدة البرنامج قصيرة مقارنة بكثافة المحتوى.",
    ],
    "example_use": [
        "أعددت بنك أسئلة لوحدة الكسور باستخدام الأداة ثم راجعته بنفسي.",
        "صممت نشاطًا يحلل فيه الطلاب نصًا ويقارنونه بإجابة الأداة.",
        "استخدمتها في إعداد خطط علاجية للطلاب المتأخرين.",
        "أنشأت أمثلة إضافية لدرس القواعد بمستويات مختلفة.",
        "لخصت مقالًا علميًا لطلاب الصف الثالث بلغة مبسطة.",
    ],
    "barrier": [
        "الوقت ما زال التحدي الأكبر.",
        "ضعف الإنترنت في المدرسة.",
        "عدم وضوح سياسة المدرسة في استخدام الأدوات.",
        "أحتاج إلى أمثلة أكثر في تخصصي.",
    ],
}


def _likert(key: str, text: str, dims: dict[str, str], inds: dict[str, str], dim: str, code: str) -> dict[str, Any]:
    return {
        "key": key,
        "type": "LIKERT",
        "text": text,
        "required": True,
        "dimension_id": dims.get(dim),
        "indicator_id": inds.get(code),
        "scale": LIKERT,
    }


def build_doc(wave: WaveType, dims: dict[str, str], inds: dict[str, str]) -> SurveyDoc:
    titles = {
        WaveType.BASELINE: "القياس القبلي — برنامج الذكاء الاصطناعي للمعلمين",
        WaveType.POST: "القياس البعدي — برنامج الذكاء الاصطناعي للمعلمين",
        WaveType.FOLLOW_UP: "قياس المتابعة بعد 30 يومًا — برنامج الذكاء الاصطناعي",
    }
    sections: list[dict[str, Any]] = [
        {
            "key": "profile",
            "title": "معلومات عامة",
            "questions": [
                {
                    "key": "specialty",
                    "type": "SINGLE_CHOICE",
                    "text": "ما تخصصك؟",
                    "required": True,
                    "settings": {"is_profile": True},
                    "options": [
                        {"value": "science", "label": "علوم"},
                        {"value": "math", "label": "رياضيات"},
                        {"value": "arabic", "label": "لغة عربية"},
                        {"value": "english", "label": "لغة إنجليزية"},
                        {"value": "other", "label": "أخرى"},
                    ],
                },
                {
                    "key": "experience",
                    "type": "SINGLE_CHOICE",
                    "text": "سنوات الخبرة في التدريس",
                    "required": True,
                    "settings": {"is_profile": True},
                    "options": [
                        {"value": "lt5", "label": "أقل من 5 سنوات"},
                        {"value": "5to10", "label": "من 5 إلى 10 سنوات"},
                        {"value": "gt10", "label": "أكثر من 10 سنوات"},
                    ],
                },
            ],
        }
    ]
    for dim, items in MEASURES.items():
        sections.append(
            {
                "key": f"sec_{dim}",
                "title": SECTION_TITLES[dim],
                "questions": [_likert(k, text, dims, inds, dim, code) for k, code, text in items],
            }
        )
    sections.append(
        {
            "key": "sec_use",
            "title": "الاستخدام الفعلي",
            "questions": [
                {
                    "key": "use_freq",
                    "type": "SINGLE_CHOICE",
                    "text": "كم مرة استخدمت أدوات الذكاء الاصطناعي في عملك خلال الأسبوعين الماضيين؟",
                    "required": True,
                    "dimension_id": dims.get("actual_use"),
                    "indicator_id": inds.get("IND-04"),
                    "options": [
                        {"value": "1", "label": "لم أستخدمها", "score": 1},
                        {"value": "2", "label": "مرة أو مرتين", "score": 2},
                        {"value": "3", "label": "مرة أسبوعيًا تقريبًا", "score": 3},
                        {"value": "4", "label": "عدة مرات أسبوعيًا", "score": 4},
                    ],
                }
            ],
        }
    )
    logic: list[dict[str, Any]] = []
    if wave == WaveType.BASELINE:
        open_q = [("challenge", "ما أكبر تحدٍّ يواجهك في استخدام أدوات الذكاء الاصطناعي حاليًا؟")]
    elif wave == WaveType.POST:
        sections.append(
            {
                "key": "sec_satisfaction",
                "title": "الرضا عن البرنامج",
                "questions": [
                    {
                        "key": "sat_overall",
                        "type": "CSAT",
                        "text": "ما مدى رضاك عن البرنامج التدريبي بشكل عام؟",
                        "required": True,
                        "scale": {"min": 1, "max": 5, "min_label": "غير راضٍ إطلاقًا", "max_label": "راضٍ جدًا"},
                        "dimension_id": dims.get("satisfaction"),
                        "indicator_id": inds.get("IND-05"),
                    },
                    {"key": "why_low", "type": "LONG_TEXT", "text": "ما الذي جعل تقييمك منخفضًا؟"},
                    {
                        "key": "recommend",
                        "type": "NPS",
                        "text": "ما مدى احتمال أن توصي زملاءك بالبرنامج؟",
                        "required": True,
                        "dimension_id": dims.get("satisfaction"),
                    },
                ],
            }
        )
        logic.append(
            {
                "id": "r_why_low",
                "type": "DISPLAY",
                "target_key": "why_low",
                "condition": {"question": "sat_overall", "op": "lte", "value": 2},
            }
        )
        open_q = [
            ("best_part", "ما أكثر ما استفدت منه في البرنامج؟"),
            ("suggestion", "ما الذي تقترحه لتحسين البرنامج؟"),
        ]
    else:
        open_q = [
            ("example_use", "اذكر مثالًا على استخدام فعلي للأدوات بعد البرنامج."),
            ("barrier", "ما الذي يعيقك عن الاستخدام أكثر؟"),
        ]
    sections.append(
        {
            "key": "sec_open",
            "title": "أسئلة مفتوحة",
            "questions": [{"key": k, "type": "LONG_TEXT", "text": t} for k, t in open_q],
        }
    )
    return SurveyDoc.model_validate(
        {
            "title": titles[wave],
            "introduction": "يهدف هذا الاستبيان إلى قياس أثر برنامج الذكاء الاصطناعي للمعلمين. يستغرق نحو 5 دقائق، "
            "وإجاباتك سرية وتُحلَّل مجمّعة فقط.",
            "thank_you_message": "شكرًا لمشاركتك.",
            "language": "ar",
            "sections": sections,
            "logic": logic,
            "settings": {
                "anonymity_mode": "PSEUDONYMOUS",
                "collect_respondent_code": True,
                "show_progress": True,
            },
        }
    )


def _clamp(value: float, lo: int, hi: int) -> int:
    return int(max(lo, min(hi, round(value))))


def _answers(wave: WaveType, rng: random.Random, traits: dict[str, float], junk: bool) -> dict[str, Any]:
    ability, gain, retention = traits["ability"], traits["gain"], traits["retention"]
    shift = {WaveType.BASELINE: 0.0, WaveType.POST: 1.0, WaveType.FOLLOW_UP: 1.0}[wave]
    answers: dict[str, Any] = {"specialty": traits["specialty"], "experience": traits["experience"]}
    for dim, items in MEASURES.items():
        level = BASE_MEAN[dim] + ability + shift * gain * GAIN[dim]
        if wave == WaveType.FOLLOW_UP:
            level += retention
        for key, _, _ in items:
            answers[key] = 5 if junk else _clamp(level + rng.gauss(0, 0.55), 1, 5)
    use = 1.5 + 0.7 * ability + {WaveType.BASELINE: 0, WaveType.POST: 0.9, WaveType.FOLLOW_UP: 1.15}[wave]
    answers["use_freq"] = str(_clamp(use + rng.gauss(0, 0.5), 1, 4))
    if wave == WaveType.POST:
        answers["sat_overall"] = 5 if junk else _clamp(4.0 + 0.45 * ability + rng.gauss(0, 0.6), 1, 5)
        answers["recommend"] = _clamp(8.0 + 1.4 * ability + rng.gauss(0, 1.4), 0, 10)
        if answers["sat_overall"] <= 2:
            answers["why_low"] = rng.choice(OPEN_POOLS["suggestion"])
    pools = {
        WaveType.BASELINE: ["challenge"],
        WaveType.POST: ["best_part", "suggestion"],
        WaveType.FOLLOW_UP: ["example_use", "barrier"],
    }[wave]
    for key in pools:
        if junk:
            answers[key] = "...."
        elif rng.random() < 0.75:
            answers[key] = rng.choice(OPEN_POOLS[key])
    return answers


async def seed_demo_surveys(session: AsyncSession, org: Organization) -> None:
    project = await session.scalar(
        # the original demo project (the customer-experience demo is seeded after it)
        select(Project)
        .where(Project.organization_id == org.id, Project.is_demo.is_(True))
        .order_by(Project.created_at)
        .limit(1)
    )
    if project is None:
        return
    existing = await session.scalar(select(func.count()).select_from(Survey).where(Survey.project_id == project.id))
    if existing:
        return
    logger.info("seeding DEMO surveys and responses")
    dims = {
        d.key: str(d.id)
        for d in (await session.scalars(select(Dimension).where(Dimension.project_id == project.id))).all()
    }
    inds = {
        i.code: str(i.id)
        for i in (await session.scalars(select(Indicator).where(Indicator.project_id == project.id))).all()
    }
    waves = {
        w.wave_type: w
        for w in (await session.scalars(select(MeasurementWave).where(MeasurementWave.project_id == project.id))).all()
    }
    rng = random.Random(SEED)  # noqa: S311 - deterministic demo data, not security
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    timing = {WaveType.BASELINE: 45, WaveType.POST: 35, WaveType.FOLLOW_UP: 4}
    participants = {WaveType.BASELINE: TEACHERS, WaveType.POST: TEACHERS - 4, WaveType.FOLLOW_UP: TEACHERS - 10}
    low_quality = {WaveType.POST: {7}, WaveType.FOLLOW_UP: {19}}

    teachers = []
    for i in range(1, TEACHERS + 1):
        code = f"T{i:02d}"
        teachers.append(
            {
                "code": code,
                "ability": rng.gauss(0, 0.45),
                "gain": max(0.2, rng.gauss(1.0, 0.35)),
                "retention": rng.gauss(-0.12, 0.2),
                "specialty": rng.choice(["science", "math", "arabic", "english", "other"]),
                "experience": rng.choice(["lt5", "5to10", "5to10", "gt10"]),
            }
        )
    respondents: dict[str, Respondent] = {}
    for t in teachers:
        digest = stable_hash(f"{project.id}:{t['code']}", purpose="respondent-code")
        respondent = Respondent(
            organization_id=org.id,
            project_id=project.id,
            code_hash=digest,
            label=f"R-{digest[:6].upper()}",
            is_demo=True,
        )
        session.add(respondent)
        respondents[t["code"]] = respondent
    await session.flush()

    for wave_type in (WaveType.BASELINE, WaveType.POST, WaveType.FOLLOW_UP):
        wave = waves.get(wave_type)
        doc = build_doc(wave_type, dims, inds)
        survey = Survey(
            organization_id=org.id,
            project_id=project.id,
            wave_id=wave.id if wave else None,
            title=doc.title,
            status=SurveyStatus.PUBLISHED if wave_type == WaveType.FOLLOW_UP else SurveyStatus.CLOSED,
            public_id=public_id(),
            language="ar",
            is_demo=True,
        )
        session.add(survey)
        await session.flush()
        published_at = now - timedelta(days=timing[wave_type] + 1)
        version = SurveyVersion(
            organization_id=org.id,
            survey_id=survey.id,
            version_number=1,
            status=VersionStatus.PUBLISHED,
            title=doc.title,
            language="ar",
            published_at=published_at,
        )
        session.add(version)
        await session.flush()
        await write_doc(session, survey, version, doc)
        survey.current_version_id = version.id
        survey.published_version_id = version.id
        await session.flush()

        rows = {
            key: (qid, lineage)
            for key, qid, lineage in (
                await session.execute(
                    select(Question.key, Question.id, Question.lineage_id).where(
                        Question.survey_version_id == version.id
                    )
                )
            ).all()
        }
        qmap = doc.question_map()
        for index, t in enumerate(teachers[: participants[wave_type]], start=1):
            junk = index in low_quality.get(wave_type, set())
            answers = _answers(wave_type, rng, t, junk)
            visible = compute_path(doc, answers).visible
            answers = {k: v for k, v in answers.items() if k in visible and is_answered(v)}
            expected = 60 + 8 * len(answers)
            duration = 25 if junk else int(expected * rng.uniform(1.1, 2.6))
            completed = now - timedelta(days=timing[wave_type]) + timedelta(minutes=rng.randint(0, 72 * 60))
            quality = assess_response(
                doc, answers, visible_keys=[k for k in visible if qmap[k].answerable], duration_seconds=duration
            )
            response = Response(
                organization_id=org.id,
                project_id=project.id,
                survey_id=survey.id,
                survey_version_id=version.id,
                wave_id=survey.wave_id,
                respondent_id=respondents[t["code"]].id,
                session_id=uuid.uuid4().hex,
                status=ResponseStatus.COMPLETED,
                started_at=completed - timedelta(seconds=duration),
                completed_at=completed,
                duration_seconds=duration,
                channel=ResponseChannel.DEMO,
                locale="ar",
                device=rng.choice(["mobile", "mobile", "desktop", "tablet"]),
                answered_count=len(answers),
                quality_score=quality.score,
                quality_status=quality.status,
                quality_flags=quality.flags,
                is_demo=True,
                created_at=completed,
            )
            session.add(response)
            await session.flush()
            for key, value in answers.items():
                qid, lineage = rows[key]
                for row in normalize_answer(qmap[key], value):
                    session.add(
                        Answer(
                            organization_id=org.id,
                            response_id=response.id,
                            survey_id=survey.id,
                            question_id=qid,
                            question_key=key,
                            lineage_id=lineage,
                            row_key=row.row_key,
                            value=row.value,
                            numeric_value=row.numeric_value,
                            text_value=row.text_value,
                            created_at=completed,
                        )
                    )
    await session.commit()
