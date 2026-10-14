"""Job CP: the routes of the shared ledger, the reminder campaigns and the call list, with fakes (no database). The database's own rules (the approval, the hashes, going back to draft, the runner, the outbox policy
per message) are proved in supabase/tests/database/100..103 and tests/integration/test_cp_campaigns.py; here: who may call what, the shapes, the idempotency, the closed requests, the paging and the mapping of every
refusal to its fixed sentence."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.dues import errors as du
from app.packs.errors import ModuleOffError
from tests.cn_fakes import FakeDues
from tests.cp_fakes import FakeCampaigns, LedgerCalls, call_item
from tests.fakes import TENANT_A, auth, make_client

A = TENANT_A.id
U = uuid.UUID
COMPANY = str(U(int=0xC0))
CONTACT = str(U(int=0x200))


class LedgerDues(FakeDues, LedgerCalls):
    """CN's dues fake plus the ledger's calls."""


def url(tail: str, tenant: uuid.UUID = A) -> str:
    return f"/v1/tenants/{tenant}{tail}"


ALL_THREE = ("a_owner", "a_admin", "a_sales")


# ============================================================================================================ the ledger
def entry(**over: Any) -> dict[str, Any]:
    return {"kind": "charge", "contact_id": CONTACT, "entry_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 1000000, "reference": "Tuition T1", **over}


def test_the_ledger_is_read_by_owner_admin_and_sales_and_never_shown_to_a_viewer() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    for who in ALL_THREE:
        assert client.get(url(f"/ledger/statement?contact_id={CONTACT}"), headers=auth(who)).status_code == 200, who
        assert client.get(url("/ledger/summary"), headers=auth(who)).status_code == 200
        assert client.get(url(f"/ledger/entries?company_id={COMPANY}"), headers=auth(who)).status_code == 200
        assert client.get(url(f"/ledger/receipts/{U(int=0xE1)}"), headers=auth(who)).status_code == 200
    for path in (f"/ledger/statement?contact_id={CONTACT}", "/ledger/summary", f"/ledger/entries?contact_id={CONTACT}", f"/ledger/receipts/{U(int=0xE1)}"):
        assert client.get(url(path), headers=auth("a_viewer")).status_code == 403, path
        assert client.get(url(path), headers=auth("b_owner")).status_code == 404, path


def test_a_statement_is_of_exactly_one_party_and_shows_both_kinds_of_ageing() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    assert client.get(url("/ledger/statement"), headers=auth("a_owner")).status_code == 422
    assert client.get(url(f"/ledger/statement?company_id={COMPANY}&contact_id={CONTACT}"), headers=auth("a_owner")).status_code == 422
    assert client.get(url("/ledger/statement?contact_id=not-a-uuid"), headers=auth("a_owner")).status_code == 404
    r = client.get(url(f"/ledger/statement?contact_id={CONTACT}&as_of=2026-10-14"), headers=auth("a_owner")).json()
    assert (r["invoiced_paise"], r["paid_paise"], r["outstanding_paise"], r["overdue_paise"]) == (3050000, 1400000, 1650000, 650000)
    assert (r["payments_paise"], r["concessions_paise"], r["adjustments_paise"]) == (800000, 500000, -50000)
    assert r["ageing"]["d31_60"] == 600000 and r["overdue_ageing"] == {"not_due": 1000000, "d1_30": 650000, "d31_60": 0, "d61_90": 0, "d90_plus": 0}
    assert r["open_invoices"][0]["reference"] == "Tuition T2" and r["open_invoices"][0]["invoice_no"] is None
    assert fake.calls[-1][1][3].isoformat() == "2026-10-14" and fake.calls[-1][1][2] == U(CONTACT) and fake.calls[-1][1][1] is None


def test_the_summary_lists_parties_and_pages_by_amount() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    r = client.get(url("/ledger/summary?party=contact&limit=1"), headers=auth("a_sales")).json()
    assert r["items"][0]["party_kind"] == "contact" and r["items"][0]["party_name"] == "Guardian worked" and r["next_cursor"]
    client.get(url(f"/ledger/summary?party=contact&limit=1&after={r['next_cursor']}"), headers=auth("a_sales"))
    assert fake.calls[-1][1][4] == "contact" and fake.calls[-1][1][3] == (1650000, U(int=0xAC))
    assert client.get(url("/ledger/summary?party=robot"), headers=auth("a_owner")).status_code == 422
    assert client.get(url("/ledger/summary?after=%25"), headers=auth("a_owner")).status_code == 422


def test_an_entry_is_recorded_with_the_callers_id_and_a_payment_gets_its_receipt_number() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    eid = U(int=0x91)
    r = client.put(url(f"/ledger/entries/{eid}"), json=entry(), headers=auth("a_sales"))
    assert r.status_code == 200 and r.json() == {"id": str(eid), "account_id": str(U(int=0xAC)), "receipt_no": None, "replayed": False}
    sent = fake.calls[-1][1][1]
    assert sent["p_kind"] == "charge" and sent["p_contact_id"] == CONTACT and sent["p_company_id"] is None and sent["p_due_date"] == "2026-09-30" and sent["p_reference"] == "Tuition T1"
    pay = {"kind": "payment", "company_id": COMPANY, "entry_date": "2026-09-05", "amount_paise": 800000, "method": "upi"}
    r = client.put(url(f"/ledger/entries/{eid}"), json=pay, headers=auth("a_sales"))
    assert r.json()["receipt_no"] == "R/2026-27/000001" and r.json()["replayed"] is False
    assert client.put(url(f"/ledger/entries/{eid}"), json={**pay, "amount_paise": 777}, headers=auth("a_sales")).json()["replayed"] is True


@pytest.mark.parametrize(
    "bad",
    [
        {"company_id": COMPANY},  # two parties
        {"contact_id": None},  # no party
        {"due_date": None},  # a charge needs its due date
        {"kind": "payment", "due_date": "2026-09-30", "method": "cash"},  # a payment has no due date
        {"kind": "payment", "due_date": None},  # and names its method
        {"kind": "adjustment", "due_date": None, "reason_code": "correction"},  # an adjustment says debit or credit
        {"kind": "adjustment", "direction": "debit", "due_date": None, "reason_code": "late_fee"},  # a debit one has a due date
        {"kind": "adjustment", "direction": "credit", "reason_code": "correction"},  # a credit one has none
        {"kind": "concession", "due_date": None},  # a concession says why
        {"kind": "refund"},  # unknown kind
        {"kind": "payment", "due_date": None, "method": "barter"},
        {"amount_paise": 0},
        {"amount_paise": 100_000_000_001},
        {"amount_paise": 1.5},
        {"invoice_no": "bad; drop"},
        {"reference": "Ann +91 98480 11111"},
        {"kind": "payment", "due_date": None, "method": "cash", "invoice_no": "INV-1"},  # only a charge has an invoice number
        {"entry_date": "yesterday"},
        {"status": "voided"},  # no such field: a client cannot send a status, an approver or a receipt number
        {"receipt_no": "R/2026-27/000001"},
    ],
)
def test_an_entry_that_does_not_fit_its_kind_is_a_422(bad: dict[str, Any]) -> None:
    client, _ = make_client(dues=LedgerDues())
    body = {**entry(), **bad}
    body = {k: v for k, v in body.items() if v is not None}
    assert client.put(url(f"/ledger/entries/{U(int=0x92)}"), json=body, headers=auth("a_owner")).status_code == 422, bad


def test_an_adjustment_and_a_concession_are_accepted_in_shape_and_decided_by_the_database() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    ok_adj = entry(kind="adjustment", direction="debit", reason_code="late_fee", reference=None)
    ok_conc = {"kind": "concession", "contact_id": CONTACT, "entry_date": "2026-09-06", "amount_paise": 500000, "reason_code": "scholarship"}
    for body in (ok_adj, ok_conc):
        assert client.put(url(f"/ledger/entries/{U(int=0x93)}"), json=body, headers=auth("a_admin")).status_code == 200, body
    assert fake.calls[-1][1][1]["p_reason_code"] == "scholarship"
    # the roles and the second factor are the database's (SM306 and 42501 become 403s): a refusal reaches the caller
    from app.tenancy.repository import MfaRequired

    fake.error = MfaRequired("SM306")
    r = client.put(url(f"/ledger/entries/{U(int=0x93)}"), json=ok_conc, headers=auth("a_admin"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"


def test_voiding_is_for_owner_and_admin_only() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    eid = U(int=0x94)
    assert client.post(url(f"/ledger/entries/{eid}/void"), headers=auth("a_sales")).status_code == 403
    assert client.post(url(f"/ledger/entries/{eid}/void"), headers=auth("a_admin")).json() == {"entry_id": str(eid), "kind": "payment", "voided": True}
    fake.error = du.AlreadyVoidedError("SM782")
    assert client.post(url(f"/ledger/entries/{eid}/void"), headers=auth("a_owner")).json()["error"]["code"] == "already_voided"


def test_a_fee_list_of_5000_runs_in_ten_parts_with_derived_ids_and_the_files_own_row_numbers() -> None:
    fake = LedgerDues()
    client, _ = make_client(dues=fake)
    batch = U(int=0x99)
    rows = [{"contact_id": CONTACT, "entry_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 100, "reference": f"T{i}"} for i in range(5000)]
    r = client.post(url("/ledger/charges/import"), json={"batch_id": str(batch), "rows": rows}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    parts = [c for c in fake.calls if c[0] == "charges_import"]
    assert len(parts) == 10 and {len(c[1][2]) for c in parts} == {500} and parts[0][1][1] == uuid.uuid5(batch, "ledger-part-0")
    out = r.json()
    assert out["added"] == 10 * (500 - 500 // 7) and out["skipped"][0] == {"row": 7, "reason": "party_not_found"} and any(s["row"] == 507 for s in out["skipped"])
    assert "company_id" not in parts[0][1][2][0], "a null is not sent: the database reads a missing key as 'no company'"
    for bad in ([], [{"entry_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 1}], [{**rows[0], "company_id": COMPANY}], rows + rows):
        assert client.post(url("/ledger/charges/import"), json={"batch_id": str(batch), "rows": bad}, headers=auth("a_owner")).status_code == 422
    assert client.post(url("/ledger/charges/import"), json={"batch_id": str(batch), "rows": rows[:1]}, headers=auth("a_viewer")).status_code == 403


def test_a_receipt_is_a_payment_made_ready_to_print() -> None:
    client, _ = make_client(dues=LedgerDues())
    r = client.get(url(f"/ledger/receipts/{U(int=0xE1)}"), headers=auth("a_sales")).json()
    assert r["receipt_no"] == "R/2026-27/000001" and r["party_name"] == "Guardian worked" and r["balance_after_paise"] == 1650000 and r["method"] == "bank_transfer"


def test_the_ledger_answers_503_when_dues_are_missing_and_403_when_the_module_is_off() -> None:
    client, _ = make_client()
    assert client.get(url("/ledger/summary"), headers=auth("a_owner")).status_code == 503
    fake = LedgerDues()
    fake.error = ModuleOffError("SM701")
    client, _ = make_client(dues=fake)
    r = client.get(url("/ledger/summary"), headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off"


def test_cns_payment_route_now_returns_the_receipt_number_and_the_statement_the_new_fields() -> None:
    class Fake(LedgerDues):
        def payment_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
            return {"payment_id": args["p_payment_id"], "receipt_no": "R/2026-27/000007", "replayed": False}

    client, _ = make_client(dues=Fake())
    r = client.put(url(f"/dues/payments/{U(int=0x95)}"), json={"company_id": COMPANY, "received_on": "2026-10-02", "amount_paise": 500, "method": "cash"}, headers=auth("a_sales"))
    assert r.json() == {"id": str(U(int=0x95)), "replayed": False, "receipt_no": "R/2026-27/000007"}


# ============================================================================================================ campaigns
CID = U(int=0xCA)


def body(**over: Any) -> dict[str, Any]:
    return {
        "name": "October dues", "kind": "payment_due", "language": "en", "wa_template_id": str(U(int=0x7E)),
        "message_text": "Dear {{name}}, payment of {{amount}} is due on {{due_date}}.",
        "steps": [{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}], **over,
    }  # fmt: skip


def row(**over: Any) -> dict[str, Any]:
    return {"contact_id": str(U(int=0x200)), "due_date": "2026-11-10", "amount_paise": 500000, "reference": "INV-1", **over}


def test_a_campaign_is_made_by_owner_admin_and_sales_and_read_by_no_viewer() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    for who in ALL_THREE:
        r = client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth(who))
        assert r.status_code == 200, (who, r.text)
    assert client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_viewer")).status_code == 403
    assert client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("b_owner")).status_code == 404
    for path in ("/campaigns", f"/campaigns/{CID}", f"/campaigns/{CID}/preview", f"/campaigns/{CID}/results", f"/campaigns/{CID}/recipients", "/call-list"):
        assert client.get(url(path), headers=auth("a_viewer")).status_code == 403, path
        assert client.get(url(path), headers=auth("a_sales")).status_code == 200, path
        assert client.get(url(path), headers=auth("b_owner")).status_code == 404, path


def test_a_save_reports_created_then_unchanged_and_sends_the_whole_campaign_to_the_database() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    r = client.put(url(f"/campaigns/{CID}"), json=body(call_after_step=2), headers=auth("a_owner")).json()
    assert r["created"] is True and r["back_to_draft"] is False and r["campaign"]["status"] == "draft"
    sent = fake.calls[-1][1][1]
    assert sent["p_campaign_id"] == str(CID) and sent["p_kind"] == "payment_due" and sent["p_call_after_step"] == 2 and sent["p_call_wait_hours"] == 24
    assert sent["p_steps"] == [{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]
    assert client.put(url(f"/campaigns/{CID}"), json=body(call_after_step=2), headers=auth("a_owner")).json()["created"] is False


@pytest.mark.parametrize(
    "bad",
    [
        {"steps": []},
        {"steps": [{"offset_days": i, "time": "10:00"} for i in range(6)]},  # more than five
        {"steps": [{"offset_days": 3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]},  # out of order
        {"steps": [{"offset_days": 0, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]},  # the same moment twice
        {"steps": [{"offset_days": 0, "time": "25:00"}]},
        {"steps": [{"offset_days": 0, "time": "9:00"}]},
        {"steps": [{"offset_days": 400, "time": "10:00"}]},
        {"steps": [{"offset_days": 0, "time": "10:00", "text": "Pay now"}]},  # a step has no words of its own
        {"kind": "promotion"},
        {"language": "fr"},
        {"name": ""},
        {"name": "x" * 101},
        {"message_text": "Hi"},
        {"message_text": "x" * 601},
        {"call_after_step": 6},
        {"call_wait_hours": 0},
        {"call_wait_hours": 169},
        {"status": "approved"},  # a client cannot set a status, an approver or a hash
        {"approved_by": str(U(int=1))},
        {"content_sha256": "0" * 64},
    ],
)
def test_a_campaign_that_does_not_fit_is_a_422(bad: dict[str, Any]) -> None:
    client, _ = make_client(campaigns=FakeCampaigns())
    assert client.put(url(f"/campaigns/{CID}"), json=body(**bad), headers=auth("a_owner")).status_code == 422, bad


def test_a_campaign_shows_what_still_stands_in_the_way_with_a_fixed_sentence_each() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    fake.issues = ["no_recipients", "template_not_approved"]
    r = client.get(url(f"/campaigns/{CID}"), headers=auth("a_owner")).json()
    assert r["issues"] == ["no_recipients", "template_not_approved"] and r["sending_on"] is True
    assert r["issue_text"] == {"no_recipients": "The campaign has nobody on its list.", "template_not_approved": "The WhatsApp template has not been approved yet."}
    assert client.get(url(f"/campaigns/{U(int=0xBAD)}"), headers=auth("a_owner")).status_code == 404


def test_the_list_pages_and_filters_by_status() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    for i in range(3):
        client.put(url(f"/campaigns/{U(int=0xCA0 + i)}"), json=body(name=f"C{i}"), headers=auth("a_owner"))
    page = client.get(url("/campaigns?limit=2"), headers=auth("a_owner")).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    client.get(url(f"/campaigns?limit=2&status=draft&after={page['next_cursor']}"), headers=auth("a_owner"))
    assert fake.calls[-1][1][1] == "draft" and fake.calls[-1][1][3][1] == U(page["items"][-1]["id"])
    assert client.get(url("/campaigns?status=weird"), headers=auth("a_owner")).status_code == 422
    assert client.get(url("/campaigns?after=%25"), headers=auth("a_owner")).status_code == 422


def test_a_list_of_5000_runs_in_ten_parts_with_the_files_own_row_numbers_and_sends_only_what_was_given() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    rows = [row(reference=f"I{i}") for i in range(5000)]
    r = client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": rows}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    parts = [c for c in fake.calls if c[0] == "recipients_add"]
    assert len(parts) == 10 and {len(c[1][2]) for c in parts} == {500}
    out = r.json()
    assert out["added"] == 10 * (500 - 500 // 7) and out["skipped"][0] == {"row": 7, "reason": "duplicate"} and any(s["row"] == 507 for s in out["skipped"]) and out["recipients"] > 0
    assert set(parts[0][1][2][0]) == {"contact_id", "due_date", "amount_paise", "reference"}, "no null is sent"
    by_phone = client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": [{"phone": "+91 90001 00001", "due_date": "2026-11-10"}]}, headers=auth("a_owner"))
    assert by_phone.status_code == 200 and fake.calls[-1][1][2][0] == {"phone": "+91 90001 00001", "due_date": "2026-11-10"}


@pytest.mark.parametrize(
    "bad",
    [
        {"contact_id": None, "phone": None},
        {"phone": "+91 90001 00001"},  # both
        {"amount_paise": 100_000_001},  # over the Rs 10 lakh cap of a message
        {"amount_paise": 0},
        {"amount_paise": 12.5},
        {"reference": "bad; ref"},
        {"due_date": "next week"},
        {"contact_id": "nope"},
        {"phone": "ring me", "contact_id": None},
        {"discount": 10},
    ],
)
def test_a_row_of_the_list_that_does_not_fit_is_a_422(bad: dict[str, Any]) -> None:
    client, _ = make_client(campaigns=FakeCampaigns())
    r = {k: v for k, v in {**row(), **bad}.items() if v is not None}
    assert client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": [r]}, headers=auth("a_owner")).status_code == 422, bad
    assert client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": []}, headers=auth("a_owner")).status_code == 422
    assert client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": [row()] * 5001}, headers=auth("a_owner")).status_code == 422


def test_the_list_can_come_from_the_ledger_and_people_can_be_taken_off() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    r = client.post(url(f"/campaigns/{CID}/recipients/from-ledger"), json={"due_from": "2026-10-01", "due_to": "2026-11-30", "party": "company", "min_open_paise": 600000}, headers=auth("a_sales"))
    assert r.json() == {"added": 1, "skipped": [{"row": 2, "reason": "no_contact"}], "recipients": 1}
    assert fake.calls[-1][1][2] == {"due_from": "2026-10-01", "due_to": "2026-11-30", "party": "company", "min_open_paise": 600000}
    for bad in ({"due_from": "2026-10-01"}, {"due_from": "2026-10-01", "due_to": "2026-11-30", "party": "robot"}, {"due_from": "2026-10-01", "due_to": "2026-11-30", "drop_table": 1}):
        assert client.post(url(f"/campaigns/{CID}/recipients/from-ledger"), json=bad, headers=auth("a_owner")).status_code == 422
    assert client.post(url(f"/campaigns/{CID}/recipients/{U(int=0x100)}/remove"), headers=auth("a_sales")).json() == {"removed": 1}
    assert fake.calls[-1][1][2] == U(int=0x100)
    client.post(url(f"/campaigns/{CID}/recipients/from-ledger"), json={"due_from": "2026-10-01", "due_to": "2026-11-30"}, headers=auth("a_owner"))
    assert client.post(url(f"/campaigns/{CID}/recipients/clear"), headers=auth("a_owner")).json() == {"removed": 1} and fake.calls[-1][1][2] is None
    assert client.post(url(f"/campaigns/{CID}/recipients/clear"), headers=auth("a_viewer")).status_code == 403


def test_the_preview_shows_the_rendered_samples_and_the_hash_of_what_was_shown() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": [row() for _ in range(3)]}, headers=auth("a_owner"))
    r = client.get(url(f"/campaigns/{CID}/preview"), headers=auth("a_sales")).json()
    assert r["recipients"] == 3 and r["samples"][0]["labels"] == ["first"] and r["samples"][0]["body"].startswith("Dear Person 0") and len(r["samples_sha256"]) == 64
    assert r["disclosure"] == "This message is from the business's AI assistant." and r["issues"] == [] and r["issue_text"] == {}


def test_only_the_owner_with_a_second_factor_approves_and_only_for_the_samples_they_saw() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    client.post(url(f"/campaigns/{CID}/recipients"), json={"rows": [row()]}, headers=auth("a_owner"))
    shown = client.get(url(f"/campaigns/{CID}/preview"), headers=auth("a_owner")).json()["samples_sha256"]
    path = url(f"/campaigns/{CID}/approve")
    for who in ("a_admin", "a_sales", "a_viewer", "b_owner"):
        assert client.post(path, json={"samples_sha256": shown}, headers=auth(who)).status_code in (403, 404), who
    r = client.post(path, json={"samples_sha256": shown}, headers=auth("a_owner", aal="aal1"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"
    assert "approve" not in fake.names(), "nothing reached the database without the second factor"
    for bad in ({}, {"samples_sha256": "short"}, {"samples_sha256": "G" * 64}, {"samples_sha256": shown, "status": "approved"}):
        assert client.post(path, json=bad, headers=auth("a_owner")).status_code == 422, bad
    stale = client.post(path, json={"samples_sha256": "0" * 64}, headers=auth("a_owner"))
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "samples_changed"
    ok = client.post(path, json={"samples_sha256": shown}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["campaign"]["status"] == "approved" and ok.json()["planned_steps"] == 3 and ok.json()["sending_on"] is True
    again = client.post(path, json={"samples_sha256": shown}, headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "campaign_state"


def test_a_campaign_that_is_not_ready_says_the_first_thing_in_the_way_in_a_fixed_sentence() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    fake.issues = ["step_in_quiet_hours", "no_recipients"]
    r = client.post(url(f"/campaigns/{CID}/approve"), json={"samples_sha256": "0" * 64}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "campaign_not_ready" and r.json()["error"]["reason"] == "step_in_quiet_hours"
    assert r.json()["error"]["message"] == "A step is at a time inside this business's quiet hours."
    fake.issues = ["something_new"]
    r = client.post(url(f"/campaigns/{CID}/approve"), json={"samples_sha256": "0" * 64}, headers=auth("a_owner"))
    assert r.json()["error"]["reason"] == "other" and "something_new" not in r.text, "a word the API does not know is never echoed"


def test_pause_resume_and_cancel_are_for_owner_and_admin() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    fake.rows[str(CID)]["status"] = "approved"
    assert client.post(url(f"/campaigns/{CID}/pause"), headers=auth("a_sales")).status_code == 403
    assert client.post(url(f"/campaigns/{CID}/pause"), headers=auth("a_admin")).json()["status"] == "paused"
    assert client.post(url(f"/campaigns/{CID}/pause"), headers=auth("a_admin")).json()["error"]["code"] == "campaign_state"
    assert client.post(url(f"/campaigns/{CID}/resume"), headers=auth("a_owner")).json()["status"] == "approved"
    assert client.post(url(f"/campaigns/{CID}/cancel"), headers=auth("a_owner")).json()["status"] == "cancelled"
    assert client.post(url(f"/campaigns/{CID}/cancel"), headers=auth("a_owner")).status_code == 409


def test_the_results_are_counts_and_nothing_else() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    client.put(url(f"/campaigns/{CID}"), json=body(), headers=auth("a_owner"))
    r = client.get(url(f"/campaigns/{CID}/results"), headers=auth("a_sales")).json()
    assert r["by_state"] == {"sent": 5, "delivered": 2, "blocked": 1} and r["by_reason"] == {"stopped": 1} and r["delivered_total"] == 2
    assert r["replied"] == 1 and r["paid_after_reminder"] == {"recipients": 1, "amount_paise": 500000} and r["calls"]["open"] == 1
    assert client.get(url(f"/campaigns/{U(int=0xBAD)}/results"), headers=auth("a_sales")).status_code == 404


# ============================================================================================================ the call list
ITEM = U(int=0x1A)


def test_the_call_list_shows_who_to_call_never_their_number() -> None:
    fake = FakeCampaigns()
    fake.items[str(ITEM)] = call_item(ITEM)
    client, _ = make_client(campaigns=fake)
    r = client.get(url("/call-list"), headers=auth("a_sales")).json()
    assert [i["id"] for i in r["items"]] == [str(ITEM)] and r["next_cursor"] is None
    text = str(r)
    assert "phone" not in text and "+00" not in text and r["items"][0]["call_request_id"] == str(U(int=0x300))
    assert client.get(url("/call-list?status=done"), headers=auth("a_sales")).json()["items"] == []
    assert client.get(url("/call-list?status=maybe"), headers=auth("a_sales")).status_code == 422
    assert client.get(url("/call-list?limit=1"), headers=auth("a_sales")).json()["next_cursor"]


def test_an_outcome_is_recorded_by_owner_admin_and_sales() -> None:
    fake = FakeCampaigns()
    fake.items[str(ITEM)] = call_item(ITEM)
    client, _ = make_client(campaigns=fake)
    path = url(f"/call-list/{ITEM}/outcome")
    assert client.post(path, json={"outcome": "paid"}, headers=auth("a_viewer")).status_code == 403
    r = client.post(path, json={"outcome": "paid"}, headers=auth("a_sales"))
    assert r.json() == {"id": str(ITEM), "status": "done", "outcome": "paid", "replayed": False}
    assert client.post(path, json={"outcome": "paid"}, headers=auth("a_owner")).json()["replayed"] is True
    other = client.post(path, json={"outcome": "wrong_number"}, headers=auth("a_owner"))
    assert other.status_code == 409 and other.json()["error"]["code"] == "campaign_state"
    assert client.post(url(f"/call-list/{U(int=0xBAD)}/outcome"), json={"outcome": "paid"}, headers=auth("a_owner")).status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"outcome": "promised"},  # a promise has its date
        {"outcome": "paid", "promised_on": "2026-11-20"},  # and only a promise does
        {"outcome": "call_later"},  # 'call later' has its time
        {"outcome": "paid", "call_after": "2026-11-12T10:00:00+05:30"},
        {"outcome": "maybe"},
        {"outcome": "stop", "note": "rude"},
    ],
)
def test_an_outcome_that_does_not_fit_is_a_422(bad: dict[str, Any]) -> None:
    fake = FakeCampaigns()
    fake.items[str(ITEM)] = call_item(ITEM)
    client, _ = make_client(campaigns=fake)
    assert client.post(url(f"/call-list/{ITEM}/outcome"), json=bad, headers=auth("a_owner")).status_code == 422, bad


def test_the_promise_date_and_the_call_later_time_reach_the_database_as_given() -> None:
    fake = FakeCampaigns()
    fake.items[str(ITEM)] = call_item(ITEM)
    client, _ = make_client(campaigns=fake)
    r = client.post(url(f"/call-list/{ITEM}/outcome"), json={"outcome": "call_later", "call_after": "2026-11-12T10:00:00+05:30"}, headers=auth("a_sales"))
    later = fake.calls[-1][1]
    assert r.json()["status"] == "open" and later[3] is None and later[4].isoformat() == "2026-11-12T10:00:00+05:30"
    r = client.post(url(f"/call-list/{ITEM}/outcome"), json={"outcome": "promised", "promised_on": "2026-11-20"}, headers=auth("a_sales"))
    promise = fake.calls[-1][1]
    assert r.json()["status"] == "done" and promise[3].isoformat() == "2026-11-20"


# ============================================================================================================ gates
@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/campaigns", None),
        ("get", f"/campaigns/{CID}", None),
        ("put", f"/campaigns/{CID}", body()),
        ("post", f"/campaigns/{CID}/recipients", {"rows": [row()]}),
        ("get", f"/campaigns/{CID}/preview", None),
        ("post", f"/campaigns/{CID}/approve", {"samples_sha256": "0" * 64}),
        ("post", f"/campaigns/{CID}/pause", None),
        ("get", f"/campaigns/{CID}/results", None),
        ("get", "/call-list", None),
        ("post", f"/call-list/{ITEM}/outcome", {"outcome": "paid"}),
    ],
)
def test_a_module_that_is_off_is_a_403_module_off_and_a_missing_repository_a_503(method: str, path: str, payload: Any) -> None:
    fake = FakeCampaigns()
    fake.error = ModuleOffError("SM701")
    client, _ = make_client(campaigns=fake)
    r = getattr(client, method)(url(path), headers=auth("a_owner"), **({"json": payload} if payload is not None else {}))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", (path, r.text)
    client, _ = make_client()
    r = getattr(client, method)(url(path), headers=auth("a_owner"), **({"json": payload} if payload is not None else {}))
    assert r.status_code == 503 and r.json()["error"]["code"] == "campaigns_unavailable"


def test_the_requests_are_closed_and_no_route_takes_a_sender_a_status_a_text_for_a_person_or_a_model() -> None:
    from app.campaigns import models as m

    for model in (m.CampaignIn, m.RecipientsIn, m.RecipientRowIn, m.LedgerFilterIn, m.ApproveIn, m.OutcomeIn, m.StepIn):
        assert model.model_config.get("extra") == "forbid", model.__name__
        fields = set(model.model_fields)
        assert not fields & {"status", "approved_by", "approved_at", "sender", "rendered", "body", "text", "model", "prompt", "content_sha256", "tenant_id", "phone_number_id", "token"}, (model.__name__, fields)
