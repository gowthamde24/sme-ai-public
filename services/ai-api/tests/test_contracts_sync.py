"""packages/contracts/crm.schema.json and crm.ts are generated from the API models."""

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
