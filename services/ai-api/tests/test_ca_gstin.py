"""Job CA (ADR 0081): GSTIN. The validator (format, state code, check character), the customer's GSTIN in the CRM models, the shop's own GSTIN (business profile routes), the two GSTINs an order shows,
and the accounting files. The same rule in the database is proved equal to this one by tests/integration/test_ca_gstin.py (a thousand numbers) and pgTAP 91. No network, no database."""

from __future__ import annotations

import random
import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app import gstin
from app.crm.models import CompanyCreate, CompanyUpdate
from app.integrations import accounting, plain, tally, vyapar
from app.tenancy.repository import MfaRequired, UpstreamError
from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client
from tests.orders_fakes import LEAD, ORDER, FakeOrders

PUBLISHED = ("27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "24AAACC1206D1ZM")
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


# ---------------------------------------------------------------------------------------------- the validator
@pytest.mark.parametrize("number", PUBLISHED)
def test_published_examples_are_valid(number: str) -> None:
    assert gstin.is_valid(number) and gstin.check_character(number[:14]) == number[14]


@pytest.mark.parametrize(
    "bad",
    [
        "27AAPFU0939F1ZW", "27AAPFU0939F1Z0", "27AAPFU0939G1ZV", "28AAPFU0939F1ZV", "00AAPFU0939F1ZV", "39AAPFU0939F1ZV", "27aapfu0939f1zv", " 27AAPFU0939F1ZV", "27AAPFU0939F1ZV1",
        "27AAPFU0939F1Z", "27AAPFU0939F1AV", "27AAPFU09391FZV", "27AAPFU0939F0ZV", "", "ABCDEFGHIJKLMNO", "123456789012345",
    ],
)
def test_malformed_numbers_are_refused(bad: str) -> None:
    assert not gstin.is_valid(bad)


def test_not_text_is_not_valid() -> None:
    for value in (None, 27, b"27AAPFU0939F1ZV", ["27AAPFU0939F1ZV"]):
        assert not gstin.is_valid(value) and gstin.parse(value) is None and gstin.normalise(value) is None


def test_a_person_may_type_it_loosely() -> None:
    assert gstin.parse(" 27aapfu0939f1zv ") == "27AAPFU0939F1ZV"
    assert gstin.parse("27 AAPFU 0939 F1ZV") == "27AAPFU0939F1ZV"
    assert gstin.parse("27-AAPFU0939F-1ZV") == "27AAPFU0939F1ZV"
    assert gstin.parse("27AAPFU0939F1ZW") is None and gstin.parse("   ") is None


def test_every_wrong_check_character_is_refused_and_exactly_one_is_right() -> None:
    rng = random.Random(7)  # noqa: S311 - a fixed seed, for a repeatable test
    for _ in range(300):
        state = rng.choice(sorted(gstin.STATE_NAMES))
        pan = "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(5)) + "".join(rng.choice("0123456789") for _ in range(4)) + rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        body = state + pan + rng.choice("123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") + "Z"
        valid = [c for c in ALPHABET if gstin.is_valid(body + c)]
        assert valid == [gstin.check_character(body)], body


def test_a_changed_character_is_caught() -> None:
    """Luhn mod 36 catches every single changed character in the first 14 (it does not catch every swap of two neighbours, and no GSTIN check can)."""
    base = PUBLISHED[0]
    caught = total = 0
    for i in range(2, 14):
        for c in ALPHABET:
            if c == base[i]:
                continue
            candidate = base[:i] + c + base[i + 1 :]
            if gstin._SHAPE.fullmatch(candidate):
                total += 1
                caught += 0 if gstin.is_valid(candidate) else 1
    assert total > 100 and caught == total


def test_the_state_codes() -> None:
    assert gstin.state_of("27AAPFU0939F1ZV") == "Maharashtra" and gstin.state_of("29AAGCB7383J1Z4") == "Karnataka"
    assert "36" in gstin.STATE_NAMES and "37" in gstin.STATE_NAMES and "38" in gstin.STATE_NAMES and "00" not in gstin.STATE_NAMES and "39" not in gstin.STATE_NAMES


# ---------------------------------------------------------------------------------------------- the CRM models
def test_a_company_takes_a_gstin_loosely_written() -> None:
    made = CompanyCreate(id=uuid.uuid4(), name="Ravi Silks", gstin=" 27aapfu0939f1zv ")
    assert made.gstin == "27AAPFU0939F1ZV" and made.model_dump(mode="json")["gstin"] == "27AAPFU0939F1ZV"
    assert CompanyCreate(id=uuid.uuid4(), name="Ravi Silks").gstin is None


@pytest.mark.parametrize("bad", ["27AAPFU0939F1ZW", "12345", "", "x" * 40, 27])
def test_a_company_refuses_a_bad_gstin(bad: Any) -> None:
    with pytest.raises(ValidationError):
        CompanyCreate(id=uuid.uuid4(), name="Ravi Silks", gstin=bad)
    with pytest.raises(ValidationError):
        CompanyUpdate(gstin=bad)


def test_an_update_can_clear_it_and_a_missing_field_changes_nothing() -> None:
    assert CompanyUpdate(gstin=None).model_dump(exclude_unset=True) == {"gstin": None}
    assert CompanyUpdate(name="X").model_dump(exclude_unset=True) == {"name": "X"}


def test_the_company_routes_check_the_gstin() -> None:
    client, _ = make_client(crm=FakeCrmRepository())
    url = f"/v1/tenants/{TENANT_A.id}/companies"
    ok = client.post(url, json={"id": str(uuid.uuid4()), "name": "Ravi Silks", "gstin": "29 aagcb7383j1z4"}, headers=auth("a_sales"))
    assert ok.status_code == 201 and ok.json()["gstin"] == "29AAGCB7383J1Z4"
    bad = client.post(url, json={"id": str(uuid.uuid4()), "name": "Bad Silks", "gstin": "29AAGCB7383J1Z5"}, headers=auth("a_sales"))
    assert bad.status_code == 422
    patch = client.patch(f"{url}/{ok.json()['id']}", json={"gstin": None}, headers=auth("a_sales"))
    assert patch.status_code == 200 and patch.json()["gstin"] is None


# ---------------------------------------------------------------------------------------------- the business profile
class FakeProfile:
    def __init__(self) -> None:
        self.gstin: dict[uuid.UUID, str | None] = {}
        self.calls: list[tuple[str, str]] = []
        self.error: Exception | None = None

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("get", token))
        if self.error is not None:
            raise self.error
        return {"gstin": self.gstin.get(tenant_id)}

    def set_gstin(self, token: str, tenant_id: uuid.UUID, gstin_: str | None) -> dict[str, Any]:
        self.calls.append(("set", token))
        if self.error is not None:
            raise self.error
        self.gstin[tenant_id] = gstin_
        return {"gstin": gstin_}


