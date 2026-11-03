"""Public (unauthenticated) survey flow: open → (AI follow-up) → submit.

Security model (SECURITY.md §5, §7):
- Only PUBLISHED surveys within their schedule/limit accept answers; drafts and
  archived surveys do not exist publicly.
- Opening a survey issues a signed session token pinning the exact version the
  respondent saw; submission requires it (no blind scripted posting), is
  idempotent per session, and is re-validated server-side with the logic engine.
- Respondent identity is minimized: pseudonymous codes are stored as keyed hashes,
  identified names/emails are encrypted, no IP or user agent is stored.
"""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any

from meqyas_ai.agents import AdaptiveInterviewerAgent
from meqyas_ai.errors import AIError, AINotConfiguredError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.cache import get_cache
from ..core.crypto import encrypt, stable_hash
from ..core.errors import Conflict, NotFound, Unprocessable
from ..core.security import create_survey_session, decode_survey_session
from ..domain.enums import (
    InvitationStatus,
    QuestionType,
    ResponseChannel,
    ResponseStatus,
    SurveyStatus,
    VersionStatus,
)
from ..domain.survey.answers import normalize_answer, validate_answer
from ..domain.survey.document import SCALE_TYPES, SurveyDoc
from ..domain.survey.logic import compute_path, display_value, is_answered
from ..domain.survey.response_quality import assess_response
from ..domain.survey.templates import fill_document, fill_placeholders
from ..models import Answer, Organization, Question, Respondent, Response, StoreConnection, Survey, SurveyVersion
from ..schemas.response import Availability, FollowupIn, FollowupOut, PublicSurveyOut, SubmissionIn
from . import cx, locations, stores, subscriptions
from .ai import _allow_cloud, get_ai_registry, run_agent
from .surveys import _describe_scale, load_doc

logger = logging.getLogger("meqyas.public")

_interviewer = AdaptiveInterviewerAgent()
SESSION_CACHE_TTL = 24 * 3600
MAX_DURATION_SECONDS = 24 * 3600
_CODE_SEPARATORS = re.compile(r"[\s\-_.·]+")
_MOBILE = re.compile(r"Mobi|Android.+Mobile|iPhone|iPod", re.IGNORECASE)
_TABLET = re.compile(r"iPad|Tablet|Android(?!.*Mobile)", re.IGNORECASE)


# ----------------------------------------------------------------- helpers
async def _survey_by_public_id(session: AsyncSession, public_id: str) -> Survey:
    survey = await session.scalar(select(Survey).where(Survey.public_id == public_id))
    if (
        survey is None
        or survey.published_version_id is None
        or survey.status in (SurveyStatus.DRAFT, SurveyStatus.ARCHIVED)
    ):
        raise NotFound("Survey not found")
    return survey


async def completed_count(session: AsyncSession, survey_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(Response)
            .where(Response.survey_id == survey_id, Response.status == ResponseStatus.COMPLETED)
        )
        or 0
    )


async def availability(session: AsyncSession, survey: Survey) -> Availability:
    now = datetime.now(UTC)
    if survey.status == SurveyStatus.PAUSED:
        return "PAUSED"
    if survey.status == SurveyStatus.CLOSED:
        return "CLOSED"
    if survey.opens_at and now < survey.opens_at:
        return "NOT_STARTED"
    if survey.closes_at and now >= survey.closes_at:
        return "CLOSED"
    if survey.response_limit and await completed_count(session, survey.id) >= survey.response_limit:
        return "FULL"
    # The workspace's subscription: suspended, ended (after the grace days) or at its monthly
    # response limit — respondents just see a closed survey (SUBSCRIPTIONS.md §2).
    org = await session.get(Organization, survey.organization_id)
    if org is not None and not await subscriptions.accepting_responses(session, org):
        return "CLOSED"
    return "OPEN"


def _followup_available(org: Organization, doc: SurveyDoc) -> bool:
    if not doc.settings.ai_followup_enabled or doc.settings.ai_followup_max <= 0:
        return False
    try:
        get_ai_registry().select(allow_cloud=_allow_cloud(org))
    except AINotConfiguredError:
        return False
    return True


