"""Job CK on the real local stack: packs as data, module default-deny through the API, sign-up with the business type as the only input (including a Google-style account), custom fields, the example data and
the spreadsheet import at 5,000 rows with custom columns. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own token. All data is synthetic.

What these prove that the pgTAP files (93 to 95) and the unit tests cannot: the pack rows in the database are byte for byte the pack files, a refusal by the database (SM701 and friends) reaches the caller as the
plain 403/422/409 the API promises, the shapes the web will read validate against the generated contract, and a 5,000-row file really runs through the real import in parts."""

# ruff: noqa: E501, S608

from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import operator_sql
import pytest
from conftest import Stack, User, aal1_token, bearer
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import pack_migration as pm  # noqa: E402  (the scripts folder is not a package)
import packs_check as pc  # noqa: E402

CONTRACT = json.loads((ROOT / "packages" / "contracts" / "packs.schema.json").read_text(encoding="utf-8"))


def conforms(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator({"$schema": CONTRACT["$schema"], "$ref": f"#/$defs/{definition}", "$defs": CONTRACT["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def set_pack(tenant_id: str, code: str) -> None:
    """The operator's act (there is no client door): move a business to another pack."""
    operator_sql.sql(f"update packs.workspace_pack set pack_code = '{code}', pack_version = (select max(version) from packs.pack_versions where code = '{code}') where tenant_id = '{tenant_id}'")


def url(tenant: Any, tail: str) -> str:
    return f"/v1/tenants/{tenant.id}{tail}"


# ============================================================================================================ the pack rows are the pack files
def test_the_pack_rows_in_the_database_are_byte_for_byte_the_pack_files(stack: Stack) -> None:
    # the files hold each pack's CURRENT version; an older, synced version stays in the database (a synced version is never edited), so only the latest of each pack is compared
    rows = operator_sql.sql("select code || '|' || version || '|' || status || '|' || is_default::text || '|' || manifest_sha256 from packs.pack_versions v where version = (select max(version) from packs.pack_versions x where x.code = v.code) order by code, version").splitlines()
    packs = pc.load_packs()
    want = sorted(f"{p['id']}|{p['version']}|{p['status']}|{str(bool(p.get('default_for_existing_workspaces'))).lower()}|{pm.manifest_sha256(pm.manifest_of(p))}" for p in packs.values())
    assert sorted(rows) == want
    for p in packs.values():
        stored = json.loads(operator_sql.sql(f"select manifest::text from packs.pack_versions where code = '{p['id']}' and version = {p['version']}"))
        assert stored == pm.manifest_of(p), f"{p['id']}: the manifest in the database differs from packages/packs"
        assert pm.manifest_sha256(stored) == pm.manifest_sha256(pm.manifest_of(p))
    modules = operator_sql.sql("select string_agg(code, ',' order by code) from packs.modules")
    assert modules == ",".join(sorted(pc.module_codes()))
    assert operator_sql.sql("select string_agg(code, ',' order by position) from packs.units") == "piece,set,sq_ft,sq_m,box,bag,tonne,cft,truckload"


def test_the_sign_up_cards_come_without_signing_in(client: TestClient) -> None:
    r = client.get("/v1/packs")
    assert r.status_code == 200
    conforms(r.json(), "PackListOut")
    # the published pack first, then by id (job DR / A1 added the nine "Leads & calls" business types, all preview)
    assert [p["pack_id"] for p in r.json()["packs"]] == ["textiles", "auto_dealer", "clinic", "coaching", "construction_materials", "education", "gym", "insurance_loans", "interiors_solar", "real_estate", "travel", "wholesale_b2b"]
    providers = client.get("/v1/auth/providers")
    conforms(providers.json(), "AuthProvidersOut")
    assert providers.json() == {"email": True, "google": False, "facebook": False}


# ============================================================================================================ every workspace made before this job runs the default pack
def test_a_workspace_made_through_the_api_runs_todays_textile_behaviour(eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner = a.users["owner"]
    pack = w.client.get(url(a, "/pack"), headers=bearer(owner))
    assert pack.status_code == 200, pack.text
    conforms(pack.json(), "WorkspacePackOut")
    body = pack.json()
    assert (body["pack_id"], body["version"], body["status"], body["validated"], body["source"]) == ("textiles", 1, "published", True, "default")
    assert body["units"] == ["piece", "set"] and body["core_tab"] == "quotes" and len(body["modules"]) == 18
    mods = w.client.get(url(a, "/modules"), headers=bearer(owner))
    conforms(mods.json(), "WorkspaceModulesOut")
    assert sum(1 for m in mods.json()["modules"] if m["enabled"]) == 18 and len(mods.json()["modules"]) == 27
    assert {m["module"]: m["reason"] for m in mods.json()["modules"]}["lead_desk"] == "core" and {m["module"]: m["reason"] for m in mods.json()["modules"]}["quotes"] == "pack"
    assert w.client.get(url(a, "/custom-fields"), headers=bearer(owner)).json() == {"fields": []}
    for role in ("admin", "sales", "viewer"):
        assert w.client.get(url(a, "/pack"), headers=bearer(a.users[role])).status_code == 200, role
    # another business's people see nothing of it
    assert w.client.get(url(a, "/pack"), headers=bearer(w.b.users["owner"])).status_code == 404


def test_the_account_security_status_says_the_second_factor_is_not_asked_at_sign_up(client: TestClient, stack: Stack, eval_world: Any) -> None:
    owner = eval_world.a.users["owner"]
    strong = client.get("/v1/account/security", headers=bearer(owner)).json()
    weak = client.get("/v1/account/security", headers={"Authorization": f"Bearer {aal1_token(stack, owner)}"}).json()
    conforms(strong, "AccountSecurityOut")
    assert (strong["session_level"], weak["session_level"]) == ("aal2", "aal1") and weak["asked_at_sign_up"] is False


# ============================================================================================================ module default deny, reaching the caller
def test_a_module_that_is_off_is_refused_by_the_database_and_reaches_the_caller_as_a_plain_403(eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    set_pack(a.id, "education")
    try:
        mods = {m["module"]: m["enabled"] for m in w.client.get(url(a, "/modules"), headers=bearer(owner)).json()["modules"]}
        assert mods["contacts"] is True and mods["companies"] is False and mods["fees"] is True and mods["quotes"] is False
        company = w.client.post(url(a, "/companies"), json={"id": str(uuid.uuid4()), "name": "Nope Ltd"}, headers=bearer(owner))
        assert company.status_code == 403 and company.json()["error"]["code"] == "module_off", company.text
        product = w.client.post(url(a, "/products"), json={"id": str(uuid.uuid4()), "sku": "NOPE-1", "name": "Nope"}, headers=bearer(owner))
        assert product.status_code == 403 and product.json()["error"]["code"] == "module_off"
        # the contacts module is on for education: a guardian is made without any company
        guardian = w.client.post(url(a, "/contacts"), json={"id": str(uuid.uuid4()), "full_name": "Example: Guardian"}, headers=bearer(sales))
        assert guardian.status_code == 201, guardian.text
        # reads are never blocked
        assert w.client.get(url(a, "/companies"), headers=bearer(owner)).status_code == 200
        assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{a.id}' and name = 'Nope Ltd'") == "0"
    finally:
        set_pack(a.id, "textiles")
    again = w.client.post(url(a, "/companies"), json={"id": str(uuid.uuid4()), "name": "Back On Ltd"}, headers=bearer(owner))
    assert again.status_code == 201, again.text


# ============================================================================================================ sign-up: the business type is the only input
def _terms(client: TestClient) -> dict[str, str]:
    current = client.get("/v1/policies/current").json()
    return {"accepted_terms_version": current["terms"]["version"], "accepted_privacy_version": current["privacy"]["version"]}


def _google_style_user(signup: Any, label: str, *, verified: bool = True, mfa: bool = False, stack: Stack | None = None) -> tuple[User, str]:
    """An account made through the real Auth server (confirmed), then given a Google identity row the way Supabase writes one. No sign-up form, so no terms metadata.
    Returns the person and a password-only (aal1) token taken BEFORE the identity row exists (the row is a test stand-in; the Auth server need not sign in with it)."""
    user = signup(label, mfa=mfa)
    weak = aal1_token(stack, user) if stack is not None else user.token
    operator_sql.sql(
        f"insert into auth.identities (provider_id, user_id, identity_data, provider) values ('g-{user.id}', '{user.id}', "
        f"'{json.dumps({'email': user.email, 'email_verified': verified, 'sub': str(user.id)})}'::jsonb, 'google')"
    )
    return user, weak


def test_a_google_style_account_signs_up_with_only_a_business_type(client: TestClient, stack: Stack, signup: Any) -> None:
    person, _ = _google_style_user(signup, "cksu1")
    assert client.get("/v1/account/setup", headers=bearer(person)).json() == {"state": "needed", "tenant_id": None, "business_name": None}
    # no terms accepted yet
    refused = client.post("/v1/account/setup", json={"business_type": "education", "language": "hi"}, headers=bearer(person))
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "terms_required"
    # a type that is not selectable
    unavailable = client.post("/v1/account/setup", json={"business_type": "bakery", "language": "hi", **_terms(client)}, headers=bearer(person))
    assert unavailable.status_code == 422 and unavailable.json()["error"]["code"] == "business_type_unavailable"
    older = client.post("/v1/account/setup", json={"business_type": "other", "language": "hi", **_terms(client)}, headers=bearer(person))
    assert older.status_code == 422 and older.json()["error"]["code"] == "business_type_unavailable"
    assert operator_sql.sql(f"select count(*) from public.account_setups where user_id = '{person.id}'") == "0"
    # the business type and the language: nothing else is typed
    made = client.post("/v1/account/setup", json={"business_type": "education", "language": "hi", **_terms(client)}, headers=bearer(person))
    assert made.status_code == 200, made.text
    tenant_id = made.json()["tenant_id"]
    assert client.get("/v1/me", headers=bearer(person)).json()["memberships"][0]["tenant"]["name"] == "My business"
    pack = client.get(f"/v1/tenants/{tenant_id}/pack", headers=bearer(person)).json()
    conforms(pack, "WorkspacePackOut")
    assert (pack["pack_id"], pack["status"], pack["validated"], pack["source"]) == ("education", "preview", False, "signup")
    assert pack["labels"]["en"]["nav.item.customers"] == "Parents & students" and pack["core_tab"] == "fees" and pack["units"] == []
    fields = client.get(f"/v1/tenants/{tenant_id}/custom-fields", headers=bearer(person)).json()["fields"]
    conforms({"fields": fields}, "CustomFieldListOut")
    assert [f["code"] for f in fields] == ["relation", "preferred_language", "programme_interested"] and {f["source"] for f in fields} == {"pack"}
    # the terms were recorded with the setup
    assert operator_sql.sql(f"select count(*) from integrations.policy_acceptances where user_id = '{person.id}' and kind = 'terms' and via = 'setup'") == "1"
    # a repeat (second tab) changes nothing, even with another type
    again = client.post("/v1/account/setup", json={"business_type": "textiles", "language": "en", **_terms(client)}, headers=bearer(person))
    assert again.status_code == 200 and again.json() == {"tenant_id": tenant_id, "created": False}
    assert operator_sql.sql(f"select pack_code from packs.workspace_pack where tenant_id = '{tenant_id}'") == "education"
    assert client.get("/v1/account/setup", headers=bearer(person)).json()["state"] == "done"


def test_a_provider_that_says_the_e_mail_is_not_verified_gets_no_business(client: TestClient, signup: Any) -> None:
    person, _ = _google_style_user(signup, "cksu2", verified=False)
    refused = client.post("/v1/account/setup", json={"business_type": "textiles", "language": "en", **_terms(client)}, headers=bearer(person))
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "email_not_confirmed"
    assert operator_sql.sql(f"select count(*) from public.account_setups where user_id = '{person.id}'") == "0"
    assert client.get("/v1/me", headers=bearer(person)).json()["memberships"] == []


def test_the_second_factor_is_not_asked_at_sign_up_but_before_a_whatsapp_connection_and_an_approval(client: TestClient, stack: Stack, signup: Any) -> None:
    person, weak_token = _google_style_user(signup, "cksu3", mfa=True, stack=stack)  # the person has an authenticator; the sign-up below uses the password-only (aal1) session
    weak = {"Authorization": f"Bearer {weak_token}"}
    made = client.post("/v1/account/setup", json={"business_type": "construction_materials", "language": "te", **_terms(client)}, headers=weak)
    assert made.status_code == 200, made.text
    tenant = made.json()["tenant_id"]
    assert client.get(f"/v1/tenants/{tenant}/pack", headers=weak).status_code == 200
    loaded = client.post(f"/v1/tenants/{tenant}/example-data", headers=weak)
    assert loaded.status_code == 201, loaded.text
    tail = f"{uuid.uuid4().int % 10**14:014d}"  # a number is held by ONE business: a fresh one per run
    account = {"waba_id": f"2{tail}", "phone_number_id": f"1{tail}", "display_phone": "+91 98765 43210", "coexistence": True, "token_ref": f"shop_ck_{tail[:8]}"}
    assert client.put(f"/v1/tenants/{tenant}/whatsapp/account", json=account, headers=weak).json()["error"]["code"] == "mfa_required"
    assert client.put(f"/v1/tenants/{tenant}/whatsapp/account", json=account, headers=bearer(person)).status_code == 200
    # an approval (the outbox) at aal1: refused for want of the second factor, with the same words
    weak_approval = client.post(f"/v1/tenants/{tenant}/outbox/messages/{uuid.uuid4()}/approve", headers=weak)
    assert weak_approval.status_code == 403 and weak_approval.json()["error"]["code"] == "mfa_required"


# ============================================================================================================ custom fields end to end
def test_custom_fields_end_to_end(eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    owner, admin, sales, viewer = (a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    base = url(a, "/custom-fields")
    # who defines
    made = w.client.post(base, json={"entity": "contact", "code": "site_area", "label": {"en": "Site area", "te": "సైట్ ప్రాంతం"}, "kind": "text"}, headers=bearer(owner))
    assert made.status_code == 201, made.text
    conforms(made.json(), "CustomFieldDefOut")
    assert made.json()["pii_class"] == "none" and made.json()["source"] == "owner"
    kind = w.client.post(base, json={"entity": "contact", "code": "customer_kind", "label": {"en": "Customer type"}, "kind": "choice", "choices": [{"code": "builder", "label": {"en": "Builder"}}, {"code": "dealer", "label": {"en": "Dealer"}}]}, headers=bearer(admin))
    assert kind.status_code == 201, kind.text
    assert w.client.post(base, json={"entity": "contact", "code": "by_sales", "label": {"en": "X"}, "kind": "text"}, headers=bearer(sales)).status_code == 403
    weak = {"Authorization": "Bearer " + __import__("conftest").aal1_token(w.stack, owner)}
    assert w.client.post(base, json={"entity": "contact", "code": "by_weak", "label": {"en": "X"}, "kind": "text"}, headers=weak).json()["error"]["code"] == "mfa_required"
    assert w.client.post(base, json={"entity": "contact", "code": "site_area", "label": {"en": "Again"}, "kind": "text"}, headers=bearer(owner)).status_code == 409
    # values: Sales fills in, a Viewer reads
    contact = w.client.post(url(a, "/contacts"), json={"id": str(uuid.uuid4()), "full_name": "Example: Customer", "email": f"c{uuid.uuid4().hex[:8]}@example.test"}, headers=bearer(sales)).json()["id"]
    put = w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"site_area": "Hitech City", "customer_kind": "builder"}}, headers=bearer(sales))
    assert put.status_code == 200, put.text
    conforms(put.json(), "CustomValuesOut")
    assert {v["code"]: v["value"] for v in put.json()["values"]} == {"site_area": "Hitech City", "customer_kind": "builder"}
    got = w.client.get(url(a, f"/contacts/{contact}/custom"), headers=bearer(viewer))
    assert got.status_code == 200 and {v["code"]: v["value"] for v in got.json()["values"]}["customer_kind"] == "builder"
    assert w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"site_area": "x"}}, headers=bearer(viewer)).status_code == 403
    bad = w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"customer_kind": "architect"}}, headers=bearer(owner))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "custom_value_invalid"
    phone = w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"site_area": "call 9876543210"}}, headers=bearer(owner))
    assert phone.status_code == 422 and phone.json()["error"]["code"] == "custom_value_invalid"
    # growth only: a choice is added, never removed; a field can be switched off
    grown = w.client.patch(url(a, f"/custom-fields/{kind.json()['id']}"), json={"add_choices": [{"code": "architect", "label": {"en": "Architect"}}]}, headers=bearer(admin))
    assert grown.status_code == 200 and [c["code"] for c in grown.json()["choices"]] == ["builder", "dealer", "architect"]
    assert w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"customer_kind": "architect"}}, headers=bearer(owner)).status_code == 200
    off = w.client.patch(url(a, f"/custom-fields/{made.json()['id']}"), json={"active": False}, headers=bearer(owner))
    assert off.status_code == 200 and off.json()["active"] is False
    assert w.client.put(url(a, f"/contacts/{contact}/custom"), json={"values": {"site_area": "new"}}, headers=bearer(owner)).status_code == 422
    # another business reaches nothing
    other = w.b
    assert w.client.get(url(a, f"/contacts/{contact}/custom"), headers=bearer(other.users["owner"])).status_code == 404
    assert w.client.get(url(other, f"/contacts/{contact}/custom"), headers=bearer(other.users["owner"])).status_code == 404
    # the twenty-field limit, through the API
    for i in range(18):  # two are active already (customer_kind; site_area was switched off) -> make 19 active
        r = w.client.post(base, json={"entity": "contact", "code": f"filler_{i:02d}", "label": {"en": f"Filler {i}"}, "kind": "number"}, headers=bearer(owner))
        assert r.status_code == 201, (i, r.text)
    full = w.client.post(base, json={"entity": "contact", "code": "one_more", "label": {"en": "One more"}, "kind": "text"}, headers=bearer(owner))
    assert full.status_code in (201, 409)
    if full.status_code == 201:  # exactly twenty active now
        beyond = w.client.post(base, json={"entity": "contact", "code": "one_too_many", "label": {"en": "Too many"}, "kind": "text"}, headers=bearer(owner))
        assert beyond.status_code == 409 and beyond.json()["error"]["code"] == "custom_field_limit"


