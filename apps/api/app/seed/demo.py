"""DEMO DATA — development only.

Creates «مدرسة تجريبية» with the project «قياس أثر برنامج تدريبي في الذكاء
الاصطناعي». Everything created here is flagged ``is_demo = true`` and shown with
a DEMO DATA badge in the UI. Never runs in production.

Demo login (development only): demo@meqyas.example / Demo-Meqyas-2026
"""

from __future__ import annotations

import logging

from meqyas_ai.domain.plan_rules import apply_rules
from meqyas_ai.schemas.plan import ArchitectOutput
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.security import hash_password
from ..domain.enums import PlanStatus, Role, Sector
from ..domain.subscription import UNLIMITED_PLAN
from ..models import MeasurementPlan, Organization, OrganizationMember, User
from ..services import subscriptions
from ..services.plans import _sync_scalars, materialize_plan
from .demo_cx import seed_demo_cx
from .demo_responses import seed_demo_surveys

logger = logging.getLogger("meqyas.seed")

DEMO_ORG_SLUG = "demo-school"
DEMO_EMAIL = "demo@meqyas.example"
DEMO_PASSWORD = "Demo-Meqyas-2026"  # development fixture, documented in README

DEMO_REQUEST = "أريد قياس أثر برنامج تدريبي للمعلمين على استخدام أدوات الذكاء الاصطناعي في التعليم."

DEMO_PLAN: dict = {
    "project_title": "قياس أثر برنامج تدريبي في الذكاء الاصطناعي",
    "measurement_type": "IMPACT",
    "secondary_types": ["TRAINING_EVALUATION", "BEHAVIOR"],
    "target_population": "معلمو ومعلمات المدرسة المشاركون في البرنامج التدريبي",
    "purpose": "معرفة مدى تحسن معرفة المعلمين وثقتهم وقدرتهم على توظيف أدوات الذكاء الاصطناعي في التدريس بعد "
    "البرنامج، ومدى استمرار الاستخدام الفعلي بعد شهر، لدعم قرار توسيع البرنامج.",
    "understanding_summary": "فهمنا أنك تريد قياس أثر برنامج تدريبي على معرفة المعلمين وثقتهم واستخدامهم الفعلي "
    "لأدوات الذكاء الاصطناعي في التعليم.",
    "measurement_type_rationale": "الطلب يسأل عن الأثر والتغير بعد البرنامج، وليس عن الرضا فقط؛ لذلك نحتاج قياسًا "
    "قبليًا وبعديًا وقياس متابعة لرصد استمرار التغير.",
    "objectives": [
        {"key": "o1", "title": "قياس التغير في معرفة المعلمين بأدوات الذكاء الاصطناعي التعليمية", "description": ""},
        {"key": "o2", "title": "رصد التغير في ثقة المعلمين وقدرتهم على التطبيق داخل الصف", "description": ""},
        {"key": "o3", "title": "تتبع الاستخدام الفعلي للأدوات بعد البرنامج ومدى استمراره", "description": ""},
    ],
    "dimensions": [
        {
            "key": "knowledge",
            "name": "المعرفة",
            "description": "معرفة الأدوات وحدودها وأخلاقيات استخدامها",
            "objective_key": "o1",
        },
        {
            "key": "confidence",
            "name": "الثقة",
            "description": "الكفاءة الذاتية المدركة في استخدام الأدوات",
            "objective_key": "o2",
        },
        {
            "key": "application",
            "name": "القدرة على التطبيق",
            "description": "القدرة على تصميم أنشطة صفية بالأدوات",
            "objective_key": "o2",
        },
        {
            "key": "actual_use",
            "name": "الاستخدام الفعلي",
            "description": "تكرار الاستخدام في التخطيط والتدريس",
            "objective_key": "o3",
        },
        {
            "key": "satisfaction",
            "name": "الرضا عن البرنامج",
            "description": "رضا المعلمين عن المحتوى والتنظيم",
            "objective_key": "o2",
        },
    ],
    "indicators": [
        {
            "code": "IND-01",
            "name": "متوسط درجة المعرفة",
            "description": "متوسط بنود المعرفة (1–5)",
            "dimension_key": "knowledge",
            "indicator_type": "AVERAGE_SCORE",
            "unit": "من 5",
            "target": "4 من 5",
            "target_value": 4,
            "formula": "مجموع درجات البنود ÷ عدد الإجابات",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-02",
            "name": "التغير في متوسط الثقة",
            "description": "الفرق بين القياس البعدي والقبلي",
            "dimension_key": "confidence",
            "indicator_type": "CHANGE",
            "unit": "نقطة",
            "target": "+0.8 نقطة",
            "target_value": 0.8,
            "formula": "متوسط البعدي − متوسط القبلي",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-03",
            "name": "نسبة القادرين على تصميم نشاط صفي",
            "description": "نسبة من اختاروا 4 أو 5",
            "dimension_key": "application",
            "indicator_type": "PERCENTAGE",
            "unit": "%",
            "target": "75% أو أكثر",
            "target_value": 75,
            "formula": "عدد من أجاب 4–5 ÷ إجمالي المجيبين × 100",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-04",
            "name": "نسبة المستخدمين أسبوعيًا",
            "description": "استخدام مرة أسبوعيًا على الأقل",
            "dimension_key": "actual_use",
            "indicator_type": "PERCENTAGE",
            "unit": "%",
            "target": "60% أو أكثر",
            "target_value": 60,
            "formula": "عدد المستخدمين أسبوعيًا ÷ إجمالي المجيبين × 100",
            "frequency": "PER_WAVE",
            "direction": "HIGHER_IS_BETTER",
        },
        {
            "code": "IND-05",
            "name": "نسبة الراضين عن البرنامج",
            "description": "نسبة من اختاروا 4 أو 5",
            "dimension_key": "satisfaction",
            "indicator_type": "PERCENTAGE",
            "unit": "%",
            "target": "80% أو أكثر",
            "target_value": 80,
            "formula": "عدد الراضين ÷ إجمالي المجيبين × 100",
            "frequency": "ONCE",
            "direction": "HIGHER_IS_BETTER",
        },
    ],
    "recommended_design": "PRE_POST_FOLLOW_UP",
    "design_rationale": "القياس القبلي يحدد نقطة البداية، والبعدي يرصد التغير المباشر، والمتابعة بعد 30 يومًا تبين "
    "هل استمر الاستخدام الفعلي.",
    "waves": [
        {"wave_type": "BASELINE", "name": "القياس القبلي", "timing": "قبل بدء البرنامج بأسبوع", "offset_days": None},
        {"wave_type": "POST", "name": "القياس البعدي", "timing": "في آخر يوم من البرنامج", "offset_days": None},
        {
            "wave_type": "FOLLOW_UP",
            "name": "قياس المتابعة",
            "timing": "بعد 30 يومًا من انتهاء البرنامج",
            "offset_days": 30,
        },
    ],
    "baseline_required": True,
    "post_measurement_required": True,
    "follow_up_recommended": True,
    "follow_up_days": 30,
    "recommended_questions_count": 18,
    "estimated_completion_minutes": 7,
    "methodology_notes": [
        "استخدم رمزًا مستعارًا ثابتًا لكل معلم لربط القياسات الثلاثة دون جمع الهوية.",
        "طبّق القياس القبلي قبل أي محتوى تدريبي حتى لا يتأثر بالبرنامج.",
    ],
    "clarifying_questions": [],
}