def public_doc(doc: SurveyDoc, *, followup: bool) -> dict[str, Any]:
    """What a respondent's browser may see: no scoring keys (correct answers),
    no internal ids, no option scores, no analysis-only flags."""
    data = doc.model_dump(mode="json")
    for section in data["sections"]:
        for q in section["questions"]:
            for internal in ("dimension_id", "indicator_id", "lineage_id", "ai_generated", "scoring"):
                q.pop(internal, None)
            q["options"] = [
                {k: o[k] for k in ("value", "label", "is_other", "is_exclusive")} for o in q.get("options", [])
            ]
            settings = q.get("settings") or {}
            settings.pop("is_profile", None)
            settings.pop("cx_role", None)
            settings["ai_followup"] = bool(followup and settings.get("ai_followup"))
    data["settings"]["ai_followup_enabled"] = followup
    data["settings"].pop("closed_loop", None)
    return data


def normalize_code(raw: str | None) -> str:
    """Self-generated respondent codes: case-, digit-system- and separator-insensitive."""
    if not raw:
        return ""
    text = unicodedata.normalize("NFKC", raw)
    text = "".join(str(unicodedata.digit(ch)) if ch.isdigit() else ch for ch in text)
    return _CODE_SEPARATORS.sub("", text).upper()[:40]


def device_class(user_agent: str | None) -> str:
    if not user_agent:
        return "unknown"
    if _TABLET.search(user_agent) and not _MOBILE.search(user_agent):
        return "tablet"
    if _MOBILE.search(user_agent):
        return "mobile"
    return "desktop"


async def _session_claims(session_token: str, survey: Survey) -> dict[str, Any]:
    claims = decode_survey_session(session_token)
    if claims is None or claims.get("srv") != str(survey.id):
        raise Unprocessable("This survey session has expired. Please reload the page.", code="invalid_session")
    return claims


async def _session_version(session: AsyncSession, survey: Survey, claims: dict[str, Any]) -> SurveyVersion:
    try:
        version = await session.get(SurveyVersion, uuid.UUID(str(claims["ver"])))
    except ValueError:
        version = None
    if version is None or version.survey_id != survey.id or version.status == VersionStatus.DRAFT:
        raise Unprocessable("This survey session has expired. Please reload the page.", code="invalid_session")
    return version


async def _find_or_create_respondent(
    session: AsyncSession, survey: Survey, *, code_hash: str | None, email_hash: str | None, **fields: Any
) -> Respondent:
    column, value = (Respondent.code_hash, code_hash) if code_hash else (Respondent.email_hash, email_hash)
    existing = await session.scalar(
        select(Respondent).where(Respondent.project_id == survey.project_id, column == value)
    )
    if existing is not None:
        for key, val in fields.items():
            if val is not None:
                setattr(existing, key, val)
        return existing
    digest = code_hash or email_hash or uuid.uuid4().hex
    respondent = Respondent(
        organization_id=survey.organization_id,
        project_id=survey.project_id,
        code_hash=code_hash,
        email_hash=email_hash,
        label=f"R-{digest[:6].upper()}",
        is_demo=survey.is_demo,
        **fields,
    )
    try:
        async with session.begin_nested():
            session.add(respondent)
    except IntegrityError:
        # Concurrent first submission with the same code: use the row that won the race.
        winner = await session.scalar(
            select(Respondent).where(Respondent.project_id == survey.project_id, column == value)
        )
        if winner is None:  # pragma: no cover - defensive
            raise
        return winner
    return respondent


