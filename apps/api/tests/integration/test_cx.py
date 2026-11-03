"""Customer experience: branch links and kiosks, the closed loop, the CX dashboard, POS branch codes."""

from __future__ import annotations

import json
import random
from typing import Any

from app.db.session import get_sessionmaker
from app.domain.enums import ReviewStatus
from app.domain.stores import sign_custom
from app.models import Answer, AuditLog, CxCase, Response
from helpers import add_member
from sqlalchemy import func, select, update

VISIT_PROMOTER = {
    "visit_csat": 5,
    "staff": 5,
    "checkout": 4,
    "availability": 5,
    "cleanliness": 5,
    "value": 4,
    "visit_nps": 10,
    "visit_praise": "الموظفون متعاونون",
}


async def _branch_project(client, owner) -> dict[str, Any]:
    h = owner["headers"]
    project = (
        await client.post(
            "/api/v1/projects", headers=h, json={"title": "تجربة عملاء الفروع", "measurement_type": "SATISFACTION"}
        )
    ).json()
    created = await client.post(
        f"/api/v1/projects/{project['id']}/surveys/from-template", headers=h, json={"template": "store_visit"}
    )
    assert created.status_code == 201, created.text
    survey = created.json()["survey"]
    published = await client.post(f"/api/v1/surveys/{survey['id']}/publish", headers=h)
    assert published.status_code == 200, published.text
    branches = []
    for name in ("فرع العليا", "فرع النخيل"):
        res = await client.post(
            f"/api/v1/projects/{project['id']}/locations", headers=h, json={"name": name, "city": "الرياض"}
        )
        assert res.status_code == 201, res.text
        branches.append(res.json())
    return {"id": project["id"], "survey": published.json()["survey"], "branches": branches}


async def _submit(client, public_id: str, answers: dict[str, Any], **extra: Any):  # type: ignore[no-untyped-def]
    loc = extra.get("location")
    opened = (await client.get(f"/api/v1/public/surveys/{public_id}" + (f"?loc={loc}" if loc else ""))).json()
    res = await client.post(
        f"/api/v1/public/surveys/{public_id}/responses",
        json={"session": opened["session"], "answers": answers, **extra},
    )
    return opened, res


async def test_branch_links_kiosk_and_closed_loop(client, register) -> None:
    owner = await register()
    project = await _branch_project(client, owner)
    h = owner["headers"]
    assert [b["code"] for b in project["branches"]] == ["B01", "B02"]  # generated codes
    taken = await client.post(
        f"/api/v1/projects/{project['id']}/locations", headers=h, json={"name": "x", "code": "b01"}
    )
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "location_code_taken"

    pid = project["survey"]["public_id"]
    opened = (await client.get(f"/api/v1/public/surveys/{pid}?loc=B01")).json()
    assert opened["location"] == {"code": "B01", "name": "فرع العليا"}
    assert opened["doc"]["introduction"].startswith("شكرًا لزيارتك فرع العليا")  # {{branch}} piped
    assert opened["doc"]["settings"]["experience"] == "pulse" and "closed_loop" not in opened["doc"]["settings"]
    phone_q = next(q for s in opened["doc"]["sections"] for q in s["questions"] if q["key"] == "visit_contact")
    assert phone_q["settings"]["contact_field"] == "phone" and "cx_role" not in phone_q["settings"]
    unknown = (await client.get(f"/api/v1/public/surveys/{pid}?loc=NOPE")).json()
    assert unknown["location"] is None and unknown["doc"]["introduction"].startswith("شكرًا لزيارتك فرعنا")

    detractor = {
        "visit_csat": 2,
        "staff": 2,
        "checkout": 1,
        "availability": 3,
        "cleanliness": 3,
        "value": 2,
        "visit_nps": 3,
        "visit_improve": "الانتظار عند المحاسب طويل",
        "visit_contact_ok": "yes",
    }
    _, bad = await _submit(client, pid, {**detractor, "visit_contact": "12"}, location="B01", channel="KIOSK")
    assert (
        bad.status_code == 422 and bad.json()["error"]["details"]["errors"]["visit_contact"]["code"] == "invalid_phone"
    )
    _, missing = await _submit(client, pid, detractor, location="B01", channel="KIOSK")
    assert missing.status_code == 422  # asked for a call back: the number is required
    _, ok = await _submit(client, pid, {**detractor, "visit_contact": "٠٥٥ ١٢٣ ٤٥٦٧"}, location="B01", channel="KIOSK")
    assert ok.status_code == 201, ok.text
    _, happy = await _submit(client, pid, VISIT_PROMOTER, location="B02", channel="QR")
    assert happy.status_code == 201, happy.text

    async with get_sessionmaker()() as session:
        response = await session.get(Response, ok.json()["response_id"])
        assert response is not None and response.channel.value == "KIOSK"
        assert response.meta["location"]["name"] == "فرع العليا" and response.meta["location"]["code"] == "B01"
        stored = set(
            (await session.scalars(select(Answer.question_key).where(Answer.response_id == response.id))).all()
        )
        assert "visit_contact" not in stored and "visit_nps" in stored  # contact details are never answers
        cases = (await session.scalars(select(CxCase))).all()
    assert len(cases) == 1 and cases[0].reason.value == "DETRACTOR" and cases[0].score == 3
    assert cases[0].contact_requested and cases[0].contact_encrypted and "0551234567" not in cases[0].contact_encrypted

    listed = (await client.get(f"/api/v1/projects/{project['id']}/cx/cases", headers=h)).json()
    case = listed[0]
    assert case["location"] == "فرع العليا" and case["has_contact"] and "الانتظار" in (case["comment"] or "")
    contact = await client.post(f"/api/v1/cx/cases/{case['id']}/contact", headers=h)
    assert contact.json() == {"phone": "0551234567"}  # Arabic-Indic digits and spaces normalized

    viewer = await add_member(client, owner, "viewer-cx@x.example", "VIEWER", register)
    hidden = (
        await client.get(f"/api/v1/projects/{project['id']}/cx/cases", headers=viewer["headers_in_owner_org"])
    ).json()
    assert hidden[0]["comment"] is None  # customers' words need raw-answer access
    assert (
        await client.post(f"/api/v1/cx/cases/{case['id']}/contact", headers=viewer["headers_in_owner_org"])
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/cx/cases/{case['id']}", headers=viewer["headers_in_owner_org"], json={"assign_to_me": True}
        )
    ).status_code == 403

    mine = (await client.patch(f"/api/v1/cx/cases/{case['id']}", headers=h, json={"assign_to_me": True})).json()
    assert mine["status"] == "IN_PROGRESS" and mine["assigned_to"] and "الانتظار" in (mine["comment"] or "")
    no_note = await client.patch(f"/api/v1/cx/cases/{case['id']}", headers=h, json={"status": "RESOLVED"})
    assert no_note.status_code == 422 and no_note.json()["error"]["code"] == "resolution_note_required"
    done = (
        await client.patch(
            f"/api/v1/cx/cases/{case['id']}",
            headers=h,
            json={"status": "RESOLVED", "resolution_note": "اتصلنا بالعميل واعتذرنا"},
        )
    ).json()
    assert done["status"] == "RESOLVED" and not done["has_contact"]  # erased once resolved
    async with get_sessionmaker()() as session:
        reveals = await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "cx.contact_reveal")
        )
    assert reveals == 1


