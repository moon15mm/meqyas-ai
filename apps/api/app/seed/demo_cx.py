"""DEMO DATA — a retail chain's customer-experience project (development only).

Three branches and ten weeks of visits rated with the pulse «قيّم زيارتك» survey (a QR code at
the till and a tablet by the exit), plus the follow-up cases their low scores opened. Staff
courtesy drives loyalty most and one branch has slow checkouts until it adds a cashier in week
seven (and a cashier off sick in the last day and a half), so the key-driver matrix, the branch
comparison, the weekly trend and the follow-up queue all have something true to show.
Deterministic (fixed seed); everything is flagged ``is_demo`` and no real person is in it
(follow-up phone numbers are fictitious 05000… numbers).
"""

from __future__ import annotations

import json
import logging
import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.crypto import encrypt
from ..core.ids import public_id
from ..domain.enums import (
    CaseStatus,
    LocationKind,
    MeasurementType,
    ProjectStatus,
    ResponseChannel,
    ResponseStatus,
    Sector,
    SurveyStatus,
    VersionStatus,
)
from ..domain.survey.answers import normalize_answer
from ..domain.survey.logic import compute_path, is_answered
from ..domain.survey.response_quality import assess_response
from ..domain.survey.templates import store_visit
from ..models import (
    Answer,
    CxCase,
    Organization,
    OrganizationMember,
    Project,
    Question,
    Response,
    StoreLocation,
    Survey,
    SurveyVersion,
)
from ..services.cx import SLA_HOURS, case_trigger, contact_keys
from ..services.locations import location_meta
from ..services.surveys import write_doc

logger = logging.getLogger("meqyas.seed")

SEED = 2027
WEEKS = 10
TITLE = "تجربة عملاء متاجر الريحان (تجريبي)"
#: code, name, city, staff offset, checkout offset before / after the extra cashier (week 7).
BRANCHES = [
    ("B01", "فرع العليا", "الرياض", 0.3, (0.1, 0.1)),
    ("B02", "فرع الحمراء", "جدة", -0.15, (-1.0, -0.2)),
    ("B03", "فرع الكورنيش", "الخبر", 0.0, (-0.3, -0.3)),
]
CASHIER_WEEK = 7
#: Checkout offset at «فرع الحمراء» during the last day and a half (a cashier off sick).
RUSH_CHECKOUT = -1.8

IMPROVE = {
    "staff": ["لم أجد موظفًا يساعدني في الممر.", "تعامل أحد الموظفين لم يكن لطيفًا."],
    "checkout": [
        "الانتظار عند المحاسب طويل.",
        "كاشير واحد فقط وقت الذروة والطابور طويل.",
        "نحتاج مسارًا سريعًا للمشتريات القليلة.",
    ],
    "availability": ["بعض المنتجات التي أبحث عنها غير متوفرة.", "الرفوف شبه فارغة مساء الخميس."],
    "value": ["الأسعار أعلى من المتاجر القريبة.", "العروض قليلة مقارنة بالسابق."],
    "cleanliness": ["المواقف تحتاج تنظيفًا.", "الممرات مزدحمة بالكراتين."],
}
PRAISE = [
    "الموظفون متعاونون جدًا.",
    "الفرع نظيف ومرتب.",
    "وجدت كل ما أحتاجه بسرعة.",
    "خدمة سريعة وابتسامة دائمة.",
    "العروض الأسبوعية ممتازة.",
]
RESOLUTIONS = [
    "اتصلنا بالعميل واعتذرنا، وأضفنا كاشيرًا في وقت الذروة.",
    "تواصلنا مع العميل وحجزنا له المنتج في الشحنة القادمة.",
    "شكرنا العميل على ملاحظته وناقشناها مع فريق الفرع في اجتماع الصباح.",
    "اعتذرنا للعميل وقدمنا قسيمة خصم لزيارته القادمة.",
]


def _clamp(value: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, round(value)))


