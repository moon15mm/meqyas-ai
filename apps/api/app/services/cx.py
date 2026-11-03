"""Customer experience (CX.md): the CX trio, key driver analysis and the closed loop.

* **Trio** — NPS (loyalty: % promoters 9–10 minus % detractors 0–6), CSAT (satisfaction with
  the interaction: share of 4–5 on 1–5) and CES (effort: share of 5–7 "easy" on 1–7), side by
  side, overall and by branch, channel and week. Every aggregate under 5 answers is withheld.
* **Key drivers** — for each driver question (``cx_role="driver"``): performance (mean on
  0–100) and importance (Spearman correlation with the outcome, ``cx_role="outcome"`` — NPS
  by default), with at least 30 paired answers. The quadrant says where to act first. A
  correlation shows association, not cause.
* **Closed loop** — a low score (NPS ≤ 6, CSAT ≤ 2, CES ≤ 3) opens a follow-up case with a
  48-hour target. Contact details exist only when the customer asked to be contacted, are
  encrypted inside the case and are erased when it is resolved.
"""

from __future__ import annotations

import json
import re
import statistics
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..core.crypto import decrypt, encrypt
from ..core.errors import Unprocessable
from ..domain import stats
from ..domain.enums import CaseReason, CaseStatus, QualityStatus, QuestionType
from ..domain.permissions import Permission
from ..domain.survey.document import QuestionDoc, SurveyDoc
from ..models import Answer, CxCase, Organization, Project, Response, StoreLocation, Survey, User
from . import analytics
from .audit import audit
from .projects import get_owned

SLA_HOURS = 48
MIN_DRIVER_PAIRS = 30
NPS_DETRACTOR, CSAT_LOW, CES_HARD = 6, 2, 3
_PHONE = re.compile(r"^\+?[0-9]{8,15}$")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


# --------------------------------------------------------------- submission
def contact_keys(doc: SurveyDoc) -> set[str]:
    return {q.key for q in doc.question_map().values() if q.settings.contact_field}