async def test_dashboard_trio_branches_and_key_drivers(client, register) -> None:
    owner = await register(email="cx-dash@x.example")
    project = await _branch_project(client, owner)
    pid = project["survey"]["public_id"]
    rng = random.Random(7)
    for i in range(36):
        # Staff drives loyalty strongly; cleanliness barely matters in this synthetic sample.
        staff = rng.randint(1, 5)
        cleanliness = rng.randint(3, 5)
        nps = max(0, min(10, staff * 2 + rng.choice([-1, 0, 0, 1])))
        answers = {
            "visit_csat": max(1, min(5, staff + rng.choice([-1, 0, 1]))),
            "staff": staff,
            "checkout": rng.randint(2, 5),
            "availability": rng.randint(2, 5),
            "cleanliness": cleanliness,
            "value": rng.randint(2, 5),
            "visit_nps": nps,
        }
        if nps <= 6:
            answers["visit_contact_ok"] = "no"
        branch = "B01" if i % 3 else "B02"
        _, res = await _submit(client, pid, answers, location=branch, channel="QR")
        assert res.status_code == 201, res.text
    async with get_sessionmaker()() as session:
        # Fast synthetic answers look like speeding: keep them, as a reviewer would.
        await session.execute(update(Response).values(review_status=ReviewStatus.KEEP))
        await session.commit()

    dash = (await client.get(f"/api/v1/projects/{project['id']}/cx", headers=owner["headers"])).json()
    assert dash["has_cx"] is True and dash["overall"]["n"] == 36
    nps = dash["overall"]["nps"]
    assert nps["n"] == 36 and abs(nps["promoters"] - nps["detractors"] - nps["score"]) < 0.01 and nps["suitable"]
    assert set(dash["channels"]) == {"branch"} and dash["channels"]["branch"]["n"] == 36  # every visit came by QR
    assert 0 <= dash["overall"]["csat"]["pct"] <= 100 and "ces" not in dash["overall"]  # the visit survey has no CES
    by_name = {loc["name"]: loc for loc in dash["locations"]}
    assert by_name["فرع العليا"]["n"] == 24 and by_name["فرع النخيل"]["n"] == 12
    drivers = {d["key"]: d for d in dash["drivers"]["items"]}
    assert dash["drivers"]["outcome"]["key"] == "visit_nps"
    assert set(drivers) == {"staff", "checkout", "availability", "cleanliness", "value"}
    assert drivers["staff"]["importance"] > 0.8 and drivers["staff"]["pairs"] == 36
    assert drivers["staff"]["importance"] == max(d["importance"] for d in drivers.values())
    assert all(d["quadrant"] in {"fix", "keep", "maintain", "monitor"} for d in drivers.values())
    assert dash["weekly"] and dash["weekly"][-1]["n"] >= 5
    assert dash["cases"]["open"] >= 1  # detractors opened cases

    segmented = await client.get(
        f"/api/v1/projects/{project['id']}/analytics/questions?segment=location", headers=owner["headers"]
    )
    assert segmented.status_code == 200, segmented.text


