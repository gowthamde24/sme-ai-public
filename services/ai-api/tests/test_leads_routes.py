"""HTTP behaviour of the lead review, import, ICP config, and export endpoints.

Tests authorization order (401 -> 404 for foreign tenant -> 403 for role), schema validation,
dry-run vs commit import, review queue blind scoring, label validation rules (bad requires reason),
and CSV / JSON exports.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from tests.fakes import (
    TENANT_A,
    TENANT_B,
    FakeCrmRepository,
    FakeEvidenceRepository,
    FakeLeadsRepository,
    auth,
    make_client,
)

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "contracts" / "leads.schema.json"
    ).read_text(encoding="utf-8")
)

PATH_ICP = Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json"
ICP_TEMPLATE = json.loads(PATH_ICP.read_text(encoding="utf-8"))

ROLES_A = ["a_owner", "a_admin", "a_sales", "a_viewer"]
SALES_PLUS = ["a_owner", "a_admin", "a_sales"]
ADMIN_PLUS = ["a_owner", "a_admin"]


def validate(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


class Env:
    def __init__(self) -> None:
        self.crm = FakeCrmRepository()
        self.evidence = FakeEvidenceRepository()
        self.leads = FakeLeadsRepository()
        self.client, self.repo = make_client(
            crm=self.crm, evidence=self.evidence, leads=self.leads
        )

    def base_url(self, tenant: Any = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}"


@pytest.fixture
def env() -> Env:
    return Env()


# =================================================================== Authentication & Tenancy
def test_all_endpoints_require_token(env: Env) -> None:
    base = env.base_url()
    assert env.client.get(f"{base}/icp-configs").status_code == 401
    assert env.client.post(f"{base}/icp-configs", json={"config": {}}).status_code == 401
    assert env.client.get(f"{base}/icp-configs/{uuid.uuid4()}").status_code == 401
    assert (
        env.client.post(
            f"{base}/leads/import/preview",
            json={"batch_id": str(uuid.uuid4()), "rows": []},
        ).status_code
        == 401
    )
    assert (
        env.client.post(
            f"{base}/leads/import",
            json={"batch_id": str(uuid.uuid4()), "rows": []},
        ).status_code
        == 401
    )
    assert env.client.get(f"{base}/leads/review-queue").status_code == 401
    assert (
        env.client.post(
            f"{base}/leads/{uuid.uuid4()}/labels",
            json={"label": "good"},
        ).status_code
        == 401
    )
    assert env.client.get(f"{base}/leads/{uuid.uuid4()}/labels").status_code == 401
    assert (
        env.client.post(
            f"{base}/exports",
            json={"kind": "lead_labels", "format": "csv"},
        ).status_code
        == 401
    )


@pytest.mark.parametrize("user", [*ROLES_A, "outsider"])
def test_foreign_tenant_is_404_for_every_role(env: Env, user: str) -> None:
    headers = auth(user)
    foreign = env.base_url(tenant=TENANT_B.id if user in ROLES_A else TENANT_A.id)

    assert env.client.get(f"{foreign}/icp-configs", headers=headers).status_code == 404
    assert (
        env.client.post(f"{foreign}/icp-configs", json={"config": {}}, headers=headers).status_code
        == 404
    )
    assert (
        env.client.get(f"{foreign}/icp-configs/{uuid.uuid4()}", headers=headers).status_code == 404
    )
    assert (
        env.client.post(
            f"{foreign}/leads/import/preview",
            json={"batch_id": str(uuid.uuid4()), "rows": []},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        env.client.post(
            f"{foreign}/leads/import",
            json={"batch_id": str(uuid.uuid4()), "rows": []},
            headers=headers,
        ).status_code
        == 404
    )
    assert env.client.get(f"{foreign}/leads/review-queue", headers=headers).status_code == 404
    assert (
        env.client.post(
            f"{foreign}/leads/{uuid.uuid4()}/labels",
            json={"label": "good"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        env.client.get(f"{foreign}/leads/{uuid.uuid4()}/labels", headers=headers).status_code
        == 404
    )
    assert (
        env.client.post(
            f"{foreign}/exports",
            json={"kind": "lead_labels", "format": "csv"},
            headers=headers,
        ).status_code
        == 404
    )


# ============================================================================= Role Matrix
def test_icp_config_publish_role_matrix(env: Env) -> None:
    base = env.base_url()
    body = {"config": ICP_TEMPLATE}
    for user in ADMIN_PLUS:
        res = env.client.post(f"{base}/icp-configs", json=body, headers=auth(user))
        assert res.status_code == 201, f"{user} should be able to publish ICP config"
        validate(res.json(), "IcpConfigOut")

    for user in ["a_sales", "a_viewer"]:
        res = env.client.post(f"{base}/icp-configs", json=body, headers=auth(user))
        assert res.status_code == 403, f"{user} should NOT be able to publish ICP config"


def test_lead_import_role_matrix(env: Env) -> None:
    base = env.base_url()
    body = {
        "batch_id": str(uuid.uuid4()),
        "rows": [{"company_name": "Test Co", "city": "Bengaluru"}],
    }
    for user in SALES_PLUS:
        res_preview = env.client.post(
            f"{base}/leads/import/preview", json=body, headers=auth(user)
        )
        assert res_preview.status_code == 200, f"{user} should be able to preview import"
        validate(res_preview.json(), "ImportBatchReport")

        res_commit = env.client.post(
            f"{base}/leads/import",
            json={**body, "batch_id": str(uuid.uuid4())},
            headers=auth(user),
        )
        assert res_commit.status_code == 201, f"{user} should be able to commit import"
        validate(res_commit.json(), "ImportBatchReport")

    # Viewer cannot import
    assert (
        env.client.post(
            f"{base}/leads/import/preview", json=body, headers=auth("a_viewer")
        ).status_code
        == 403
    )
    assert (
        env.client.post(f"{base}/leads/import", json=body, headers=auth("a_viewer")).status_code
        == 403
    )


def test_export_role_matrix(env: Env) -> None:
    base = env.base_url()
    body = {"kind": "lead_labels", "format": "csv"}
    for user in ADMIN_PLUS:
        res = env.client.post(f"{base}/exports", json=body, headers=auth(user))
        assert res.status_code == 200, f"{user} should be able to export"

    for user in ["a_sales", "a_viewer"]:
        res = env.client.post(f"{base}/exports", json=body, headers=auth(user))
        assert res.status_code == 403, f"{user} should NOT be able to export"


# ============================================================================= ICP Configs
def test_publish_and_retrieve_icp_config(env: Env) -> None:
    base = env.base_url()
    res = env.client.post(
        f"{base}/icp-configs", json={"config": ICP_TEMPLATE}, headers=auth("a_admin")
    )
    assert res.status_code == 201
    data = res.json()
    assert data["version_no"] == 1
    assert data["engine"] == "icp-rules"
    cfg_id = data["id"]

    # Retrieve by id
    get_res = env.client.get(f"{base}/icp-configs/{cfg_id}", headers=auth("a_viewer"))
    assert get_res.status_code == 200
    assert get_res.json()["id"] == cfg_id

    # List configs
    list_res = env.client.get(f"{base}/icp-configs", headers=auth("a_sales"))
    assert list_res.status_code == 200
    assert len(list_res.json()["items"]) == 1


def test_publish_invalid_icp_config_rejected(env: Env) -> None:
    base = env.base_url()
    # Bad config where factors don't sum to 100
    bad_cfg = {**ICP_TEMPLATE, "factors": [{**ICP_TEMPLATE["factors"][0], "max_points": 50}]}
    res = env.client.post(f"{base}/icp-configs", json={"config": bad_cfg}, headers=auth("a_admin"))
    assert res.status_code == 422


# ============================================================================= Lead Import
def test_lead_import_preview_and_commit(env: Env) -> None:
    base = env.base_url()
    batch_id = str(uuid.uuid4())
    rows = [
        {"company_name": "Silk House", "city": "Bengaluru", "contact_name": "Anil"},
        {"company_name": "Saree Mandir", "city": "Dharmavaram"},
    ]
    # Preview
    res = env.client.post(
        f"{base}/leads/import/preview",
        json={"batch_id": batch_id, "rows": rows, "label": "Spring 2026 Batch"},
        headers=auth("a_sales"),
    )
    assert res.status_code == 200
    report = res.json()
    assert report["dry_run"] is True
    assert report["counts"]["rows"] == 2
    assert len(report["rows"]) == 2

    # Commit
    res_commit = env.client.post(
        f"{base}/leads/import",
        json={"batch_id": batch_id, "rows": rows, "label": "Spring 2026 Batch"},
        headers=auth("a_sales"),
    )
    assert res_commit.status_code == 201
    report_commit = res_commit.json()
    assert report_commit["dry_run"] is False
    assert report_commit["batch_id"] == batch_id


# ============================================================================= Lead Labeling
def test_lead_labeling_validation_and_scoring(env: Env) -> None:
    base = env.base_url()

    # 1. Publish ICP config
    env.client.post(f"{base}/icp-configs", json={"config": ICP_TEMPLATE}, headers=auth("a_admin"))

    # 2. Seed a lead in CRM
    company_id = uuid.uuid4()
    lead_id = uuid.uuid4()
    env.crm.seed("companies", TENANT_A.id, company_id, name="Sri Balaji Sarees", city="bengaluru")
    env.crm.seed("leads", TENANT_A.id, lead_id, company_id=str(company_id))

    # 3. Label "good" without reason code -> 201
    res_good = env.client.post(
        f"{base}/leads/{lead_id}/labels",
        json={"label": "good"},
        headers=auth("a_sales"),
    )
    assert res_good.status_code == 201
    label_data = res_good.json()
    validate(label_data, "LeadLabelOut")
    assert label_data["label"] == "good"
    assert label_data["reason_code"] is None
    # Score snapshot should be present
    assert label_data["score"] is not None

    # 4. Label "bad" without reason code -> 422
    res_bad_no_reason = env.client.post(
        f"{base}/leads/{lead_id}/labels",
        json={"label": "bad"},
        headers=auth("a_sales"),
    )
    assert res_bad_no_reason.status_code == 422

    # 5. Label "bad" with reason code -> 201
    res_bad = env.client.post(
        f"{base}/leads/{lead_id}/labels",
        json={"label": "bad", "reason_code": "not_our_market"},
        headers=auth("a_sales"),
    )
    assert res_bad.status_code == 201
    assert res_bad.json()["reason_code"] == "not_our_market"

    # 6. Label "good" with reason code -> 422
    res_good_with_reason = env.client.post(
        f"{base}/leads/{lead_id}/labels",
        json={"label": "good", "reason_code": "not_our_market"},
        headers=auth("a_sales"),
    )
    assert res_good_with_reason.status_code == 422

    # 7. List labels for lead
    res_list = env.client.get(f"{base}/leads/{lead_id}/labels", headers=auth("a_viewer"))
    assert res_list.status_code == 200
    assert len(res_list.json()["items"]) >= 2


def test_labeling_nonexistent_lead_returns_404(env: Env) -> None:
    base = env.base_url()
    missing_lead = uuid.uuid4()
    res = env.client.post(
        f"{base}/leads/{missing_lead}/labels",
        json={"label": "good"},
        headers=auth("a_sales"),
    )
    assert res.status_code == 404


# ============================================================================= Review Queue
def test_review_queue_blind_scoring(env: Env) -> None:
    base = env.base_url()

    # Setup fake review queue items
    from datetime import UTC, datetime

    from app.leads.models import ReviewQueueLeadOut

    unlabeled_id = uuid.uuid4()

    env.leads.review_queue_leads[TENANT_A.id] = [
        ReviewQueueLeadOut(
            lead_id=unlabeled_id,
            status="new",
            source="import",
            created_at=datetime.now(UTC),
            company={"name": "Unlabeled Co", "city": "Bengaluru"},
            contact=None,
            latest_label=None,
            score=None,  # hidden because blind
            score_max_reachable=None,
            score_band=None,
            snapshot=None,
        ),
    ]

    # Query with default blind=true
    res_blind = env.client.get(f"{base}/leads/review-queue", headers=auth("a_sales"))
    assert res_blind.status_code == 200
    items = res_blind.json()["items"]
    assert len(items) == 1
    assert items[0]["score"] is None, "unlabeled lead score must be hidden when blind"

    validate(items[0], "ReviewQueueLeadOut")


# ============================================================================= Data Export
def test_export_csv_and_json(env: Env) -> None:
    base = env.base_url()

    # Seed a label
    lead_id = uuid.uuid4()
    from datetime import UTC, datetime

    from app.crm.models import RecordOrigin
    from app.leads.models import LeadLabel, LeadLabelOut, LeadLabelReason

    env.leads.labels[TENANT_A.id] = [
        LeadLabelOut(
            id=uuid.uuid4(),
            tenant_id=TENANT_A.id,
            lead_id=lead_id,
            label=LeadLabel.BAD,
            reason_code=LeadLabelReason.NOT_OUR_MARKET,
            icp_version_id=None,
            score=30,
            score_max_reachable=100,
            snapshot=None,
            created_by=None,
            created_via=RecordOrigin.MANUAL,
            created_at=datetime.now(UTC),
        )
    ]

    # 1. Export CSV
    res_csv = env.client.post(
        f"{base}/exports",
        json={"kind": "lead_labels", "format": "csv"},
        headers=auth("a_admin"),
    )
    assert res_csv.status_code == 200
    assert res_csv.headers["content-type"] == "text/csv; charset=utf-8"
    assert "attachment; filename=" in res_csv.headers["content-disposition"]
    assert "X-Export-Sha256" in res_csv.headers
    assert int(res_csv.headers["X-Export-Rows"]) >= 1
    assert "lead_id,company_name,company_city" in res_csv.text

    # 2. Export JSON
    res_json = env.client.post(
        f"{base}/exports",
        json={"kind": "lead_labels", "format": "json"},
        headers=auth("a_admin"),
    )
    assert res_json.status_code == 200
    assert res_json.headers["content-type"] == "application/json; charset=utf-8"
    json_data = json.loads(res_json.text)
    assert len(json_data) >= 1
    assert json_data[0]["label"] == "bad"
