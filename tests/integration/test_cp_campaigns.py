"""Job CP on the real local stack: the shared ledger, reminder campaigns, the call list and the results. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own token; the scheduler worker
signed in as its OWN registered account, with the LOCAL FAKE adapter as the only channel. The outbox clock is pinned (the steps are days apart), the dates are in the future of the real clock so every step is
ahead. All data is synthetic.

What these prove that the pgTAP files (100 to 103) and the unit tests cannot:
  * the whole journey through the HTTP API: entries in the ledger (a company's invoice, a guardian's fee, a payment with its receipt number), a campaign built FROM the ledger, the Owner's approval for the samples they
    saw (and only the Owner, and only with the second factor), a change that sends it back to draft, the worker sending each step as an ordinary outbox message through the real channel rules (STOP, consent),
    the call list and its outcomes, and the results, every shape validated against the generated contract;
  * the module gates on a real workspace (a textile workspace is refused with a plain 403 module_off; its call list works but is empty)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jsonschema
import operator_sql
import pytest
from conftest import aal1_token, bearer
from followup_support import FollowWorld
from test_outbox_api import restore_clock
from test_scheduler_api import Sched

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "packages" / "contracts" / "campaigns.schema.json").read_text(encoding="utf-8"))
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
BASE = TODAY + timedelta(days=30)  # the day of step 1 (a day in the future of the real clock)
DUE = BASE + timedelta(days=2)  # the date the reminders are about
LONG_AGO = TODAY - timedelta(days=40)


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": CONTRACT["$schema"], "$ref": f"#/$defs/{definition}", "$defs": CONTRACT["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def uid() -> str:
    return str(uuid.uuid4())


def url(tenant: Any, tail: str) -> str:
    return f"/v1/tenants/{tenant.id}{tail}"


def pin(day: date, clock: str) -> None:
    h, m = (int(p) for p in clock.split(":"))
    at = datetime.combine(day, datetime.min.time(), tzinfo=IST).replace(hour=h, minute=m)
    operator_sql.sql(f"create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '{at.isoformat()}' $b$")


def make_construction(w: Any) -> None:
    a = w.a
    pack = "(select max(version) from packs.pack_versions where code = 'construction_materials')"
    operator_sql.sql(f"update packs.workspace_pack set pack_code = 'construction_materials', pack_version = {pack}, source = 'operator' where tenant_id = '{a.id}'")
    operator_sql.sql(f"select app.apply_pack_fields('{a.id}', 'construction_materials', {pack}, '{a.users['owner'].id}')")


def mine(adapter: Any, tenant: Any) -> list[Any]:
    """The messages the channel sent that belong to this workspace's campaigns (the worker serves every business of the shared database, so others' queued messages go too)."""
    ids = set(operator_sql.sql(f"select id from public.outbox_messages where tenant_id = '{tenant.id}' and category = 'campaign_reminder'").split())
    return [m for m in adapter.sent if str(m.message_id) in ids]


class Shop:
    """The state of one journey (the steps follow each other)."""

    campaign = uid()
    template = uid()
    people: dict[str, Any] = {}
    charges: dict[str, str] = {}
    samples_sha = ""
    first_payment = uid()


# ============================================================================================================ gates on a textile workspace
def test_a_textile_workspace_is_refused_by_campaigns_and_the_ledger_and_its_call_list_is_empty(eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner = a.users["owner"]
    contact = a.rows["contacts"]["id"]
    refused = (
        ("PUT", f"/campaigns/{uid()}", {"name": "x", "kind": "payment_due", "language": "en", "message_text": "Dear {{name}}, {{amount}} is due on {{due_date}}.", "steps": [{"offset_days": 0, "time": "10:00"}]}),
        ("POST", f"/campaigns/{uid()}/recipients", {"rows": [{"contact_id": contact, "due_date": "2026-11-10"}]}),
        ("PUT", f"/ledger/entries/{uid()}", {"kind": "charge", "contact_id": contact, "entry_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 1000}),
    )
    for method, tail, body in refused:
        r = w.client.request(method, url(a, tail), json=body, headers=bearer(owner))
        assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", (tail, r.status_code, r.text)
    for tail in ("/campaigns", "/ledger/summary"):
        r = w.client.get(url(a, tail), headers=bearer(owner))
        assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", tail
    # the call list is a module of the textile pack too: it works, and it is empty
    r = w.client.get(url(a, "/call-list"), headers=bearer(owner))
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}
    assert w.client.get(url(a, "/call-list"), headers=bearer(a.users["viewer"])).status_code == 403


# ============================================================================================================ the shop
@pytest.fixture(scope="module")
def cp(client: Any, eval_world: Any, stack: Any, signup: Any) -> Any:
    make_construction(eval_world)
    user = signup("cp-scheduler", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    pin(BASE - timedelta(days=1), "12:00")
    w = eval_world
    r = w.client.put(url(w.a, "/outbox/settings"), json={"auto_send_enabled": True, "per_customer_daily_limit": 5}, headers=bearer(w.a.users["owner"]))
    assert r.status_code == 200, r.text
    # the approved reminder template (what Meta decided is the operator's act in this test)
    operator_sql.sql(
        "insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) "
        f"values ('{Shop.template}', '{w.a.id}', 'dues_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{{{1}}}} Thank you.', 'approved')"
    )
    fw = FollowWorld(client, w, w.a)
    for name in ("p1", "p2", "p3", "p4"):
        Shop.people[name] = fw.lead(name, email=False)
    try:
        yield Sched(stack, user), fw
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")
        restore_clock()


# ============================================================================================================ the ledger
def test_the_ledger_records_a_companys_invoice_a_guardians_fee_and_a_payment_with_its_receipt_number(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    fees = {"p1": 500000, "p2": 300000, "p3": 200000, "p4": 100000}
    for name, amount in fees.items():
        eid = uid()
        Shop.charges[name] = eid
        body = {"kind": "charge", "contact_id": Shop.people[name].contact_id, "entry_date": LONG_AGO.isoformat(), "due_date": DUE.isoformat(), "amount_paise": amount, "reference": f"Fee {name}"}
        r = w.client.put(url(a, f"/ledger/entries/{eid}"), json=body, headers=bearer(sales))
        assert r.status_code == 200, r.text
        conforms(r.json(), "EntryRecordedOut")
        assert r.json()["receipt_no"] is None
    assert w.client.put(url(a, f"/ledger/entries/{uid()}"), json=body, headers=bearer(viewer)).status_code == 403
    # a concession is the Owner's or Admin's, with a second factor
    conc = {"kind": "concession", "contact_id": Shop.people["p1"].contact_id, "entry_date": LONG_AGO.isoformat(), "amount_paise": 100000, "reason_code": "scholarship"}
    assert w.client.put(url(a, f"/ledger/entries/{uid()}"), json=conc, headers=bearer(sales)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, admin)}"}
    assert w.client.put(url(a, f"/ledger/entries/{uid()}"), json=conc, headers=weak).json()["error"]["code"] == "mfa_required"
    concession = uid()
    assert w.client.put(url(a, f"/ledger/entries/{concession}"), json=conc, headers=bearer(admin)).status_code == 200
    st = w.client.get(url(a, f"/ledger/statement?contact_id={Shop.people['p1'].contact_id}"), headers=bearer(sales)).json()
    assert (st["invoiced_paise"], st["concessions_paise"], st["outstanding_paise"]) == (500000, 100000, 400000)
    # voiding the concession brings the full amount back (a second factor again)
    assert w.client.post(url(a, f"/ledger/entries/{concession}/void"), headers=bearer(admin)).json()["kind"] == "concession"
    st = w.client.get(url(a, f"/ledger/statement?contact_id={Shop.people['p1'].contact_id}"), headers=bearer(sales)).json()
    assert st["outstanding_paise"] == 500000 and st["overdue_ageing"]["not_due"] == 500000
    # a payment gets the business's next receipt number, once
    pay = {"kind": "payment", "contact_id": Shop.people["p3"].contact_id, "entry_date": TODAY.isoformat(), "amount_paise": 50000, "method": "upi"}
    r = w.client.put(url(a, f"/ledger/entries/{Shop.first_payment}"), json=pay, headers=bearer(sales))
    assert r.status_code == 200 and r.json()["receipt_no"].startswith("R/") and r.json()["receipt_no"].endswith("/000001"), r.text
    again = w.client.put(url(a, f"/ledger/entries/{Shop.first_payment}"), json=pay, headers=bearer(sales)).json()
    assert again["receipt_no"] == r.json()["receipt_no"] and again["replayed"] is True
    other = w.client.put(url(a, f"/ledger/entries/{Shop.first_payment}"), json={**pay, "amount_paise": 50001}, headers=bearer(sales))
    assert other.status_code in (409, 422), other.text
    rec = w.client.get(url(a, f"/ledger/receipts/{Shop.first_payment}"), headers=bearer(sales)).json()
    conforms(rec, "ReceiptOut")
    assert rec["party_name"] == "Person p3" and rec["amount_paise"] == 50000 and rec["balance_after_paise"] == 150000
    # p3 has paid part: its fee is Rs 2,000 less Rs 500
    summary = w.client.get(url(a, "/ledger/summary?party=contact"), headers=bearer(sales)).json()
    assert {i["party_name"]: i["outstanding_paise"] for i in summary["items"]} == {"Person p1": 500000, "Person p2": 300000, "Person p3": 150000, "Person p4": 100000}
    assert [i["outstanding_paise"] for i in summary["items"]] == sorted((i["outstanding_paise"] for i in summary["items"]), reverse=True)


def test_a_fee_list_is_imported_in_parts_and_a_retry_adds_nothing(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    batch = uid()
    rows = [{"contact_id": Shop.people["p1"].contact_id, "entry_date": LONG_AGO.isoformat(), "due_date": (DUE + timedelta(days=60)).isoformat(), "amount_paise": 1000, "reference": f"Bus {i}"} for i in range(3)]
    rows.append({"contact_id": uid(), "entry_date": LONG_AGO.isoformat(), "due_date": DUE.isoformat(), "amount_paise": 1000})
    first = w.client.post(url(a, "/ledger/charges/import"), json={"batch_id": batch, "rows": rows}, headers=bearer(a.users["sales"]))
    assert first.status_code == 200, first.text
    conforms(first.json(), "ChargesImportOut")
    assert first.json()["added"] == 3 and first.json()["skipped"] == [{"row": 4, "reason": "party_not_found"}]
    again = w.client.post(url(a, "/ledger/charges/import"), json={"batch_id": batch, "rows": rows}, headers=bearer(a.users["sales"])).json()
    assert again["added"] == 0, "the same batch adds nothing"


# ============================================================================================================ the campaign
def campaign_body(**over: Any) -> dict[str, Any]:
    return {
        "name": "October fees", "kind": "payment_due", "language": "en", "wa_template_id": Shop.template,
        "message_text": "Dear {{name}}, {{amount}} is pending, due on {{due_date}}. Thank you, {{business}}.",
        "steps": [{"offset_days": -2, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}], "call_after_step": 2, "call_wait_hours": 24, **over,
    }  # fmt: skip


def test_a_campaign_is_built_from_the_ledger_and_previewed_with_rendered_samples(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    sales = a.users["sales"]
    path = url(a, f"/campaigns/{Shop.campaign}")
    saved = w.client.put(path, json=campaign_body(), headers=bearer(sales))
    assert saved.status_code == 200, saved.text
    conforms(saved.json()["campaign"], "CampaignOut")
    detail = w.client.get(path, headers=bearer(sales)).json()
    conforms(detail, "CampaignDetailOut")
    assert detail["issues"] == ["no_recipients"] and detail["sending_on"] is True
    # the fee list is not in the campaign yet: build it from the ledger (the claims due on DUE; the 'Bus' fees are due later)
    added = w.client.post(path + "/recipients/from-ledger", json={"due_from": DUE.isoformat(), "due_to": DUE.isoformat()}, headers=bearer(sales))
    assert added.status_code == 200, added.text
    conforms(added.json(), "RecipientsAddedOut")
    assert added.json()["added"] == 4 and added.json()["skipped"] == [] and added.json()["recipients"] == 4
    preview = w.client.get(path + "/preview", headers=bearer(sales)).json()
    conforms(preview, "PreviewOut")
    assert preview["recipients"] == 4 and preview["total_amount_paise"] == 500000 + 300000 + 150000 + 100000 and preview["issues"] == []
    assert len(preview["samples"]) == 4 and {s["labels"][0] for s in preview["samples"]} >= {"first"}
    assert any("₹5,000.00" in s["body"] for s in preview["samples"]) and all("{{" not in s["body"] for s in preview["samples"])
    assert any(s["body"].startswith("Dear Person p1, ₹5,000.00 is pending, due on ") for s in preview["samples"])
    Shop.samples_sha = preview["samples_sha256"]
    listed = w.client.get(path + "/recipients", headers=bearer(sales)).json()
    assert len(listed) == 4 and {r["amount_paise"] for r in listed} == {500000, 300000, 150000, 100000}
    for r in listed:
        conforms(r, "RecipientOut")


def test_only_the_owner_with_a_second_factor_approves_and_only_for_the_samples_they_saw(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales = (a.users[r] for r in ("owner", "admin", "sales"))
    path = url(a, f"/campaigns/{Shop.campaign}/approve")
    body = {"samples_sha256": Shop.samples_sha}
    for who in (admin, sales, a.users["viewer"]):
        assert w.client.post(path, json=body, headers=bearer(who)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.post(path, json=body, headers=weak).json()["error"]["code"] == "mfa_required"
    stale = w.client.post(path, json={"samples_sha256": "0" * 64}, headers=bearer(owner))
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "samples_changed"
    assert w.client.get(url(a, f"/campaigns/{Shop.campaign}"), headers=bearer(sales)).json()["status"] == "draft"
    ok = w.client.post(path, json=body, headers=bearer(owner))
    assert ok.status_code == 200, ok.text
    conforms(ok.json(), "ApprovedOut")
    assert ok.json()["campaign"]["status"] == "approved" and ok.json()["planned_steps"] == 8 and ok.json()["past_steps"] == 0
    assert ok.json()["campaign"]["approved_recipients"] == 4 and ok.json()["campaign"]["approved_total_paise"] == 1050000
    again = w.client.post(path, json=body, headers=bearer(owner))
    assert again.status_code == 409 and again.json()["error"]["code"] == "campaign_state"


def test_any_change_after_the_approval_sends_the_campaign_back_to_draft(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    path = url(a, f"/campaigns/{Shop.campaign}")
    name_only = w.client.put(path, json=campaign_body(name="October fees (renamed)"), headers=bearer(sales)).json()
    assert name_only["back_to_draft"] is False and name_only["campaign"]["status"] == "approved", "a new name is not content"
    changed = w.client.put(path, json=campaign_body(message_text="Dear {{name}}, {{amount}} is still pending, due on {{due_date}}. Thank you, {{business}}."), headers=bearer(sales)).json()
    assert changed["back_to_draft"] is True and changed["campaign"]["status"] == "draft" and changed["campaign"]["approved_by"] is None
    old = w.client.post(path + "/approve", json={"samples_sha256": Shop.samples_sha}, headers=bearer(owner))
    assert old.status_code == 409 and old.json()["error"]["code"] == "samples_changed", "the approval of the OLD words cannot be used for the new ones"
    preview = w.client.get(path + "/preview", headers=bearer(sales)).json()
    Shop.samples_sha = preview["samples_sha256"]
    assert any("is still pending" in s["body"] for s in preview["samples"])
    assert w.client.post(path + "/approve", json={"samples_sha256": Shop.samples_sha}, headers=bearer(owner)).status_code == 200


# ============================================================================================================ the worker
def test_the_worker_sends_each_step_as_an_ordinary_message_under_the_channel_rules(cp: Any, eval_world: Any) -> None:
    sched, fw = cp
    w, a = eval_world, eval_world.a
    worker, adapter = sched.worker()
    # nothing is due the day before
    pin(BASE - timedelta(days=1), "12:00")
    assert worker.tick_once() is not None and mine(adapter, a) == []
    # step 1 (two days before the date), 10:30
    pin(BASE, "10:30")
    assert worker.tick_once() is not None
    bodies = {m.message_id: m for m in mine(adapter, a)}
    assert len(bodies) == 4, "four people, four reminders"
    sent_text = " | ".join(m.body for m in bodies.values())
    assert "is still pending" in sent_text and "₹5,000.00" in sent_text and "{{" not in sent_text
    made = operator_sql.sql(
        f"select concat_ws(',', count(*), count(*) filter (where status = 'sent'), count(distinct id), min(category), max(reason)) from public.outbox_messages where tenant_id = '{a.id}' and category = 'campaign_reminder'"
    ).strip()
    assert made == "4,4,4,campaign_reminder,campaign_approved", made
    assert bodies
    assert w.client.get(url(a, f"/campaigns/{Shop.campaign}"), headers=bearer(a.users["sales"])).json()["status"] == "running"
    # p4 says STOP after step 1; p3 writes back after step 2; p2 will pay
    r = fw.suppress(Shop.people["p4"])
    assert r.status_code in (200, 201), r.text
    # step 2, on the date, 10:30
    pin(DUE, "10:30")
    assert worker.tick_once() is not None
    assert len(mine(adapter, a)) == 4 + 3, "p4 said STOP: that reminder is blocked by the channel rule, the other three go"
    blocked = operator_sql.sql(f"select concat_ws(',', count(*), min(reason)) from public.outbox_messages where tenant_id = '{a.id}' and category = 'campaign_reminder' and status = 'blocked'").strip()
    assert blocked == "1,stopped", blocked
    # replay: asking again at the same instant sends nothing
    assert worker.tick_once() is not None and len(mine(adapter, a)) == 7


def test_the_call_list_gets_those_who_did_not_reply_and_have_not_paid(cp: Any, eval_world: Any) -> None:
    sched, fw = cp
    w, a = eval_world, eval_world.a
    sales, owner = a.users["sales"], a.users["owner"]
    worker, _ = sched.worker()
    p2, p3 = Shop.people["p2"], Shop.people["p3"]
    # p2 pays in full; p3 writes back on WhatsApp (after the reminder)
    pay = {"kind": "payment", "contact_id": p2.contact_id, "entry_date": TODAY.isoformat(), "amount_paise": 300000, "method": "cash"}
    r = w.client.put(url(a, f"/ledger/entries/{uid()}"), json=pay, headers=bearer(sales))
    assert r.status_code == 200 and r.json()["receipt_no"].endswith("/000002"), r.text
    at = datetime.combine(DUE, datetime.min.time(), tzinfo=IST).replace(hour=12).isoformat()
    operator_sql.sql(
        "insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at) "
        f"values ('{uid()}', '{a.id}', '{p3.id}', '{p3.contact_id}', 'in', 'whatsapp', '{at}', '{at}')"
    )
    # the day after, 11:00: 24 hours have passed since the second message
    pin(DUE + timedelta(days=1), "11:00")
    assert worker.tick_once() is not None
    listing = w.client.get(url(a, "/call-list"), headers=bearer(sales)).json()
    conforms(listing, "CallListOut")
    assert [i["contact_name"] for i in listing["items"]] == ["Person p1"], "only p1: p2 paid, p3 replied, p4 said STOP"
    item = listing["items"][0]
    assert item["amount_paise"] == 500000 and item["step_no"] == 2 and item["status"] == "open" and "phone" not in json.dumps(item)
    # the call itself goes through the existing bridge (approved with the campaign); outcomes are recorded by Sales
    request_id = item["call_request_id"]
    status = operator_sql.sql(f"select status || '/' || (decided_by is not null)::text || '/' || decision_note from public.call_requests where id = '{request_id}'").strip()
    assert status == "approved/true/approved with the campaign", status
    bad = w.client.post(url(a, f"/call-list/{item['id']}/outcome"), json={"outcome": "promised"}, headers=bearer(sales))
    assert bad.status_code == 422
    promised = (DUE + timedelta(days=5)).isoformat()
    out = w.client.post(url(a, f"/call-list/{item['id']}/outcome"), json={"outcome": "promised", "promised_on": promised}, headers=bearer(sales))
    assert out.status_code == 200, out.text
    conforms(out.json(), "OutcomeRecordedOut")
    assert out.json() == {"id": item["id"], "status": "done", "outcome": "promised", "replayed": False}
    assert w.client.post(url(a, f"/call-list/{item['id']}/outcome"), json={"outcome": "paid"}, headers=bearer(owner)).json()["error"]["code"] == "campaign_state"
    assert w.client.get(url(a, "/call-list"), headers=bearer(sales)).json()["items"] == []
    done = w.client.get(url(a, "/call-list?status=done"), headers=bearer(sales)).json()["items"]
    assert [(i["contact_name"], i["outcome"], i["promised_on"]) for i in done] == [("Person p1", "promised", promised)]


def test_the_results_are_counted_from_the_outbox_and_the_ledger(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    sched, _ = cp
    worker, _adapter = sched.worker()
    pin(DUE + timedelta(days=10), "11:00")
    assert worker.tick_once() is not None
    res = w.client.get(url(a, f"/campaigns/{Shop.campaign}/results"), headers=bearer(a.users["sales"])).json()
    conforms(res, "ResultsOut")
    assert res["recipients"] == 4
    assert res["by_state"].get("sent") == 7 and res["by_state"].get("blocked") == 1 and sum(res["by_state"].values()) == 8
    assert res["by_reason"].get("stopped") == 1
    assert res["replied"] == 1, "p3 wrote back"
    assert res["paid_after_reminder"]["recipients"] == 1 and res["paid_after_reminder"]["amount_paise"] == 300000, "p2 paid after the reminders"
    assert res["closed"] == {"paid": 1, "promised": 1}
    assert res["calls"]["done"] == 1 and res["calls"]["open"] == 0 and res["calls"]["outcomes"] == {"promised": 1}
    assert sum(day["states"].get("sent", 0) for day in res["by_day"]) == 7
    assert w.client.get(url(a, f"/campaigns/{Shop.campaign}"), headers=bearer(a.users["sales"])).json()["status"] == "done"
    assert w.client.get(url(a, f"/campaigns/{Shop.campaign}/results"), headers=bearer(a.users["viewer"])).status_code == 403
    assert w.client.get(url(a, f"/campaigns/{Shop.campaign}/results"), headers=bearer(w.b.users["owner"])).status_code in (403, 404)


def test_a_cancelled_campaign_sends_nothing_more_and_the_list_of_campaigns_shows_both(cp: Any, eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin = a.users["owner"], a.users["admin"]
    other = uid()
    assert w.client.put(url(a, f"/campaigns/{other}"), json=campaign_body(name="Never sent"), headers=bearer(owner)).status_code == 200
    assert w.client.post(url(a, f"/campaigns/{other}/cancel"), headers=bearer(a.users["sales"])).status_code == 403
    assert w.client.post(url(a, f"/campaigns/{other}/cancel"), headers=bearer(admin)).json()["status"] == "cancelled"
    assert w.client.post(url(a, f"/campaigns/{other}/cancel"), headers=bearer(admin)).json()["error"]["code"] == "campaign_state"
    page = w.client.get(url(a, "/campaigns"), headers=bearer(a.users["sales"])).json()
    conforms(page, "CampaignListOut")
    assert {(c["name"], c["status"]) for c in page["items"]} == {("October fees", "done"), ("Never sent", "cancelled")}
    only_done = w.client.get(url(a, "/campaigns?status=done"), headers=bearer(a.users["sales"])).json()["items"]
    assert [c["status"] for c in only_done] == ["done"]
    assert w.client.get(url(a, "/campaigns"), headers=bearer(w.b.users["owner"])).status_code in (403, 404)