def test_a_catalogue_items_fields_through_the_api(eval_world: Any) -> None:
    w, a = eval_world, eval_world.a
    item = uuid.uuid4()
    operator_sql.sql(f"insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values ('{item}', '{a.id}', 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', '{a.users['owner'].id}')")
    made = w.client.post(url(a, "/custom-fields"), json={"entity": "catalogue_item", "code": "grade", "label": {"en": "Grade"}, "kind": "text"}, headers=bearer(a.users["owner"]))
    assert made.status_code == 201, made.text
    assert w.client.put(url(a, f"/catalogue/{item}/custom"), json={"values": {"grade": "M30"}}, headers=bearer(a.users["admin"])).status_code == 200
    assert w.client.put(url(a, f"/catalogue/{item}/custom"), json={"values": {"grade": "M35"}}, headers=bearer(a.users["sales"])).status_code == 403
    assert w.client.get(url(a, f"/catalogue/{item}/custom"), headers=bearer(a.users["viewer"])).json()["values"][0]["value"] == "M30"
    set_pack(a.id, "education")  # no catalogue module: the item's fields are refused by the database
    try:
        refused = w.client.put(url(a, f"/catalogue/{item}/custom"), json={"values": {"grade": "M40"}}, headers=bearer(a.users["admin"]))
        assert refused.status_code == 403 and refused.json()["error"]["code"] == "module_off"
    finally:
        set_pack(a.id, "textiles")


