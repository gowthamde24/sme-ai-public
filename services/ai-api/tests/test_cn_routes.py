"""Job CN: the routes of sites, dues, material quotes and deliveries, and the public calculator, with fakes (no database). The database's own rules are proved in supabase/tests/database/96..99 and
tests/integration/test_cn_*.py; here: who may call what, the shapes, the idempotency, the mapping of every refusal to its fixed sentence, and that the REAL calculator runs in the quote flow."""

from __future__ import annotations

import copy
import io
import json
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from PIL import Image

from app.catalogue.storage import SIGNED_URL_SECONDS
from app.deliveries import errors as dl
from app.dues import errors as du
from app.materials import engine_port
from app.materials import errors as mq
from app.orders import errors as order_errors
from app.packs.errors import ModuleOffError
from app.quotes.errors import RequirementNotConfirmedError
from app.sites.errors import SiteContactError
from tests.catalogue_fakes import FakeStorage
from tests.cn_fakes import (
    ITEM_ID,
    WORKED,
    FakeDeliveries,
    FakeDues,
    FakeMaterials,
    FakeSites,
    stored_quote,
)
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

A = TENANT_A.id
U = uuid.UUID
COMPANY = str(U(int=0xC0))


def url(tail: str, tenant: uuid.UUID = A) -> str:
    return f"/v1/tenants/{tenant}{tail}"


def jpeg(size: tuple[int, int] = (800, 600)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (200, 120, 40)).save(out, format="JPEG")
    return out.getvalue()


# ============================================================================================================ the public calculator
def calc_body() -> dict[str, Any]:
    return {
        "as_of": "2026-10-14",
        "lines": [{"sku": "PV80-GREY", "name": "Paver block 80 mm grey", "mode": "area", "sold_per": "sq_ft", "unit_price_paise": 6500, "gst_bps": 1800, "hsn": "68101990", "area_unit": "sq_ft", "area_x100": 100000,
                   "pieces_per_area_x1000": 4500, "pieces_per_pallet": 500}],
        "policy": {"default_wastage_bps": 500, "round_to_pallet": False, "bill_wastage": True, "transport": {"kind": "per_trip", "capacity_basis": "pieces", "truck_capacity": 2500, "rate_per_trip_paise": 350000, "gst_bps": 1800},
                   "advance_bps": 5000, "credit_days": 0, "validity_days": 7, "rounding_mode": "half_up"},
        "customer": {"outstanding_paise": 0},
    }  # fmt: skip


def test_the_calculator_needs_no_sign_in_and_gives_the_worked_example() -> None:
    client, _ = make_client()
    r = client.post("/v1/calculate/materials", json=calc_body())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "draft" and out["engine_version"] == "1.0.0"
    line = out["lines"][0]
    assert (line["pieces"], line["pallets"], out["trips"], out["totals"]["total"]) == (4725, 10, 2, 8879500)
    assert out["range"] == {"total_low": 8496000, "total_high": 8879500}
    assert out["flags"]["needs_owner_approval"] is True and out["flags"]["reasons"] == []
    assert out["payment_terms"]["balance_on"] == "delivery" and out["valid_until"] == "2026-10-21"


def test_the_calculator_equals_the_reference_vectors_through_the_api() -> None:
    from tests.cn_fakes import VECTORS

    client, _ = make_client()
    checked = 0
    for v in VECTORS:
        if v["expected"]["status"] != "draft":
            continue
        body = copy.deepcopy(v["request"])
        r = client.post("/v1/calculate/materials", json=body)
        if r.status_code == 422:
            continue  # a vector the API's own closed models refuse before the calculator (e.g. an unknown key); the calculator's rejections are the other test
        assert r.status_code == 200, (v["name"], r.text)
        assert r.json()["totals"] == v["expected"]["totals"], v["name"]
        assert r.json()["trips"] == v["expected"]["trips"], v["name"]
        checked += 1
    assert checked >= 20


def test_a_request_the_calculator_cannot_use_is_a_rejection_with_its_closed_code_not_an_error() -> None:
    client, _ = make_client()
    body = calc_body()
    body["laying"] = True
    r = client.post("/v1/calculate/materials", json=body)
    assert r.status_code == 200 and r.json()["status"] == "rejected" and r.json()["codes"] == ["LAYING_RATE_MISSING"]
    assert r.json()["totals"] is None and r.json()["lines"] == []


