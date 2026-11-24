"""What you sell, the four styles that are not products (docs/contracts/what-you-sell.md, 25 Nov 2026): JOBS door, roles, second factor, the shape checks by style and the closed words. A fake store: no database."""

# ruff: noqa: E501
from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.jobs.wiring import JobsRuntime
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/what-you-sell"
EID = "11111111-2222-4333-8444-555555555555"

SERVICE = {"name": "Haircut", "minutes": 30, "price_paise": 25000, "price_from": False, "booking": "any_day", "place": None}
COURSE = {"name": "Spoken English", "batch": "Morning", "starts_on": "2026-12-10", "fee_paise": 150000, "seats": {"state": "left", "count": 4}, "total": 20, "description": None}
PROPERTY = {"name": "Plot 12", "location": "Behind the temple", "size": 200, "size_unit": "sq_yd", "note": None, "price_paise": None, "status": "available"}
PRICE = {"name": "Plain bag", "moq": 10, "unit": "piece", "rates": [{"from_qty": 10, "rate_paise": 9000}, {"from_qty": 100, "rate_paise": 8000}], "good_until": None}


class FakeSell:
    def __init__(self) -> None:
        self.puts: list[tuple[str, str, dict[str, Any]]] = []
        self.removes: list[tuple[str, str]] = []
        self.created = True

    def list(self, token: str, tenant_id: uuid.UUID, style: str, limit: int, cursor: str | None) -> dict[str, Any]:
        return {"style": style, "items": [], "next_cursor": None}

    def put(self, token: str, tenant_id: uuid.UUID, style: str, entry_id: uuid.UUID, name: str, data: dict[str, Any]) -> dict[str, Any]:
        self.puts.append((style, name, data))
        return {"item": {"id": str(entry_id), "name": name, **data}, "created": self.created}

    def remove(self, token: str, tenant_id: uuid.UUID, style: str, entry_id: uuid.UUID) -> dict[str, Any]:
        self.removes.append((style, str(entry_id)))
        return {"removed": True}


def world() -> tuple[Any, FakeSell]:
    store = FakeSell()
    client, _ = make_client(jobs=JobsRuntime(sell=store))
    return client, store


def test_everything_is_404_while_jobs_is_off() -> None:
    client, _ = make_client()
    assert client.get(f"{BASE}?style=services", headers=auth("a_owner")).status_code == 404
    assert client.put(f"{BASE}/services/{EID}", json=SERVICE, headers=auth("a_owner")).status_code == 404
    assert client.post(f"{BASE}/services/{EID}/remove", json={}, headers=auth("a_owner")).status_code == 404


@pytest.mark.parametrize(("style", "body"), [("services", SERVICE), ("courses", COURSE), ("properties", PROPERTY), ("pricelist", PRICE)])
def test_an_entry_of_each_style_is_stored_with_its_name_apart_and_the_same_id_again_is_a_retry(style: str, body: dict[str, Any]) -> None:
    client, store = world()
    first = client.put(f"{BASE}/{style}/{EID}", json=body, headers=auth("a_owner"))
    assert first.status_code == 201 and first.json()["id"] == EID and first.json()["name"] == body["name"], first.text
    assert store.puts[-1][0] == style and store.puts[-1][1] == body["name"] and "name" not in store.puts[-1][2]
    store.created = False
    again = client.put(f"{BASE}/{style}/{EID}", json=body, headers=auth("a_owner"))
    assert again.status_code == 200 and len(store.puts) == 2


@pytest.mark.parametrize(
    ("style", "body", "field"),
    [
        ("services", {**SERVICE, "minutes": 2}, "minutes"),
        ("services", {**SERVICE, "price_paise": -5}, "price_paise"),
        ("services", {**SERVICE, "booking": "whenever"}, "booking"),
        ("services", {**SERVICE, "extra": 1}, "extra"),
        ("services", {**SERVICE, "name": "  "}, "name"),
        ("courses", {**COURSE, "seats": {"state": "left"}}, "seats"),
        ("courses", {**COURSE, "seats": {"state": "open", "count": 3}}, "seats"),
        ("courses", {**COURSE, "starts_on": "10-12-2026"}, "starts_on"),
        ("courses", {**COURSE, "starts_on": "2026-02-31"}, "__model__"),
        ("properties", {**PROPERTY, "size": 0}, "size"),
        ("properties", {**PROPERTY, "size_unit": "mile"}, "size_unit"),
        ("pricelist", {**PRICE, "rates": []}, "rates"),
        ("pricelist", {**PRICE, "rates": [{"from_qty": 10, "rate_paise": 8000}, {"from_qty": 100, "rate_paise": 9000}]}, "__model__"),
        ("pricelist", {**PRICE, "rates": [{"from_qty": 100, "rate_paise": 8000}, {"from_qty": 10, "rate_paise": 7000}]}, "__model__"),
    ],
)
def test_a_body_that_does_not_fit_its_style_is_a_422_naming_the_fields_never_the_values(style: str, body: dict[str, Any], field: str) -> None:
    client, store = world()
    r = client.put(f"{BASE}/{style}/{EID}", json=body, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", r.text
    assert store.puts == [] and "fields" in r.json()["error"]
    assert str(body.get("name", "x")) not in r.text or body.get("name") in ("", "  ")


def test_who_may_write_and_the_second_factor_and_the_other_business() -> None:
    client, store = world()
    assert client.put(f"{BASE}/services/{EID}", json=SERVICE, headers=auth("a_admin")).status_code == 201
    for who in ("a_viewer", "a_sales"):
        assert client.put(f"{BASE}/services/{EID}", json=SERVICE, headers=auth(who)).status_code == 403, who
        assert client.post(f"{BASE}/services/{EID}/remove", json={}, headers=auth(who)).status_code == 403, who
    assert client.put(f"{BASE}/services/{EID}", json=SERVICE, headers=auth("a_owner", aal="aal1")).status_code == 403, "the second factor is asked of an Owner who turned it on"
    assert client.put(f"/v1/tenants/{TENANT_B.id}/what-you-sell/services/{EID}", json=SERVICE, headers=auth("a_owner")).status_code == 404, "another business is not ours"
    assert len(store.puts) == 1


def test_reads_are_for_every_member_and_products_and_junk_are_not_styles() -> None:
    client, _ = world()
    for who in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(f"{BASE}?style=courses&limit=10", headers=auth(who))
        assert r.status_code == 200 and r.json() == {"style": "courses", "items": [], "next_cursor": None}, who
    assert client.get(f"{BASE}?style=products", headers=auth("a_owner")).status_code == 422, "products are the catalogue's"
    assert client.get(f"{BASE}", headers=auth("a_owner")).status_code == 422
    assert client.get(f"{BASE}?style=services&limit=51", headers=auth("a_owner")).status_code == 422
    assert client.put(f"{BASE}/products/{EID}", json=SERVICE, headers=auth("a_owner")).status_code == 404
    assert client.put(f"{BASE}/services/not-an-id", json=SERVICE, headers=auth("a_owner")).status_code == 404
    assert client.get(f"{BASE}?style=services").status_code == 401


def test_remove_is_a_post_with_a_closed_answer() -> None:
    client, store = world()
    r = client.post(f"{BASE}/pricelist/{EID}/remove", json={}, headers=auth("a_admin"))
    assert r.status_code == 200 and r.json() == {"removed": True} and store.removes == [("pricelist", EID)]
    assert client.delete(f"{BASE}/pricelist/{EID}", headers=auth("a_owner")).status_code in (404, 405)
