"""Job CP: the generated contract of campaigns, the call list and the shared ledger (packages/contracts/campaigns.*) is current, has no duplicate names in the barrel, forbids what must never be sent, keeps money
and counts as integers, and is satisfied by what the routes really answer."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

import jsonschema

from app.campaigns import contracts
from tests.cn_fakes import FakeDues
from tests.cp_fakes import FakeCampaigns, LedgerCalls, call_item
from tests.fakes import TENANT_A, auth, make_client

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "campaigns.schema.json").read_text())
A = TENANT_A.id
U = uuid.UUID


def definition(name: str) -> dict[str, Any]:
    found: dict[str, Any] = SCHEMA["$defs"][name]
    return found


def validate(instance: Any, name: str) -> None:
    jsonschema.validate(instance, {"$ref": f"#/$defs/{name}", "$defs": SCHEMA["$defs"]})


def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "campaigns.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "campaigns.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_barrel_exports_it_and_no_name_is_defined_twice() -> None:
    mine = set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / "campaigns.ts").read_text()))
    assert 'export * from "./campaigns";' in (CONTRACTS / "index.ts").read_text()
    for other in ("crm", "evidence", "leads", "agents", "erasure", "packs", "materials"):
        names = set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / f"{other}.ts").read_text()))
        assert not mine & names, (other, mine & names)


def test_every_request_forbids_unknown_properties() -> None:
    for model in contracts.REQUESTS:
        assert definition(model.__name__).get("additionalProperties") is False, model.__name__


def test_nothing_a_caller_must_not_choose_can_be_sent() -> None:
    forbidden = {"tenant_id", "status", "approved_by", "approved_at", "content_sha256", "rendered", "body", "sender", "receipt_no", "receipt_seq", "recorded_by", "voided", "phone_number_id", "model", "prompt"}
    for model in contracts.REQUESTS:
        props = set(definition(model.__name__).get("properties", {}))
        assert not props & forbidden, (model.__name__, props & forbidden)


def test_money_and_counts_are_integers_everywhere() -> None:
    for name, node in SCHEMA["$defs"].items():
        for prop, spec in node.get("properties", {}).items():
            if prop.endswith(("_paise", "_hours", "_step", "_days")) or prop in ("recipients", "attempts", "seq", "step_no", "added", "removed", "planned_steps", "past_steps", "replied", "delivered_total"):
                kinds = {spec.get("type")} | {o.get("type") for o in spec.get("anyOf", [])}
                assert "number" not in kinds, f"{name}.{prop} is a float in the contract"


def test_the_approval_takes_the_hash_of_the_samples_that_were_seen_and_nothing_else() -> None:
    node = definition("ApproveIn")
    assert set(node["properties"]) == {"samples_sha256"} and node["required"] == ["samples_sha256"]
    assert node["properties"]["samples_sha256"]["pattern"] == "^[0-9a-f]{64}$"


def test_a_message_carries_at_most_ten_lakh_rupees() -> None:
    amount = definition("RecipientRowIn")["properties"]["amount_paise"]
    options = amount.get("anyOf", [amount])
    assert any(o.get("maximum") == 100_000_000 and o.get("minimum") == 1 for o in options), amount


def test_what_the_routes_really_answer_satisfies_the_contract() -> None:
    fake = FakeCampaigns()
    fake.items[str(U(int=0x1A))] = call_item(U(int=0x1A))

    class Dues(FakeDues, LedgerCalls):
        pass

    client, _ = make_client(campaigns=fake, dues=Dues())
    cid = U(int=0xCA)
    headers = auth("a_owner")
    base = f"/v1/tenants/{A}"
    body = {"name": "October dues", "kind": "payment_due", "language": "en", "wa_template_id": str(U(int=0x7E)), "message_text": "Dear {{name}}, payment of {{amount}} is due on {{due_date}}.",
            "steps": [{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]}  # fmt: skip
    validate(body, "CampaignIn")
    saved = client.put(f"{base}/campaigns/{cid}", json=body, headers=headers).json()
    validate(saved["campaign"], "CampaignOut")
    rows = {"rows": [{"contact_id": str(U(int=0x200)), "due_date": "2026-11-10", "amount_paise": 500000, "reference": "INV-1"}]}
    validate(rows, "RecipientsIn")
    validate(client.post(f"{base}/campaigns/{cid}/recipients", json=rows, headers=headers).json(), "RecipientsAddedOut")
    validate(client.get(f"{base}/campaigns/{cid}", headers=headers).json(), "CampaignDetailOut")
    validate(client.get(f"{base}/campaigns", headers=headers).json(), "CampaignListOut")
    for item in client.get(f"{base}/campaigns/{cid}/recipients", headers=headers).json():
        validate(item, "RecipientOut")
    preview = client.get(f"{base}/campaigns/{cid}/preview", headers=headers).json()
    validate(preview, "PreviewOut")
    approve = {"samples_sha256": preview["samples_sha256"]}
    validate(approve, "ApproveIn")
    validate(client.post(f"{base}/campaigns/{cid}/approve", json=approve, headers=headers).json(), "ApprovedOut")
    validate(client.get(f"{base}/campaigns/{cid}/results", headers=headers).json(), "ResultsOut")
    validate(client.get(f"{base}/call-list", headers=headers).json(), "CallListOut")
    outcome = {"outcome": "paid"}
    validate(outcome, "OutcomeIn")
    validate(client.post(f"{base}/call-list/{U(int=0x1A)}/outcome", json=outcome, headers=headers).json(), "OutcomeRecordedOut")
    ledger_body = {"kind": "payment", "contact_id": str(U(int=0x200)), "entry_date": "2026-09-05", "amount_paise": 800000, "method": "upi"}
    validate(ledger_body, "EntryIn")
    validate(client.put(f"{base}/ledger/entries/{U(int=0xE1)}", json=ledger_body, headers=headers).json(), "EntryRecordedOut")
    validate(client.get(f"{base}/ledger/entries?contact_id={U(int=0x200)}", headers=headers).json(), "EntriesOut")
    validate(client.get(f"{base}/ledger/receipts/{U(int=0xE1)}", headers=headers).json(), "ReceiptOut")
    validate(client.post(f"{base}/ledger/entries/{U(int=0xE1)}/void", headers=headers).json(), "EntryVoidedOut")
    charges = {"batch_id": str(U(int=0x99)), "rows": [{"contact_id": str(U(int=0x200)), "entry_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 100, "reference": "Tuition T1"}]}
    validate(charges, "ChargesImportIn")
    validate(client.post(f"{base}/ledger/charges/import", json=charges, headers=headers).json(), "ChargesImportOut")