async def _resolve_respondent(
    session: AsyncSession, survey: Survey, doc: SurveyDoc, data: SubmissionIn
) -> Respondent | None:
    mode = doc.settings.anonymity_mode
    if mode == "PSEUDONYMOUS" and doc.settings.collect_respondent_code:
        code = normalize_code(data.respondent_code)
        if len(code) < 3:
            raise Unprocessable(
                "Please enter your personal code",
                code="invalid_answers",
                details={"errors": {"_respondent_code": {"code": "required"}}},
            )
        return await _find_or_create_respondent(
            session,
            survey,
            code_hash=stable_hash(f"{survey.project_id}:{code}", purpose="respondent-code"),
            email_hash=None,
        )
    if mode == "IDENTIFIED":
        name = " ".join((data.respondent_name or "").split())
        if not name:
            raise Unprocessable(
                "Please enter your name",
                code="invalid_answers",
                details={"errors": {"_respondent_name": {"code": "required"}}},
            )
        email = str(data.respondent_email).strip().lower() if data.respondent_email else None
        fields = {"name_encrypted": encrypt(name), "email_encrypted": encrypt(email)}
        if email:
            return await _find_or_create_respondent(
                session,
                survey,
                code_hash=None,
                email_hash=stable_hash(f"{survey.project_id}:{email}", purpose="respondent-email"),
                **fields,
            )
        respondent = Respondent(
            organization_id=survey.organization_id,
            project_id=survey.project_id,
            label=f"R-{uuid.uuid4().hex[:6].upper()}",
            is_demo=survey.is_demo,
            **fields,
        )
        session.add(respondent)
        return respondent
    return None


def describe_answer(question: Any, value: Any, language: str) -> str:
    """Human-readable answer for the follow-up agent (matrix rows and scale position included)."""
    if question.type == QuestionType.MATRIX and isinstance(value, dict):
        labels = {o.value: o.label for o in question.options}
        parts = []
        for row in question.settings.rows:
            cell = value.get(row.key)
            if is_answered(cell):
                code = str(int(cell)) if isinstance(cell, int | float) and float(cell).is_integer() else str(cell)
                parts.append(f"{row.text}: {labels.get(code, code)}")
        return ("؛ " if language == "ar" else "; ").join(parts)
    text = display_value(question, value, language)
    if question.scale is not None and question.type in SCALE_TYPES and isinstance(value, int | float):
        number = int(value) if float(value).is_integer() else value
        position = f"{number} / {question.scale.max}"
        return f"{text} ({position})" if text != str(number) else position
    return text


# ------------------------------------------------------------------- open
async def get_public_survey(
    session: AsyncSession, public_id: str, *, invitation: str | None = None, location: str | None = None
) -> PublicSurveyOut:
    survey = await _survey_by_public_id(session, public_id)
    version = await session.get(SurveyVersion, survey.published_version_id)
    if version is None:  # pragma: no cover - guarded by _survey_by_public_id
        raise NotFound("Survey not found")
    state = await availability(session, survey)
    values = stores.placeholder_values(None, version.language)
    out = PublicSurveyOut(
        public_id=survey.public_id,
        title=fill_placeholders(version.title, values),
        language=version.language,
        availability=state,
        version=version.version_number,
        is_demo=survey.is_demo,
    )
    inv = None
    if invitation:
        inv, inv_state = await stores.find_invitation(session, survey, invitation)
        out.invitation = {"state": inv_state}
        if inv is None or inv_state != "valid":
            return out  # used / expired / cancelled links never reopen the form
        values = stores.placeholder_values(inv, version.language)
        out.invitation |= {"store": values["store"], "product": (inv.context.get("product") or {}).get("name")}
        out.title = fill_placeholders(version.title, values)
    elif location:
        loc = await locations.find_active(session, survey.project_id, location)
        if loc is not None:
            values = {**values, "branch": loc.name}
            out.location = {"code": loc.code, "name": loc.name}
            out.title = fill_placeholders(version.title, values)
    if state != "OPEN":
        return out
    doc = await load_doc(session, version)
    org = await session.get(Organization, survey.organization_id)
    followup = (
        org is not None
        and _followup_available(org, doc)
        and await subscriptions.feature_available(session, org.id, "ai_followup")
    )
    out.doc = fill_document(public_doc(doc, followup=followup), values)
    out.ai_followup = followup
    out.session = create_survey_session(survey.id, version.id)
    if inv is not None and inv.status in (InvitationStatus.READY, InvitationStatus.SCHEDULED, InvitationStatus.SENT):
        inv.status, inv.opened_at = InvitationStatus.OPENED, datetime.now(UTC)
        inv.email_encrypted = None  # the customer already has the link
        await session.commit()
    return out


async def opt_out(session: AsyncSession, public_id: str, token: str) -> None:
    survey = await _survey_by_public_id(session, public_id)
    await stores.opt_out(session, survey, token)


