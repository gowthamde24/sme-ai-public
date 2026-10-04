"""Integration tests for the Lead Review API (T005 milestone 2) against the real local stack.

Tests the full lifecycle end-to-end:
1. ICP Config publishing, versioning, and RBAC (owner/admin 201, sales 403, foreign 404).
2. Lead batch import preview and commit with deduplication / idempotency replay.
3. Review queue with blind scoring (scores hidden until labeled when blind=true).
4. Lead labeling (Good/Bad/Maybe, Bad requires reason code, append-only score snapshot).
5. Data export (CSV with formula injection neutralization and JSON, owner/admin only).
6. PostgREST data_exports record verification.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import httpx
import pytest
from conftest import bearer
from crm_support import World, uid

PATH = Path(__file__).resolve().parents[2] / "config" / "icp" / "silk-wholesale.v1.json"
ICP_TEMPLATE = json.loads(PATH.read_text(encoding="utf-8"))


@pytest.fixture
def w(crm_world: World) -> World:
    return crm_world


def test_icp_config_lifecycle(w: World) -> None:
    # 1. Foreign tenant gets 404
    r_foreign = w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs",
        json={"config": ICP_TEMPLATE},
        headers=bearer(w.b.users["owner"]),
    )
    assert r_foreign.status_code == 404

    # 2. Sales role gets 403
    r_sales = w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs",
        json={"config": ICP_TEMPLATE},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_sales.status_code == 403

    # 3. Owner publishes version 1
    r_v1 = w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs",
        json={"config": ICP_TEMPLATE},
        headers=bearer(w.a.users["owner"]),
    )
    assert r_v1.status_code == 201
    v1_data = r_v1.json()
    assert v1_data["version_no"] >= 1
    assert len(v1_data["config_sha256"]) == 64
    assert v1_data["engine"] == "icp-rules"

    # 4. Admin publishes version 2
    r_v2 = w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs",
        json={"config": ICP_TEMPLATE},
        headers=bearer(w.a.users["admin"]),
    )
    assert r_v2.status_code == 201
    v2_data = r_v2.json()
    assert v2_data["version_no"] == v1_data["version_no"] + 1

    # 5. Any member can read active config
    r_active = w.client.get(
        f"/v1/tenants/{w.a.id}/icp-configs/active",
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_active.status_code == 200
    assert r_active.json()["id"] == v2_data["id"]

    # 6. Any member can list configs
    r_list = w.client.get(
        f"/v1/tenants/{w.a.id}/icp-configs",
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_list.status_code == 200
    items = r_list.json()["items"]
    assert len(items) >= 2


def test_lead_import_and_deduplication(w: World) -> None:
    batch_id = uid()
    company_name = f"Sri Lakshmi Silks {batch_id[:6]}"
    rows = [
        {
            "company_name": company_name,
            "city": "Bengaluru",
            "buyer_type": "saree_shop",
            "contact_name": "Ramesh Kumar",
            "contact_phone": "+001234567890",
            "contact_email": f"ramesh_{batch_id[:6]}@example.test",
        },
        {
            "company_name": f"=1+1 Formula Injection Co {batch_id[:6]}",
            "city": "Dharmavaram",
            "buyer_type": "boutique",
        },
    ]

    # 1. Preview (dry run)
    r_prev = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import/preview",
        json={"batch_id": batch_id, "rows": rows},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_prev.status_code == 200
    prev_report = r_prev.json()
    assert prev_report["dry_run"] is True
    assert prev_report["counts"]["rows"] == 2
    assert prev_report["counts"]["companies_created"] == 2

    # 2. Commit import
    r_commit = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import",
        json={"batch_id": batch_id, "rows": rows, "label": "test-batch"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_commit.status_code == 201
    commit_report = r_commit.json()
    assert commit_report["replayed"] is False
    assert commit_report["counts"]["companies_created"] == 2
    assert commit_report["counts"]["contacts_created"] >= 1

    # 3. Idempotent replay: exact same batch_id returns replayed=True
    r_replay = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import",
        json={"batch_id": batch_id, "rows": rows},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_replay.status_code == 200
    replay_report = r_replay.json()
    assert replay_report["replayed"] is True


def test_review_queue_and_lead_labeling(w: World) -> None:
    # 1. Ensure active ICP config exists
    w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs",
        json={"config": ICP_TEMPLATE},
        headers=bearer(w.a.users["admin"]),
    )

    # 2. Import a distinct lead
    batch_id = uid()
    r_commit = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import",
        json={
            "batch_id": batch_id,
            "rows": [
                {
                    "company_name": f"Kanchipuram Silk Palace {batch_id[:6]}",
                    "city": "Bengaluru",
                    "buyer_type": "saree_shop",
                    "contact_name": "Suresh",
                    "contact_phone": "+009123456789",
                    "contact_email": f"suresh_{batch_id[:6]}@example.test",
                }
            ],
        },
        headers=bearer(w.a.users["sales"]),
    )
    assert r_commit.status_code == 201
    outcome = r_commit.json()["rows"][0]
    lead_id = outcome["lead_id"]
    assert lead_id is not None

    # 3. Review queue with blind=true: unlabeled lead score is hidden (None)
    r_blind = w.client.get(
        f"/v1/tenants/{w.a.id}/leads/review-queue?blind=true",
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_blind.status_code == 200
    items_blind = r_blind.json()["items"]
    target_blind = next((item for item in items_blind if item["lead_id"] == lead_id), None)
    assert target_blind is not None
    assert target_blind["score"] is None

    # 4. Review queue with blind=false: lead score is visible
    r_unblind = w.client.get(
        f"/v1/tenants/{w.a.id}/leads/review-queue?blind=false",
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_unblind.status_code == 200
    items_unblind = r_unblind.json()["items"]
    target_unblind = next((item for item in items_unblind if item["lead_id"] == lead_id), None)
    assert target_unblind is not None
    assert target_unblind["score"] is not None
    assert target_unblind["score_band"] in ("priority", "worth_reviewing", "maybe", "low_priority")

    # 5. Labeling validation: viewer cannot label (403)
    r_view_label = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        json={"label": "good"},
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_view_label.status_code == 403

    # 6. Bad label requires reason code (422)
    r_bad_missing = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        json={"label": "bad"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_bad_missing.status_code == 422

    # 7. Good label succeeds without reason code
    r_good = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        json={"label": "good"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_good.status_code == 201
    good_label = r_good.json()
    assert good_label["label"] == "good"
    assert good_label["reason_code"] is None
    assert good_label["score"] is not None
    assert good_label["snapshot"] is not None

    # 8. Changed mind: label as bad with reason_code succeeds
    r_bad = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        json={"label": "bad", "reason_code": "not_our_market"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_bad.status_code == 201
    bad_label = r_bad.json()
    assert bad_label["label"] == "bad"
    assert bad_label["reason_code"] == "not_our_market"

    # 9. List labels for lead: both are preserved (append-only)
    r_labels = w.client.get(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        headers=bearer(w.a.users["viewer"]),
    )
    assert r_labels.status_code == 200
    label_history = r_labels.json()["items"]
    assert len(label_history) >= 2
    assert [lh["label"] for lh in label_history[:2]] == ["bad", "good"]


def test_label_snapshot_equals_the_score_the_queue_showed(w: World) -> None:
    """Imported attributes are claims about the company. The score stored with a label must be the
    one the reviewer's queue view computed from the same claims, evidence and ICP version."""
    admin, sales = bearer(w.a.users["admin"]), bearer(w.a.users["sales"])
    published = w.client.post(
        f"/v1/tenants/{w.a.id}/icp-configs", json={"config": ICP_TEMPLATE}, headers=admin
    )
    assert published.status_code in (200, 201)
    active = w.client.get(f"/v1/tenants/{w.a.id}/icp-configs/active", headers=admin).json()

    batch = uid()
    imported = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import",
        json={
            "batch_id": batch,
            "rows": [
                {
                    "company_name": f"DEMO Claims Silks {batch[:6]}",
                    "city": "Bengaluru",
                    "industry": "Silk sarees",
                    "buyer_type": "saree_shop",
                    "size_band": "large",
                    "order_scale": "five_or_more_per_order",
                }
            ],
        },
        headers=sales,
    )
    assert imported.status_code == 201
    row = imported.json()["rows"][0]
    assert row["attributes_written"] == 3
    lead_id = row["lead_id"]

    queue = w.client.get(
        f"/v1/tenants/{w.a.id}/leads/review-queue?blind=false&limit=100", headers=sales
    ).json()["items"]
    shown = next(i for i in queue if i["lead_id"] == lead_id)
    assert shown["score"] is not None

    label = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels", json={"label": "good"}, headers=sales
    ).json()
    assert label["icp_version_id"] == active["id"]
    assert (label["score"], label["score_max_reachable"]) == (
        shown["score"],
        shown["score_max_reachable"],
    )
    assert label["snapshot"] == shown["snapshot"]
    assert label["snapshot"]["band"] == shown["score_band"]