def _visit(rng: random.Random, staff_off: float, checkout_off: float, week: int) -> dict[str, Any]:
    mood = rng.gauss(0, 0.8)
    staff = _clamp(3.9 + 0.9 * mood + staff_off + rng.gauss(0, 0.55), 1, 5)
    checkout = _clamp(3.6 + 0.4 * mood + checkout_off + rng.gauss(0, 0.65), 1, 5)
    availability = _clamp(3.8 + 0.3 * mood + rng.gauss(0, 0.8), 1, 5)
    cleanliness = _clamp(4.45 + 0.1 * mood + rng.gauss(0, 0.5), 1, 5)
    value = _clamp(3.4 + 0.35 * mood + rng.gauss(0, 0.8), 1, 5)
    nps = _clamp(
        7.0
        + 1.35 * (staff - 3)
        + 0.85 * (checkout - 3)
        + 0.35 * (availability - 3)
        + 0.35 * (value - 3)
        + 0.03 * week
        + rng.gauss(0, 1.0),
        0,
        10,
    )
    csat = _clamp(3.6 + 0.45 * (staff - 3) + 0.3 * (checkout - 3) + 0.2 * (value - 3) + rng.gauss(0, 0.45), 1, 5)
    answers: dict[str, Any] = {
        "visit_csat": csat,
        "staff": staff,
        "checkout": checkout,
        "availability": availability,
        "cleanliness": cleanliness,
        "value": value,
        "visit_nps": nps,
    }
    drivers = {k: answers[k] for k in ("staff", "checkout", "availability", "value", "cleanliness")}
    if nps <= 8 and rng.random() < 0.5:
        weakest = min(drivers, key=lambda k: (drivers[k], rng.random()))
        answers["visit_improve"] = rng.choice(IMPROVE[weakest])
    if nps >= 9 and rng.random() < 0.35:
        answers["visit_praise"] = rng.choice(PRAISE)
    if nps <= 6:
        answers["visit_contact_ok"] = "yes" if rng.random() < 0.45 else "no"
    return answers


def _case_state(rng: random.Random, created: datetime, now: datetime) -> tuple[CaseStatus, datetime | None, bool]:
    """(status, resolved_at, assigned) for a case opened at ``created``: older cases are almost all
    resolved, most within the 48-hour target; the last two days are still being followed up."""
    age = (now - created).total_seconds() / 3600
    if age > 96 and rng.random() < 0.97:
        hours = rng.uniform(3, 44) if rng.random() < 0.85 else rng.uniform(52, 90)
        return CaseStatus.RESOLVED, created + timedelta(hours=min(hours, age - 1)), True
    if 48 < age <= 96 and rng.random() < 0.75:
        return CaseStatus.RESOLVED, created + timedelta(hours=rng.uniform(3, 46)), True
    if 8 < age <= 48 and rng.random() < 0.2:
        return CaseStatus.RESOLVED, created + timedelta(hours=rng.uniform(1, age * 0.8)), True
    if rng.random() < 0.4:
        return CaseStatus.IN_PROGRESS, None, True
    return CaseStatus.OPEN, None, False