# ---------------------------------------------------------------- follow-up
async def ai_followup(session: AsyncSession, public_id: str, data: FollowupIn) -> FollowupOut:
    """Bounded adaptive follow-up. Never blocks the respondent: any problem → no question."""
    no = FollowupOut(ask=False)
    survey = await _survey_by_public_id(session, public_id)
    claims = await _session_claims(data.session, survey)
    if await availability(session, survey) != "OPEN":
        return no
    version = await _session_version(session, survey, claims)
    doc = await load_doc(session, version)
    question = doc.question_map().get(data.question_key)
    org = await session.get(Organization, survey.organization_id)
    if (
        question is None
        or org is None
        or not question.settings.ai_followup
        or not _followup_available(org, doc)
        or not await subscriptions.feature_available(session, org.id, "ai_followup")
        or not is_answered(data.answer)
        or validate_answer(question, data.answer) is not None
    ):
        return no

    cache = await get_cache()
    jti = str(claims["jti"])
    asked = int(await cache.get(f"fu-count:{jti}") or 0)
    if asked >= doc.settings.ai_followup_max or await cache.get(f"fu:{jti}:{question.key}"):
        return no

    answer = describe_answer(question, data.answer, doc.language)
    if data.other_text:
        answer = f"{answer} — {data.other_text[:500]}"
    payload = {
        "language": doc.language,
        "survey_title": doc.title,
        "question_type": question.type.value,
        "question_text": question.text,
        "answer": answer[:2000],
        "scale_hint": _describe_scale(question),
    }
    try:
        result, _run = await run_agent(
            session,
            organization=org,
            user_id=None,
            agent=_interviewer,
            data=payload,
            entity_type="survey",
            entity_id=survey.id,
            use_cache=False,
        )
    except AIError as exc:
        logger.info("follow-up skipped: %s", exc.code)
        return no
    output = result.output
    if not output.ask:
        return no
    await cache.set(f"fu:{jti}:{question.key}", output.question, SESSION_CACHE_TTL)
    await cache.set(f"fu-count:{jti}", str(asked + 1), SESSION_CACHE_TTL)
    return FollowupOut(ask=True, question=output.question)


