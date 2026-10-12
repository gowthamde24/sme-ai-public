"""Job BO (ADR 0074): phone-first contacts. The stored form of an Indian mobile, the comparison form (the same rule as the database), the CRM routes, the lookup by number, the chat's customer search by
a number, the spreadsheet import of phone-only contacts and the stable Tally GUIDs. The database rules are pgTAP 84; the real stack is tests/integration/test_bo_phone_contacts.py."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant.tools import Ctx, FindCustomersArgs, State, find_customers
from app.crm.phone import canonical_phone
from app.integrations import importer
from app.integrations.accounting import build
from app.integrations.sheet import load_grid
from app.integrations.tally import voucher_guid, vouchers_xml
from app.suppression.keys import normalise_phone
from app.tenancy.repository import UpstreamError
from tests.fakes import TENANT_A, auth, make_client
from tests.integrations_fakes import FakeIntegrations
from tests.test_integrations_accounting import PAYLOAD

# ------------------------------------------------------------------------------------------------------------------------ the forms of a number
STORED = [
    ("98765 43210", "+919876543210"), ("098765-43210", "+919876543210"), ("+91 98765 43210", "+919876543210"), ("91-9876543210", "+919876543210"), ("919876543210", "+919876543210"),
    ("0091 98765 43210", "+919876543210"), ("  98765 43210  ", "+919876543210"), ("(98765) 43210", "+919876543210"), ("९८७६५ ४३२१०", "+919876543210"), ("౯౮౭౬౫౪౩౨౧౦", "+919876543210"),
    ("+00 90000 10001", "+00 90000 10001"), ("040-23456789", "040-23456789"), ("+44 7911 123456", "+44 7911 123456"), ("12345", "12345"), ("+91 12345 67890", "+91 12345 67890"), ("5876543210", "5876543210"),
]  # fmt: skip


@pytest.mark.parametrize(("raw", "stored"), STORED)
def test_the_stored_form_of_a_number(raw: str, stored: str) -> None:
    assert canonical_phone(raw) == stored


def test_a_stored_number_is_stable() -> None:
    for raw, _ in STORED:
        once = canonical_phone(raw)
        assert canonical_phone(once) == once, raw


@pytest.mark.parametrize(
    ("raw", "norm"),
    [("+91 98765 43210", "9876543210"), ("098765-43210", "9876543210"), ("९८७६५४३२१०", "9876543210"), ("௯௮௭௬௫௪௩௨௧௦", "9876543210"), ("+00 90000 10001", "9000010001"), ("+44 7911 123456", "447911123456"), ("12", None), ("abc", None)],
)  # fmt: skip
def test_the_comparison_form_reads_every_script_s_digits(raw: str, norm: str | None) -> None:
    assert normalise_phone(raw) == norm


def test_every_spelling_of_a_number_has_one_comparison_form() -> None:
    forms = {normalise_phone(canonical_phone(raw)) for raw, stored in STORED if stored == "+919876543210"}
    assert forms == {"9876543210"}


# ------------------------------------------------------------------------------------------------------------------------ the CRM
def test_a_contact_is_stored_with_its_number_in_the_canonical_form() -> None:
    from tests.fakes import FakeCrmRepository

    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    body = {"id": str(uuid.uuid4()), "full_name": "Ravi", "phone": "098765-43210"}
    r = client.post(f"/v1/tenants/{TENANT_A.id}/contacts", json=body, headers=auth("a_sales"))
    assert r.status_code in (200, 201), r.text
    assert r.json()["phone"] == "+919876543210" and r.json()["email"] is None, "a phone-only contact is a contact"
    patched = client.patch(f"/v1/tenants/{TENANT_A.id}/contacts/{body['id']}", json={"phone": "91 98765 43211"}, headers=auth("a_sales"))
    assert patched.status_code == 200 and patched.json()["phone"] == "+919876543211"


def test_the_synthetic_numbers_of_the_demo_are_left_as_typed() -> None:
    from tests.fakes import FakeCrmRepository

    client, _ = make_client(crm=FakeCrmRepository())
    r = client.post(f"/v1/tenants/{TENANT_A.id}/contacts", json={"id": str(uuid.uuid4()), "full_name": "Demo", "phone": "+00 90000 10001"}, headers=auth("a_sales"))
    assert r.json()["phone"] == "+00 90000 10001"


# ------------------------------------------------------------------------------------------------------------------------ the lookup route
class HolderLookup(FakeIntegrations):
    def contact_by_phone(self, token: str, tenant_id: uuid.UUID, phone: str) -> dict[str, Any]:
        self._note("contact_by_phone", token, phone)
        if normalise_phone(phone) == "9876543210":
            holder = {"contact_id": str(uuid.UUID(int=9)), "full_name": "Ravi", "company_id": str(uuid.UUID(int=8)), "company_name": "Ravi Silks", "lead_ids": []}
            return {**holder, "found": True, "holders": [holder]}
        return {"found": False, "holders": []}


def test_who_holds_this_number() -> None:
    db = HolderLookup()
    client, _ = make_client(integrations=db)
    url = f"/v1/tenants/{TENANT_A.id}/contacts/by-phone"
    ok = client.get(url, params={"phone": "+91 98765 43210"}, headers=auth("a_sales"))
    assert ok.status_code == 200 and ok.json()["company_name"] == "Ravi Silks"
    assert client.get(url, params={"phone": "98765 00000"}, headers=auth("a_owner")).json() == {"found": False, "holders": []}
    assert client.get(url, params={"phone": "98765 43210"}, headers=auth("a_viewer")).status_code == 403
    assert client.get(url, params={"phone": "98765 43210"}).status_code == 401
    assert client.get(url, params={"phone": "9"}, headers=auth("a_owner")).status_code == 422
    assert client.get(url, params={"phone": "98765 43210"}, headers=auth("outsider")).status_code == 404


# ------------------------------------------------------------------------------------------------------------------------ the chat
class FakeAssistantDb:
    def __init__(self) -> None:
        self.asked: list[tuple[str, dict[str, str]]] = []

    def rest_rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        self.asked.append((path, params))
        if path == "/companies" and "id" in params:
            return [{"id": str(uuid.UUID(int=8)), "name": "Ravi Silks", "city": "Hyderabad"}]
        if path == "/companies":
            return []
        return [{"id": str(uuid.UUID(int=5)), "company_id": str(uuid.UUID(int=8)), "status": "new"}]


def ctx_with(db: FakeAssistantDb, integrations: Any) -> Ctx:
    return Ctx(db=db, runtime=SimpleNamespace(integrations=integrations), token="caller-token", tenant=uuid.UUID(int=1), run_id=uuid.UUID(int=2), state=State())  # type: ignore[arg-type]


def test_the_chat_finds_a_customer_by_a_phone_number_and_never_hands_the_number_on() -> None:
    db = FakeAssistantDb()
    out = find_customers(ctx_with(db, HolderLookup()), FindCustomersArgs(query="098765 43210"))
    assert [i.type for i in out.items] == ["company", "lead"] and out.items[0].label == "Ravi Silks"
    assert not any("ilike" in str(p.get("name", "")) for _, p in db.asked), "found by the number, not by a name search"
    assert "9876543210" not in repr(out.items), "no number is in what the model is shown"


def test_a_name_still_searches_by_name_and_an_unknown_number_finds_nothing() -> None:
    db = FakeAssistantDb()
    find_customers(ctx_with(db, HolderLookup()), FindCustomersArgs(query="Ravi"))
    assert any("ilike" in str(p.get("name", "")) for _, p in db.asked)
    db2 = FakeAssistantDb()
    out = find_customers(ctx_with(db2, HolderLookup()), FindCustomersArgs(query="98765 00000"))
    assert out.items == ()


def test_a_data_layer_failure_in_the_number_lookup_falls_back_to_the_name_search() -> None:
    class Down(HolderLookup):
        def contact_by_phone(self, token: str, tenant_id: uuid.UUID, phone: str) -> dict[str, Any]:
            raise UpstreamError("down")

    db = FakeAssistantDb()
    assert find_customers(ctx_with(db, Down()), FindCustomersArgs(query="98765 43210")).items == ()


# ------------------------------------------------------------------------------------------------------------------------ the spreadsheet import
def test_phone_only_rows_become_contacts_named_after_the_shop() -> None:
    g = load_grid(b"Party,Mobile,Name\nRavi Silks,98765 43210,\nLakshmi,+91-98765-43211,Lakshmi\nBoss Only,,Owner Person\n")
    p = importer.prepare_customers(g, {"company_name": 0, "contact_phone": 1, "contact_name": 2})
    assert p.rows[0] == {"company_name": "Ravi Silks", "contact_phone": "+919876543210", "contact_name": "Ravi Silks", "source": "Spreadsheet import"} and p.notes[0] == "contact_named_after_company"
    assert p.rows[1]["contact_phone"] == "+919876543211" and p.rows[1]["contact_name"] == "Lakshmi" and p.notes[1] is None
    assert "contact_name" not in p.rows[2] and p.notes[2] == "contact_needs_phone_or_email", "a name with no way to reach the person keeps only the company"


# ------------------------------------------------------------------------------------------------------------------------ Tally
def test_voucher_guids_are_stable_unique_and_in_tallys_shape() -> None:
    a = voucher_guid("sale", "11111111-1111-4111-8111-111111111112")
    assert a == voucher_guid("sale", "11111111-1111-4111-8111-111111111112")
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}", a)
    assert len({a, voucher_guid("payment", "11111111-1111-4111-8111-111111111112"), voucher_guid("refund", "11111111-1111-4111-8111-111111111112"), voucher_guid("sale", "x")}) == 4


def test_importing_a_range_again_gives_the_same_vouchers() -> None:
    first = vouchers_xml(build(PAYLOAD))
    again = vouchers_xml(build(PAYLOAD))
    assert first == again
    guids = re.findall(r"<GUID>([^<]+)</GUID>", first)
    assert len(guids) == 5 and len(set(guids)) == 5 and re.findall(r"<REMOTEID>([^<]+)</REMOTEID>", first) == guids
    assert re.findall(r"<VOUCHERNUMBER>([^<]+)</VOUCHERNUMBER>", first) == ["SO-00012", "SO-00013", "SO-00014", "RC-00012-aaaaaaaa", "PY-00013-bbbbbbbb"]
