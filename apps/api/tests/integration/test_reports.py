"""Phase 7 over the DEMO DATA: reports, versions, edits and the grounded report writer."""

from __future__ import annotations

import re
from typing import Any

from app.db.session import get_sessionmaker
from app.models import AuditLog, ReportVersion
from app.seed.demo import DEMO_EMAIL, DEMO_PASSWORD, seed_demo
from helpers import add_member, demo_project
from sqlalchemy import func, select

_ITEM = re.compile(r'<item id="([^"]+)">([^<]*)</item>')
_KEY = re.compile(r'- key "([a-z_]+)"')


async def _demo(client) -> dict[str, Any]:
    async with get_sessionmaker()() as session:
        await seed_demo(session)
    body = (await client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})).json()
    org_id = body["memberships"][0]["organization_id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Organization-Id": org_id}
    project = await demo_project(client, headers)
    return {"headers": headers, "org_id": org_id, "project_id": project["id"]}


def writer_script(messages: Any, schema: Any) -> dict[str, Any]:
    """Write every requested section from the first fact (responses analyzed), citing it."""
    user = messages[1].content
    facts = dict(_ITEM.findall(user))
    responses = re.search(r"\d+", facts["F1"].split(":", 1)[1]).group(0)  # type: ignore[union-attr]
    return {
        "sections": [
            {"key": key, "paragraphs": [f"شمل التحليل {responses} إجابة معتمدة."], "evidence_ids": ["F1"]}
            for key in _KEY.findall(user)
        ]
    }


def _sections(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {s["key"]: s for s in report["version"]["content"]["sections"]}


async def test_executive_report_is_grounded_and_versioned(client, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    provider = scripted_ai([writer_script])
    res = await client.post(f"{base}/reports", headers=demo["headers"], json={"report_type": "EXECUTIVE"})
    assert res.status_code == 201, res.text
    report = res.json()
    content = report["version"]["content"]
    assert report["current_version"] == 1 and report["title"].startswith("تقرير تنفيذي")
    assert content["ai"]["used"] is True and content["language"] == "ar"
    keys = [s["key"] for s in content["sections"]]
    assert keys == [
        "summary",
        "key_figures",
        "findings",
        "dimensions_chart",
        "indicators_table",
        "limitations",
        "appendix",
    ]  # no recommendations yet → the section is omitted
    sections = _sections(report)
    summary = (await client.get(f"{base}/analytics/summary", headers=demo["headers"])).json()
    included = summary["counts"]["included"]
    assert sections["summary"]["source"] == "AI" and str(included) in sections["summary"]["paragraphs"][0]
    assert sections["findings"]["bullets"]  # a "bullets" section written as paragraphs is normalized
    assert sections["key_figures"]["items"][0]["value"] == str(included)  # computed by the platform
    chart = sections["dimensions_chart"]
    assert chart["series"][0]["key"] == "BASELINE" and all(
        len(r["values"]) == len(chart["series"]) for r in chart["rows"]
    )
    appendix = sections["appendix"]["items"]
    assert [f["id"] for f in appendix] == ["F1"] and str(included) in appendix[0]["value"]
    assert any("لا يثبت" in b or "لا تثبت" in b for b in sections["limitations"]["bullets"])  # evidence-level caveat
    # The writer saw aggregates only, as untrusted data.
    prompt = provider.calls[0]["messages"][1].content
    assert '<untrusted_data source="analytics_pack">' in prompt and "ضعف الإنترنت" not in prompt

    listed = (await client.get(f"{base}/reports", headers=demo["headers"])).json()
    assert [r["id"] for r in listed] == [report["id"]]
    everywhere = (await client.get("/api/v1/reports", headers=demo["headers"])).json()
    assert everywhere[0]["project_title"] == report["project_title"]
    async with get_sessionmaker()() as session:
        snapshot = (await session.scalars(select(ReportVersion.data_snapshot))).one()
        audited = await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "report.create")
        )
    assert snapshot["counts"]["included"] == included and snapshot["facts"][0]["id"] == "F1"
    assert audited == 1


async def test_failed_ai_falls_back_to_computed_insights(client, scripted_ai) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    scripted_ai([{"sections": []}] * 3)  # never acceptable → the writer gives up
    res = await client.post(f"{base}/reports", headers=demo["headers"], json={"report_type": "EXECUTIVE"})
    assert res.status_code == 201, res.text
    content = res.json()["version"]["content"]
    assert content["ai"]["used"] is False and content["ai"]["error"] == "unverified"
    assert {"summary", "findings"} <= set(content["ai"]["rejected"])  # nothing unverified is printed
    sections = _sections(res.json())
    assert sections["summary"]["source"] == "RULE" and sections["summary"]["bullets"]  # insight bodies
    assert "appendix" not in sections  # nothing was cited


