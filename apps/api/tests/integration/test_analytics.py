"""Phase 5 analytics over the deterministic DEMO DATA (3 waves, 40 pseudonymous teachers)."""

from __future__ import annotations

import csv
import io
import statistics
import uuid
from typing import Any

from app.db.session import get_sessionmaker
from app.domain.enums import ReviewStatus
from app.models import Response
from app.seed.demo import DEMO_EMAIL, DEMO_PASSWORD, seed_demo
from app.services.exports import _safe
from helpers import add_member, demo_project
from openpyxl import load_workbook
from sqlalchemy import select, update


async def _demo(client) -> dict[str, Any]:
    async with get_sessionmaker()() as session:
        await seed_demo(session)
    body = (await client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})).json()
    org_id = body["memberships"][0]["organization_id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id}
    project = await demo_project(client, headers)
    surveys = (await client.get(f"/api/v1/projects/{project['id']}/surveys", headers=headers)).json()
    return {
        "headers": headers,
        "org_id": org_id,
        "project_id": project["id"],
        "surveys": {s["wave_type"]: s for s in surveys},
    }


async def test_summary_kpis_dimensions_and_indicators(client) -> None:
    demo = await _demo(client)
    res = await client.get(f"/api/v1/projects/{demo['project_id']}/analytics/summary", headers=demo["headers"])
    assert res.status_code == 200, res.text
    s = res.json()
    assert s["counts"]["total"] == 106 and s["counts"]["low_quality"] == 2 and s["counts"]["included"] == 104
    assert [w["wave"] for w in s["waves"]] == ["BASELINE", "POST", "FOLLOW_UP"]
    assert s["evidence_level"] == "CHANGE_PERSISTENCE" and s["causality"]["note"] == "change_not_cause"
    assert s["causality"]["allows_causal_language"] is False

    knowledge = next(d for d in s["dimensions"] if d["key"] == "knowledge")
    waves = {w["wave"]: w for w in knowledge["waves"]}
    assert waves["BASELINE"]["mean"] < 3 < waves["POST"]["mean"]
    assert waves["BASELINE"]["scale_min"] == 1 and waves["BASELINE"]["scale_max"] == 5
    assert waves["POST"]["alpha"] is not None  # 3 items → reliability is computed
    assert 0 < waves["BASELINE"]["score"] < waves["POST"]["score"] <= 100

    inds = {i["code"]: i for i in s["indicators"]}
    ind1 = inds["IND-01"]  # AVERAGE_SCORE over the 3 knowledge items
    assert ind1["items"] == 3 and ind1["baseline_value"] == waves["BASELINE"]["mean"]
    assert ind1["current_value"] == waves["FOLLOW_UP"]["mean"] and ind1["change"]["absolute"] > 1
    assert inds["IND-02"]["indicator_type"] == "CHANGE" and inds["IND-02"]["current_value"] > 0.5
    use = inds["IND-04"]  # % using weekly or more: top-2-box of a 4-point frequency scale
    use_waves = {w["wave"]: w["value"] for w in use["waves"]}
    assert use_waves["BASELINE"] < use_waves["POST"]
    assert inds["IND-05"]["waves"][1]["wave"] == "POST" and inds["IND-05"]["current_value"] is not None
    assert {i["status"] for i in s["indicators"]} <= {"NOT_STARTED", "ON_TRACK", "AT_RISK", "OFF_TRACK", "ACHIEVED"}
    assert s["nps"] is None  # NPS exists only in the POST wave, latest wave is FOLLOW_UP
    assert s["top_strength"] and s["top_problem"] and s["overall_score"] is not None

    flagged = (
        await client.get(
            f"/api/v1/projects/{demo['project_id']}/analytics/summary?include_flagged=true", headers=demo["headers"]
        )
    ).json()
    assert flagged["counts"]["included"] == 106


async def test_paired_wave_comparison(client) -> None:
    demo = await _demo(client)
    res = (
        await client.get(
            f"/api/v1/projects/{demo['project_id']}/analytics/compare?from_wave=BASELINE&to_wave=POST",
            headers=demo["headers"],
        )
    ).json()
    knowledge = next(d for d in res["dimensions"] if d["key"] == "knowledge")
    assert knowledge["paired"] is True and knowledge["n_pairs"] >= 30
    assert knowledge["test"]["test"] == "paired_t" and knowledge["test"]["p_value"] < 0.001
    assert knowledge["test"]["effect_label"] == "large" and knowledge["change"]["absolute"] > 1
    assert res["causality"] == "change_not_cause"
    item = next(q for q in res["questions"] if q["key"] == "know_tools")
    assert item["paired"] and item["test"]["difference"] > 0
    same = await client.get(
        f"/api/v1/projects/{demo['project_id']}/analytics/compare?from_wave=POST&to_wave=POST", headers=demo["headers"]
    )
    assert same.status_code == 422


async def test_question_stats_segments_and_crosstab(client) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}/analytics"
    page = (await client.get(f"{base}/questions?wave=POST", headers=demo["headers"])).json()
    by_key = {q["key"]: q for q in page["questions"]}
    likert = by_key["know_tools"]
    assert likert["n"] == page["n"] == 35  # POST minus the excluded low-quality response
    assert sum(c["count"] for c in likert["distribution"]["categories"]) == likert["n"]
    assert abs(sum(c["pct"] for c in likert["distribution"]["categories"]) - 100) < 1e-6
    assert by_key["recommend"]["nps"]["n"] == 35 and -100 <= by_key["recommend"]["nps"]["score"] <= 100
    assert by_key["best_part"]["text_count"] > 0 and by_key["best_part"]["text_samples"]  # owner may read raw text
    assert by_key["specialty"]["is_profile"] is True

    seg = (await client.get(f"{base}/questions/know_tools?segment=specialty&wave=POST", headers=demo["headers"])).json()
    assert sum(s["n"] for s in seg["segments"]) == 35
    assert all(s["stats"] is None for s in seg["segments"] if s["n"] < 5)
    by_wave = (await client.get(f"{base}/questions/use_freq?segment=wave", headers=demo["headers"])).json()
    assert [s["value"] for s in by_wave["segments"]] == ["BASELINE", "POST", "FOLLOW_UP"]
    bad = await client.get(f"{base}/questions/know_tools?segment=know_limits", headers=demo["headers"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_segment"

    ct = (
        await client.get(f"{base}/crosstab?row=experience&col=use_freq&wave=BASELINE", headers=demo["headers"])
    ).json()
    assert ct["n"] == 40 and len(ct["rows"]) == 3 and len(ct["columns"]) == 4
    assert ct["row_labels"][0] == "أقل من 5 سنوات"
    # The chi-square is only reported as suitable when every expected count is ≥ 5.
    assert ct["min_expected"] is not None and (ct["suitable"] is (ct["min_expected"] >= 5))
    sparse = (
        await client.get(f"{base}/crosstab?row=specialty&col=experience&wave=POST", headers=demo["headers"])
    ).json()
    assert sparse["suitable"] is False and sparse["reason"] == "expected_counts_below_5"
    assert (await client.get(f"{base}/questions/nope", headers=demo["headers"])).status_code == 404
    # Across waves the same teachers are counted once per wave: counts yes, chi-square no.
    pooled = (await client.get(f"{base}/crosstab?row=experience&col=use_freq", headers=demo["headers"])).json()
    assert pooled["n"] == 104 and pooled["suitable"] is False and pooled["reason"] == "repeated_respondents"
    by_wave = (await client.get(f"{base}/crosstab?row=wave&col=use_freq", headers=demo["headers"])).json()
    assert by_wave["rows"] == ["BASELINE", "POST", "FOLLOW_UP"]


async def test_roles_text_privacy_and_exports(client, register) -> None:
    demo = await _demo(client)
    owner = {"headers": demo["headers"], "org_id": demo["org_id"]}
    viewer = await add_member(client, owner, "viewer@school.example", "VIEWER", register)
    editor = await add_member(client, owner, "editor@school.example", "EDITOR", register)
    analyst = await add_member(client, owner, "analyst@school.example", "ANALYST", register)
    base = f"/api/v1/projects/{demo['project_id']}/analytics"

    as_viewer = (await client.get(f"{base}/questions?wave=POST", headers=viewer["headers_in_owner_org"])).json()
    text_q = next(q for q in as_viewer["questions"] if q["key"] == "best_part")
    assert text_q["text_count"] > 0 and "text_samples" not in text_q  # aggregates yes, raw text no

    post_id = demo["surveys"]["POST"]["id"]
    export = f"/api/v1/surveys/{post_id}/responses/export"
    assert (await client.get(f"{export}.csv", headers=editor["headers_in_owner_org"])).status_code == 403
    csv_res = await client.get(f"{export}.csv", headers=analyst["headers_in_owner_org"])
    assert csv_res.status_code == 200 and csv_res.headers["content-disposition"].startswith("attachment")
    text = csv_res.content.decode("utf-8")
    assert text.startswith("﻿")  # BOM for Excel + Arabic
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    keys = rows[1]
    assert keys[:3] == ["response_id", "submitted_at", "wave"] and "know_tools" in keys and "recommend" in keys
    assert len(rows) == 2 + 35  # labels row + keys row + included responses
    specialty = keys.index("specialty")
    assert {r[specialty] for r in rows[2:]} <= {"علوم", "رياضيات", "لغة عربية", "لغة إنجليزية", "أخرى"}
    scores = [float(r[keys.index("know_tools")]) for r in rows[2:]]
    assert 3 < statistics.fmean(scores) < 5

    xlsx = await client.get(f"{export}.xlsx?include_flagged=true", headers=demo["headers"])
    wb = load_workbook(io.BytesIO(xlsx.content))
    ws = wb.active
    assert ws.sheet_view.rightToLeft is True and ws.max_row == 2 + 36


def test_formula_injection_is_neutralized() -> None:
    assert _safe('=HYPERLINK("x")') == '\'=HYPERLINK("x")'
    assert _safe("+1") == "'+1" and _safe("@cmd") == "'@cmd" and _safe("عادي") == "عادي" and _safe(5) == 5


async def test_small_groups_are_masked_everywhere(client) -> None:
    """k-anonymity: no mean, distribution, indicator value or test is shown for fewer than K answers."""
    demo = await _demo(client)
    follow_up = uuid.UUID(demo["surveys"]["FOLLOW_UP"]["id"])
    async with get_sessionmaker()() as session:
        ids = (
            await session.scalars(select(Response.id).where(Response.survey_id == follow_up).order_by(Response.id))
        ).all()
        await session.execute(
            update(Response).where(Response.id.in_(ids[3:])).values(review_status=ReviewStatus.EXCLUDE)
        )
        await session.commit()
    base = f"/api/v1/projects/{demo['project_id']}/analytics"

    page = (await client.get(f"{base}/questions?wave=FOLLOW_UP", headers=demo["headers"])).json()
    likert = next(q for q in page["questions"] if q["key"] == "know_tools")
    assert likert["n"] == 3 and likert["masked"] is True
    assert not {"describe", "distribution", "top_box", "ci"} & set(likert)

    s = (await client.get(f"{base}/summary", headers=demo["headers"])).json()
    knowledge = next(d for d in s["dimensions"] if d["key"] == "knowledge")
    fu = next(w for w in knowledge["waves"] if w["wave"] == "FOLLOW_UP")
    assert fu["masked"] is True and fu["n"] == 3 and fu["mean"] is None and fu["score"] is None
    ind1 = next(i for i in s["indicators"] if i["code"] == "IND-01")
    fu_value = next(w for w in ind1["waves"] if w["wave"] == "FOLLOW_UP")
    assert fu_value["value"] is None and fu_value["reason"] == "below_k_anonymity"
    assert ind1["current_value"] == next(w["value"] for w in ind1["waves"] if w["wave"] == "POST")

    cmp = (await client.get(f"{base}/compare?from_wave=POST&to_wave=FOLLOW_UP", headers=demo["headers"])).json()
    k = next(d for d in cmp["dimensions"] if d["key"] == "knowledge")
    assert k["masked"] is True and k["to_mean"] is None and k["test"]["reason"] == "below_k_anonymity"


async def test_questions_page_breaks_down_by_segment(client) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}/analytics/questions"
    page = (await client.get(f"{base}?wave=POST&segment=experience", headers=demo["headers"])).json()
    assert page["segment"] == "experience"
    by_key = {q["key"]: q for q in page["questions"]}
    assert "segments" not in by_key["experience"]  # never broken down by itself
    assert "segments" not in by_key["best_part"]  # text answers are not segmented
    segs = by_key["know_tools"]["segments"]
    assert sum(s["n"] for s in segs) == by_key["know_tools"]["n"]
    assert next(s["label"] for s in segs) == "أقل من 5 سنوات"
    bad = await client.get(f"{base}?segment=know_tools", headers=demo["headers"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_segment"


async def test_results_hub_lists_collection_status_per_project(client, register) -> None:
    demo = await _demo(client)
    items = (await client.get("/api/v1/analytics/projects", headers=demo["headers"])).json()["items"]
    project = next(p for p in items if p["id"] == demo["project_id"])
    assert project["responses_total"] == 106 and project["responses_included"] == 104
    assert project["waves"] == ["BASELINE", "POST", "FOLLOW_UP"] and project["published_surveys"] == 3
    assert project["evidence_level"] == "CHANGE_PERSISTENCE" and project["last_response_at"]
    # Another organization sees none of it.
    stranger = await register()
    theirs = (await client.get("/api/v1/analytics/projects", headers=stranger["headers"])).json()["items"]
    assert all(p["id"] != demo["project_id"] for p in theirs)