async def demo_org(session: AsyncSession) -> Organization | None:
    return await session.scalar(select(Organization).where(Organization.slug == DEMO_ORG_SLUG))


async def seed_demo(session: AsyncSession) -> None:
    if get_settings().is_production:
        return
    existing = await demo_org(session)
    if existing is not None:
        await seed_demo_surveys(session, existing)  # backfills databases seeded before Phase 4
        await seed_demo_cx(session, existing)  # …and before the customer-experience module
        return
    logger.info("seeding DEMO DATA (development)")

    user = await session.scalar(select(User).where(func.lower(User.email) == DEMO_EMAIL))
    if user is None:
        user = User(
            email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD), full_name="مستخدم تجريبي", locale="ar"
        )
        session.add(user)
        await session.flush()

    org = Organization(
        name="مدرسة تجريبية",
        slug=DEMO_ORG_SLUG,
        sector=Sector.EDUCATION,
        locale="ar",
        settings={"ai": {"allow_cloud_ai": True, "followup_limit": 2}},
        is_demo=True,
    )
    session.add(org)
    await session.flush()
    session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=Role.OWNER))
    # The demo is never limited (SUBSCRIPTIONS.md).
    await subscriptions.create(
        session, org, await subscriptions.get_plan(session, UNLIMITED_PLAN), days=None, start_now=True
    )

    draft = apply_rules(ArchitectOutput.model_validate(DEMO_PLAN), language="ar", signals=None)
    plan = MeasurementPlan(
        organization_id=org.id,
        status=PlanStatus.DRAFT,
        source_prompt=DEMO_REQUEST,
        created_by_id=user.id,
        measurement_type=draft.measurement_type,
        recommended_design=draft.recommended_design,
        evidence_level=draft.evidence_level,
    )
    _sync_scalars(plan, draft)
    session.add(plan)
    await session.flush()
    await materialize_plan(session, plan, organization=org, user_id=user.id, is_demo=True)
    await session.commit()
    await seed_demo_surveys(session, org)
    await seed_demo_cx(session, org)


async def attach_user_to_demo(session: AsyncSession, user: User) -> None:
    """Development convenience: every new account can explore the demo project
    immediately (as EDITOR) without creating data manually."""
    s = get_settings()
    if s.is_production or not s.seed_demo_on_startup:
        return
    org = await demo_org(session)
    if org is None:
        return
    exists = await session.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == user.id
        )
    )
    if exists is None:
        session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=Role.EDITOR))
