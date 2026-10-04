"""packages/contracts/crm.schema.json and crm.ts are generated from the API models."""

import json
from pathlib import Path

from app.crm.contracts import schema_text, ts_text

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"


def test_schema_file_is_up_to_date() -> None:
    assert (CONTRACTS / "crm.schema.json").read_text() == schema_text(), "run `make contracts`"


def test_typescript_file_is_up_to_date() -> None:
    assert (CONTRACTS / "crm.ts").read_text() == ts_text(), "run `make contracts`"


def test_the_barrel_exports_the_crm_types() -> None:
    assert 'export * from "./crm"' in (CONTRACTS / "index.ts").read_text()


def test_request_definitions_forbid_unknown_properties() -> None:
    import json

    defs = json.loads((CONTRACTS / "crm.schema.json").read_text())["$defs"]
    for name in defs:
        if name.endswith(("Create", "Update", "In")) or name.endswith("Out"):
            assert defs[name].get("additionalProperties") is False, name
    for name in [n for n in defs if n.endswith(("Create", "Update", "In"))]:
        props = set(defs[name]["properties"])
        assert not props & {
            "created_by",
            "created_via",
            "closed_at",
            "tenant_id",
            "archived_at",
            "email_consent",
            "whatsapp_consent",
            "phone_consent",
            "suppressed_at",
            "suppression_reason",
        } - ({"suppression_reason"} if name == "SuppressIn" else set()), name


# ==== evidence (T004) ====
def test_evidence_schema_and_typescript_are_up_to_date() -> None:
    from app.evidence import contracts

    assert (CONTRACTS / "evidence.schema.json").read_text() == contracts.schema_text(), (
        "run `make contracts`"
    )
    assert (CONTRACTS / "evidence.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_barrel_exports_the_evidence_types_without_duplicating_crm_names() -> None:
    import re

    assert 'export * from "./evidence"' in (CONTRACTS / "index.ts").read_text()
    crm = set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / "crm.ts").read_text()))
    evidence = set(
        re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / "evidence.ts").read_text())
    )
    assert not crm & evidence, f"duplicate export names break the barrel: {crm & evidence}"


def test_the_evidence_request_forbids_unknown_and_server_owned_properties() -> None:
    import json

    defs = json.loads((CONTRACTS / "evidence.schema.json").read_text())["$defs"]
    assert defs["EvidenceCreate"]["additionalProperties"] is False
    assert defs["EvidenceOut"]["additionalProperties"] is False
    assert defs["EvidenceLinkOut"]["additionalProperties"] is False
    assert not set(defs["EvidenceCreate"]["properties"]) & {
        "provider",
        "created_by",
        "created_via",
        "created_at",
        "tenant_id",
        "archived_at",
        "company_id",
        "lead_id",
        "claim_id",
        "stance",
    }
    assert defs["EvidenceCreate"]["properties"]["snippet"]["anyOf"][0]["maxLength"] == 1000


# ==== leads (T005) ====
def test_leads_schema_and_typescript_are_up_to_date() -> None:
    from app.leads import contracts

    assert (CONTRACTS / "leads.schema.json").read_text() == contracts.schema_text(), (
        "run `make contracts`"
    )
    assert (CONTRACTS / "leads.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_label_request_carries_a_client_id_and_nothing_server_owned() -> None:
    defs = json.loads((CONTRACTS / "leads.schema.json").read_text())["$defs"]
    create = defs["LeadLabelCreate"]
    assert "id" in create["properties"] and "id" in create["required"]
    assert create["additionalProperties"] is False
    assert not set(create["properties"]) & {
        "tenant_id",
        "lead_id",
        "created_by",
        "created_via",
        "created_at",
        "score",
        "snapshot",
        "icp_version_id",
    }


# ==== agent runs (T006) ====
def test_agents_schema_and_typescript_are_up_to_date() -> None:
    from app.agent_runs import contracts

    assert (CONTRACTS / "agents.schema.json").read_text() == contracts.schema_text(), (
        "run `make contracts`"
    )
    assert (CONTRACTS / "agents.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_barrel_exports_the_agents_types_without_duplicating_other_names() -> None:
    import re

    assert 'export * from "./agents"' in (CONTRACTS / "index.ts").read_text()
    names = {
        f: set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / f"{f}.ts").read_text()))
        for f in ("crm", "evidence", "leads", "agents")
    }
    for other in ("crm", "evidence", "leads"):
        assert not names["agents"] & names[other], f"duplicate export names with {other}"


def test_agent_requests_forbid_unknown_and_server_owned_properties() -> None:
    defs = json.loads((CONTRACTS / "agents.schema.json").read_text())["$defs"]
    server_owned = {
        "tenant_id",
        "created_by",
        "created_via",
        "started_by",
        "agent_version",
        "agent_run_id",
        "claim_confidence",
        "self_review",
        "budgets",
        "model",
        "provider",
    }
    for name in ("RunStart", "AgentSettingsIn", "ReviewIn"):
        assert defs[name]["additionalProperties"] is False, name
        assert not set(defs[name]["properties"]) & server_owned, name
    for name, node in defs.items():
        if name.endswith("Out"):
            assert node["additionalProperties"] is False, name