async def test_every_report_type_renders_without_ai(client) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    expected = {
        "DETAILED": {"methodology", "dimensions_table", "comparisons_table", "questions_table", "insights"},
        "IMPACT": {"impact", "comparisons_table", "sustainability", "methodology"},
        "MANAGEMENT": {"status", "indicators_table", "risks"},
        "ACADEMIC": {"methodology", "dimensions_table", "comparisons_table", "questions_table"},
    }
    for report_type, keys in expected.items():
        res = await client.post(
            f"{base}/reports",
            headers=demo["headers"],
            json={"report_type": report_type, "use_ai": False, "language": "en" if report_type == "ACADEMIC" else None},
        )
        assert res.status_code == 201, (report_type, res.text)
        sections = _sections(res.json())
        assert keys <= set(sections), (report_type, sorted(sections))
        assert res.json()["version"]["content"]["ai"] == {
            "requested": False,
            "used": False,
            "error": None,
            "rejected": [],
        }
    academic = _sections(res.json())
    assert academic["comparisons_table"]["columns"][-2] == "Statistic"  # t and df for an academic audience
    assert academic["methodology"]["items"][0]["label"] == "Design"


async def test_edits_and_refreshes_create_versions(client, register) -> None:
    demo = await _demo(client)
    base = f"/api/v1/projects/{demo['project_id']}"
    report = (
        await client.post(
            f"{base}/reports", headers=demo["headers"], json={"report_type": "EXECUTIVE", "use_ai": False}
        )
    ).json()
    url = f"/api/v1/reports/{report['id']}"
    original = _sections(report)["summary"]["paragraphs"]

    edited = await client.patch(
        url,
        headers=demo["headers"],
        json={
            "title": "تقرير مجلس الإدارة",
            "sections": [
                {"key": "summary", "paragraphs": ["ملخص كتبه الفريق.", "  "]},
                {"key": "key_figures", "hidden": True},
            ],
        },
    )
    assert edited.status_code == 200, edited.text
    out = edited.json()
    assert out["current_version"] == 2 and out["version"]["reason"] == "edited" and out["title"] == "تقرير مجلس الإدارة"
    sections = _sections(out)
    assert sections["summary"]["paragraphs"] == ["ملخص كتبه الفريق."] and sections["summary"]["source"] == "USER"
    assert sections["key_figures"]["hidden"] is True

    numbers = await client.patch(
        url, headers=demo["headers"], json={"sections": [{"key": "key_figures", "bullets": ["1"]}]}
    )
    assert numbers.status_code == 422 and numbers.json()["error"]["code"] == "not_editable"
    unchanged = await client.patch(
        url, headers=demo["headers"], json={"sections": [{"key": "key_figures", "hidden": True}]}
    )
    assert unchanged.json()["current_version"] == 2  # no change → no new version

    first = (await client.get(f"{url}?version=1", headers=demo["headers"])).json()
    assert _sections(first)["summary"]["paragraphs"] == original  # old versions are immutable

    refreshed = await client.post(f"{url}/regenerate", headers=demo["headers"], json={"use_ai": False, "tone": "PLAIN"})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["current_version"] == 3 and refreshed.json()["tone"] == "PLAIN"
    versions = (await client.get(f"{url}/versions", headers=demo["headers"])).json()
    assert [v["reason"] for v in versions] == ["refreshed", "edited", "generated"]
    assert versions[0]["responses"] == versions[2]["responses"] > 0

    # Viewers read reports but cannot create or change them; other organizations cannot see them.
    viewer = await add_member(
        client, {"headers": demo["headers"], "org_id": demo["org_id"]}, "viewer@x.example", "VIEWER", register
    )
    assert (await client.get(url, headers=viewer["headers_in_owner_org"])).status_code == 200
    denied = await client.post(
        f"{base}/reports", headers=viewer["headers_in_owner_org"], json={"report_type": "EXECUTIVE"}
    )
    assert denied.status_code == 403
    assert (await client.patch(url, headers=viewer["headers_in_owner_org"], json={"title": "x"})).status_code == 403
    outsider = await register(email="outsider@x.example", org="جهة أخرى")
    assert (await client.get(url, headers=outsider["headers"])).status_code == 404

    assert (await client.delete(url, headers=demo["headers"])).status_code == 200
    assert (await client.get(url, headers=demo["headers"])).status_code == 404
