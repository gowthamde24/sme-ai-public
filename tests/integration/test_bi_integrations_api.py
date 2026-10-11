"""Job BI on the real stack: the accounting export (real orders, real events, real money), the spreadsheet imports (customers through the existing lead import, catalogue stock), the visits calendar
feed (a real token, the anonymous read, revocation), the policy acceptance and the voice status, with the roles, the second factor and the other business each time. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from xml.etree import ElementTree as ET

import httpx
import operator_sql
import pytest
from conftest import aal1_token
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient
from order_support import OrderWorld
from quote_support import QuoteWorld

from app.integrations.xlsx import write_xlsx

INDIA = timedelta(hours=5, minutes=30)


def india_today() -> datetime:
    return datetime.now(UTC) + INDIA


@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=4)
    qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
    qw.policy_version()
    world = OrderWorld(qw)
    world.policy()
    return world


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def hdr(ow: OrderWorld, user: str, *, weak: bool = False) -> dict[str, str]:
    token = aal1_token(ow.w.stack, ow.users[user]) if weak else ow.users[user].token
    return {"Authorization": f"Bearer {token}"}


def window() -> dict[str, str]:
    d = india_today().date()
    return {"from_date": (d - timedelta(days=1)).isoformat(), "to_date": (d + timedelta(days=1)).isoformat()}


def export(client: TestClient, ow: OrderWorld, user: str = "owner", fmt: str = "csv", **kw: Any) -> httpx.Response:
    r: httpx.Response = client.post(url(ow.t, "/exports/accounting"), json={"export_id": uid(), "format": fmt, **window()}, headers=hdr(ow, user, **kw))
    return r


def run_order(client: TestClient, ow: OrderWorld, steps: Sequence[tuple[str, str, int | None]]) -> tuple[str, int, int, int]:
    """An order from a real approved quote, taken through `steps` (user, event type, amount). Returns (order id, order no, quote total, advance)."""
    quote = ow.approved_quote()
    r = client.post(url(ow.t, "/orders"), json={"id": uid(), "quote_id": quote}, headers=hdr(ow, "owner"))
    assert r.status_code == 201, r.text
    body = r.json()
    for user, type_, amount in steps:
        payload: dict[str, Any] = {"id": uid(), "type": type_}
        if amount is not None:
            payload["amount_paise"], payload["ledger_id"] = amount, uid()
        e = client.post(url(ow.t, f"/orders/{body['id']}/events"), json=payload, headers=hdr(ow, user))
        assert e.status_code == 200, (type_, e.text)
    return str(body["id"]), int(body["order_no"]), int(body["order_total_paise"]), int(body["advance_paise"])


# ============================================================================ the accounting export
def test_the_export_of_real_orders_agrees_with_the_database_in_every_format(client: TestClient, ow: OrderWorld) -> None:
    order, order_no, total, advance = run_order(client, ow, [("sales", "send_quote", None), ("sales", "customer_accept", None), ("sales", "request_advance", None), ("admin", "record_payment", None)][:3])
    paid = max(1, advance)
    client.post(url(ow.t, f"/orders/{order}/events"), json={"id": uid(), "type": "record_payment", "amount_paise": paid, "ledger_id": uid()}, headers=hdr(ow, "admin"))
    lost_quote_order, *_ = run_order(client, ow, [("sales", "send_quote", None)])  # sent but not accepted: not a sale
    quote_row = operator_sql.sql(f"select q.merchandise_net_paise || '|' || q.item_tax_paise || '|' || q.shipping_net_paise || '|' || q.shipping_tax_paise || '|' || o.order_total_paise from public.orders o join public.quotes q on q.id = o.quote_id where o.id = '{order}'")
    merch, item_tax, ship, ship_tax, order_total = (int(x) for x in quote_row.split("|"))
    assert order_total == total == merch + item_tax + ship + ship_tax

    csv_r = export(client, ow)
    assert csv_r.status_code == 200 and csv_r.headers["content-type"].startswith("text/csv")
    text = csv_r.content.decode("utf-8-sig")
    rows = [line.split(",") for line in text.strip().split("\r\n")]
    sales = [r for r in rows if r[0] == "Sale" and r[3] == str(order_no)]
    assert len(sales) == 1 and sales[0][14] == f"{total // 100}.{total % 100:02d}", "the sale is in the CSV with the quote's total"
    assert f"SO-{order_no:05d}" in text
    assert not [r for r in rows if r[0] == "Sale" and r[3] == str(int(order_no) + 1)], "an order that was sent but not accepted is not a sale"
    assert any(r[0] == "Payment received" and r[3] == str(order_no) and r[14] == f"{paid // 100}.{paid % 100:02d}" for r in rows)

    z = zipfile.ZipFile(io.BytesIO(export(client, ow, fmt="tally_zip").content))
    assert z.namelist() == ["1-masters.xml", "2-vouchers.xml", "README.txt"]
    root = ET.fromstring(z.read("2-vouchers.xml").split(b"\n", 1)[1])  # noqa: S314 - our own output
    mine = [v for v in root.iter("VOUCHER") if v.findtext("VOUCHERNUMBER") == f"SO-{order_no:05d}"]
    assert len(mine) == 1
    amounts = [(e.findtext("ISDEEMEDPOSITIVE"), e.findtext("AMOUNT")) for e in mine[0].findall("LEDGERENTRIES.LIST")]
    from decimal import Decimal

    assert sum(Decimal(a or "0") for _, a in amounts) == 0, "the voucher balances"
    assert Decimal(amounts[0][1] or "0") == -Decimal(total) / 100, "the party is debited the order total"
    assert re.search(r"Output (CGST|SGST|IGST)", z.read("1-masters.xml").decode()) or item_tax + ship_tax == 0

    xl = export(client, ow, fmt="vyapar_xlsx")
    assert xl.status_code == 200 and xl.content[:2] == b"PK"
    assert export(client, ow, fmt="xlsx").status_code == 200 and export(client, ow, fmt="tally_masters_xml").status_code == 200 and export(client, ow, fmt="tally_vouchers_xml").status_code == 200
    assert lost_quote_order


def test_every_export_is_audited_and_refusals_are_not(client: TestClient, ow: OrderWorld) -> None:
    before = int(operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{ow.t.id}' and action = 'export.create'"))
    ok = export(client, ow, fmt="csv")
    assert ok.status_code == 200
    export_id = ok.headers["x-export-id"]
    assert int(operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{ow.t.id}' and action = 'export.create'")) == before + 1
    row = json.loads(operator_sql.sql(f"select new_values::text from public.audit_events where entity_id = '{export_id}' and action = 'export.create'"))
    assert row["format"] == "csv" and row["kind"] == "accounting" and set(row) == {"kind", "format", "from", "to", "orders", "payments"}
    assert operator_sql.sql(f"select actor_user_id::text from public.audit_events where entity_id = '{export_id}' and action = 'export.create'") == str(ow.users["owner"].id)
    assert export(client, ow, "sales").status_code == 403 and export(client, ow, "viewer").status_code == 403
    assert export(client, ow, "owner", weak=True).status_code == 403 and export(client, ow, "admin", weak=True).status_code == 403
    assert int(operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{ow.t.id}' and action = 'export.create'")) == before + 1, "refused requests leave no export record"
    assert export(client, ow, "admin").status_code == 200


def test_another_business_can_neither_export_nor_see_these_sales(client: TestClient, ow: OrderWorld, eval_world: World) -> None:
    b_owner = eval_world.b.users["owner"]
    r = client.post(url(ow.t, "/exports/accounting"), json={"export_id": uid(), "format": "csv", **window()}, headers={"Authorization": f"Bearer {b_owner.token}"})
    assert r.status_code == 404, "business b's owner is not a member of business a"
    mine = client.post(url(eval_world.b, "/exports/accounting"), json={"export_id": uid(), "format": "csv", **window()}, headers={"Authorization": f"Bearer {b_owner.token}"})
    assert mine.status_code == 200
    assert not [line for line in mine.content.decode("utf-8-sig").splitlines()[1:] if line.startswith("Sale")], "business b has no sales, and none of a's appear"


def test_a_window_too_long_or_backwards_is_refused(client: TestClient, ow: OrderWorld) -> None:
    for body in ({"from_date": "2024-01-01", "to_date": "2026-10-01"}, {"from_date": "2026-10-02", "to_date": "2026-10-01"}):
        r = client.post(url(ow.t, "/exports/accounting"), json={"export_id": uid(), "format": "csv", **body}, headers=hdr(ow, "owner"))
        assert r.status_code == 422


# ============================================================================ spreadsheet import: customers
def csv_file(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return buf.getvalue().encode()


def up(client: TestClient, ow: OrderWorld, path: str, data: bytes, user: str = "owner", **kw: Any) -> httpx.Response:
    r: httpx.Response = client.post(url(ow.t, "/imports/spreadsheet" + path), content=data, headers={**hdr(ow, user, **kw), "Content-Type": "text/csv"})
    return r


def test_the_customer_import_previews_confirms_replays_and_never_overwrites(client: TestClient, ow: OrderWorld) -> None:
    tag = uid()[:8]
    f = csv_file(
        [
            ["Party Name", "Contact Person", "Mobile", "Email", "City"],
            [f"Import Silks {tag} One", "Contact One", "+00 90000 21001", f"one{tag}@example.test", "Hyderabad"],
            [f"Import Silks {tag} Two", "", "98765 43210", "", "Guntur"],
            [f"Real Shop {tag}", "Real Person", "+91 98765 00000", f"real{tag}@gmail.com", "Vijayawada"],
            ["=HYPERLINK(\"http://evil\",\"x\")", "", "", "", "Nellore"],
        ]
    )
    job = uid()
    seen = up(client, ow, "/inspect?kind=customers", f).json()
    assert seen["suggested_mapping"]["company_name"] == 0 and seen["rows"] == 4
    pv = up(client, ow, f"/preview?kind=customers&job_id={job}", f)
    assert pv.status_code == 200, pv.text
    body = pv.json()
    by_line = {r["line"]: r for r in body["rows"]}
    assert by_line[2]["status"] == "will_create" and by_line[3]["status"] == "will_create" and by_line[3]["note"] == "contact_needs_email"
    assert by_line[4]["status"] == "rejected" and by_line[4]["reason"] == "contact_domain_not_reserved", "the real-data gate is closed: a real e-mail address is refused, with its code"
    assert [(i["line"], i["code"]) for i in body["issues"]] == [(5, "formula_like")]
    assert f"Import Silks {tag}" not in json.dumps(body["issues"])
    assert int(operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{ow.t.id}' and name like 'Import Silks {tag}%'")) == 0, "a preview creates nothing"

    assert up(client, ow, f"/{job}/confirm", f, "owner", weak=True).status_code == 403, "running an import needs the second factor"
    changed = up(client, ow, f"/{job}/confirm", f.replace(b"Hyderabad", b"Secunderabad"), "owner")
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "import_file_changed", "another file than the one that was checked is refused"
    assert int(operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{ow.t.id}' and name like 'Import Silks {tag}%'")) == 0
    done = up(client, ow, f"/{job}/confirm", f, "owner")
    assert done.status_code == 200 and done.json()["replay"] is False and done.json()["result"]["counts"]["created"] == 2, done.text
    n = int(operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{ow.t.id}' and name like 'Import Silks {tag}%'"))
    assert n == 2, "exactly the two good rows became companies"
    again = up(client, ow, f"/{job}/confirm", f, "owner")
    assert again.status_code == 200 and again.json()["replay"] is True
    assert int(operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{ow.t.id}' and name like 'Import Silks {tag}%'")) == 2, "running the finished job again imports nothing"
    job_row = client.get(url(ow.t, f"/imports/spreadsheet/jobs/{job}"), headers=hdr(ow, "owner")).json()
    assert job_row["status"] == "completed" and job_row["counts"]["created"] == 2 and tag not in json.dumps(job_row), "the job keeps counts, no cell"

    second = uid()
    pv2 = up(client, ow, f"/preview?kind=customers&job_id={second}", f).json()
    assert [r["status"] for r in pv2["rows"]][:2] == ["duplicate", "duplicate"], "the same customers again are duplicates, not overwritten"
    conf2 = up(client, ow, f"/{second}/confirm", f).json()
    assert conf2["result"]["counts"]["created"] == 0 and conf2["result"]["counts"]["skipped_duplicate"] == 2
    assert operator_sql.sql(f"select city from public.companies where tenant_id = '{ow.t.id}' and name = 'Import Silks {tag} One'") == "Hyderabad"


def test_nothing_of_one_business_is_matched_or_shown_in_another(client: TestClient, ow: OrderWorld, eval_world: World) -> None:
    tag = uid()[:8]
    f = csv_file([["Party Name", "City"], [f"Cross Silks {tag}", "Chennai"]])
    job = uid()
    up(client, ow, f"/preview?kind=customers&job_id={job}", f)
    up(client, ow, f"/{job}/confirm", f)
    b = eval_world.b.users["owner"]
    other = client.post(url(eval_world.b, f"/imports/spreadsheet/preview?kind=customers&job_id={uid()}"), content=f, headers={"Authorization": f"Bearer {b.token}", "Content-Type": "text/csv"})
    assert other.status_code == 200 and other.json()["rows"][0]["status"] == "will_create", "business b does not see business a's customer as a duplicate"
    foreign_job = client.get(url(eval_world.b, f"/imports/spreadsheet/jobs/{job}"), headers={"Authorization": f"Bearer {b.token}"})
    assert foreign_job.status_code == 404, "a job of business a is not found through business b"


def test_the_import_roles(client: TestClient, ow: OrderWorld) -> None:
    f = csv_file([["Party Name"], ["Someone"]])
    for user in ("sales", "viewer"):
        assert up(client, ow, "/inspect?kind=customers", f, user).status_code == 403
        assert up(client, ow, f"/preview?kind=customers&job_id={uid()}", f, user).status_code == 403
    assert up(client, ow, "/inspect?kind=customers", f, "admin").status_code == 200
    assert client.get(url(ow.t, "/imports/spreadsheet/jobs"), headers=hdr(ow, "sales")).status_code == 403


# ============================================================================ spreadsheet import: stock
def test_the_stock_import_changes_only_the_named_items_of_this_business(client: TestClient, ow: OrderWorld, eval_world: World) -> None:
    tag = uid()[:8]
    names = [f"Stock Maroon {tag}", f"Stock Green {tag}"]
    for t, n in ((ow.t, names[0]), (ow.t, names[1]), (eval_world.b, names[0])):
        operator_sql.sql(
            f"insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, stock_status, active, created_by) "
            f"values ('{uid()}', '{t.id}', '{n}', 'kanchi_pattu', array['maroon'], '25k_50k', 'in_stock', false, '{ow.users['owner'].id if t is ow.t else eval_world.b.users['owner'].id}')"
        )
    f = csv_file([["Design", "Qty"], [names[0], "1"], [names[1].upper(), "0"], [f"No such saree {tag}", "5"], ["బాలాజీ", "4"]])
    job = uid()
    pv = up(client, ow, f"/preview?kind=stock&job_id={job}", f).json()
    assert [(r["status"], r["old_status"], r["new_status"]) for r in pv["rows"]] == [("will_change", "in_stock", "few_left"), ("will_change", "in_stock", "made_to_order"), ("not_found", None, "in_stock"), ("not_found", None, "in_stock")]
    assert operator_sql.sql(f"select stock_status from public.catalogue_items where tenant_id = '{ow.t.id}' and name = '{names[0]}'") == "in_stock", "a preview changes nothing"
    assert up(client, ow, f"/{job}/confirm", f, "owner", weak=True).status_code == 403
    done = up(client, ow, f"/{job}/confirm", f).json()
    assert done["result"]["counts"]["updated"] == 2 and done["result"]["counts"]["not_found"] == 2
    assert operator_sql.sql(f"select stock_status from public.catalogue_items where tenant_id = '{ow.t.id}' and name = '{names[0]}'") == "few_left"
    assert operator_sql.sql(f"select stock_status from public.catalogue_items where tenant_id = '{ow.t.id}' and name = '{names[1]}'") == "made_to_order"
    assert operator_sql.sql(f"select stock_status from public.catalogue_items where tenant_id = '{eval_world.b.id}' and name = '{names[0]}'") == "in_stock", "the other business's item with the same name is untouched"
    assert up(client, ow, f"/{job}/confirm", f).json()["replay"] is True


# ============================================================================ the calendar feed
def test_the_calendar_feed_end_to_end(client: TestClient, ow: OrderWorld) -> None:
    lead = operator_sql.sql(f"select id from public.leads where tenant_id = '{ow.t.id}' order by created_at limit 1")
    assert lead, "the world has a lead"
    contact = uid()
    operator_sql.sql(f"insert into public.contacts (id, tenant_id, company_id, full_name, phone) select '{contact}', tenant_id, company_id, 'Anil Kumar Rao', '+00 90000 33001' from public.leads where id = '{lead}'")
    starts = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    ends = starts + timedelta(minutes=30)
    operator_sql.sql(
        f"insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, request_sha256, created_by, purpose, note) "
        f"select '{uid()}', tenant_id, id, '{contact}', company_id, ('{starts.isoformat()}'::timestamptz at time zone 'Asia/Kolkata')::date, '{starts.isoformat()}', '{ends.isoformat()}', repeat('a', 64), '{ow.users['owner'].id}', 'secret purpose', 'secret note' from public.leads where id = '{lead}'"
    )
    made = client.post(url(ow.t, "/calendar-feed"), headers=hdr(ow, "viewer"))
    assert made.status_code == 201, "any member, even a viewer, can make their feed"
    token = made.json()["token"]
    assert operator_sql.sql(f"select count(*) from integrations.calendar_tokens where token_sha256 = '{hashlib.sha256(token.encode()).hexdigest()}'") == "1"
    assert operator_sql.sql(f"select count(*) from integrations.calendar_tokens where token_sha256 = '{token}'") == "0", "the token itself is never stored"
    anon = TestClient(client.app)
    r = anon.get(made.json()["path"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar"), r.text
    assert "SUMMARY:Visit: Anil R." in r.text and f"DTSTART:{starts.strftime('%Y%m%dT%H%M%SZ')}" in r.text
    for secret in ("90000", "secret purpose", "secret note", "Kumar", "Company"):
        assert secret not in r.text
    assert client.get(url(ow.t, "/calendar-feed"), headers=hdr(ow, "viewer")).json()["last_used_at"] is not None
    assert client.get(url(ow.t, "/calendar-feed"), headers=hdr(ow, "sales")).json()["active"] is False, "feeds are per member"
    rotated = client.post(url(ow.t, "/calendar-feed"), headers=hdr(ow, "viewer")).json()
    assert anon.get(made.json()["path"]).status_code == 404 and anon.get(rotated["path"]).status_code == 200
    assert client.post(url(ow.t, "/calendar-feed/revoke"), headers=hdr(ow, "viewer")).json()["revoked"] == 1
    assert anon.get(rotated["path"]).status_code == 404
    assert anon.get("/v1/calendar/feed/" + "z" * 43 + ".ics").status_code == 404


def test_a_feed_stops_when_the_member_leaves(client: TestClient, ow: OrderWorld) -> None:
    made = client.post(url(ow.t, "/calendar-feed"), headers=hdr(ow, "sales")).json()
    anon = TestClient(client.app)
    assert anon.get(made["path"]).status_code == 200
    digest = hashlib.sha256(made["token"].encode()).hexdigest()
    operator_sql.sql(f"update integrations.calendar_tokens set revoked_at = now() where token_sha256 = '{digest}'")
    assert anon.get(made["path"]).status_code == 404


# ============================================================================ policy acceptance and voice status
def test_policy_acceptance_is_recorded_for_the_person_and_only_for_current_versions(client: TestClient, ow: OrderWorld) -> None:
    cur = client.get("/v1/policies/current").json()
    assert set(cur) == {"terms", "privacy"}
    h = hdr(ow, "viewer")
    before = client.get("/v1/me/policy-acceptances", headers=h).json()
    ok = client.post("/v1/me/policy-acceptances", json={"terms_version": cur["terms"]["version"], "privacy_version": cur["privacy"]["version"]}, headers=h)
    assert ok.status_code == 200 and ok.json()["needs_acceptance"] == {"terms": False, "privacy": False}
    assert before["current"] == cur
    assert client.post("/v1/me/policy-acceptances", json={"terms_version": "1999-01-01"}, headers=h).status_code == 409
    mine = operator_sql.sql(f"select count(*) from integrations.policy_acceptances where user_id = '{ow.users['viewer'].id}'")
    assert int(mine) >= 2
    assert all(a["version"] in (cur["terms"]["version"], cur["privacy"]["version"]) for a in client.get("/v1/me/policy-acceptances", headers=h).json()["accepted"])
    assert client.get("/v1/me/policy-acceptances", headers=hdr(ow, "sales")).json()["needs_acceptance"] == {"terms": True, "privacy": True}, "another person's acceptance is not mine"
    assert client.get("/v1/me/policy-acceptances").status_code == 401


def test_voice_status_on_a_system_without_a_speech_provider(client: TestClient, ow: OrderWorld) -> None:
    r = client.get(url(ow.t, "/assistant/voice/status"), headers=hdr(ow, "sales"))
    assert r.status_code == 200 and r.json()["available"] is False and r.json()["max_seconds"] == 60
    assert client.get(url(ow.t, "/assistant/voice/status"), headers=hdr(ow, "viewer")).status_code == 403


def test_xlsx_customer_upload_goes_through_the_same_path(client: TestClient, ow: OrderWorld) -> None:
    data = write_xlsx([("Customers", [["Party Name", "City"], [f"Xlsx Silks {uid()[:8]}", "Warangal"]])])
    r = client.post(url(ow.t, f"/imports/spreadsheet/preview?kind=customers&job_id={uid()}"), content=data, headers={**hdr(ow, "owner"), "Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json()["rows"][0]["status"] == "will_create"