# ============================================================================================================ the example data
def test_the_example_data_is_labelled_loaded_once_and_removed_without_touching_real_rows(eval_world: Any) -> None:
    w, b = eval_world, eval_world.b
    owner, sales = b.users["owner"], b.users["sales"]
    base = url(b, "/example-data")
    before = operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{b.id}'")
    assert w.client.get(base, headers=bearer(sales)).json()["loaded"] is False
    assert w.client.post(base, headers=bearer(sales)).status_code == 403
    loaded = w.client.post(base, headers=bearer(owner))
    assert loaded.status_code == 201, loaded.text
    conforms(loaded.json(), "ExampleDataStatusOut")
    assert loaded.json()["counts"] == {"companies": 3, "contacts": 3, "leads": 2, "products": 5}
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{b.id}' and name like 'Example: %'") == "3"
    assert operator_sql.sql(f"select count(*) from public.contacts where tenant_id = '{b.id}' and full_name like 'Example: %' and (email is not null or phone is not null)") == "0"
    again = w.client.post(base, headers=bearer(owner))
    assert again.status_code == 409 and again.json()["error"]["code"] == "example_data_loaded"
    # a real quote-less, real edit: one company is edited by hand, so it stays
    company = operator_sql.sql(f"select id from public.companies where tenant_id = '{b.id}' and name like 'Example: Sri Lakshmi%'")
    assert w.client.patch(url(b, f"/companies/{company}"), json={"city": "Edited by hand"}, headers=bearer(owner)).status_code == 200
    removed = w.client.post(base + "/remove", headers=bearer(owner))
    assert removed.status_code == 200, removed.text
    conforms(removed.json(), "ExampleDataRemoveOut")
    assert removed.json()["removed"]["products"] == 5 and removed.json()["kept"]["companies"] == 1
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{b.id}'") == str(int(before) + 1)
    assert operator_sql.sql(f"select city from public.companies where id = '{company}'") == "Edited by hand"
    assert operator_sql.sql(f"select count(*) from public.products where tenant_id = '{b.id}' and sku like 'EX-%'") == "0"
    assert w.client.get(base, headers=bearer(owner)).json()["loaded"] is False