def test_data_exports_csv_and_json_with_formula_sanitization(w: World) -> None:
    # 0. Ensure a lead exists and is labeled for Tenant A
    batch_id = uid()
    r_commit = w.client.post(
        f"/v1/tenants/{w.a.id}/leads/import",
        json={
            "batch_id": batch_id,
            "rows": [
                {
                    "company_name": f"=1+1 Formula Injection Co {batch_id[:6]}",
                    "city": "Dharmavaram",
                    "buyer_type": "boutique",
                }
            ],
        },
        headers=bearer(w.a.users["sales"]),
    )
    assert r_commit.status_code == 201
    lead_id = r_commit.json()["rows"][0]["lead_id"]
    w.client.post(
        f"/v1/tenants/{w.a.id}/leads/{lead_id}/labels",
        json={"label": "bad", "reason_code": "not_our_market"},
        headers=bearer(w.a.users["sales"]),
    )

    # 1. Non-admin cannot export (403)
    r_sales = w.client.post(
        f"/v1/tenants/{w.a.id}/exports",
        json={"kind": "lead_labels", "format": "csv"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r_sales.status_code == 403

    # 2. Admin exports CSV
    r_csv = w.client.post(
        f"/v1/tenants/{w.a.id}/exports",
        json={"kind": "lead_labels", "format": "csv"},
        headers=bearer(w.a.users["admin"]),
    )
    assert r_csv.status_code == 200
    assert r_csv.headers["content-type"] == "text/csv; charset=utf-8"
    assert "attachment; filename=" in r_csv.headers["content-disposition"]
    assert "X-Export-Sha256" in r_csv.headers
    assert int(r_csv.headers["X-Export-Rows"]) >= 1

    reader = csv.reader(io.StringIO(r_csv.text))
    rows = list(reader)
    assert len(rows) >= 2  # header + at least 1 data row
    header = rows[0]
    assert "lead_id" in header
    assert "label" in header
    assert "company_name" in header

    # Verify formula sanitisation: any field starting with =, +, -, @ must be prefixed with '
    for row in rows[1:]:
        for val in row:
            if val and val[0] in ("=", "+", "-", "@"):
                # If it starts with those characters unescaped, that's a security violation!
                pytest.fail(f"Formula injection vector found unescaped in CSV: {val}")

    # 3. Admin exports JSON
    r_json = w.client.post(
        f"/v1/tenants/{w.a.id}/exports",
        json={"kind": "lead_labels", "format": "json"},
        headers=bearer(w.a.users["admin"]),
    )
    assert r_json.status_code == 200
    assert "application/json" in r_json.headers["content-type"]
    json_data = r_json.json()
    assert isinstance(json_data, list)
    assert len(json_data) >= 1

    # 4. Check data_exports table in PostgREST
    r_audit = httpx.get(
        f"{w.stack.rest}/data_exports?tenant_id=eq.{w.a.id}&order=created_at.desc&limit=5",
        headers=w.stack.headers(w.a.users["admin"].token),
        timeout=15,
    )
    assert r_audit.status_code == 200
    audit_rows = r_audit.json()
    assert len(audit_rows) >= 2
    assert audit_rows[0]["kind"] == "lead_labels"
    assert audit_rows[0]["content_sha256"] == r_json.headers["X-Export-Sha256"]