async def seed_demo_cx(session: AsyncSession, org: Organization) -> None:
    exists = await session.scalar(
        select(Project.id).where(Project.organization_id == org.id, Project.is_demo.is_(True), Project.title == TITLE)
    )
    if exists:
        return
    logger.info("seeding DEMO customer-experience project")
    owner_id = await session.scalar(
        select(OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == org.id)
        .order_by(OrganizationMember.created_at)
        .limit(1)
    )
    rng = random.Random(SEED)  # noqa: S311 - deterministic demo data, not security
    now = datetime.now(UTC).replace(second=0, microsecond=0)

    project = Project(
        organization_id=org.id,
        title=TITLE,
        description="سلسلة متاجر تجزئة بثلاثة فروع تقيس تجربة الزيارة بـNPS والرضا ومحركات الولاء، وتتابع كل عميل غير راضٍ خلال 48 ساعة.",
        measurement_type=MeasurementType.SATISFACTION,
        sector=Sector.CUSTOMER,
        target_population="عملاء الفروع بعد الدفع",
        status=ProjectStatus.ACTIVE,
        created_by_id=owner_id,
        is_demo=True,
    )
    session.add(project)
    await session.flush()

    locations = []
    for code, name, city, _, _ in BRANCHES:
        loc = StoreLocation(
            organization_id=org.id, project_id=project.id, code=code, name=name, city=city, kind=LocationKind.BRANCH
        )
        session.add(loc)
        locations.append(loc)
    await session.flush()

    doc = store_visit("ar")
    doc = doc.model_copy(
        update={
            "settings": doc.settings.model_copy(
                update={"reward_text": "استخدم الكود RAIHAN10 لخصم 10% في زيارتك القادمة."}
            )
        }
    )
    survey = Survey(
        organization_id=org.id,
        project_id=project.id,
        title=doc.title,
        status=SurveyStatus.PUBLISHED,
        public_id=public_id(),
        language="ar",
        is_demo=True,
    )
    session.add(survey)
    await session.flush()
    version = SurveyVersion(
        organization_id=org.id,
        survey_id=survey.id,
        version_number=1,
        status=VersionStatus.PUBLISHED,
        title=doc.title,
        language="ar",
        published_at=now - timedelta(weeks=WEEKS, days=1),
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
                select(Question.key, Question.id, Question.lineage_id).where(Question.survey_version_id == version.id)
            )
        ).all()
    }
    qmap = doc.question_map()
    hidden = contact_keys(doc)

    async def add_visit(loc: StoreLocation, completed: datetime, answers: dict[str, Any]) -> None:
        visible = compute_path(doc, answers).visible
        answers = {k: v for k, v in answers.items() if k in visible and is_answered(v)}
        kiosk = rng.random() < 0.3
        taps = sum(1 for k in answers if qmap[k].type.value not in ("LONG_TEXT", "SHORT_TEXT"))
        typed = "visit_improve" in answers or "visit_praise" in answers
        duration = int(taps * rng.uniform(2.2, 5.5) + (rng.uniform(15, 45) if typed else 0))
        quality = assess_response(
            doc,
            answers,
            visible_keys=[k for k in visible if qmap[k].answerable and k not in hidden],
            duration_seconds=duration,
        )
        response = Response(
            organization_id=org.id,
            project_id=project.id,
            survey_id=survey.id,
            survey_version_id=version.id,
            session_id=uuid.uuid4().hex,
            status=ResponseStatus.COMPLETED,
            started_at=completed - timedelta(seconds=duration),
            completed_at=completed,
            duration_seconds=duration,
            channel=ResponseChannel.KIOSK if kiosk else ResponseChannel.QR,
            locale="ar",
            device="tablet" if kiosk else "mobile",
            meta={"location": location_meta(loc)},
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
        trigger = case_trigger(doc, answers)
        if trigger is None:
            return
        reason, score, score_type = trigger
        status, resolved_at, assigned = _case_state(rng, completed, now)
        wants_contact = answers.get("visit_contact_ok") == "yes"
        phone = f"05000{rng.randint(10000, 99999)}"  # fictitious
        session.add(
            CxCase(
                organization_id=org.id,
                project_id=project.id,
                survey_id=survey.id,
                response_id=response.id,
                location_id=loc.id,
                reason=reason,
                score=score,
                score_type=score_type,
                status=status,
                contact_requested=wants_contact,
                contact_encrypted=encrypt(json.dumps({"phone": phone}))
                if wants_contact and status != CaseStatus.RESOLVED
                else None,
                assigned_to_id=owner_id if assigned else None,
                due_at=completed + timedelta(hours=SLA_HOURS),
                resolved_at=resolved_at,
                resolution_note=rng.choice(RESOLUTIONS) if status == CaseStatus.RESOLVED else "",
                created_at=completed,
            )
        )

    start = now - timedelta(weeks=WEEKS)
    for week in range(1, WEEKS + 1):
        for loc, (_, _, _, staff_off, checkout) in zip(locations, BRANCHES, strict=True):
            checkout_off = checkout[1] if week >= CASHIER_WEEK else checkout[0]
            for _ in range(rng.randint(6, 11)):
                completed = start + timedelta(days=(week - 1) * 7 + rng.uniform(0, 7), hours=rng.uniform(-3, 3))
                if completed < now - timedelta(hours=40):
                    await add_visit(loc, completed, _visit(rng, staff_off, checkout_off, week))
    # The last day and a half: a cashier is off sick at «فرع الحمراء», and the closed loop catches it.
    rush = locations[1]
    for _ in range(9):
        completed = now - timedelta(hours=rng.uniform(1, 40))
        await add_visit(rush, completed, _visit(rng, BRANCHES[1][3], RUSH_CHECKOUT, WEEKS))
    for loc, (_, _, _, staff_off, checkout) in zip(locations, BRANCHES, strict=True):
        if loc is rush:
            continue
        for _ in range(rng.randint(3, 5)):
            completed = now - timedelta(hours=rng.uniform(1, 40))
            await add_visit(loc, completed, _visit(rng, staff_off, checkout[1], WEEKS))
    await session.commit()
