"""Job CN: the generated contract of the building-materials modules (packages/contracts/materials.*) is current, has no duplicate names in the barrel, forbids what must never be sent, and says what the web may rely
on."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import jsonschema

from app.materials import contracts

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "materials.schema.json").read_text())


def definition(name: str) -> dict[str, Any]:
    found: dict[str, Any] = SCHEMA["$defs"][name]
    return found


def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "materials.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "materials.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_barrel_exports_it_and_no_name_is_defined_twice() -> None:
    mine = set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / "materials.ts").read_text()))
    assert 'export * from "./materials";' in (CONTRACTS / "index.ts").read_text()
    for other in ("crm", "evidence", "leads", "agents", "erasure", "packs"):
        names = set(re.findall(r"export (?:interface|type) (\w+)", (CONTRACTS / f"{other}.ts").read_text()))
        assert not mine & names, (other, mine & names)


def test_every_request_forbids_unknown_properties() -> None:
    for model in contracts.REQUESTS:
        node = definition(model.__name__)
        assert node.get("additionalProperties") is False, model.__name__


def test_nothing_a_caller_must_not_choose_can_be_sent() -> None:
    forbidden = {"tenant_id", "total", "total_paise", "tax", "tax_paise", "gst_rate", "status", "approved_by", "challan_no", "trip_no", "order_no", "canonical_hash", "request_text", "result_text", "bucket", "path"}
    for model in contracts.REQUESTS:
        props = set(definition(model.__name__).get("properties", {}))
        if model.__name__ == "TripStatusIn":
            props.discard("status")  # asking for a status is what that request is for (delivered is not among them)
        assert not props & forbidden, (model.__name__, props & forbidden)


def test_a_gst_rate_is_a_required_part_of_every_calculator_line() -> None:
    line = definition("CalcLineIn")
    assert "gst_bps" in line["required"] and "unit_price_paise" in line["required"]
    transport = definition("TransportIn")["properties"]
    assert "gst_bps" in transport, "the freight rate is part of the rules, entered by the owner"


def test_money_and_quantities_are_integers_everywhere() -> None:
    for name, node in SCHEMA["$defs"].items():
        for prop, spec in node.get("properties", {}).items():
            if prop.endswith(("_paise", "_bps", "_x100", "_x1000")) or prop in ("quantity", "pieces", "pallets", "trips", "material", "tax", "total", "gross", "transport", "handling", "laying", "subtotal"):
                kinds = {spec.get("type")} | {o.get("type") for o in spec.get("anyOf", [])}
                assert "number" not in kinds, f"{name}.{prop} is a float in the contract"


def test_a_real_calculator_answer_validates_against_the_contract() -> None:
    from app.materials import service
    from tests.cn_fakes import WORKED

    result = service.calculate(json.loads(json.dumps(WORKED))).model_dump(mode="json")
    jsonschema.Draft202012Validator({"$schema": SCHEMA["$schema"], "$ref": "#/$defs/CalcOut", "$defs": SCHEMA["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(result)


def test_the_enums_say_the_closed_lists() -> None:
    line = definition("CalcLineIn")["properties"]
    assert line["sold_per"]["enum"] == ["piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"]
    assert definition("TripStatusIn")["properties"]["status"]["enum"] == ["planned", "loaded", "on_the_way", "problem", "cancelled"], "delivered is made by the proof, never set"
    assert definition("PaymentIn")["properties"]["method"]["enum"] == ["cash", "upi", "bank_transfer", "cheque", "card", "other"]
    assert definition("RejectIn")["properties"]["code"]["enum"] == ["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"]
