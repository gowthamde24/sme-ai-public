"""Job DI on the real local stack: plans and billing through HTTP. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own token and the FAKE billing provider (no network, no key).
All data is synthetic.

What this proves that the pgTAP file (111) and the unit tests cannot:
  * the database's answers are accepted by the strict response models and conform to the generated contract (packages/contracts/billing.schema.json);
  * the journey through HTTP: the catalogue, the meter at the start, call seconds recorded by the registered CHANNEL account, the notices at 80 and 100 percent, the stop (platform switch on) and the gate that
    refuses a call start, the 30-day trial with a payment method, a failed payment, and a cancel."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import jsonschema
import operator_sql
import pytest
from conftest import bearer
from test_outbox_api import restore_clock

from app.billing import fake
from app.billing.errors import PlanLimitReachedError
from app.billing.provider import ProviderEvent, build_provider
from app.billing.repository import PostgrestBillingRepository
from app.billing.service import BillingService, UsageGate
from app.tenancy.repository import Forbidden

ROOT = Path(__file__).resolve().parents[2]
BILLING = json.loads((ROOT / "packages" / "contracts" / "billing.schema.json").read_text(encoding="utf-8"))


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": BILLING["$schema"], "$ref": f"#/$defs/{definition}", "$defs": BILLING["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


class Scene:
    channel_token = ""
    repo: PostgrestBillingRepository


@pytest.fixture(scope="module")
def scene(stack: Any, signup: Any) -> Iterator[Any]:
    restore_clock()
    channel = signup("di-channel", mfa=False)
    operator_sql.sql(f"select app.operator_register_channel_agent('{channel.email}')")
    Scene.channel_token = channel.token
    Scene.repo = PostgrestBillingRepository(stack.rest, stack.anon_key)
    try:
        yield Scene
    finally:
        operator_sql.sql("select app.operator_set_billing_enforced(false)")
        operator_sql.sql(f"select app.operator_remove_channel_agent('{channel.email}')")
        Scene.repo.close()


def b(tenant: Any, tail: str = "") -> str:
    return f"/v1/tenants/{tenant.id}/billing{tail}"


def test_the_catalogue_is_the_contract_and_has_no_price(client: Any, eval_world: Any, scene: Any) -> None:
    r = client.get("/v1/plans", headers=bearer(eval_world.a.users["sales"]))
    assert r.status_code == 200, r.text
    conforms(r.json(), "PlansOut")
    plans = r.json()["plans"]
    assert [p["id"] for p in plans] == ["free_trial", "starter", "growth", "business", "calls_payg", "calls_300", "calls_1000"]
    assert all(p["price_paise_monthly"] is None and p["price_set"] is False for p in plans)
    assert client.get("/v1/plans").status_code == 401


def test_the_meter_at_the_start_and_who_may_read_it(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    r = client.get(b(a), headers=bearer(a.users["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    conforms(body, "BillingOut")
    assert body["plan"]["id"] == "free_trial" and body["subscription"] is None and body["can_start_trial"] is True
    assert (body["usage"]["call_minutes"]["allowance"], body["usage"]["whatsapp_messages"]["allowance"]) == (30, 100)
    assert (body["usage"]["call_minutes"]["used"], body["usage"]["call_minutes"]["percent"], body["usage"]["call_minutes"]["state"]) == (0.0, 0, "ok")
    assert body["period"]["timezone"] == "Asia/Kolkata" and body["notices"] == []
    for user in ("sales", "viewer"):
        assert client.get(b(a), headers=bearer(a.users[user])).status_code == 403, user
    assert client.get(b(a), headers=bearer(eval_world.b.users["owner"])).status_code == 404, "another business"


def test_call_seconds_the_notices_the_stop_and_the_gate(client: Any, eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    owner = bearer(a.users["owner"])
    gate = UsageGate(scene.repo)
    # an Owner cannot record call seconds; the channel account can
    with pytest.raises(Forbidden):
        gate.record_call_seconds(a.users["owner"].token, a.id, uuid.uuid4(), 60)
    after = gate.record_call_seconds(scene.channel_token, a.id, uuid.uuid4(), 24 * 60)
    assert (after["percent"], after["state"]) == (80, "notice")
    usage = client.get(b(a, "/usage"), headers=owner)
    assert usage.status_code == 200, usage.text
    conforms(usage.json(), "UsageViewOut")
    assert [(n["kind"], n["level"]) for n in usage.json()["notices"]] == [("call_minutes", 80)]
    gate.record_call_seconds(scene.channel_token, a.id, uuid.uuid4(), 6 * 60)
    assert client.get(b(a, "/usage"), headers=owner).json()["usage"]["call_minutes"]["state"] == "stopped"
    # the platform switch is OFF: the meter and the notices run, nothing is held
    assert gate.ensure_allowed(a.users["owner"].token, a.id, "call_minutes")["allowed"] is True
    operator_sql.sql("select app.operator_set_billing_enforced(true)")
    try:
        with pytest.raises(PlanLimitReachedError):
            gate.ensure_allowed(a.users["owner"].token, a.id, "call_minutes")
        assert gate.ensure_allowed(a.users["owner"].token, a.id, "whatsapp_messages")["allowed"] is True, "messages are their own meter"
        operator_sql.sql(f"select app.operator_billing_topup('{a.id}', '{uuid.uuid4()}', 'call_minutes', 10)")
        assert gate.ensure_allowed(a.users["owner"].token, a.id, "call_minutes")["allowed"] is True, "a top-up lets calls begin again"
    finally:
        operator_sql.sql("select app.operator_set_billing_enforced(false)")
    both = client.get(b(a), headers=owner).json()
    conforms(both, "BillingOut")
    assert [(n["kind"], n["level"]) for n in both["notices"]] == [("call_minutes", 80), ("call_minutes", 100)]


def test_the_trial_a_failed_payment_and_the_cancel_through_http(client: Any, eval_world: Any, scene: Any, stack: Any) -> None:
    w = eval_world.b
    owner = bearer(w.users["owner"])
    service = BillingService(scene.repo, build_provider("fake"))
    declined = client.post(b(w, "/trial"), json={"plan_id": "growth", "checkout_ref": fake.DECLINED}, headers=owner)
    assert declined.status_code == 402 and declined.json()["error"]["code"] == "payment_method_declined"
    assert client.get(b(w), headers=owner).json()["subscription"] is None, "a declined method creates nothing"
    r = client.post(b(w, "/trial"), json={"plan_id": "growth", "checkout_ref": fake.DECLINES_ON_RENEWAL}, headers=owner)
    assert r.status_code == 200, r.text
    conforms(r.json(), "BillingOut")
    sub = r.json()["subscription"]
    assert sub["status"] == "trialing" and sub["payment_method_on_file"] is True and sub["provider"] == "fake"
    assert r.json()["plan"]["id"] == "free_trial" and r.json()["can_start_trial"] is False
    again = client.post(b(w, "/trial"), json={"plan_id": "business", "checkout_ref": fake.OK}, headers=owner)
    assert again.status_code == 409 and again.json()["error"]["code"] == "trial_already_started"
    unknown = client.post(b(w, "/trial"), json={"plan_id": "platinum", "checkout_ref": fake.OK}, headers=owner)
    assert unknown.status_code in (409, 422) and unknown.json()["error"]["code"] in ("plan_unknown", "trial_already_started")
    # the first charge fails at the end of the trial (the provider's event, applied by the channel account)
    ref = scene.repo.subscription_ref(w.users["owner"].token, w.id)
    assert ref is not None and ref["status"] == "trialing"
    failed = service.apply(scene.channel_token, ProviderEvent(f"{ref['provider_ref']}:charge:0:failed", str(w.id), "charge_failed", None, datetime.now(UTC)))
    assert failed.status == "past_due"
    past_due = client.get(b(w), headers=owner).json()
    conforms(past_due, "BillingOut")
    assert past_due["subscription"]["status"] == "past_due" and past_due["subscription"]["grace_until"] is not None
    assert past_due["plan"]["id"] == "free_trial", "the plan in force has not changed"
    # an Owner cannot hand in a provider event
    with pytest.raises(Forbidden):
        service.apply(w.users["owner"].token, ProviderEvent(f"{ref['provider_ref']}:x", str(w.id), "charge_succeeded", 0, datetime.now(UTC)))
    # cancel
    assert client.post(b(w, "/cancel"), headers=bearer(w.users["sales"])).status_code == 403
    cancelled = client.post(b(w, "/cancel"), headers=owner)
    assert cancelled.status_code == 200, cancelled.text
    conforms(cancelled.json(), "BillingOut")
    assert cancelled.json()["subscription"]["status"] == "cancelled" and cancelled.json()["subscription"]["payment_method_on_file"] is False
    assert client.post(b(w, "/cancel"), headers=owner).json()["error"]["code"] == "nothing_to_cancel"
    assert operator_sql.sql(f"select count(*) from public.billing_events where tenant_id = '{w.id}' and kind = 'charge_succeeded'").strip() == "0", "not one successful charge"