def test_a_gst_rate_is_never_assumed_by_the_api_either() -> None:
    client, _ = make_client()
    body = calc_body()
    del body["lines"][0]["gst_bps"]
    r = client.post("/v1/calculate/materials", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("change", [("lines", 0, "unit_price_paise", 65.5), ("lines", 0, "area_x100", True), ("lines", 0, "area_x100", 0), ("lines", 0, "wastage_bps", 6000), ("lines", 0, "hsn", "68X1")])
def test_floats_booleans_and_out_of_range_numbers_are_422(change: tuple[str, int, str, Any]) -> None:
    client, _ = make_client()
    body = calc_body()
    body[change[0]][change[1]][change[2]] = change[3]
    assert client.post("/v1/calculate/materials", json=body).status_code == 422


def test_unknown_properties_are_refused_so_nothing_can_be_smuggled_in() -> None:
    client, _ = make_client()
    body = calc_body()
    body["totals"] = {"total": 1}
    assert client.post("/v1/calculate/materials", json=body).status_code == 422
    body = calc_body()
    body["lines"][0]["tenant_id"] = str(A)
    assert client.post("/v1/calculate/materials", json=body).status_code == 422


def test_a_missing_as_of_means_today_in_india_and_the_request_is_not_stored_anywhere() -> None:
    client, _ = make_client()
    body = calc_body()
    del body["as_of"]
    r = client.post("/v1/calculate/materials", json=body)
    assert r.status_code == 200
    from app.materials.service import today_ist

    assert r.json()["valid_until"] > today_ist().isoformat()


def test_the_calculator_is_rate_limited() -> None:
    client, _ = make_client(rate_limit=True)
    codes = [client.post("/v1/calculate/materials", json=calc_body()).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and 429 in codes[30:]


def test_the_calculator_fails_closed_when_the_package_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(engine_port, "_engine", None)
    monkeypatch.setattr(engine_port, "_PACKAGE_SRC", None)
    monkeypatch.setattr(engine_port, "_import", lambda src=None: (_ for _ in ()).throw(engine_port.CalculatorUnavailable()))
    client, _ = make_client()
    r = client.post("/v1/calculate/materials", json=calc_body())
    assert r.status_code == 503 and r.json()["error"]["code"] == "calculator_unavailable"
    monkeypatch.undo()


# ============================================================================================================ sites
def site_body(**over: Any) -> dict[str, Any]:
    return {"company_id": COMPANY, "name": "Kukatpally villa", "address_line": "Plot 4", "city": "Hyderabad", "pin": "500072", "distance_km": 22, **over}


def test_sites_are_written_by_owner_admin_and_sales_and_read_by_every_member() -> None:
    fake = FakeSites()
    client, _ = make_client(sites=fake)
    sid = U(int=0x51)
    for who in ("a_owner", "a_admin", "a_sales"):
        r = client.put(url(f"/sites/{sid}"), json=site_body(), headers=auth(who))
        assert r.status_code == 200 and r.json()["site"]["id"] == str(sid), (who, r.text)
    assert client.put(url(f"/sites/{sid}"), json=site_body(), headers=auth("a_viewer")).status_code == 403
    assert client.put(url(f"/sites/{sid}"), json=site_body(), headers=auth("b_owner")).status_code == 404
    assert client.put(url(f"/sites/{sid}"), json=site_body()).status_code == 401
    for who in ("a_owner", "a_viewer"):
        assert client.get(url(f"/sites/{sid}"), headers=auth(who)).status_code == 200
        assert client.get(url("/sites"), headers=auth(who)).json()["items"][0]["id"] == str(sid)


def test_a_site_body_is_closed_and_validated_before_the_database() -> None:
    client, fake = make_client(sites=FakeSites())[0], None
    sid = U(int=0x52)
    for bad in ({"pin": "12345"}, {"map_lat": 91.0, "map_lng": 78.0}, {"distance_km": 6000}, {"lane_width_ft": 0}, {"name": "  "}, {"company_id": "nope"}, {"tenant_id": str(A)}, {"night_delivery": "yes"}):
        r = client.put(url(f"/sites/{sid}"), json=site_body(**bad), headers=auth("a_owner"))
        assert r.status_code == 422, (bad, r.text)
    assert fake is None


def test_a_site_has_its_own_errors_and_the_module_check_reaches_the_caller() -> None:
    fake = FakeSites()
    client, _ = make_client(sites=fake)
    sid = U(int=0x53)
    fake.error = SiteContactError("SM751")
    r = client.put(url(f"/sites/{sid}"), json=site_body(), headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "site_contact_invalid"
    fake.error = ModuleOffError("SM701")
    r = client.get(url("/sites"), headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off"
    unavailable, _ = make_client()
    assert unavailable.get(url("/sites"), headers=auth("a_owner")).status_code == 503


def test_the_site_list_pages_by_an_opaque_cursor_and_filters_by_customer() -> None:
    fake = FakeSites()
    client, _ = make_client(sites=fake)
    for i in range(3):
        client.put(url(f"/sites/{U(int=0x60 + i)}"), json=site_body(name=f"Site {i}"), headers=auth("a_owner"))
    page = client.get(url("/sites?limit=2"), headers=auth("a_owner")).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    client.get(url(f"/sites?after={page['next_cursor']}&company_id={COMPANY}"), headers=auth("a_owner"))
    assert fake.calls[-1][1][1] == U(COMPANY) and fake.calls[-1][1][3] == 50
    assert client.get(url("/sites?after=%25"), headers=auth("a_owner")).status_code == 422


# ============================================================================================================ dues
def test_dues_are_read_and_recorded_by_owner_admin_and_sales_and_never_shown_to_a_viewer() -> None:
    fake = FakeDues()
    client, _ = make_client(dues=fake)
    for who in ("a_owner", "a_admin", "a_sales"):
        assert client.get(url(f"/dues/customers/{COMPANY}"), headers=auth(who)).status_code == 200, who
        assert client.get(url("/dues"), headers=auth(who)).status_code == 200
    assert client.get(url(f"/dues/customers/{COMPANY}"), headers=auth("a_viewer")).status_code == 403
    assert client.get(url("/dues"), headers=auth("a_viewer")).status_code == 403
    assert client.get(url(f"/dues/customers/{COMPANY}"), headers=auth("b_owner")).status_code == 404
    r = client.get(url(f"/dues/customers/{COMPANY}?as_of=2026-10-14"), headers=auth("a_owner")).json()
    assert r["outstanding_paise"] == 2400000 and r["ageing"]["d61_90"] == 1800000 and r["open_invoices"][0]["invoice_no"] == "INV-2"
    assert fake.calls[-1][1][2].isoformat() == "2026-10-14"


def test_an_invoice_and_a_payment_are_recorded_with_the_callers_ids() -> None:
    fake = FakeDues()
    client, _ = make_client(dues=fake)
    iid, pid = U(int=0x81), U(int=0x82)
    r = client.put(url(f"/dues/invoices/{iid}"), json={"company_id": COMPANY, "invoice_no": "INV-9", "invoice_date": "2026-10-01", "due_date": "2026-10-31", "amount_paise": 500000}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json() == {"id": str(iid), "replayed": False}
    assert fake.calls[-1][1][1]["p_source"] == "manual" and fake.calls[-1][1][1]["p_invoice_date"] == "2026-10-01"
    r = client.put(url(f"/dues/payments/{pid}"), json={"company_id": COMPANY, "received_on": "2026-10-02", "amount_paise": 777, "method": "upi"}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json() == {"id": str(pid), "replayed": True}
    for bad in ({"amount_paise": 0}, {"method": "barter"}, {"received_on": "yesterday"}, {"amount_paise": 1.5}):
        body = {"company_id": COMPANY, "received_on": "2026-10-02", "amount_paise": 100, "method": "cash", **bad}
        assert client.put(url(f"/dues/payments/{pid}"), json=body, headers=auth("a_owner")).status_code == 422, bad
    assert client.put(url(f"/dues/invoices/{iid}"), json={"company_id": COMPANY, "invoice_no": "bad; drop", "invoice_date": "2026-10-01", "due_date": "2026-10-31", "amount_paise": 5}, headers=auth("a_owner")).status_code == 422


def test_voiding_is_for_owner_and_admin_only_and_a_second_void_is_a_409() -> None:
    fake = FakeDues()
    client, _ = make_client(dues=fake)
    iid = U(int=0x83)
    assert client.post(url(f"/dues/invoices/{iid}/void"), headers=auth("a_sales")).status_code == 403
    assert client.post(url(f"/dues/invoices/{iid}/void"), headers=auth("a_admin")).json() == {"id": str(iid), "voided": True}
    assert client.post(url(f"/dues/payments/{iid}/void"), headers=auth("a_owner")).status_code == 200
    fake.error = du.AlreadyVoidedError("SM782")
    r = client.post(url(f"/dues/invoices/{iid}/void"), headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_voided"
    fake.error = du.InvoiceNumberUsedError("SM781")
    r = client.put(url(f"/dues/invoices/{iid}"), json={"company_id": COMPANY, "invoice_no": "INV-9", "invoice_date": "2026-10-01", "due_date": "2026-10-31", "amount_paise": 5}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "invoice_number_used"


def test_the_credit_limit_is_the_owners_with_a_second_factor() -> None:
    fake = FakeDues()
    client, _ = make_client(dues=fake)
    path = url(f"/dues/customers/{COMPANY}/credit-limit")
    assert client.put(path, json={"limit_paise": 2500000}, headers=auth("a_owner")).json() == {"company_id": COMPANY, "limit_paise": 2500000}
    assert client.put(path, json={"limit_paise": None}, headers=auth("a_owner")).json()["limit_paise"] is None
    r = client.put(path, json={"limit_paise": 100}, headers=auth("a_owner", aal="aal1"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"
    assert client.put(path, json={"limit_paise": 100}, headers=auth("a_admin")).status_code == 403
    assert client.put(path, json={"limit_paise": -1}, headers=auth("a_owner")).status_code == 422
    assert client.put(path, json={}, headers=auth("a_owner")).status_code == 422


def test_the_credit_check_is_a_warning_everyone_who_quotes_may_ask_for() -> None:
    client, _ = make_client(dues=FakeDues())
    path = url(f"/dues/customers/{COMPANY}/credit-check")
    assert client.post(path, json={"amount_paise": 100000}, headers=auth("a_sales")).json()["exceeded"] is False
    out = client.post(path, json={"amount_paise": 100001}, headers=auth("a_sales")).json()
    assert out["exceeded"] is True and out["would_be_paise"] == 2500001 and out["has_limit"] is True
    assert client.post(path, json={"amount_paise": 1}, headers=auth("a_viewer")).status_code == 403


def test_a_file_of_5000_invoices_runs_in_ten_parts_with_derived_ids_and_the_files_own_row_numbers() -> None:
    fake = FakeDues()
    client, _ = make_client(dues=fake)
    batch = U(int=0x99)
    rows = [{"company_id": COMPANY, "invoice_no": f"T-{i}", "invoice_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 100} for i in range(5000)]
    r = client.post(url("/dues/invoices/import"), json={"batch_id": str(batch), "rows": rows}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    parts = [c for c in fake.calls if c[0] == "invoices_import"]
    assert len(parts) == 10 and {len(c[1][2]) for c in parts} == {500}
    assert len({c[1][1] for c in parts}) == 10 and parts[0][1][1] == uuid.uuid5(batch, "part-0")
    out = r.json()
    assert out["added"] == 10 * (500 - 500 // 7) and out["skipped"][0] == {"row": 7, "reason": "invoice_number_used"}
    assert any(s["row"] == 507 for s in out["skipped"]), "the second part's rows are numbered from 501"
    again = client.post(url("/dues/invoices/import"), json={"batch_id": str(batch), "rows": rows}, headers=auth("a_sales"))
    assert [c[1][1] for c in fake.calls if c[0] == "invoices_import"][10:] == [c[1][1] for c in parts], "a retry sends the same part ids"
    assert again.status_code == 200


def test_an_import_of_more_than_5000_rows_or_none_is_a_422() -> None:
    client, _ = make_client(dues=FakeDues())
    row = {"company_id": COMPANY, "invoice_no": "T-1", "invoice_date": "2026-09-01", "due_date": "2026-09-30", "amount_paise": 1}
    assert client.post(url("/dues/invoices/import"), json={"batch_id": str(U(int=1)), "rows": [row] * 5001}, headers=auth("a_owner")).status_code == 422
    assert client.post(url("/dues/invoices/import"), json={"batch_id": str(U(int=1)), "rows": []}, headers=auth("a_owner")).status_code == 422
    assert client.post(url("/dues/invoices/import"), json={"batch_id": str(U(int=1)), "rows": [{**row, "extra": 1}]}, headers=auth("a_owner")).status_code == 422


def test_the_ledger_and_the_summary_have_their_shapes() -> None:
    client, _ = make_client(dues=FakeDues())
    led = client.get(url(f"/dues/customers/{COMPANY}/ledger"), headers=auth("a_owner")).json()
    assert led["invoices"][0]["invoice_no"] == "INV-1" and led["payments"][0]["method"] == "cash"
    summ = client.get(url("/dues?limit=1"), headers=auth("a_owner")).json()
    assert summ["items"][0]["company_name"] == "Company a" and summ["next_cursor"]


# ============================================================================================================ material quotes
REQ = U(int=0xAA)
PICKS = [{"line_no": 1, "item_id": str(ITEM_ID)}]


def test_the_policy_is_read_by_quoters_and_set_by_the_owner_with_a_second_factor() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    got = client.get(url("/materials/policy"), headers=auth("a_sales")).json()
    assert got["current"]["version_no"] == 2 and got["current"]["policy"]["advance_bps"] == 5000 and got["current"]["policy"]["transport"]["truck_capacity"] == 2500
    assert client.get(url("/materials/policy"), headers=auth("a_viewer")).status_code == 403
    body = {"version_id": str(U(int=0x91)), "policy": WORKED["policy"]}
    r = client.post(url("/materials/policy"), json=body, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["version_no"] == 2 and r.json()["replayed"] is False
    sent = fake.calls[-1][1][3]
    assert sent["transport"]["kind"] == "per_trip" and "handling" not in sent and "laying" not in sent, "unset optional rules are left out, not sent as nulls"
    assert client.post(url("/materials/policy"), json=body, headers=auth("a_owner", aal="aal1")).json()["error"]["code"] == "mfa_required"
    assert client.post(url("/materials/policy"), json=body, headers=auth("a_admin")).status_code == 403
    bad = {"version_id": str(U(int=0x91)), "policy": {**WORKED["policy"], "advance_bps": 20000}}
    assert client.post(url("/materials/policy"), json=bad, headers=auth("a_owner")).status_code == 422


def test_an_item_is_saved_by_owner_and_admin_and_the_price_is_only_sent_when_present() -> None:
    from tests.catalogue_fakes import FakeCatalogue

    cat = FakeCatalogue()
    iid = ITEM_ID
    cat.items[str(iid)] = __import__("tests.cn_fakes", fromlist=["item_row"]).item_row(iid)
    fake = FakeMaterials()
    client, _ = make_client(materials=fake, catalogue=cat, catalogue_storage=FakeStorage())
    body = {"name": "Paver block 80 mm grey", "sell_unit": "sq_ft"}
    r = client.put(url(f"/materials/items/{iid}"), json=body, headers=auth("a_admin"))
    assert r.status_code == 200, r.text
    assert fake.calls[0][1][1]["p_change_price"] is False and fake.calls[0][1][1]["p_price_paise"] is None and fake.calls[0][1][1]["p_area_unit"] is None
    assert r.json()["item"]["inputs"]["gst_bps"] == 1800 and r.json()["item"]["price_text"] == "₹65.00"
    client.put(url(f"/materials/items/{iid}"), json={**body, "price_paise": 7000}, headers=auth("a_owner"))
    assert fake.calls[2][1][1]["p_change_price"] is True and fake.calls[2][1][1]["p_price_paise"] == 7000
    client.put(url(f"/materials/items/{iid}"), json={**body, "price_paise": None}, headers=auth("a_owner"))
    assert fake.calls[4][1][1]["p_change_price"] is True and fake.calls[4][1][1]["p_price_paise"] is None
    for who in ("a_sales", "a_viewer"):
        assert client.put(url(f"/materials/items/{iid}"), json=body, headers=auth(who)).status_code == 403
    for bad in ({"sell_unit": "furlong"}, {"price_paise": 50}, {"area_unit": "sq_mile"}, {"stock_status": "plenty"}, {"fabric": "silk"}):
        assert client.put(url(f"/materials/items/{iid}"), json={**body, **bad}, headers=auth("a_owner")).status_code == 422, bad


def test_a_material_is_not_a_saree_on_the_saree_screens() -> None:
    from tests.catalogue_fakes import FakeCatalogue
    from tests.cn_fakes import item_row

    cat = FakeCatalogue()
    cat.items[str(ITEM_ID)] = item_row(ITEM_ID)
    client, _ = make_client(materials=FakeMaterials(), catalogue=cat, catalogue_storage=FakeStorage())
    assert client.get(url(f"/catalogue/items/{ITEM_ID}"), headers=auth("a_owner")).status_code == 404
    assert client.get(url(f"/materials/items/{ITEM_ID}"), headers=auth("a_viewer")).status_code == 200
    cat.items[str(U(int=0x7))] = {**item_row(U(int=0x7)), "item_kind": "saree", "fabric": "soft_silk"}
    assert client.get(url(f"/materials/items/{U(int=0x7)}"), headers=auth("a_owner")).status_code == 404


def test_the_saree_catalogue_always_asks_for_sarees_and_the_materials_list_for_materials() -> None:
    from tests.catalogue_fakes import FakeCatalogue
    from tests.cn_fakes import item_row

    class Spy(FakeCatalogue):
        kinds: list[str] = []  # noqa: RUF012

        def search(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], kind: str = "saree") -> list[dict[str, Any]]:
            self.kinds.append(kind)
            return [item_row(ITEM_ID, rank=0)]

    spy = Spy()
    client, _ = make_client(materials=FakeMaterials(), catalogue=spy, catalogue_storage=FakeStorage())
    out = client.get(url("/materials/items"), headers=auth("a_viewer")).json()
    assert out["items"][0]["sell_unit"] == "sq_ft" and spy.kinds == ["material"]


def test_a_preview_runs_the_real_calculator_and_says_whether_the_database_agrees() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    r = client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["database_agrees"] is True and out["result"]["totals"]["total"] == 8879500 and out["result"]["lines"][0]["pieces"] == 4725
    assert out["as_of"] == "2026-10-14" and out["valid_until"] == "2026-10-21"
    assert fake.names() == ["quote_build"], "nothing is stored by a preview"
    fake.tamper_core = True
    assert client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS}, headers=auth("a_sales")).json()["database_agrees"] is False
    assert client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS}, headers=auth("a_viewer")).status_code == 403
    assert client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": []}, headers=auth("a_sales")).status_code == 422
    assert client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": [{"line_no": 6, "item_id": str(ITEM_ID)}]}, headers=auth("a_sales")).status_code == 422
    assert client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS, "total": 5}, headers=auth("a_sales")).status_code == 422


def test_a_draft_sends_the_database_the_calculators_own_request_result_and_hash() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    qid = U(int=0xB1)
    r = client.post(url(f"/materials/requirements/{REQ}/quotes"), json={"quote_id": str(qid), "picks": PICKS}, headers=auth("a_sales"))
    assert r.status_code == 201, r.text
    assert r.json()["replayed"] is False and r.json()["quote"]["total_paise"] == 8879500 and r.json()["quote"]["status"] == "draft"
    sent = fake.calls[1][1][1]
    assert sent["p_engine_version"] == "1.0.0" and sent["p_tenant_id"] == str(A) and sent["p_requirement_id"] == str(REQ)
    request = json.loads(sent["p_request_text"])
    assert sent["p_request_text"] == engine_port.canonical_json(request), "the request text is the calculator's canonical JSON"
    result = json.loads(sent["p_result_text"])
    assert result["canonical_hash"] == engine_port.expected_hash(request) and result["status"] == "draft"
    assert [c for c in fake.names()] == ["quote_build", "quote_draft", "quote_get"]


def test_a_draft_that_the_database_and_the_calculator_disagree_about_is_never_stored() -> None:
    fake = FakeMaterials()
    fake.tamper_core = True
    client, _ = make_client(materials=fake)
    r = client.post(url(f"/materials/requirements/{REQ}/quotes"), json={"quote_id": str(U(int=0xB2)), "picks": PICKS}, headers=auth("a_owner"))
    assert r.status_code == 500 and r.json()["error"]["code"] == "calculator_disagreement"
    assert "quote_draft" not in fake.names() and fake.quotes == {}


def test_a_request_the_calculator_rejects_is_a_422_with_its_code_and_nothing_is_stored() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    import tests.cn_fakes as cf

    original = cf.build_worked

    def with_laying(picks: list[dict[str, Any]], site_id: Any) -> dict[str, Any]:
        built = original(picks, site_id)
        built["request"]["laying"] = True
        return built

    cf.build_worked = with_laying
    try:
        r = client.post(url(f"/materials/requirements/{REQ}/quotes"), json={"quote_id": str(U(int=0xB3)), "picks": PICKS}, headers=auth("a_owner"))
    finally:
        cf.build_worked = original
    assert r.status_code == 422 and r.json()["error"]["code"] == "quote_not_computable" and r.json()["error"]["reason"] == "LAYING_RATE_MISSING"
    assert "quote_draft" not in fake.names()


@pytest.mark.parametrize(
    ("error", "status", "code", "reason"),
    [
        (mq.MaterialInputMissingError("SM762"), 422, "quote_input_missing", "other"),
        (mq.MaterialQuoteMismatchError("SM761"), 409, "quote_mismatch", None),
        (mq.MaterialQuoteStaleError("SM764"), 409, "quote_stale", None),
        (mq.MaterialQuoteNotDraftError("SM763"), 409, "quote_not_draft", None),
        (mq.MaterialOwnerApprovalError("SM765"), 403, "owner_approval_required", None),
        (mq.MaterialNotComputableError("SM766"), 422, "quote_not_computable", "other"),
        (RequirementNotConfirmedError("SM767"), 409, "requirement_not_confirmed", None),
        (ModuleOffError("SM701"), 403, "module_off", None),
    ],
)
def test_every_refusal_of_the_quote_functions_has_its_fixed_sentence(error: Exception, status: int, code: str, reason: str | None) -> None:
    fake = FakeMaterials()
    fake.error = error
    client, _ = make_client(materials=fake)
    r = client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS}, headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    assert r.json()["error"].get("reason") == reason
    assert "SM7" not in r.text and "paise" not in r.text, "nothing from the data layer reaches the caller"


@pytest.mark.parametrize("detail", ["pick", "measure", "product_type", "price", "gst_rate", "pieces_per_area", "unit", "hsn", "policy", "duplicate_item"])
def test_a_missing_input_names_what_is_missing_in_plain_words(detail: str) -> None:
    from app.main import MATERIAL_MISSING_TEXT

    fake = FakeMaterials()
    err = mq.MaterialInputMissingError("SM762")
    err.detail = detail
    fake.error = err
    client, _ = make_client(materials=fake)
    r = client.post(url(f"/materials/requirements/{REQ}/preview"), json={"picks": PICKS}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["reason"] == detail and r.json()["error"]["message"] == MATERIAL_MISSING_TEXT[detail]


def test_the_approval_recomputes_the_hash_with_the_calculator_and_a_quote_that_does_not_recompute_is_a_409() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    qid = U(int=0xB4)
    client.post(url(f"/materials/requirements/{REQ}/quotes"), json={"quote_id": str(qid), "picks": PICKS}, headers=auth("a_owner"))
    r = client.post(url(f"/materials/quotes/{qid}/approve"), headers=auth("a_admin"))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert fake.calls[-2][0] == "quote_approve" and fake.calls[-2][1][2] == engine_port.expected_hash(json.loads(fake.quotes[str(qid)]["request_text"]))
    assert client.post(url(f"/materials/quotes/{qid}/approve"), headers=auth("a_sales")).status_code == 403
    assert client.post(url(f"/materials/quotes/{qid}/approve"), headers=auth("a_admin", aal="aal1")).json()["error"]["code"] == "mfa_required"
    # a stored result that is not what the calculator computes from the stored request
    tampered = json.loads(fake.quotes[str(qid)]["result_text"])
    tampered["totals"]["total"] += 1
    fake.quotes[str(qid)]["result_text"] = json.dumps(tampered)
    fake.quotes[str(qid)]["status"] = "draft"
    before = len([c for c in fake.calls if c[0] == "quote_approve"])
    r = client.post(url(f"/materials/quotes/{qid}/approve"), headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "quote_mismatch"
    assert len([c for c in fake.calls if c[0] == "quote_approve"]) == before, "the database is not even asked"


def test_reject_get_list_and_the_customers_text() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    qid = U(int=0xB5)
    client.post(url(f"/materials/requirements/{REQ}/quotes"), json={"quote_id": str(qid), "picks": PICKS}, headers=auth("a_owner"))
    detail = client.get(url(f"/materials/quotes/{qid}"), headers=auth("a_sales")).json()
    assert detail["trace"] and detail["trace"][0]["rule_id"] == "quantity.area" and "result_text" not in detail and "request_text" not in detail
    assert client.get(url("/materials/quotes"), headers=auth("a_owner")).json()["items"][0]["id"] == str(qid)
    assert client.get(url(f"/materials/quotes/{qid}"), headers=auth("a_viewer")).status_code == 403
    en = client.get(url(f"/materials/quotes/{qid}/text"), headers=auth("a_owner")).json()
    assert en["language_review"] == "reviewed" and "Total: ₹88,795.00" in en["text"] and "4,725 pieces, 10 pallets" in en["text"] and "Transport (2 trips): ₹7,000.00" in en["text"]
    assert "Advance before dispatch: ₹44,397.50" in en["text"] and "Balance on delivery: ₹44,397.50" in en["text"] and "not an invoice" in en["text"]
    for lang in ("te", "hi", "kn", "ta"):
        t = client.get(url(f"/materials/quotes/{qid}/text?language={lang}"), headers=auth("a_owner")).json()
        assert t["language_review"] == "draft" and "₹88,795.00" in t["text"] and "4,725" in t["text"]
    assert client.get(url(f"/materials/quotes/{qid}/text?language=fr"), headers=auth("a_owner")).status_code == 422
    assert client.post(url(f"/materials/quotes/{qid}/reject"), json={"code": "wrong_prices"}, headers=auth("a_sales")).json()["status"] == "rejected"
    assert client.post(url(f"/materials/quotes/{qid}/reject"), json={"code": "madeup"}, headers=auth("a_owner")).status_code == 422
    assert client.get(url(f"/materials/quotes/{U(int=0xFF)}"), headers=auth("a_owner")).status_code == 404


def test_the_order_comes_from_an_approved_quote_with_a_credit_warning() -> None:
    fake = FakeMaterials()
    client, _ = make_client(materials=fake)
    qid, oid = U(int=0xB6), U(int=0xD1)
    r = client.post(url(f"/materials/quotes/{qid}/order"), json={"order_id": str(oid)}, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json()["order_id"] == str(oid) and r.json()["credit"]["exceeded"] is True and r.json()["credit"]["credit_limit_paise"] == 2500000
    assert client.post(url(f"/materials/quotes/{qid}/order"), json={"order_id": str(oid)}, headers=auth("a_sales")).status_code == 403
    assert client.post(url(f"/materials/quotes/{qid}/order"), json={"order_id": str(oid)}, headers=auth("a_owner", aal="aal1")).json()["error"]["code"] == "mfa_required"
    fake.error = order_errors.OrderExistsError("SM231")
    r = client.post(url(f"/materials/quotes/{qid}/order"), json={"order_id": str(oid)}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "order_exists"


def test_stored_quote_helper_is_what_the_calculator_computed() -> None:
    row = stored_quote(U(int=0xB7))
    assert row["total_paise"] == 8879500 and row["flags"] == [] and json.loads(row["request_text"]) == WORKED


# ============================================================================================================ deliveries
def plan_body(trip_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    return {"trip_id": str(trip_id), "planned_date": "2026-10-20", "vehicle_no": "TS09 AB 1234", "driver_name": "Ramesh", "driver_phone": "+91 98480 11111", "lines": [{"line_no": 1, "quantity": 2500}], **over}


ORDER = U(int=0x0D)


def test_trips_are_planned_listed_and_read_by_owner_admin_and_sales_but_not_a_viewer() -> None:
    fake = FakeDeliveries()
    client, _ = make_client(deliveries=fake)
    tid = U(int=0xE1)
    r = client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(tid), headers=auth("a_sales"))
    assert r.status_code == 201 and r.json()["id"] == str(tid) and r.json()["lines"][0]["quantity"] == 2500 and "replayed" not in r.json()
    sent = fake.calls[0][1][1]
    assert sent["p_order_id"] == str(ORDER) and sent["p_lines"] == [{"line_no": 1, "quantity": 2500}] and sent["p_site_id"] is None
    assert client.get(url(f"/orders/{ORDER}/trips"), headers=auth("a_owner")).json()["items"][0]["id"] == str(tid)
    assert client.get(url("/trips?date=2026-10-20&status=planned"), headers=auth("a_admin")).status_code == 200
    detail = client.get(url(f"/trips/{tid}"), headers=auth("a_sales")).json()
    assert detail["events"] == [{"seq": 1, "from_status": None, "to_status": "planned", "problem_code": None, "recorded_at": "2026-10-14T09:00:00Z"}]
    calls: list[Callable[[dict[str, str]], Any]] = [lambda h: client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(U(int=0xE2)), headers=h), lambda h: client.get(url(f"/trips/{tid}"), headers=h), lambda h: client.get(url("/trips"), headers=h)]
    for call in calls:
        assert call(auth("a_viewer")).status_code == 403
        assert call(auth("b_owner")).status_code == 404
        assert call({}).status_code == 401


def test_a_trip_body_is_closed_and_validated_before_the_database() -> None:
    client, _ = make_client(deliveries=FakeDeliveries())
    bad_bodies: list[dict[str, Any]] = [{"vehicle_no": "ab"}, {"driver_phone": "call me"}, {"lines": []}, {"lines": [{"line_no": 1, "quantity": 0}]}, {"lines": [{"line_no": 9, "quantity": 1}]}, {"planned_date": "soon"}, {"status": "delivered"}, {"challan_no": 5}]
    for bad in bad_bodies:
        r = client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(U(int=0xE3), **bad), headers=auth("a_owner"))
        assert r.status_code == 422, (bad, r.text)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (dl.TripStateError("SM771"), 409, "trip_state"),
        (dl.OrderNotDispatchedError("SM772"), 409, "order_not_dispatched"),
        (dl.QuantityExceedsOrderError("SM773"), 409, "quantity_exceeds_order"),
        (dl.OrderNotDeliverableError("SM774"), 409, "order_not_deliverable"),
        (dl.NoSiteContactError("SM775"), 422, "no_site_contact"),
        (dl.ProofIncompleteError("SM776"), 422, "proof_incomplete"),
        (ModuleOffError("SM701"), 403, "module_off"),
    ],
)
def test_every_refusal_of_the_trip_functions_has_its_fixed_sentence(error: Exception, status: int, code: str) -> None:
    fake = FakeDeliveries()
    fake.error = error
    client, _ = make_client(deliveries=fake)
    r = client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(U(int=0xE4)), headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert "SM77" not in r.text


def test_the_status_machine_is_the_databases_and_the_api_only_carries_the_call() -> None:
    fake = FakeDeliveries()
    client, _ = make_client(deliveries=fake)
    tid = U(int=0xE5)
    client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(tid), headers=auth("a_owner"))
    r = client.post(url(f"/trips/{tid}/status"), json={"status": "loaded"}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["status"] == "loaded"
    r = client.post(url(f"/trips/{tid}/status"), json={"status": "problem", "problem_code": "road_blocked"}, headers=auth("a_sales"))
    assert r.json()["status"] == "problem" and r.json()["problem_code"] == "road_blocked"
    assert client.post(url(f"/trips/{tid}/status"), json={"status": "delivered"}, headers=auth("a_owner")).status_code == 422, "delivered has its own call: it needs the proof"
    assert client.post(url(f"/trips/{tid}/status"), json={"status": "problem", "problem_code": "diesel"}, headers=auth("a_owner")).status_code == 422
    assert client.post(url(f"/trips/{tid}/status"), json={"status": "loaded"}, headers=auth("a_viewer")).status_code == 403
    r = client.patch(url(f"/trips/{tid}"), json={"planned_date": "2026-10-22", "vehicle_no": "TS09 CD 5678"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["planned_date"] == "2026-10-22"
    assert fake.calls[-1][1][1]["p_lines"] is None


def test_the_proof_is_a_photo_and_a_name_and_the_photo_is_cleaned_before_it_is_stored() -> None:
    fake = FakeDeliveries()
    storage = FakeStorage()
    client, _ = make_client(deliveries=fake, catalogue_storage=storage)
    tid, pid = U(int=0xE6), U(int=0xF1)
    client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(tid), headers=auth("a_owner"))
    r = client.post(url(f"/trips/{tid}/delivered?received_by=Site%20supervisor&photo_id={pid}"), content=jpeg(), headers={**auth("a_sales"), "content-type": "image/jpeg"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "delivered" and out["proof"]["received_by"] == "Site supervisor" and out["proof"]["expires_in_seconds"] == SIGNED_URL_SECONDS
    uploaded = [c for c in storage.calls if c[0] == "upload"]
    assert len(uploaded) == 1 and uploaded[0][2] == f"pod-{A}" and uploaded[0][3][0] == f"{tid}/{pid}.jpg" and uploaded[0][3][1] == "image/jpeg", "one cleaned jpeg in the business's private proof bucket"
    assert [c for c in storage.calls if c[0] == "sign"], "the photo is shown by a signed url"
    assert fake.calls[-1][1][1]["p_photo_id"] == str(pid) and fake.calls[-1][1][1]["p_received_by"] == "Site supervisor"
    assert max(fake.calls[-1][1][1]["p_width"], fake.calls[-1][1][1]["p_height"]) <= 1280


def test_a_proof_that_is_not_recorded_leaves_no_file_behind() -> None:
    fake = FakeDeliveries()
    fake.deliver_error = dl.TripStateError("SM771")
    storage = FakeStorage()
    client, _ = make_client(deliveries=fake, catalogue_storage=storage)
    tid = U(int=0xE7)
    client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(tid), headers=auth("a_owner"))
    r = client.post(url(f"/trips/{tid}/delivered?received_by=X"), content=jpeg(), headers={**auth("a_owner"), "content-type": "image/jpeg"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_state"
    assert [c[0] for c in storage.calls] == ["upload", "remove"] and storage.objects == {}


@pytest.mark.parametrize(
    ("content", "ctype", "status", "code"),
    [(b"not a photo", "image/jpeg", 422, "photo_unreadable"), (b"GIF89a", "image/gif", 415, "photo_type_unsupported"), (b"x" * (6 * 1024 * 1024), "image/jpeg", 413, "photo_too_large")],
)
def test_a_bad_photo_is_refused_in_plain_words(content: bytes, ctype: str, status: int, code: str) -> None:
    client, _ = make_client(deliveries=FakeDeliveries(), catalogue_storage=FakeStorage())
    tid = U(int=0xE8)
    r = client.post(url(f"/trips/{tid}/delivered?received_by=X"), content=content, headers={**auth("a_owner"), "content-type": ctype})
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_the_name_of_the_receiver_is_required_and_bounded() -> None:
    client, _ = make_client(deliveries=FakeDeliveries(), catalogue_storage=FakeStorage())
    tid = U(int=0xE9)
    headers = {**auth("a_owner"), "content-type": "image/jpeg"}
    assert client.post(url(f"/trips/{tid}/delivered"), content=jpeg(), headers=headers).status_code == 422
    assert client.post(url(f"/trips/{tid}/delivered?received_by="), content=jpeg(), headers=headers).status_code == 422
    assert client.post(url(f"/trips/{tid}/delivered?received_by={'x' * 81}"), content=jpeg(), headers=headers).status_code == 422


def test_the_challan_has_no_amounts_and_is_for_quoters_only() -> None:
    client, _ = make_client(deliveries=FakeDeliveries())
    tid = U(int=0xEA)
    out = client.get(url(f"/trips/{tid}/challan"), headers=auth("a_sales"))
    assert out.status_code == 200 and out.json()["lines"][0]["description"] == "Paver block 80 mm grey" and out.json()["site_contact"]["name"] == "Site supervisor"
    keys = json.dumps(out.json()).lower()
    assert not any(word in keys for word in ("paise", "amount", "price", "gst", "tax", "total"))
    assert client.get(url(f"/trips/{tid}/challan"), headers=auth("a_viewer")).status_code == 403


def test_a_trip_update_to_the_site_contact_uses_a_fixed_template_and_reports_what_the_outbox_did() -> None:
    fake = FakeDeliveries()
    client, _ = make_client(deliveries=fake)
    tid, mid = U(int=0xEB), U(int=0xF2)
    client.post(url(f"/orders/{ORDER}/trips"), json=plan_body(tid), headers=auth("a_owner"))
    r = client.post(url(f"/trips/{tid}/notify"), json={"message_id": str(mid), "kind": "left", "eta": "3 pm"}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    assert r.json() == {"message_id": str(mid), "status": "queued", "reason": "auto_allowed", "text": "Truck TS09 AB 1234 has left with your material and should reach the site around 3 pm.", "replayed": False}
    sent = fake.calls[-1][1][1]
    assert sent["p_body"] == r.json()["text"] and sent["p_language"] == "en" and sent["p_trip_id"] == str(tid)
    fake.notify_status = ("blocked", "no_opt_in")
    r = client.post(url(f"/trips/{tid}/notify"), json={"message_id": str(U(int=0xF3)), "kind": "delivered", "language": "hi"}, headers=auth("a_owner"))
    assert r.json()["status"] == "blocked" and r.json()["reason"] == "no_opt_in" and "माल" in r.json()["text"]
    for bad in ({"kind": "invoice"}, {"eta": "soon-ish"}, {"language": "fr"}, {"text": "pay Rs 5,000"}):
        r = client.post(url(f"/trips/{tid}/notify"), json={"message_id": str(U(int=0xF4)), "kind": "left", **bad}, headers=auth("a_owner"))
        assert r.status_code == 422, bad
    assert client.post(url(f"/trips/{tid}/notify"), json={"message_id": str(mid), "kind": "left"}, headers=auth("a_viewer")).status_code == 403


def test_no_template_of_the_automatic_kinds_carries_a_money_commitment_or_complaint_word() -> None:
    """The outbox decides in the database (app.outbox_content_flags; the integration test runs every template through it). This is the cheap structural half: no digit but the time, no currency sign."""
    from app.deliveries.messages import TEMPLATES, compose

    for kind in ("left", "left_no_eta", "soon", "delivered"):
        for lang, template in TEMPLATES[kind].items():
            text = compose(kind.replace("_no_eta", ""), lang, "TS09 AB 1234", "3 pm" if kind == "left" else None)
            assert "₹" not in text and "Rs" not in text and "/-" not in text, (kind, lang)
            assert "{" not in text and "}" not in text and "  " not in text, (kind, lang, text)
            assert template
    assert compose("left", "en", None, None) == "Truck has left with your material and is on its way to the site."


def test_a_missing_repository_is_a_503_not_a_crash() -> None:
    client, _ = make_client()
    tid = U(int=0xEC)
    assert client.get(url("/trips"), headers=auth("a_owner")).status_code == 503
    assert client.get(url("/dues"), headers=auth("a_owner")).status_code == 503
    assert client.get(url("/materials/policy"), headers=auth("a_owner")).status_code == 503
    assert client.get(url(f"/trips/{tid}"), headers=auth("a_owner")).json()["error"]["code"] == "deliveries_unavailable"
    assert TENANT_B.id != A
