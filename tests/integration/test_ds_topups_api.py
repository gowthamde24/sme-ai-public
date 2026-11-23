"""Job DS part E2 on the real local stack, through HTTP: a plan chosen, a pack bought (fake payment) and bought again with the same id, the meter and the invoice read back through the strict response models and checked against the generated
contract, the settings, the upgrade preview and the upgrade during the trial.

What this proves that the pgTAP file (129) and the unit tests cannot: the database's answers are accepted by the strict models (no key we did not declare, none missing) and conform to billing.schema.json."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
from conftest import aal1_token, bearer

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "packages" / "contracts" / "billing.schema.json").read_text(encoding="utf-8"))


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def test_a_pack_is_bought_once_read_back_and_the_upgrade_preview_conforms(client: Any, stack: Any, eval_world: Any) -> None:
    a = eval_world.a
    base = f"/v1/tenants/{a.id}/billing"
    owner, admin, sales = bearer(a.users["owner"]), bearer(a.users["admin"]), bearer(a.users["sales"])
    assert client.post(f"{base}/trial", json={"plan_id": "starter", "checkout_ref": "pm_fake_ok"}, headers=owner).status_code == 200

    got = client.get(f"{base}/topups", headers=admin)
    assert got.status_code == 200, got.text
    conforms(got.json(), "TopupsOut")
    assert [p["code"] for p in got.json()["packs"]][:3] == ["minutes_100", "minutes_300", "minutes_1000"]
    assert client.get(f"{base}/topups", headers=sales).status_code == 403

    pid = str(uuid.uuid4())
    body = {"purchase_id": pid, "pack_code": "minutes_300", "checkout_ref": "pm_fake_ok"}
    first = client.post(f"{base}/topups", json=body, headers=owner)
    assert first.status_code == 201, first.text
    conforms(first.json(), "TopupBuyOut")
    assert first.json()["invoice"]["total_paise"] == 127440 and first.json()["usage"]["call_minutes"]["topup_balance"] == 300.0
    again = client.post(f"{base}/topups", json=body, headers=owner)
    assert again.status_code == 200 and again.json() == first.json(), "the same purchase id changes nothing"
    assert client.post(f"{base}/topups", json={**body, "pack_code": "minutes_100"}, headers=owner).json()["error"]["code"] == "purchase_id_used"
    assert client.post(f"{base}/topups", json={**body, "purchase_id": str(uuid.uuid4()), "pack_code": "minutes_99"}, headers=owner).json()["error"]["code"] == "pack_unknown"

    weak = {"Authorization": f"Bearer {aal1_token(stack, a.users['owner'])}"}
    assert client.post(f"{base}/topups", json={**body, "purchase_id": str(uuid.uuid4())}, headers=weak).status_code == 403, "the Owner needs the second factor"

    billing = client.get(base, headers=owner)
    conforms(billing.json(), "BillingOut")
    meter = billing.json()["usage"]["call_minutes"]
    assert meter["topup_balance"] == 300.0 and meter["allowance"] == 300 + 30 and meter["plan_allowance"] == 30 and meter["queued"] == 0 and meter["blocked"] is False, meter
    usage = client.get(f"{base}/usage", headers=admin)
    conforms(usage.json(), "UsageViewOut")
    assert usage.json()["queued_calls"] == 0

    listed = client.get(f"{base}/invoices", headers=owner).json()
    conforms(listed, "InvoicesOut")
    assert len(listed["items"]) == 1 and listed["items"][0]["number"].startswith("S19-")
    one = client.get(f"{base}/invoices/{listed['items'][0]['id']}", headers=admin)
    conforms(one.json(), "InvoiceOut")
    assert client.get(f"{base}/invoices/{uuid.uuid4()}", headers=owner).status_code == 404

    settings = {"auto_minutes_pack": "minutes_100", "auto_messages_pack": None, "auto_monthly_cap_paise": 200000, "overage_minutes": True, "overage_messages": False, "overage_monthly_cap_paise": 50000}
    saved = client.put(f"{base}/topups/settings", json=settings, headers=owner)
    assert saved.status_code == 200, saved.text
    conforms(saved.json(), "TopupSettingsOut")
    assert client.put(f"{base}/topups/settings", json={**settings, "auto_monthly_cap_paise": 0}, headers=owner).json()["error"]["code"] == "cap_required"
    assert client.put(f"{base}/topups/settings", json=settings, headers=admin).status_code == 403

    pre = client.get(f"{base}/upgrade-preview?plan_id=growth", headers=admin)
    assert pre.status_code == 200, pre.text
    conforms(pre.json(), "UpgradePreviewOut")
    assert pre.json()["prorated_paise"] == 0 and pre.json()["new_allowances"] == {"call_minutes": 100, "whatsapp_messages": 1000}
    assert client.get(f"{base}/upgrade-preview?plan_id=starter", headers=admin).json()["error"]["code"] == "not_an_upgrade"
    done = client.post(f"{base}/upgrade", json={"plan_id": "growth", "checkout_ref": "pm_fake_ok"}, headers=owner)
    assert done.status_code == 200, done.text
    conforms(done.json(), "UpgradeOut")
    assert done.json()["invoice"] is None and done.json()["billing"]["subscription"]["plan_id"] == "growth"
