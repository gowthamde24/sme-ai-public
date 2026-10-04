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