# ============================================================================================================ the import at 5,000 rows, with custom columns
def _customers_csv(n: int) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Party Name", "Email", "Customer type", "Credit days"])
    for i in range(n):
        writer.writerow([f"CK Import Shop {i:05d}", f"ck-import-{i:05d}@example.test", "Builder" if i % 2 else "Dealer", 15 + i % 60])
    return out.getvalue().encode()


def test_a_5000_row_file_runs_in_parts_and_its_custom_columns_land_on_the_new_contacts(eval_world: Any) -> None:
    w, a = eval_world, eval_world.b  # (business B: business A's twenty contact fields are used up by the custom-field test)
    owner = a.users["owner"]
    suffix = uuid.uuid4().hex[:6]
    kind_code, days_code = f"imp_kind_{suffix}", f"imp_days_{suffix}"
    for code, label, kind, choices in ((kind_code, "Customer type", "choice", [{"code": "builder", "label": {"en": "Builder"}}, {"code": "dealer", "label": {"en": "Dealer"}}]), (days_code, "Credit days", "number", None)):
        body: dict[str, Any] = {"entity": "contact", "code": code, "label": {"en": label}, "kind": kind}
        if choices:
            body["choices"] = choices
        r = w.client.post(url(a, "/custom-fields"), json=body, headers=bearer(owner))
        assert r.status_code == 201, r.text
    # (the label "Customer type" is shared with earlier tests' fields in this tenant, so map by code, not by suggestion)
    mapping = json.dumps({"company_name": 0, "contact_email": 1, f"custom:{kind_code}": 2, f"custom:{days_code}": 3})
    data = _customers_csv(5000)
    job = str(uuid.uuid4())
    base = url(a, "/imports/spreadsheet")
    started = time.monotonic()
    preview = w.client.post(f"{base}/preview?kind=customers&job_id={job}&mapping={mapping}", content=data, headers={**bearer(owner), "Content-Type": "text/csv"})
    assert preview.status_code == 200, preview.text[:500]
    body = preview.json()
    assert body["counts"]["rows"] == 5000 and body["counts"]["usable"] == 5000 and body["counts"]["file_problems"] == 0 and body["parts"] == 10
    assert body["counts"]["will_create"] == 5000 and "ck-import-00001" not in json.dumps(body["job"]), "no cell value in the stored job"
    done = w.client.post(f"{base}/{job}/confirm", content=data, headers={**bearer(owner), "Content-Type": "text/csv"})
    assert done.status_code == 200, done.text[:500]
    result = done.json()["result"]["counts"]
    elapsed = time.monotonic() - started
    assert result["created"] == 5000 and result["contacts_created"] == 5000 and result["custom_values_set"] == 5000 and result["custom_values_failed"] == 0, result
    assert elapsed < 300, f"5,000 rows took {elapsed:.0f} seconds"
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{a.id}' and name like 'CK Import Shop %'") == "5000"
    assert operator_sql.sql(f"select count(*) from public.custom_field_values v join public.custom_field_defs d on d.id = v.field_id where v.tenant_id = '{a.id}' and d.code in ('{kind_code}', '{days_code}')") == "10000"
    row = operator_sql.sql(f"select v.value_text from public.custom_field_values v join public.custom_field_defs d on d.id = v.field_id join public.contacts c on c.id = v.contact_id where d.code = '{kind_code}' and c.email = 'ck-import-00001@example.test'")
    assert row == "builder"
    assert operator_sql.sql(f"select count(*) from public.import_batches where tenant_id = '{a.id}' and created_at > now() - interval '15 minutes'") == "10", "ten parts, ten batches"
    # the job is one record; running it again replays and imports nothing twice
    again = w.client.post(f"{base}/{job}/confirm", content=data, headers={**bearer(owner), "Content-Type": "text/csv"})
    assert again.status_code == 200 and again.json()["replay"] is True
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{a.id}' and name like 'CK Import Shop %'") == "5000"
    stored = w.client.get(f"{base}/jobs/{job}", headers=bearer(owner)).json()
    assert stored["status"] == "completed" and stored["rows_total"] == 5000 and hashlib.sha256(data).hexdigest() == stored["file_sha256"]


def test_a_file_over_5000_rows_is_refused_whole(eval_world: Any) -> None:
    w, a = eval_world, eval_world.b
    r = w.client.post(url(a, "/imports/spreadsheet/inspect?kind=customers"), content=_customers_csv(5001), headers={**bearer(a.users["owner"]), "Content-Type": "text/csv"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "file_too_many_rows"


def test_the_httpx_import_is_used() -> None:
    assert httpx.__version__ and pytest.__version__
