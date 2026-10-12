"""Job BP (ADR 0078): the two web-research routes against fakes: who may call, what the status shows (switched on, today's use against the daily limit), and that confirming a shop found on the map makes
ONE company and ONE lead from what the owner typed, keeps only the place ID, and is idempotent. The real database rules are pgTAP 90; the real stack is tests/integration/test_bp_research_tools.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.websearch.metals import FixtureMetals
from app.websearch.places import FixturePlaces
from app.websearch.providers import DemoSearch
from app.websearch.service import ResearchWeb
from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client

STATUS = f"/v1/tenants/{TENANT_A.id}/research/status"
CONFIRM = f"/v1/tenants/{TENANT_A.id}/places/confirm"
PLACE = "ChIJFIXTURE000000002"


class Usage:
    def __init__(self, rows: dict[str, dict[str, int]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, uuid.UUID]] = []

    def usage_today(self, token: str, tenant_id: uuid.UUID) -> dict[str, dict[str, int]]:
        self.calls.append((token, tenant_id))
        return self.rows


CAPS = {"web-search": {"used": 4, "cap": 30}, "web-page": {"used": 0, "cap": 60}, "places-search": {"used": 2, "cap": 10}, "metal-price": {"used": 1, "cap": 20}}


# ---------------------------------------------------------------------------------------------- status
def test_status_is_all_off_when_nothing_is_switched_on() -> None:
    client, _ = make_client()
    body = client.get(STATUS, headers=auth("a_owner")).json()
    assert body == {"tools": {t: {"enabled": False, "used_today": None, "daily_limit": None} for t in ("web_search", "read_page", "find_retailers", "metal_prices")}}


def test_status_shows_use_against_the_daily_limit_for_the_tools_that_are_on() -> None:
    usage = Usage(CAPS)
    web = ResearchWeb(search=DemoSearch(), places=FixturePlaces(), metals=FixtureMetals())
    client, _ = make_client(research_web=web, research_usage=usage)
    response = client.get(STATUS, headers=auth("a_admin"))
    assert response.status_code == 200
    tools = response.json()["tools"]
    assert tools["web_search"] == {"enabled": True, "used_today": 4, "daily_limit": 30}
    assert tools["find_retailers"] == {"enabled": True, "used_today": 2, "daily_limit": 10}
    assert tools["metal_prices"] == {"enabled": True, "used_today": 1, "daily_limit": 20}
    assert tools["read_page"] == {"enabled": False, "used_today": None, "daily_limit": None}
    assert usage.calls and usage.calls[0][1] == TENANT_A.id


@pytest.mark.parametrize(("user", "code"), [("a_sales", 403), ("a_viewer", 403), ("outsider", 404), ("b_owner", 404)])
def test_status_is_for_owner_and_admin_only(user: str, code: int) -> None:
    client, _ = make_client(research_web=ResearchWeb(search=DemoSearch()), research_usage=Usage(CAPS))
    assert client.get(STATUS, headers=auth(user)).status_code == code


def test_status_needs_a_login() -> None:
    client, _ = make_client()
    assert client.get(STATUS).status_code == 401


# ---------------------------------------------------------------------------------------------- confirm
BODY: dict[str, Any] = {"place_id": PLACE, "company_name": "Balaji Sarees", "city": "Guntur"}


def test_confirm_makes_one_company_and_one_lead_from_what_the_owner_typed() -> None:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    response = client.post(CONFIRM, json=BODY, headers=auth("a_sales"))
    assert response.status_code == 201, response.text
    out = response.json()
    assert out["created"] is True
    company = crm.rows[("companies", TENANT_A.id)][uuid.UUID(out["company_id"])]
    lead = crm.rows[("leads", TENANT_A.id)][uuid.UUID(out["lead_id"])]
    assert company.name == "Balaji Sarees" and company.city == "Guntur" and company.type == "prospect"
    assert lead.source == f"places:{PLACE}" and lead.company_id == company.id and lead.status == "new"
    # nothing else from the map is anywhere: no address, no phone, no website, no map link
    dumped = str(company.model_dump()) + str(lead.model_dump())
    assert "Gandhi" not in dumped and company.website is None


def test_confirming_twice_returns_the_same_rows() -> None:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    first = client.post(CONFIRM, json=BODY, headers=auth("a_owner"))
    second = client.post(CONFIRM, json=BODY, headers=auth("a_owner"))
    assert first.status_code == 201 and second.status_code == 200
    assert second.json() == {**first.json(), "created": False}
    assert len(crm.rows[("companies", TENANT_A.id)]) == 1 and len(crm.rows[("leads", TENANT_A.id)]) == 1


def test_the_same_place_in_two_workspaces_makes_two_separate_sets_of_rows() -> None:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    a = client.post(CONFIRM, json=BODY, headers=auth("a_owner")).json()
    b = client.post(f"/v1/tenants/{TENANT_B.id}/places/confirm", json=BODY, headers=auth("b_owner")).json()
    assert a["lead_id"] != b["lead_id"] and a["company_id"] != b["company_id"]


@pytest.mark.parametrize(("user", "code"), [("a_owner", 201), ("a_admin", 201), ("a_sales", 201), ("a_viewer", 403), ("outsider", 404), ("b_owner", 404)])
def test_confirm_roles(user: str, code: int) -> None:
    client, _ = make_client(crm=FakeCrmRepository())
    assert client.post(CONFIRM, json=BODY, headers=auth(user)).status_code == code


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "place_id": "short"},
        {**BODY, "place_id": "has spaces in it!!"},
        {**BODY, "place_id": "x" * 91},
        {**BODY, "company_name": ""},
        {**BODY, "company_name": "x" * 201},
        {**BODY, "phone": "9876543210"},  # no field takes a phone number
        {**BODY, "website": "https://example.com"},
        {"place_id": PLACE},
    ],
)
def test_confirm_refuses_bad_input(body: dict[str, Any]) -> None:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    assert client.post(CONFIRM, json=body, headers=auth("a_owner")).status_code == 422
    assert not crm.rows


def test_a_conflicting_second_confirm_is_a_conflict_not_an_overwrite() -> None:
    crm = FakeCrmRepository()
    client, _ = make_client(crm=crm)
    assert client.post(CONFIRM, json=BODY, headers=auth("a_owner")).status_code == 201
    other = client.post(CONFIRM, json={**BODY, "company_name": "Another Name"}, headers=auth("a_owner"))
    assert other.status_code == 409
    (company,) = crm.rows[("companies", TENANT_A.id)].values()
    assert company.name == "Balaji Sarees"