def extract_contact(doc: SurveyDoc, answers: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Split contact fields off the answers: they are never stored as answers."""
    qmap = doc.question_map()
    kept: dict[str, Any] = {}
    contact: dict[str, str] = {}
    errors: dict[str, dict[str, str]] = {}
    for key, value in answers.items():
        q = qmap.get(key)
        field = q.settings.contact_field if q else None
        if not field:
            kept[key] = value
            continue
        raw = str(value or "").strip()
        if field == "phone":
            normalized = re.sub(r"[\s()-]", "", raw.translate(_DIGITS))
            if not _PHONE.match(normalized):
                errors[key] = {"code": "invalid_phone"}
                continue
            contact["phone"] = normalized
        else:
            if not _EMAIL.match(raw):
                errors[key] = {"code": "invalid_email"}
                continue
            contact["email"] = raw.lower()
    if errors:
        raise Unprocessable("Some answers are missing or invalid", code="invalid_answers", details={"errors": errors})
    return kept, contact


def _first(doc: SurveyDoc, answers: dict[str, Any], qtype: QuestionType) -> tuple[QuestionDoc, float] | None:
    candidates = [q for q in doc.question_map().values() if q.type == qtype and q.key in answers]
    candidates.sort(key=lambda q: q.settings.cx_role != "outcome")  # the declared outcome first
    for q in candidates:
        try:
            return q, float(answers[q.key])
        except (TypeError, ValueError):
            continue
    return None


def case_trigger(doc: SurveyDoc, answers: dict[str, Any]) -> tuple[CaseReason, float, str] | None:
    if (nps := _first(doc, answers, QuestionType.NPS)) and nps[1] <= NPS_DETRACTOR:
        return CaseReason.DETRACTOR, nps[1], "NPS"
    if (csat := _first(doc, answers, QuestionType.CSAT)) and csat[1] <= CSAT_LOW:
        return CaseReason.LOW_SATISFACTION, csat[1], "CSAT"
    if (ces := _first(doc, answers, QuestionType.CES)) and ces[1] <= CES_HARD:
        return CaseReason.HIGH_EFFORT, ces[1], "CES"
    return None


async def open_case(
    session: AsyncSession,
    survey: Survey,
    doc: SurveyDoc,
    response: Response,
    answers: dict[str, Any],
    contact: dict[str, str],
) -> CxCase | None:
    """Open a follow-up case for a low score (does not commit). Test orders and responses
    flagged as low quality never open cases."""
    if not doc.settings.closed_loop or response.quality_status == QualityStatus.LOW_QUALITY:
        return None
    if ((response.meta or {}).get("store") or {}).get("test"):
        return None
    trigger = case_trigger(doc, answers)
    if trigger is None:
        return None
    reason, score, score_type = trigger
    location = (response.meta or {}).get("location") or {}
    now = datetime.now(UTC)
    case = CxCase(
        organization_id=survey.organization_id,
        project_id=survey.project_id,
        survey_id=survey.id,
        response_id=response.id,
        location_id=uuid.UUID(location["id"]) if location.get("id") else None,
        reason=reason,
        score=score,
        score_type=score_type,
        contact_requested=bool(contact),
        contact_encrypted=encrypt(json.dumps(contact)) if contact else None,
        due_at=now + timedelta(hours=SLA_HOURS),
    )
    session.add(case)
    return case


# ---------------------------------------------------------------- dashboard
def _scores(ds: analytics.Dataset, rows: list[analytics.Row], key: str) -> list[float]:
    return [v for r in rows if (v := ds.num.get(r.id, {}).get((key, None))) is not None]


def _main(ds: analytics.Dataset, qtype: QuestionType) -> QuestionDoc | None:
    qs = [q for q in ds.questions.values() if q.type == qtype and not q.settings.is_profile]
    qs.sort(key=lambda q: q.settings.cx_role != "outcome")
    return qs[0] if qs else None


def _trio(ds: analytics.Dataset, rows: list[analytics.Row]) -> dict[str, Any]:
    out: dict[str, Any] = {"n": len(rows)}
    if (q := _main(ds, QuestionType.NPS)) is not None:
        vals = _scores(ds, rows, q.key)
        if len(vals) >= analytics.K_ANON:
            res = stats.nps(vals)
            out["nps"] = {
                "score": res.score,
                "promoters": res.promoters,
                "passives": res.passives,
                "detractors": res.detractors,
                "n": res.n,
                "ci_low": res.ci_low,
                "ci_high": res.ci_high,
                "suitable": res.suitable,
            }
        else:
            out["nps"] = {"masked": True, "n": len(vals)}
    if (q := _main(ds, QuestionType.CSAT)) is not None:
        vals = _scores(ds, rows, q.key)
        out["csat"] = (
            {
                "pct": round(sum(v >= 4 for v in vals) / len(vals) * 100, 1),
                "mean": round(statistics.fmean(vals), 2),
                "n": len(vals),
            }
            if len(vals) >= analytics.K_ANON
            else {"masked": True, "n": len(vals)}
        )
    if (q := _main(ds, QuestionType.CES)) is not None:
        vals = _scores(ds, rows, q.key)
        out["ces"] = (
            {
                "pct": round(sum(v >= 5 for v in vals) / len(vals) * 100, 1),
                "mean": round(statistics.fmean(vals), 2),
                "n": len(vals),
            }
            if len(vals) >= analytics.K_ANON
            else {"masked": True, "n": len(vals)}
        )
    return out


def _location_of(r: analytics.Row) -> tuple[str, str]:
    if r.location_id:
        return r.location_id, r.location_name or "—"
    return "", ""


def _drivers(ds: analytics.Dataset, rows: list[analytics.Row]) -> dict[str, Any]:
    outcome = _main(ds, QuestionType.NPS) or _main(ds, QuestionType.CSAT)
    if outcome is None:
        return {"outcome": None, "items": []}
    lo, hi = analytics._bounds(outcome) or (0.0, 10.0)
    drivers = [
        q
        for q in ds.questions.values()
        if q.settings.cx_role == "driver" and q.key != outcome.key and analytics._bounds(q) is not None
    ]
    items: list[dict[str, Any]] = []
    for q in drivers:
        b_lo, b_hi = analytics._bounds(q)  # type: ignore[misc]
        pairs = [
            (d, o)
            for r in rows
            if (d := ds.num.get(r.id, {}).get((q.key, None))) is not None
            and (o := ds.num.get(r.id, {}).get((outcome.key, None))) is not None
        ]
        values = _scores(ds, rows, q.key)
        if len(values) < analytics.K_ANON:
            items.append({"key": q.key, "text": q.text, "n": len(values), "masked": True})
            continue
        performance = round((statistics.fmean(values) - b_lo) / (b_hi - b_lo) * 100, 1)
        corr = stats.correlation([p[0] for p in pairs], [p[1] for p in pairs], method="spearman")
        enough = len(pairs) >= MIN_DRIVER_PAIRS and corr.suitable and corr.r is not None
        items.append(
            {
                "key": q.key,
                "text": q.text,
                "n": len(values),
                "pairs": len(pairs),
                "masked": False,
                "performance": performance,
                "mean": round(statistics.fmean(values), 2),
                "importance": corr.r if enough else None,
                "p_value": corr.p_value if enough else None,
            }
        )
    scored = [i for i in items if i.get("importance") is not None]
    if scored:
        imp_mid = statistics.median(i["importance"] for i in scored)
        perf_mid = statistics.median(i["performance"] for i in scored)
        for i in scored:
            high_imp, high_perf = i["importance"] >= imp_mid, i["performance"] >= perf_mid
            i["quadrant"] = (
                "fix" if high_imp and not high_perf else "keep" if high_imp else "maintain" if high_perf else "monitor"
            )
        scored.sort(key=lambda i: -(i["importance"] or 0))
    return {
        "outcome": {"key": outcome.key, "text": outcome.text, "type": outcome.type.value, "min": lo, "max": hi},
        "items": items,
        "min_pairs": MIN_DRIVER_PAIRS,
    }


def _weekly(ds: analytics.Dataset, rows: list[analytics.Row], weeks: int = 12) -> list[dict[str, Any]]:
    if not rows:
        return []
    last = max(r.created_at for r in rows)
    start = (last - timedelta(days=last.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    buckets: dict[str, list[analytics.Row]] = defaultdict(list)
    for r in rows:
        monday = (r.created_at - timedelta(days=r.created_at.weekday())).date()
        if (start.date() - monday).days < weeks * 7:
            buckets[monday.isoformat()].append(r)
    out = []
    for week in sorted(buckets):
        trio = _trio(ds, buckets[week])
        out.append({"week": week, **trio})
    return out


async def dashboard(session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID) -> dict[str, Any]:
    ctx.require(Permission.ANALYTICS_READ)
    data = await analytics.load_project(session, ctx, project_id)
    ds = data.ds
    rows = list(ds.rows)
    by_location: dict[str, list[analytics.Row]] = defaultdict(list)
    names: dict[str, str] = {}
    for r in rows:
        lid, name = _location_of(r)
        if lid:
            by_location[lid].append(r)
            names[lid] = name
    locations = (await session.scalars(select(StoreLocation).where(StoreLocation.project_id == data.project.id))).all()
    for loc in locations:
        names.setdefault(str(loc.id), loc.name)
    # A visit to a branch (QR, kiosk or a POS receipt) is "branch"; an online order is "online".
    channels: dict[str, list[analytics.Row]] = defaultdict(list)
    for r in rows:
        channels["branch" if r.location_id else "online" if r.channel == "STORE" else "other"].append(r)
    cases = (await session.scalars(select(CxCase).where(CxCase.project_id == data.project.id))).all()
    now = datetime.now(UTC)
    resolved = [c for c in cases if c.resolved_at]
    hours = [(c.resolved_at - c.created_at).total_seconds() / 3600 for c in resolved if c.resolved_at]
    return {
        "has_cx": any(q.type in (QuestionType.NPS, QuestionType.CSAT, QuestionType.CES) for q in ds.questions.values()),
        "overall": _trio(ds, rows),
        "locations": sorted(
            (
                {"id": lid, "name": names.get(lid, "—"), **_trio(ds, by_location.get(lid, []))}
                for lid in {*by_location, *(str(loc.id) for loc in locations)}
            ),
            key=lambda x: -x["n"],
        ),
        "channels": {k: _trio(ds, v) for k, v in channels.items() if v},
        "weekly": _weekly(ds, rows),
        "drivers": _drivers(ds, rows),
        "cases": {
            "open": sum(c.status != CaseStatus.RESOLVED for c in cases),
            "overdue": sum(c.status != CaseStatus.RESOLVED and c.due_at < now for c in cases),
            "resolved": len(resolved),
            "within_sla_pct": round(
                sum(c.resolved_at <= c.due_at for c in resolved if c.resolved_at) / len(resolved) * 100, 1
            )
            if resolved
            else None,
            "median_hours": round(statistics.median(hours), 1) if hours else None,
        },
        "k_anonymity": analytics.K_ANON,
    }


# -------------------------------------------------------------------- cases
def _case_out(case: CxCase, *, location: str | None, assignee: str | None, comment: str | None) -> dict[str, Any]:
    return {
        "id": case.id,
        "reason": case.reason.value,
        "score": case.score,
        "score_type": case.score_type,
        "status": case.status.value,
        "contact_requested": case.contact_requested,
        "has_contact": case.contact_encrypted is not None,
        "location": location,
        "assigned_to": assignee,
        "assigned_to_id": case.assigned_to_id,
        "due_at": case.due_at,
        "overdue": case.status != CaseStatus.RESOLVED and case.due_at < datetime.now(UTC),
        "resolved_at": case.resolved_at,
        "resolution_note": case.resolution_note,
        "comment": comment,
        "created_at": case.created_at,
        "response_id": case.response_id,
    }


async def _comments(session: AsyncSession, response_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not response_ids:
        return {}
    rows = (
        await session.execute(
            select(Answer.response_id, Answer.text_value).where(
                Answer.response_id.in_(response_ids), Answer.text_value.is_not(None), Answer.is_followup.is_(False)
            )
        )
    ).all()
    out: dict[uuid.UUID, list[str]] = defaultdict(list)
    for rid, text in rows:
        if text and len(text.strip()) > 1:
            out[rid].append(text.strip())
    return {rid: " — ".join(texts)[:600] for rid, texts in out.items()}


async def list_cases(
    session: AsyncSession, ctx: OrgContext, project_id: uuid.UUID, *, status: str | None = None
) -> list[dict[str, Any]]:
    ctx.require(Permission.ANALYTICS_READ)
    project = await get_owned(session, Project, project_id, ctx)
    stmt = select(CxCase).where(CxCase.project_id == project.id)
    if status == "open":
        stmt = stmt.where(CxCase.status != CaseStatus.RESOLVED)
    elif status == "resolved":
        stmt = stmt.where(CxCase.status == CaseStatus.RESOLVED)
    # A work queue: unresolved cases first, most urgent (earliest due) first; then the latest resolved.
    stmt = stmt.order_by(CxCase.resolved_at.desc().nulls_first(), CxCase.due_at.asc(), CxCase.created_at.desc()).limit(
        200
    )
    cases = (await session.scalars(stmt)).all()
    loc_names = {
        loc.id: loc.name
        for loc in (await session.scalars(select(StoreLocation).where(StoreLocation.project_id == project.id))).all()
    }
    users = {
        u.id: u.full_name
        for u in (
            await session.scalars(
                select(User).where(User.id.in_([c.assigned_to_id for c in cases if c.assigned_to_id]))
            )
        ).all()
    }
    # Customers' words are raw answers: shown only to roles that may read them.
    comments = (
        await _comments(session, [c.response_id for c in cases]) if ctx.can(Permission.RESPONSES_READ_RAW) else {}
    )
    return [
        _case_out(
            c,
            location=loc_names.get(c.location_id) if c.location_id else None,
            assignee=users.get(c.assigned_to_id) if c.assigned_to_id else None,
            comment=comments.get(c.response_id),
        )
        for c in cases
    ]


async def update_case(
    session: AsyncSession, ctx: OrgContext, case_id: uuid.UUID, data: dict[str, Any]
) -> dict[str, Any]:
    ctx.require(Permission.RESPONSES_READ_RAW)
    case = await get_owned(session, CxCase, case_id, ctx)
    if data.get("assign_to_me"):
        case.assigned_to_id = ctx.user_id
        if case.status == CaseStatus.OPEN:
            case.status = CaseStatus.IN_PROGRESS
    status = data.get("status")
    if status:
        new = CaseStatus(status)
        if new == CaseStatus.RESOLVED:
            note = (data.get("resolution_note") or "").strip()
            if len(note) < 3:
                raise Unprocessable("Describe how the case was resolved", code="resolution_note_required")
            case.resolution_note = note[:2000]
            case.resolved_at = datetime.now(UTC)
            case.contact_encrypted = None  # the follow-up is done: the contact details are erased
        else:
            case.resolved_at = None
        case.status = new
    audit(
        session,
        action="cx.case_update",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="cx_case",
        entity_id=case.id,
        meta={"status": case.status.value},
    )
    await session.commit()
    await session.refresh(case)
    loc = await session.get(StoreLocation, case.location_id) if case.location_id else None
    user = await session.get(User, case.assigned_to_id) if case.assigned_to_id else None
    comment = (await _comments(session, [case.response_id])).get(case.response_id)
    return _case_out(
        case, location=loc.name if loc else None, assignee=user.full_name if user else None, comment=comment
    )


async def reveal_contact(session: AsyncSession, ctx: OrgContext, case_id: uuid.UUID) -> dict[str, str]:
    """The customer's contact details, for the person following up (audited)."""
    ctx.require(Permission.RESPONSES_READ_RAW)
    case = await get_owned(session, CxCase, case_id, ctx)
    raw = decrypt(case.contact_encrypted) if case.contact_encrypted else None
    contact = json.loads(raw) if raw else {}
    audit(
        session,
        action="cx.contact_reveal",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="cx_case",
        entity_id=case.id,
    )
    await session.commit()
    return contact


async def analyze_retention(
    session: AsyncSession,
    ctx: OrgContext,
    data: Any,
) -> Any:
    """Analyze customer interaction and formulate retention remediation using Meta Llama 3."""
    from meqyas_ai.agents.cx_retention_agent import CXRetentionAgent

    from . import ai as ai_svc

    org = await session.get(Organization, ctx.organization_id)
    if not org:
        raise ValueError("Organization not found")

    result, _ = await ai_svc.run_agent(
        session,
        organization=org,
        user_id=ctx.user_id,
        agent=CXRetentionAgent(),
        data=data,
        entity_type="cx_retention",
    )
    return result.output
