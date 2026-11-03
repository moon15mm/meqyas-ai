"""Response exports (CSV / XLSX) — wide format, one row per response.

Values are human-readable (option labels), formula injection is neutralized,
CSV carries a UTF-8 BOM so Excel opens Arabic correctly, XLSX sheets are RTL
for Arabic surveys. Exports are audited and need RESPONSES_EXPORT.
"""

from __future__ import annotations

import csv
import io
import uuid
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import OrgContext
from ..domain.enums import QualityStatus, QuestionType, ReviewStatus
from ..domain.permissions import Permission
from ..domain.survey.logic import display_value
from ..models import Answer, MeasurementWave, Respondent, Response, Survey, SurveyVersion
from .analytics import is_test_response, store_context
from .audit import audit
from .projects import get_owned
from .surveys import load_doc

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe(value: Any) -> Any:
    """Neutralize spreadsheet formula injection (CSV/XLSX) for text cells."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


async def export_responses(
    session: AsyncSession,
    ctx: OrgContext,
    survey_id: uuid.UUID,
    *,
    fmt: str,
    include_flagged: bool,
    request_meta: dict[str, str | None],
) -> tuple[bytes, str, str]:
    """Returns (content, media type, filename)."""
    ctx.require(Permission.RESPONSES_EXPORT)
    survey = await get_owned(session, Survey, survey_id, ctx)
    version = await session.get(SurveyVersion, survey.published_version_id or survey.current_version_id)
    doc = await load_doc(session, version) if version else None
    wave = await session.get(MeasurementWave, survey.wave_id) if survey.wave_id else None

    query = select(Response).where(Response.survey_id == survey.id).order_by(Response.created_at)
    responses = [
        r
        for r in (await session.scalars(query)).all()
        if r.review_status != ReviewStatus.EXCLUDE
        and not is_test_response(r)
        and (include_flagged or r.review_status == ReviewStatus.KEEP or r.quality_status != QualityStatus.LOW_QUALITY)
    ]
    has_store = any(store_context(r) for r in responses)
    labels = dict(
        (
            await session.execute(
                select(Respondent.id, Respondent.label).where(
                    Respondent.id.in_({r.respondent_id for r in responses if r.respondent_id})
                )
            )
        ).all()
    )
    versions = dict(
        (
            await session.execute(
                select(SurveyVersion.id, SurveyVersion.version_number).where(SurveyVersion.survey_id == survey.id)
            )
        ).all()
    )
    answers: dict[uuid.UUID, dict[str, Any]] = {}
    others: dict[uuid.UUID, dict[str, str]] = {}
    followups: dict[uuid.UUID, dict[str, str]] = {}
    rows = await session.execute(
        select(
            Answer.response_id, Answer.question_key, Answer.row_key, Answer.value, Answer.text_value, Answer.is_followup
        ).where(Answer.survey_id == survey.id)
    )
    for rid, key, row, value, text, is_followup in rows.all():
        if is_followup:
            followups.setdefault(rid, {})[key] = str(value)
        elif row is not None:
            answers.setdefault(rid, {})[f"{key}.{row}"] = value
        else:
            answers.setdefault(rid, {})[key] = value
            if text and not isinstance(value, str):
                others.setdefault(rid, {})[key] = text
            elif text and isinstance(value, str) and text != value:
                others.setdefault(rid, {})[key] = text

    questions = [q for q in (doc.questions() if doc else []) if q.answerable]
    language = doc.language if doc else "ar"
    other_label, followup_label = ("أخرى", "متابعة") if language == "ar" else ("Other", "Follow-up")
    columns: list[tuple[str, str, Any]] = []  # (column key, header, question)
    for q in questions:
        if q.type == QuestionType.MATRIX:
            for row in q.settings.rows:
                columns.append((f"{q.key}.{row.key}", f"{q.text} — {row.text}", q))
        else:
            columns.append((q.key, q.text, q))
            if any(o.is_other for o in q.options):
                columns.append((f"{q.key}__other", f"{q.text} — {other_label}", None))
            if q.settings.ai_followup:
                columns.append((f"{q.key}__followup", f"{q.text} — {followup_label}", None))

    meta_headers = [
        "response_id",
        "submitted_at",
        "wave",
        "version",
        "respondent",
        "device",
        "channel",
        "quality_status",
        "quality_score",
        "review_status",
        "duration_seconds",
        *(["store", "product"] if has_store else []),
    ]
    header_keys = meta_headers + [c[0] for c in columns]
    header_labels = meta_headers + [c[1] for c in columns]

    table: list[list[Any]] = []
    for r in responses:
        line: list[Any] = [
            str(r.id),
            (r.completed_at or r.created_at).isoformat(),
            wave.wave_type.value if wave else "",
            versions.get(r.survey_version_id, ""),
            labels.get(r.respondent_id, "") if r.respondent_id else "",
            r.device,
            r.channel.value,
            r.quality_status.value,
            r.quality_score,
            r.review_status.value,
            r.duration_seconds,
            *(
                [_safe(store_context(r).get("name") or ""), _safe(store_context(r).get("product_name") or "")]
                if has_store
                else []
            ),
        ]
        mine = answers.get(r.id, {})
        for key, _header, q in columns:
            if key.endswith("__other"):
                line.append(_safe(others.get(r.id, {}).get(key[: -len("__other")], "")))
            elif key.endswith("__followup"):
                line.append(_safe(followups.get(r.id, {}).get(key[: -len("__followup")], "")))
            elif q is not None and q.type == QuestionType.MATRIX:
                line.append(mine.get(key, ""))
            elif q is not None:
                value = mine.get(key)
                if value is None:
                    line.append("")
                elif q.type in (
                    QuestionType.SINGLE_CHOICE,
                    QuestionType.DROPDOWN,
                    QuestionType.MULTIPLE_CHOICE,
                    QuestionType.RANKING,
                ):
                    line.append(_safe(display_value(q, value, language)))
                else:
                    line.append(_safe(value) if isinstance(value, str) else value)
        table.append(line)

    audit(
        session,
        action="data.export",
        organization_id=ctx.organization_id,
        actor_user_id=ctx.user_id,
        entity_type="survey",
        entity_id=survey.id,
        meta={"format": fmt, "rows": len(table), "include_flagged": include_flagged},
        request_meta=request_meta,
    )
    await session.commit()

    filename = f"meqyas-{survey.public_id}-responses.{fmt}"
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header_labels)
        writer.writerow(header_keys)
        writer.writerows(table)
        return ("﻿" + buf.getvalue()).encode("utf-8"), "text/csv; charset=utf-8", filename

    wb = Workbook()
    ws = wb.active
    ws.title = "responses"
    ws.sheet_view.rightToLeft = language == "ar"
    ws.append(header_labels)
    ws.append(header_keys)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for line in table:
        ws.append(line)
    ws.freeze_panes = "B3"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename
