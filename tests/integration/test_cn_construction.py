"""Job CN on the real local stack: the building-materials core. Real GoTrue, PostgREST, Storage and Postgres; our API in-process with the caller's own token. All data is synthetic.

What these prove that the pgTAP files (96 to 99) and the unit tests cannot:
  * the SQL twin of the calculator (app.cq_compute) equals the Python reference on every golden vector and on random requests, and the API's engine port accepts what the database built;
  * a whole quote-to-delivery journey through the HTTP API: catalogue item with the owner's own figures, a requirement read and confirmed, a preview, a draft recomputed by the database, approval, an order, trips with
    a real photo in Storage, the delivery note, the site contact's update through the outbox, the dues ledger and the credit warning;
  * the module gate (a textile workspace is refused with a plain 403), the roles, and the shapes the web will read validate against the generated contract."""

# ruff: noqa: E501, S608

from __future__ import annotations

import importlib.util
import io
import json
import random
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import operator_sql
import pytest
from conftest import aal1_token, bearer
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "packages" / "contracts" / "materials.schema.json").read_text(encoding="utf-8"))
VECTORS = json.loads((ROOT / "packages" / "quote-engine" / "tests" / "fixtures" / "construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
CORE_KEYS = ("lines", "trips", "totals", "payment_terms", "valid_until")


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": CONTRACT["$schema"], "$ref": f"#/$defs/{definition}", "$defs": CONTRACT["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def url(tenant: Any, tail: str) -> str:
    return f"/v1/tenants/{tenant.id}{tail}"


def uid() -> str:
    return str(uuid.uuid4())


def literal(value: Any) -> str:
    return "$j$" + json.dumps(value, separators=(",", ":")) + "$j$::jsonb"


def twin(request: dict[str, Any]) -> dict[str, Any]:
    out = operator_sql.sql(f"select app.cq_compute({literal(request)})::text")
    parsed: dict[str, Any] = json.loads(out)
    return parsed


def load_random_request() -> Any:
    path = ROOT / "packages" / "quote-engine" / "tests" / "test_construction.py"
    spec = importlib.util.spec_from_file_location("cn_engine_tests", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.random_request


# ============================================================================================================ the SQL twin equals the reference
def test_the_sql_twin_gives_the_python_references_figures_on_every_golden_vector() -> None:
    drafts = [v for v in VECTORS if v["expected"].get("status") == "draft"]
    assert len(drafts) >= 20
    for v in drafts:
        got = twin(v["request"])
        core = got.get("core", got)
        for key in CORE_KEYS:
            assert core.get(key) == v["expected"].get(key), f"{v['name']}: {key} differs between the database and the reference"


def test_the_sql_twin_gives_the_python_references_figures_on_random_requests() -> None:
    from app.materials import engine_port

    engine_port.engine()  # puts packages/quote-engine/src on the path, through the one door
    random_request = load_random_request()
    rng = random.Random(20261014)  # noqa: S311 - a fixed seed for a repeatable test, not a secret
    checked = 0
    for _ in range(150):
        request = random_request(rng)
        want = engine_port.calculate(request)
        if want.get("status") != "draft":
            continue
        got = twin(request)
        core = got.get("core", got)
        for key in CORE_KEYS:
            assert core.get(key) == want.get(key), f"{key} differs for {json.dumps(request, sort_keys=True)}"
        checked += 1
    assert checked >= 60, "the generator should give mostly computable requests"


# ============================================================================================================ the journey
WORKED = next(v for v in VECTORS if v["name"].startswith("worked_example"))
POLICY = WORKED["request"]["policy"]


def make_materials_workspace(w: Any) -> None:
    """The operator's act (there is no client door): the business is a construction-materials one, with the pack's custom fields."""
    a = w.a
    operator_sql.sql(
        f"update packs.workspace_pack set pack_code = 'construction_materials', pack_version = (select max(version) from packs.pack_versions where code = 'construction_materials'), source = 'operator' where tenant_id = '{a.id}'"
    )
    operator_sql.sql(f"select app.apply_pack_fields('{a.id}', 'construction_materials', (select max(version) from packs.pack_versions where code = 'construction_materials'), '{a.users['owner'].id}')")


def photo_bytes(colour: str = "grey") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (640, 480), colour).save(out, "JPEG")
    return out.getvalue()


class Journey:
    """State carried between the steps of the one journey (module scope: the steps follow each other)."""

    item = uid()
    policy_version = uid()
    enquiry = uid()
    quote = uid()
    order = uid()
    trip = uid()
    trip2 = uid()
    site = uid()
    requirement = ""


@pytest.fixture(scope="module")
def mw(eval_world: Any) -> Any:
    make_materials_workspace(eval_world)
    return eval_world


def test_a_textile_workspace_is_refused_by_every_materials_write_and_reads_show_nothing(eval_world: Any) -> None:
    w, a, b = eval_world, eval_world.a, eval_world.b  # not yet switched: still the default textile pack
    owner = a.users["owner"]
    company = a.rows["companies"]["id"]
    writes = (
        ("PUT", f"/materials/items/{uid()}", {"name": "Paver", "sell_unit": "sq_ft", "area_unit": "sq_ft"}),
        ("POST", "/materials/policy", {"version_id": uid(), "policy": POLICY}),
        ("PUT", f"/sites/{uid()}", {"company_id": company, "name": "Site"}),
        ("PUT", f"/dues/invoices/{uid()}", {"company_id": company, "invoice_no": "INV-1", "invoice_date": "2026-10-01", "due_date": "2026-10-31", "amount_paise": 100000}),
        ("PUT", f"/dues/payments/{uid()}", {"company_id": company, "received_on": "2026-10-02", "amount_paise": 1000, "method": "cash"}),
        ("POST", f"/orders/{uid()}/trips", {"trip_id": uid(), "planned_date": "2026-10-20", "lines": [{"line_no": 1, "quantity": 10}]}),
    )
    for method, tail, body in writes:
        r = w.client.request(method, url(a, tail), json=body, headers=bearer(owner))
        assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", (tail, r.status_code, r.text)
    for tail in ("/materials/items", "/sites", "/trips", "/dues"):  # a read shows nothing: empty, or the same plain refusal
        r = w.client.get(url(a, tail), headers=bearer(owner))
        assert (r.status_code == 200 and not any(r.json().get(k) for k in ("items", "sites", "trips"))) or (r.status_code == 403 and r.json()["error"]["code"] == "module_off"), (tail, r.text)
    # the public calculator needs no sign-in and no workspace
    assert w.client.post("/v1/calculate/materials", json=WORKED["request"]).status_code == 200
    assert w.client.get(url(a, "/materials/items"), headers=bearer(b.users["owner"])).status_code in (403, 404)


def test_the_owner_sets_the_rules_and_the_items_figures_and_nothing_is_assumed(mw: Any) -> None:
    w, a = mw, mw.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    # the rules: the Owner, with a second factor
    body = {"version_id": Journey.policy_version, "policy": POLICY}
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.post(url(a, "/materials/policy"), json=body, headers=weak).json()["error"]["code"] == "mfa_required"
    assert w.client.post(url(a, "/materials/policy"), json=body, headers=bearer(admin)).status_code == 403
    saved = w.client.post(url(a, "/materials/policy"), json=body, headers=bearer(owner))
    assert saved.status_code == 200, saved.text
    conforms(saved.json(), "PolicySavedOut")
    assert w.client.post(url(a, "/materials/policy"), json=body, headers=bearer(owner)).json()["replayed"] is True
    got = w.client.get(url(a, "/materials/policy"), headers=bearer(sales))
    assert got.status_code == 200 and got.json()["current"]["policy"]["transport"]["truck_capacity"] == 2500
    conforms(got.json(), "PolicyOut")
    assert w.client.get(url(a, "/materials/policy"), headers=bearer(viewer)).status_code == 403
    # the item: the Owner or an Admin makes it; the price only the Owner (with a second factor)
    item = {"name": "Paver block 80 mm grey", "sell_unit": "sq_ft", "area_unit": "sq_ft", "stock_status": "in_stock", "active": False}
    path = url(a, f"/materials/items/{Journey.item}")
    assert w.client.put(path, json=item, headers=bearer(sales)).status_code == 403
    made = w.client.put(path, json=item, headers=bearer(admin))
    assert made.status_code == 200, made.text
    conforms(made.json(), "MaterialItemSavedOut")
    assert made.json()["created"] is True and made.json()["item"]["price_paise"] is None
    assert w.client.put(path, json={**item, "price_paise": 6500}, headers=bearer(admin)).status_code == 403
    priced = w.client.put(path, json={**item, "price_paise": 6500}, headers=bearer(owner))
    assert priced.status_code == 200, priced.text
    # nothing is assumed: the GST rate, pieces per area and so on are missing until the owner enters them
    inputs = priced.json()["item"]["inputs"]
    assert inputs["gst_bps"] is None and "gst_rate" in inputs["missing_for_area"] and "pieces_per_area" in inputs["missing_for_area"]
    refused = w.client.post(
        url(a, "/materials/requirements/" + uid() + "/preview"), json={"picks": [{"line_no": 1, "item_id": Journey.item}]}, headers=bearer(owner)
    )
    assert refused.status_code == 404
    values = {"product_type": "paver_block", "thickness_mm": "80", "size": "200 x 100 mm", "pieces_per_area": 4.5, "pieces_per_pallet": 500, "minimum_order": 100, "lead_days": 3, "hsn_code": "68101990", "gst_rate_percent": 18}
    put = w.client.put(url(a, f"/catalogue/{Journey.item}/custom"), json={"values": values}, headers=bearer(admin))
    assert put.status_code == 200, put.text
    full = w.client.get(path, headers=bearer(sales)).json()
    conforms(full, "MaterialItemOut")
    assert full["inputs"] == {"price_paise": 6500, "gst_bps": 1800, "hsn": "68101990", "pieces_per_area_x1000": 4500, "pieces_per_pallet": 500, "min_order_qty": 100, "lead_days": 3, "missing_for_area": [], "missing_for_quantity": []}
    assert w.client.get(path, headers=bearer(viewer)).status_code == 200  # an item is not secret from the team (a viewer sees no price in the catalogue of money: asserted by the roles matrix)
    listing = w.client.get(url(a, "/materials/items?include_inactive=true"), headers=bearer(admin)).json()
    conforms(listing, "MaterialItemListOut")
    assert [i["id"] for i in listing["items"]] == [Journey.item]
    assert w.client.get(url(a, "/materials/items?include_inactive=true"), headers=bearer(sales)).json()["items"] == []  # an inactive item is the owner's and the admin's to see


def capture_requirement(w: Any) -> str:
    """An enquiry captured on the lead, its fields entered by a person (the same readers as the agent's), and the requirement confirmed. Returns the requirement id."""
    a = w.a
    sales = a.users["sales"]
    lead = a.rows["leads"]["id"]
    text = "Need about 1,000 sq ft of 80 mm paver blocks for a driveway. Site is at Kukatpally Hyderabad. Laying also needed. 50% advance is fine."
    r = w.client.post(url(a, f"/leads/{lead}/enquiries"), json={"id": Journey.enquiry, "channel": "email", "received_at": "2026-10-13T10:00:00+00:00", "text": text}, headers=bearer(sales))
    assert r.status_code == 201, r.text
    base = url(a, f"/enquiries/{Journey.enquiry}/requirement-fields")
    entries = (
        (1, "product_type", "paver blocks"), (1, "area", "1,000 sq ft"), (1, "thickness", "80 mm"), (None, "application", "driveway"),
        (None, "site_location", "Kukatpally Hyderabad"), (None, "laying", "laying also needed"),
    )  # fmt: skip
    for line, field, value in entries:
        body: dict[str, Any] = {"field": field, "value": value}
        if line is not None:
            body["line"] = line
        added = w.client.post(base, json=body, headers=bearer(sales))
        assert added.status_code == 200, (field, added.text)
    view = w.client.get(url(a, f"/enquiries/{Journey.enquiry}/requirement"), headers=bearer(sales)).json()
    return str(view["requirement"]["id"])


def test_a_requirement_is_read_with_the_materials_rules_and_confirmed(mw: Any) -> None:
    w, a = mw, mw.a
    sales = a.users["sales"]
    Journey.requirement = capture_requirement(w)
    view = w.client.get(url(a, f"/enquiries/{Journey.enquiry}/requirement"), headers=bearer(sales)).json()
    shown = {(f["line_no"], f["field_key"]): f["display"] for f in view["fields"]}
    assert shown[(1, "area")] == "1,000 sq ft" and shown[(1, "thickness")] == "80 mm" and shown[(1, "product_type")] == "paver block"
    assert shown[(None, "laying")] == "Laying needed" and shown[(None, "site_location")] == "Kukatpally Hyderabad"
    assert {f["state"] for f in view["fields"]} <= {"confirmed", "corrected", "proposed"}
    # a value the readers refuse never reaches the database
    base = url(a, f"/enquiries/{Journey.enquiry}/requirement-fields")
    assert w.client.post(base, json={"field": "thickness", "line": 1, "value": "5 mm"}, headers=bearer(sales)).status_code == 422
    assert w.client.post(base, json={"field": "laying", "value": "maybe"}, headers=bearer(sales)).status_code == 422
    assert w.client.post(base, json={"field": "saree_type", "line": 1, "value": "banarasi"}, headers=bearer(sales)).status_code == 422
    # the people decide: confirm what is proposed, then the requirement
    for f in view["fields"]:
        if f["state"] == "proposed":
            assert w.client.post(url(a, f"/requirement-fields/{f['id']}/decision"), json={"decision": "confirm"}, headers=bearer(sales)).status_code == 200
    done = w.client.post(url(a, f"/requirements/{Journey.requirement}/confirm"), headers=bearer(sales))
    assert done.status_code == 200, done.text
    again = w.client.get(url(a, f"/enquiries/{Journey.enquiry}/requirement"), headers=bearer(sales)).json()
    assert again["confirmable"] is True and again["requirement"]["status"] == "confirmed"


def expected_for(laying: dict[str, int] | None) -> dict[str, Any]:
    """What the reference calculator says for the same business (the worked example), computed here without the database."""
    from app.materials import engine_port

    request = json.loads(json.dumps(WORKED["request"]))
    if laying is not None:
        request["policy"]["laying"] = laying
        request["laying"] = True
    return engine_port.calculate(request)


def test_a_quote_is_previewed_drafted_approved_and_becomes_an_order(mw: Any) -> None:
    w, a = mw, mw.a
    owner, admin, sales = (a.users[r] for r in ("owner", "admin", "sales"))
    picks = [{"line_no": 1, "item_id": Journey.item}]
    preview = url(a, f"/materials/requirements/{Journey.requirement}/preview")
    # the customer wants laying and the owner has set no laying rate: refused with the closed reason, nothing assumed
    refused = w.client.post(preview, json={"picks": picks}, headers=bearer(sales))
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "quote_not_computable" and refused.json()["error"]["reason"] == "LAYING_RATE_MISSING", refused.text
    # the owner adds the rule (a new version; the old one stays)
    with_laying = {**POLICY, "laying": {"rate_paise_per_area": 1200, "gst_bps": 1800}}
    v2 = uid()
    assert w.client.post(url(a, "/materials/policy"), json={"version_id": v2, "policy": with_laying}, headers=bearer(owner)).status_code == 200
    got = w.client.get(url(a, "/materials/policy"), headers=bearer(sales)).json()
    assert got["current"]["version_no"] == 2 and len(got["versions"]) == 2
    # the preview: the database built the request; the figures are the reference calculator's
    pv = w.client.post(preview, json={"picks": picks}, headers=bearer(sales))
    assert pv.status_code == 200, pv.text
    conforms(pv.json(), "QuotePreviewOut")
    want = expected_for({"rate_paise_per_area": 1200, "gst_bps": 1800})
    result = pv.json()["result"]
    assert result["totals"] == want["totals"] and result["trips"] == want["trips"] == 2 and result["lines"][0]["pieces"] == 4725
    assert result["totals"]["material"] == 6_825_000 and result["totals"]["transport"] == 700_000
    # the draft: the same figures, recomputed by the database and compared with the engine's; a viewer cannot draft
    draft_path = url(a, f"/materials/requirements/{Journey.requirement}/quotes")
    assert w.client.post(draft_path, json={"quote_id": Journey.quote, "picks": picks}, headers=bearer(a.users["viewer"])).status_code == 403
    drafted = w.client.post(draft_path, json={"quote_id": Journey.quote, "picks": picks}, headers=bearer(sales))
    assert drafted.status_code == 201, drafted.text
    conforms(drafted.json(), "QuoteDraftOut")
    replay = w.client.post(draft_path, json={"quote_id": Journey.quote, "picks": picks}, headers=bearer(sales))
    assert replay.status_code in (200, 201) and replay.json()["replayed"] is True and replay.json()["quote"]["id"] == Journey.quote
    assert drafted.json()["replayed"] is False and drafted.json()["quote"]["status"] == "draft"
    assert pv.json()["database_agrees"] is True
    detail = w.client.get(url(a, f"/materials/quotes/{Journey.quote}"), headers=bearer(sales)).json()
    conforms(detail, "MaterialQuoteDetailOut")
    assert detail["status"] == "draft" and detail["total_paise"] == want["totals"]["total"] and detail["canonical_hash"] and detail["trips"] == 2
    text = w.client.get(url(a, f"/materials/quotes/{Journey.quote}/text?language=en"), headers=bearer(sales)).json()
    conforms(text, "QuoteTextOut")
    assert "4,725" in text["text"] or "4725" in text["text"]
    # approval: the Owner or an Admin, with a second factor; a quote with a flag only the Owner
    approve = url(a, f"/materials/quotes/{Journey.quote}/approve")
    assert w.client.post(approve, headers=bearer(sales)).status_code == 403
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.post(approve, headers=weak).json()["error"]["code"] == "mfa_required"
    ok = w.client.post(approve, headers=bearer(owner))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved" and ok.json()["total_paise"] == want["totals"]["total"]
    assert w.client.post(approve, headers=bearer(owner)).status_code == 200  # a retry
    # an order from the approved quote: the order rules are the owner's (the same ones the saree flow reads)
    today = operator_sql.sql("select app.quote_today()").strip()
    rule = {"id": uid(), "effective_from": today, "advance_required": True, "dispatch_requires_advance": False, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": False}
    assert w.client.post(url(a, "/order-policy-versions"), json=rule, headers=bearer(owner)).status_code == 201
    order_path = url(a, f"/materials/quotes/{Journey.quote}/order")
    assert w.client.post(order_path, json={"order_id": Journey.order}, headers=bearer(sales)).status_code == 403
    made = w.client.post(order_path, json={"order_id": Journey.order}, headers=bearer(owner))
    assert made.status_code == 201, made.text
    again = w.client.post(order_path, json={"order_id": Journey.order}, headers=bearer(owner))
    assert again.status_code in (200, 201)
    order = w.client.get(url(a, f"/orders/{Journey.order}"), headers=bearer(owner)).json()
    assert order["material_quote_id"] == Journey.quote and order["quote_id"] is None
    assert operator_sql.sql(f"select count(*) from public.orders where id = '{Journey.order}'") == "1"


# ============================================================================================================ sites
def test_a_customer_has_sites_with_a_site_contact_and_no_phone_numbers_in_the_free_text(mw: Any) -> None:
    w, a = mw, mw.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    company, contact = a.rows["companies"]["id"], a.rows["contacts"]["id"]
    body = {"company_id": company, "name": "Kukatpally villa", "address_line": "Plot 4, Road 2", "city": "Hyderabad", "pin": "500072", "map_lat": 17.412345, "map_lng": 78.434567, "distance_km": 22, "lane_width_ft": 14, "unloading_help": True, "site_contact_id": contact}
    path = url(a, f"/sites/{Journey.site}")
    assert w.client.put(path, json=body, headers=bearer(viewer)).status_code == 403
    made = w.client.put(path, json=body, headers=bearer(sales))
    assert made.status_code == 200, made.text
    conforms(made.json(), "SiteSaveOut")
    assert made.json()["created"] is True and made.json()["site"]["distance_km"] == 22
    assert w.client.put(path, json={**body, "name": "Kukatpally villa (new gate)"}, headers=bearer(admin)).json()["created"] is False
    # free text carries no phone number or address of a person; a map pin is both numbers or neither; the pin code is six digits
    for bad in ({"access_notes": "call Ramesh on 9848011111 at the gate"}, {"map_lng": None}, {"pin": "50007"}, {"company_id": uid()}, {"site_contact_id": uid()}):
        r = w.client.put(url(a, f"/sites/{uid()}"), json={**body, **bad}, headers=bearer(owner))
        assert r.status_code in (404, 409, 422), (bad, r.status_code, r.text)
    listed = w.client.get(url(a, f"/sites?company_id={company}"), headers=bearer(viewer))
    assert listed.status_code == 200
    conforms(listed.json(), "SiteListOut")
    assert [s["id"] for s in listed.json()["items"]] == [Journey.site]
    assert w.client.get(url(a, f"/sites/{Journey.site}"), headers=bearer(w.b.users["owner"])).status_code == 404  # another business sees nothing


# ============================================================================================================ dues
def test_the_dues_ledger_ages_the_oldest_invoice_first_and_warns_before_a_new_order(mw: Any) -> None:
    w, a = mw, mw.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    company = a.rows["companies"]["id"]
    inv1, inv2, pay1 = uid(), uid(), uid()
    one = {"company_id": company, "invoice_no": "CN-INV-1", "invoice_date": "2026-08-01", "due_date": "2026-08-31", "amount_paise": 5_000_000}
    two = {"company_id": company, "invoice_no": "CN-INV-2", "invoice_date": "2026-10-05", "due_date": "2026-11-04", "amount_paise": 3_000_000}
    assert w.client.put(url(a, f"/dues/invoices/{inv1}"), json=one, headers=bearer(viewer)).status_code == 403  # a viewer reads no money and records none
    assert w.client.put(url(a, f"/dues/invoices/{inv1}"), json=one, headers=bearer(sales)).json() == {"id": inv1, "replayed": False, "receipt_no": None}
    assert w.client.put(url(a, f"/dues/invoices/{inv1}"), json=one, headers=bearer(sales)).json()["replayed"] is True
    assert w.client.put(url(a, f"/dues/invoices/{uid()}"), json=one, headers=bearer(sales)).status_code == 409  # the invoice number is used
    assert w.client.put(url(a, f"/dues/invoices/{inv2}"), json=two, headers=bearer(admin)).status_code == 200
    pay = {"company_id": company, "received_on": "2026-10-10", "amount_paise": 2_000_000, "method": "upi"}
    assert w.client.put(url(a, f"/dues/payments/{pay1}"), json=pay, headers=bearer(sales)).status_code == 200
    assert w.client.put(url(a, f"/dues/payments/{uid()}"), json={**pay, "received_on": "2030-01-01"}, headers=bearer(sales)).status_code in (409, 422)
    # the statement: payments go to the oldest invoice first
    st = w.client.get(url(a, f"/dues/customers/{company}?as_of=2026-10-14"), headers=bearer(sales))
    assert st.status_code == 200, st.text
    conforms(st.json(), "StatementOut")
    s = st.json()
    assert (s["invoiced_paise"], s["paid_paise"], s["outstanding_paise"], s["credit_paise"]) == (8_000_000, 2_000_000, 6_000_000, 0)
    assert s["ageing"] == {"d0_30": 3_000_000, "d31_60": 0, "d61_90": 3_000_000, "d90_plus": 0}
    assert [(i["invoice_no"], i["open_paise"]) for i in s["open_invoices"]] == [("CN-INV-1", 3_000_000), ("CN-INV-2", 3_000_000)]
    assert s["overdue_paise"] == 3_000_000  # INV-1 was due 31 August
    assert w.client.get(url(a, f"/dues/customers/{company}"), headers=bearer(viewer)).status_code == 403
    ledger = w.client.get(url(a, f"/dues/customers/{company}/ledger"), headers=bearer(admin)).json()
    conforms(ledger, "LedgerOut")
    assert len(ledger["invoices"]) == 2 and len(ledger["payments"]) == 1
    # the credit limit: the Owner, with a second factor; a warning, never a block
    limit = url(a, f"/dues/customers/{company}/credit-limit")
    weak = {"Authorization": f"Bearer {aal1_token(w.stack, owner)}"}
    assert w.client.put(limit, json={"limit_paise": 7_000_000}, headers=weak).json()["error"]["code"] == "mfa_required"
    assert w.client.put(limit, json={"limit_paise": 7_000_000}, headers=bearer(admin)).status_code == 403
    assert w.client.put(limit, json={"limit_paise": 7_000_000}, headers=bearer(owner)).json()["limit_paise"] == 7_000_000
    warn = w.client.post(url(a, f"/dues/customers/{company}/credit-check"), json={"amount_paise": 2_000_000}, headers=bearer(sales))
    conforms(warn.json(), "CreditCheckOut")
    assert (warn.json()["would_be_paise"], warn.json()["exceeded"], warn.json()["has_limit"]) == (8_000_000, True, True)
    ok = w.client.post(url(a, f"/dues/customers/{company}/credit-check"), json={"amount_paise": 500_000}, headers=bearer(sales)).json()
    assert ok["exceeded"] is False
    # the summary lists the customers by what they owe
    summary = w.client.get(url(a, "/dues?as_of=2026-10-14"), headers=bearer(admin)).json()
    conforms(summary, "SummaryOut")
    assert summary["items"][0]["company_id"] == company and summary["items"][0]["over_limit"] is False
    # voiding: the Owner or an Admin; the number can then be used again, and the balance follows
    assert w.client.post(url(a, f"/dues/payments/{pay1}/void"), headers=bearer(sales)).status_code == 403
    assert w.client.post(url(a, f"/dues/payments/{pay1}/void"), headers=bearer(admin)).json() == {"id": pay1, "voided": True}
    assert w.client.get(url(a, f"/dues/customers/{company}?as_of=2026-10-14"), headers=bearer(sales)).json()["outstanding_paise"] == 8_000_000
    # a file from the accounting system: skipped rows are named by their row number and reason
    rows = [{**one, "invoice_no": "CN-INV-1"}, {**one, "invoice_no": "CN-IMP-2", "amount_paise": 100_000}, {**one, "company_id": uid(), "invoice_no": "CN-IMP-3"}]
    batch = uid()
    imported = w.client.post(url(a, "/dues/invoices/import"), json={"batch_id": batch, "rows": rows}, headers=bearer(admin))
    assert imported.status_code == 200, imported.text
    conforms(imported.json(), "InvoicesImportOut")
    assert imported.json()["added"] == 1 and {(s["row"], s["reason"]) for s in imported.json()["skipped"]} == {(1, "invoice_number_used"), (3, "customer_not_found")}
    assert w.client.post(url(a, "/dues/invoices/import"), json={"batch_id": batch, "rows": rows}, headers=bearer(admin)).json()["added"] == 0  # the same file again adds nothing
    assert w.client.get(url(a, f"/dues/customers/{company}"), headers=bearer(w.b.users["owner"])).status_code == 404


# ============================================================================================================ deliveries
def order_event(w: Any, order_id: str, type_: str, user: str = "owner", amount: int | None = None) -> Any:
    body: dict[str, Any] = {"id": uid(), "type": type_}
    if amount is not None:
        body.update(amount_paise=amount, ledger_id=uid())
    r = w.client.post(url(w.a, f"/orders/{order_id}/events"), json=body, headers=bearer(w.a.users[user]))
    assert r.status_code in (200, 201), (type_, r.status_code, r.text)
    return r.json()


def test_trips_carry_the_order_to_the_site_with_a_proof_a_delivery_note_and_a_message_with_no_amounts(mw: Any) -> None:
    w, a = mw, mw.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    plan = url(a, f"/orders/{Journey.order}/trips")
    # a trip is planned only for an order the customer accepted
    early = w.client.post(plan, json={"trip_id": uid(), "planned_date": "2026-10-20", "lines": [{"line_no": 1, "quantity": 10}]}, headers=bearer(sales))
    assert early.status_code == 409 and early.json()["error"]["code"] == "order_not_deliverable", early.text
    for event in ("send_quote", "customer_accept"):
        order_event(w, Journey.order, event)

    def body(trip_id: str, quantity: int, **over: Any) -> dict[str, Any]:
        return {"trip_id": trip_id, "planned_date": "2026-10-20", "vehicle_no": "TS09 AB 1234", "driver_name": "Ramesh", "driver_phone": "+91 98480 11111", "site_id": Journey.site, "site_contact_id": a.rows["contacts"]["id"], "lines": [{"line_no": 1, "quantity": quantity}], **over}

    assert w.client.post(plan, json=body(Journey.trip, 2500), headers=bearer(viewer)).status_code == 403
    first = w.client.post(plan, json=body(Journey.trip, 2500), headers=bearer(sales))
    assert first.status_code == 201, first.text
    conforms(first.json(), "TripOut")
    assert first.json()["status"] == "planned" and first.json()["challan_no"]
    # a trip is planned once: the same id again changes nothing
    again = w.client.post(plan, json=body(Journey.trip, 2500), headers=bearer(sales))
    assert again.status_code in (200, 201)
    assert w.client.post(plan, json=body(Journey.trip2, 2225), headers=bearer(admin)).status_code == 201
    # the trips never carry more than the order holds (4,725 pieces)
    over = w.client.post(plan, json=body(uid(), 1), headers=bearer(owner))
    assert over.status_code in (409, 422), over.text
    listed = w.client.get(url(a, f"/orders/{Journey.order}/trips"), headers=bearer(sales)).json()
    conforms(listed, "TripListOut")
    assert sorted(t["lines"][0]["quantity"] for t in listed["items"]) == [2225, 2500]
    # the truck can be loaded, but cannot leave while the order is not dispatched (the order's own advance rule decides when it is); the order moves by its own lifecycle (the pinned engine)
    status = url(a, f"/trips/{Journey.trip}/status")
    assert w.client.post(status, json={"status": "on_the_way"}, headers=bearer(sales)).status_code == 409  # not loaded yet
    assert w.client.post(status, json={"status": "loaded"}, headers=bearer(sales)).json()["status"] == "loaded"
    early_leave = w.client.post(status, json={"status": "on_the_way"}, headers=bearer(sales))
    assert early_leave.status_code == 409 and "dispatch" in early_leave.json()["error"]["code"], early_leave.text
    advance = w.client.get(url(a, f"/materials/quotes/{Journey.quote}"), headers=bearer(owner)).json()["advance_paise"]
    order_event(w, Journey.order, "request_advance")
    order_event(w, Journey.order, "record_payment", amount=advance)
    for event in ("start_preparation", "dispatch"):
        order_event(w, Journey.order, event)
    assert w.client.post(status, json={"status": "on_the_way"}, headers=bearer(sales)).json()["status"] == "on_the_way"
    # delivered needs the proof: a photo and the name of who received the goods
    delivered = url(a, f"/trips/{Journey.trip}/delivered")
    nameless = w.client.post(delivered, content=photo_bytes(), headers={**bearer(sales), "Content-Type": "image/jpeg"})
    assert nameless.status_code == 422
    notphoto = w.client.post(delivered + "?received_by=Suresh", content=b"not a picture", headers={**bearer(sales), "Content-Type": "image/jpeg"})
    assert notphoto.status_code in (415, 422), notphoto.text
    assert w.client.post(delivered + "?received_by=Suresh", content=photo_bytes(), headers={**bearer(viewer), "Content-Type": "image/jpeg"}).status_code == 403
    proof_id = uid()
    done = w.client.post(delivered + f"?received_by=Suresh&photo_id={proof_id}", content=photo_bytes(), headers={**bearer(sales), "Content-Type": "image/jpeg"})
    assert done.status_code == 200, done.text
    conforms(done.json(), "TripOut")
    assert done.json()["status"] == "delivered" and done.json()["proof"]["received_by"] == "Suresh"
    assert operator_sql.sql(f"select count(*) from storage.objects where bucket_id = 'pod-{a.id}'") == "1"
    # a problem on the other trip: a closed reason; then rescheduled
    status2 = url(a, f"/trips/{Journey.trip2}/status")
    assert w.client.post(status2, json={"status": "problem"}, headers=bearer(sales)).status_code == 422  # a reason is needed
    assert w.client.post(status2, json={"status": "loaded"}, headers=bearer(sales)).status_code == 200
    assert w.client.post(status2, json={"status": "problem", "problem_code": "site_closed"}, headers=bearer(sales)).json()["status"] == "problem"
    assert w.client.post(status2, json={"status": "planned"}, headers=bearer(sales)).json()["status"] == "planned"
    # the history is kept
    detail = w.client.get(url(a, f"/trips/{Journey.trip}"), headers=bearer(sales)).json()
    conforms(detail, "TripDetailOut")
    assert [e["to_status"] for e in detail["events"]] == ["planned", "loaded", "on_the_way", "delivered"]
    # the delivery note has no amounts and no tax
    challan = w.client.get(url(a, f"/trips/{Journey.trip}/challan"), headers=bearer(sales))
    assert challan.status_code == 200, challan.text
    conforms(challan.json(), "ChallanOut")
    flat = json.dumps(challan.json()).lower()
    for word in ("paise", "price", "amount", "gst", "total", "advance", "balance", "tax"):
        assert word not in flat, f"the delivery note mentions {word}"
    assert challan.json()["lines"][0]["quantity"] == 2500
    assert w.client.get(url(a, f"/trips/{Journey.trip}/challan"), headers=bearer(w.b.users["owner"])).status_code == 404


def test_every_fixed_trip_message_passes_the_outbox_content_rules_and_only_a_delay_may_be_held_for_a_person() -> None:
    from app.deliveries import messages

    for language in ("en", "te", "hi", "kn", "ta"):
        for kind in ("left", "soon", "delivered", "delay"):
            text = messages.compose(kind, language, "TS09 AB 1234", "2026-10-20 14:00" if kind in ("soon", "delay") else None)
            flags = operator_sql.sql(f"select app.outbox_content_flags($m${text}$m$)::text")
            if kind == "delay":  # a delay reads as bad news to the outbox's rules: it is held for a person, never sent by itself
                assert flags in ("{}", "", "{complaint}"), (language, kind, flags, text)
            else:
                assert flags in ("{}", ""), (language, kind, flags, text)


def test_the_site_contact_hears_about_a_trip_through_the_outbox_and_only_through_it(mw: Any) -> None:
    w, a = mw, mw.a
    sales, viewer = a.users["sales"], a.users["viewer"]
    notify = url(a, f"/trips/{Journey.trip}/notify")
    sent = {"message_id": uid(), "kind": "delivered", "language": "en"}
    assert w.client.post(notify, json=sent, headers=bearer(viewer)).status_code == 403
    r = w.client.post(notify, json=sent, headers=bearer(sales))
    assert r.status_code == 200, r.text
    conforms(r.json(), "NotifyOut")
    assert r.json()["status"] in ("queued", "needs_approval", "blocked")  # the outbox decides (consent, suppression key, quiet hours); nothing here sends by itself
    assert r.json()["status"] != "sent"
    row = operator_sql.sql(f"select status || '|' || source || '|' || category from public.outbox_messages where id = '{sent['message_id']}'")
    assert row.split("|")[1:] == ["system", "order_status"], row
    assert w.client.post(notify, json=sent, headers=bearer(sales)).json()["replayed"] is True  # a retry sends nothing twice
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where id = '{sent['message_id']}'") == "1"
    text = r.json()["text"].lower()
    assert not any(ch.isdigit() for ch in text.replace("ts09 ab 1234", "")) or "rs" not in text and "₹" not in text