URL = f"/v1/tenants/{TENANT_A.id}/business-profile"


def test_every_member_reads_the_shops_gstin() -> None:
    profile = FakeProfile()
    profile.gstin[TENANT_A.id] = "27AAPFU0939F1ZV"
    client, _ = make_client(business_profile=profile)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(URL, headers=auth(user))
        assert r.status_code == 200 and r.json() == {"gstin": "27AAPFU0939F1ZV", "state": "Maharashtra"}, user
    assert client.get(URL, headers=auth("outsider")).status_code == 404
    assert client.get(URL).status_code == 401


def test_owner_and_admin_set_and_clear_it_with_a_second_factor() -> None:
    profile = FakeProfile()
    client, _ = make_client(business_profile=profile)
    r = client.put(URL, json={"gstin": " 27aapfu0939f1zv"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"gstin": "27AAPFU0939F1ZV", "state": "Maharashtra"}
    assert profile.gstin[TENANT_A.id] == "27AAPFU0939F1ZV"
    assert client.put(URL, json={"gstin": None}, headers=auth("a_admin")).json() == {"gstin": None, "state": None}
    for user, code in (("a_sales", 403), ("a_viewer", 403), ("outsider", 404), ("b_owner", 404)):
        assert client.put(URL, json={"gstin": "27AAPFU0939F1ZV"}, headers=auth(user)).status_code == code, user
    weak = client.put(URL, json={"gstin": "27AAPFU0939F1ZV"}, headers=auth("a_owner", aal="aal1"))
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"


def test_a_bad_or_missing_gstin_is_a_422_and_nothing_is_written() -> None:
    profile = FakeProfile()
    client, _ = make_client(business_profile=profile)
    for body in ({"gstin": "27AAPFU0939F1ZW"}, {}, {"gstin": ""}, {"gstin": "x"}, {"gstin": "27AAPFU0939F1ZV", "extra": 1}, {"gstin": 27}):
        assert client.put(URL, json=body, headers=auth("a_owner")).status_code == 422, body
    assert [c for c in profile.calls if c[0] == "set"] == []


def test_the_database_refusals_have_their_plain_words() -> None:
    profile = FakeProfile()
    client, _ = make_client(business_profile=profile)
    profile.error = MfaRequired("SM306")
    assert client.put(URL, json={"gstin": "27AAPFU0939F1ZV"}, headers=auth("a_owner")).status_code == 403
    profile.error = UpstreamError("down")
    assert client.get(URL, headers=auth("a_owner")).status_code in (502, 503)
    plain_client, _ = make_client()
    assert plain_client.get(URL, headers=auth("a_owner")).status_code == 503


# ---------------------------------------------------------------------------------------------- what an order shows
def _order_client(profile: FakeProfile | None = None, crm: FakeCrmRepository | None = None) -> tuple[Any, FakeOrders]:
    orders = FakeOrders(TENANT_A.id)
    client, _ = make_client(orders=orders, crm=crm or FakeCrmRepository(), business_profile=profile)
    return client, orders


def test_an_order_shows_the_customers_and_the_shops_gstin() -> None:
    crm = FakeCrmRepository()
    company = uuid.UUID(int=0xC0)
    crm.seed("companies", TENANT_A.id, company, name="Ravi Silks", gstin="29AAGCB7383J1Z4")
    crm.seed("leads", TENANT_A.id, LEAD, company_id=str(company))
    profile = FakeProfile()
    profile.gstin[TENANT_A.id] = "27AAPFU0939F1ZV"
    client, _ = _order_client(profile, crm)
    got = client.get(f"/v1/tenants/{TENANT_A.id}/orders/{ORDER}", headers=auth("a_sales"))
    assert got.status_code == 200, got.text
    assert (got.json()["customer_gstin"], got.json()["shop_gstin"]) == ("29AAGCB7383J1Z4", "27AAPFU0939F1ZV")


def test_an_order_without_gstins_says_null_and_a_failed_read_never_fails_the_screen() -> None:
    client, _ = _order_client()
    got = client.get(f"/v1/tenants/{TENANT_A.id}/orders/{ORDER}", headers=auth("a_sales")).json()
    assert got["customer_gstin"] is None and got["shop_gstin"] is None
    profile = FakeProfile()
    profile.error = UpstreamError("down")
    client, _ = _order_client(profile)
    again = client.get(f"/v1/tenants/{TENANT_A.id}/orders/{ORDER}", headers=auth("a_sales"))
    assert again.status_code == 200 and again.json()["shop_gstin"] is None


def test_one_business_never_sees_anothers_gstin() -> None:
    crm = FakeCrmRepository()
    company = uuid.UUID(int=0xC1)
    crm.seed("companies", TENANT_B.id, company, name="B Silks", gstin="29AAGCB7383J1Z4")
    profile = FakeProfile()
    profile.gstin[TENANT_B.id] = "24AAACC1206D1ZM"
    client, _ = _order_client(profile, crm)
    got = client.get(f"/v1/tenants/{TENANT_A.id}/orders/{ORDER}", headers=auth("a_sales")).json()
    assert got["customer_gstin"] is None and got["shop_gstin"] is None


# ---------------------------------------------------------------------------------------------- the accounting files
def _payload(**over: Any) -> dict[str, Any]:
    import json
    from pathlib import Path

    doc: dict[str, Any] = json.loads((Path(__file__).parent / "golden_bi" / "payload.json").read_text(encoding="utf-8"))
    doc.update(over)
    return doc


def test_the_files_carry_the_gstins_where_the_format_has_a_place() -> None:
    acc = accounting.build(_payload())
    assert acc.shop_gstin == "36AABCU9603R1ZO"
    assert acc.party_gstins() == {"Ravi & Sons Silks": "36AAACR5055K1Z8", "శ్రీ లక్ష్మి చీరలు": "29AAGCB7383J1Z4"}
    text = plain.csv_bytes(acc).decode("utf-8")
    assert "36AAACR5055K1Z8" in text and "36AABCU9603R1ZO" in text and text.splitlines()[0].endswith("Seller GSTIN")
    sheet = vyapar.workbook(acc)
    assert sheet[:2] == b"PK"
    xml = tally.masters_xml(acc) + tally.vouchers_xml(acc)
    assert "36AAACR5055K1Z8" not in xml and "29AAGCB7383J1Z4" not in xml and "36AABCU9603R1ZO" not in xml, "the Tally files do not carry GSTINs (the tag names could not be verified)"


def test_a_number_the_application_would_refuse_never_reaches_a_file() -> None:
    doc = _payload(shop_gstin="27AAPFU0939F1ZW")
    doc["orders"][0]["gstin"] = "not a gstin"
    doc["payments"][0]["gstin"] = 12345
    acc = accounting.build(doc)
    assert acc.shop_gstin == "" and acc.sales[0].gstin == "" and acc.payments[0].gstin == ""


def test_an_export_without_gstins_is_the_same_as_before() -> None:
    doc = _payload()
    doc.pop("shop_gstin")
    for o in doc["orders"]:
        o.pop("gstin", None)
    for p in doc["payments"]:
        p.pop("gstin", None)
    acc = accounting.build(doc)
    assert acc.shop_gstin == "" and acc.party_gstins() == {}
    text = plain.csv_bytes(acc).decode("utf-8").splitlines()
    assert all(line.endswith(",") or "Seller GSTIN" in line for line in text)