# ------------------------------------------------------------------ submit
async def submit_response(
    session: AsyncSession, public_id: str, data: SubmissionIn, *, user_agent: str | None
) -> Response:
    survey = await _survey_by_public_id(session, public_id)
    claims = await _session_claims(data.session, survey)
    jti = str(claims["jti"])

    existing = await session.scalar(select(Response).where(Response.survey_id == survey.id, Response.session_id == jti))
    if existing is not None:
        return existing  # idempotent: the same session never creates two responses

    state = await availability(session, survey)
    if state != "OPEN":
        raise Conflict("This survey is not accepting responses", code=f"survey_{state.lower()}")
    version = await _session_version(session, survey, claims)
    doc = await load_doc(session, version)
    qmap = doc.question_map()

    raw = {k: v for k, v in data.answers.items() if k in qmap and qmap[k].answerable}
    path = compute_path(doc, raw)
    visible = [k for k in path.visible if k in qmap and qmap[k].answerable]
    visible_set = set(visible)
    answers = {k: v for k, v in raw.items() if k in visible_set and is_answered(v)}

    errors = {key: err.as_dict() for key in visible if (err := validate_answer(qmap[key], answers.get(key)))}
    if errors:
        raise Unprocessable("Some answers are missing or invalid", code="invalid_answers", details={"errors": errors})
    # Contact details typed to be called back never become answers (CX.md §5).
    answers, contact = cx.extract_contact(doc, answers)
    contact_keys = cx.contact_keys(doc)
    visible = [k for k in visible if k not in contact_keys]

    invitation = None
    meta: dict[str, Any] = {}
    if data.invitation:
        invitation, inv_state = await stores.find_invitation(session, survey, data.invitation)
        if invitation is None or inv_state != "valid":
            raise Conflict("This rating link can no longer be used", code=f"invitation_{inv_state}")
        conn = await session.get(StoreConnection, invitation.connection_id) if invitation.connection_id else None
        meta = stores.store_meta(invitation, conn)
    elif data.location:
        loc = await locations.find_active(session, survey.project_id, data.location)
        if loc is not None:
            meta = {"location": locations.location_meta(loc)}

    # One answer of the workspace's monthly allowance (atomic; undone if the submission fails).
    org = await session.get(Organization, survey.organization_id)
    if org is not None:
        await subscriptions.consume_response(session, org)

    respondent = await _resolve_respondent(session, survey, doc, data)

    now = datetime.now(UTC)
    started = datetime.fromtimestamp(int(claims["iat"]), UTC)
    duration = max(0, min(MAX_DURATION_SECONDS, int((now - started).total_seconds())))

    dedupe_hash = stable_hash(f"{survey.id}:{data.client_id}", purpose="device") if data.client_id else None
    repeat_device = bool(
        dedupe_hash
        and await session.scalar(
            select(func.count())
            .select_from(Response)
            .where(Response.survey_id == survey.id, Response.dedupe_hash == dedupe_hash)
        )
    )
    repeat_code = bool(
        respondent is not None
        and respondent.id is not None
        and await session.scalar(
            select(func.count())
            .select_from(Response)
            .where(Response.survey_id == survey.id, Response.respondent_id == respondent.id)
        )
    )
    quality = assess_response(
        doc, answers, visible_keys=visible, duration_seconds=duration, repeat_device=repeat_device or repeat_code
    )

    question_rows = {
        key: (qid, lineage)
        for key, qid, lineage in (
            await session.execute(
                select(Question.key, Question.id, Question.lineage_id).where(Question.survey_version_id == version.id)
            )
        ).all()
    }

    response = Response(
        organization_id=survey.organization_id,
        project_id=survey.project_id,
        survey_id=survey.id,
        survey_version_id=version.id,
        wave_id=survey.wave_id,
        respondent_id=respondent.id if respondent is not None else None,
        session_id=jti,
        status=ResponseStatus.COMPLETED,
        started_at=started,
        completed_at=now,
        duration_seconds=duration,
        channel=ResponseChannel.STORE if invitation is not None else ResponseChannel(data.channel),
        locale=(data.locale or doc.language)[:8],
        device=device_class(user_agent),
        meta=meta,
        invitation_id=invitation.id if invitation is not None else None,
        dedupe_hash=dedupe_hash,
        answered_count=len(answers),
        quality_score=quality.score,
        quality_status=quality.status,
        quality_flags=quality.flags,
        is_demo=survey.is_demo,
    )
    session.add(response)
    await session.flush()  # assigns ids (respondent, response) before answers reference them
    if respondent is not None:
        response.respondent_id = respondent.id
    if invitation is not None:
        invitation.status, invitation.responded_at = InvitationStatus.RESPONDED, now
        invitation.email_encrypted = None

    cache = await get_cache()
    for key in visible:
        question = qmap[key]
        qid, lineage = question_rows.get(key, (None, None))
        for row in normalize_answer(question, answers.get(key), data.other_texts.get(key)):
            session.add(
                Answer(
                    organization_id=survey.organization_id,
                    response_id=response.id,
                    survey_id=survey.id,
                    question_id=qid,
                    question_key=key,
                    lineage_id=lineage,
                    row_key=row.row_key,
                    value=row.value,
                    numeric_value=row.numeric_value,
                    text_value=row.text_value,
                )
            )
        follow_text = " ".join((data.followups.get(key) or "").split())
        if follow_text:
            prompt = await cache.get(f"fu:{jti}:{key}")
            if prompt:  # only follow-ups this server actually issued are stored
                session.add(
                    Answer(
                        organization_id=survey.organization_id,
                        response_id=response.id,
                        survey_id=survey.id,
                        question_id=qid,
                        question_key=key,
                        lineage_id=lineage,
                        value=follow_text,
                        text_value=follow_text,
                        is_followup=True,
                        followup_prompt=prompt,
                    )
                )
    await cx.open_case(session, survey, doc, response, answers, contact)
    try:
        await session.commit()
    except IntegrityError:
        # The same session submitted twice concurrently: return the stored response.
        await session.rollback()
        winner = await session.scalar(
            select(Response).where(Response.survey_id == survey.id, Response.session_id == jti)
        )
        if winner is None:
            if data.invitation:  # another session answered this invitation first
                raise Conflict("This rating link can no longer be used", code="invitation_used") from None
            raise
        return winner
    return response