async def test_pos_transactions_carry_the_branch(client, register) -> None:
    owner = await register(email="pos@x.example")
    project = await _branch_project(client, owner)
    h = owner["headers"]
    conn = (
        await client.post(
            f"/api/v1/projects/{project['id']}/store-connections",
            headers=h,
            json={
                "platform": "CUSTOM",
                "name": "نقاط البيع",
                "store_survey_id": project["survey"]["id"],
                "secret": "pos-secret-for-tests",
            },
        )
    ).json()
    hook = "/api/v1/" + conn["webhook_url"].split("/api/v1/", 1)[1]
    body = json.dumps(
        {"event": "order.completed", "order": {"id": "R-1001", "status": "completed", "branch": "B02", "items": []}}
    ).encode()
    res = await client.post(
        hook,
        content=body,
        headers={"X-Meqyas-Signature": sign_custom("pos-secret-for-tests", body), "Content-Type": "application/json"},
    )
    assert res.status_code == 200, res.text
    url = res.json()["invitations"][0]["url"]
    public_id, token = url.split("/s/", 1)[1].split("?inv=")
    opened = (await client.get(f"/api/v1/public/surveys/{public_id}?inv={token}")).json()
    assert opened["doc"]["introduction"].startswith("شكرًا لزيارتك فرع النخيل")  # the branch from the POS
    submitted = await client.post(
        f"/api/v1/public/surveys/{public_id}/responses",
        json={"session": opened["session"], "answers": VISIT_PROMOTER, "invitation": token},
    )
    assert submitted.status_code == 201, submitted.text
    async with get_sessionmaker()() as session:
        response = await session.get(Response, submitted.json()["response_id"])
    assert (
        response is not None
        and response.meta["location"]["code"] == "B02"
        and response.meta["store"]["name"] == "نقاط البيع"
    )
    assert response.channel.value == "STORE"
    dash = (await client.get(f"/api/v1/projects/{project['id']}/cx", headers=h)).json()
    assert set(dash["channels"]) == {"branch"}  # a POS receipt is a branch visit, not an online order


async def test_demo_chain_tells_a_true_story(client, register) -> None:
    """The CX demo seed: ten weeks at three branches, with staff driving loyalty and slow
    checkouts at one branch — the dashboard must surface exactly that."""
    import uuid

    from app.models import Organization, Project
    from app.seed.demo_cx import TITLE, seed_demo_cx

    owner = await register(email="cx-demo@x.example")
    async with get_sessionmaker()() as session:
        org = await session.get(Organization, uuid.UUID(owner["org_id"]))
        assert org is not None
        await seed_demo_cx(session, org)
        await seed_demo_cx(session, org)  # idempotent
        projects = (await session.scalars(select(Project).where(Project.title == TITLE))).all()
    assert len(projects) == 1 and projects[0].is_demo
    dash = (await client.get(f"/api/v1/projects/{projects[0].id}/cx", headers=owner["headers"])).json()
    assert dash["overall"]["n"] > 150 and not dash["overall"]["nps"].get("masked")
    drivers = {d["key"]: d for d in dash["drivers"]["items"]}
    assert max(drivers.values(), key=lambda d: d["importance"])["key"] == "staff"
    assert drivers["cleanliness"]["quadrant"] in {"maintain", "monitor"}  # high performance, weak link
    by_branch = {b["name"]: b for b in dash["locations"]}
    assert by_branch["فرع العليا"]["nps"]["score"] > by_branch["فرع الحمراء"]["nps"]["score"]
    assert len([w for w in dash["weekly"] if not w["nps"].get("masked")]) >= 8
    cases = dash["cases"]
    assert cases["resolved"] > 0 and cases["open"] > 0 and cases["within_sla_pct"] is not None
    listed = (
        await client.get(f"/api/v1/projects/{projects[0].id}/cx/cases?status=all", headers=owner["headers"])
    ).json()
    assert all(not c["has_contact"] for c in listed if c["status"] == "RESOLVED")  # erased once resolved
    pending = [c for c in listed if c["status"] != "RESOLVED"]
    assert any(not c["overdue"] for c in pending) and any(c["location"] == "فرع الحمراء" for c in pending)
    # A work queue: unresolved cases first, earliest due first.
    assert [c["status"] for c in listed].index("RESOLVED") == len(pending)
    assert [c["due_at"] for c in pending] == sorted(c["due_at"] for c in pending)
