"""DEMO DATA seed: idempotent, fully flagged, realistic and consistent with the survey engine."""

from __future__ import annotations

from app.db.session import get_sessionmaker
from app.domain.survey.answers import validate_answer
from app.models import Answer, CxCase, Project, Respondent, Response, StoreLocation, Survey, SurveyVersion
from app.seed.demo import DEMO_EMAIL, DEMO_PASSWORD, seed_demo
from app.seed.demo_cx import TITLE as CX_DEMO_TITLE
from app.services.surveys import load_doc
from sqlalchemy import func, select


async def test_demo_seed_is_idempotent_flagged_and_valid(client) -> None:
    async with get_sessionmaker()() as session:
        await seed_demo(session)
        await seed_demo(session)  # second run must not duplicate anything
        projects = (await session.scalars(select(Project).order_by(Project.created_at))).all()
        assert [p.title == CX_DEMO_TITLE for p in projects] == [False, True] and all(p.is_demo for p in projects)
        education, cx = projects
        surveys = (await session.scalars(select(Survey).where(Survey.project_id == education.id))).all()
        assert len(surveys) == 3 and all(s.is_demo for s in surveys)
        responses = (await session.scalars(select(Response).where(Response.project_id == education.id))).all()
        assert len(responses) == 40 + 36 + 30 and all(r.is_demo for r in responses)
        assert int(await session.scalar(select(func.count()).select_from(Respondent))) == 40
        assert {r.quality_status.value for r in responses} >= {"VALID", "LOW_QUALITY"}

        # every stored answer is valid for the published document it belongs to
        for survey in surveys:
            version = await session.get(SurveyVersion, survey.published_version_id)
            assert version is not None
            doc = await load_doc(session, version)
            qmap = doc.question_map()
            rows = (
                await session.scalars(select(Answer).where(Answer.survey_id == survey.id, Answer.row_key.is_(None)))
            ).all()
            assert rows
            for row in rows:
                assert validate_answer(qmap[row.question_key], row.value) is None

        # the customer-experience demo: one pulse survey, three branches, visits and follow-up cases
        cx_surveys = (await session.scalars(select(Survey).where(Survey.project_id == cx.id))).all()
        assert len(cx_surveys) == 1 and cx_surveys[0].is_demo
        cx_responses = (await session.scalars(select(Response).where(Response.project_id == cx.id))).all()
        assert len(cx_responses) > 150 and all(r.is_demo and r.meta["location"]["code"] for r in cx_responses)
        assert int(await session.scalar(select(func.count()).select_from(StoreLocation))) == 3
        assert int(await session.scalar(select(func.count()).select_from(CxCase))) > 0

    # the demo account can sign in and sees the project's responses
    login = await client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert login.status_code == 200, login.text
    body = login.json()
    org_id = body["memberships"][0]["organization_id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id}
    project_id = str(education.id)
    page = (await client.get(f"/api/v1/projects/{project_id}/responses?limit=5", headers=headers)).json()
    assert page["counts"]["total"] == 106 and page["items"][0]["quality_status"] != "VALID"  # needs attention first
