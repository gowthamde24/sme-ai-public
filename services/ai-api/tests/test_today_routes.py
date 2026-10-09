"""HTTP behaviour of Today, AI usage and the helpers' status: authentication, tenant isolation (404 not 403), role gates, the contract's shapes."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.tenancy import repository as repo
from tests.fakes import TENANT_A, TENANT_B, USERS, auth, make_client
from tests.today_fakes import FakeTodayRepository, empty_today

ID = str(uuid.UUID(int=9))
AT = "2026-10-09T09:30:00+00:00"
PATHS = ("today", "ai-usage/today", "agents/status")


def a_today() -> dict[str, Any]:
    return {
        "cards": {"waiting": 1, "money_held_paise": 0, "orders_open": 1},
        "needs_you": [
            {
                "kind": "quote_approval",
                "id": ID,
                "customer": "Harbour Retail",
                "city": "Hyderabad",
                "agent": "quote_writer",
                "ref": "3",
                "amount_paise": 500_000,
                "at": AT,
                "target": {"type": "quote", "id": ID},
            }
        ],
        "recent": [],
    }


def b_today() -> dict[str, Any]:
    return {
        "cards": {"waiting": 1, "money_held_paise": 9_999_900, "orders_open": 0},
        "needs_you": [
            {
                "kind": "order_money_held",
                "id": ID,
                "customer": "Rival Co",
                "city": "Chennai",
                "agent": "order_desk",
                "ref": "1",
                "amount_paise": 9_999_900,
                "at": AT,
                "target": {"type": "order", "id": ID},
            }
        ],
        "recent": [],
    }


def agents_facts() -> dict[str, Any]:
    return {
        "agents_enabled": True,
        "main": {"switched_on": True, "running": False, "last_status": None, "last_at": None},
        "researcher": {"switched_on": True, "running": False, "last_status": None, "last_at": None},
        "requirement_analyst": {"switched_on": True, "running": False, "last_status": None, "last_at": None},
        "quote_writer": {},
        "followup_desk": {},
        "order_desk": {},
    }


def world() -> tuple[Any, FakeTodayRepository]:
    today = FakeTodayRepository()
    today.today = {TENANT_A.id: a_today(), TENANT_B.id: b_today()}
    today.agents = {TENANT_A.id: agents_facts(), TENANT_B.id: agents_facts()}
    today.cost = {
        TENANT_A.id: {"cap_micros": 250_000_000, "spent_micros": 0},
        TENANT_B.id: {"cap_micros": 1, "spent_micros": 0},
    }
    client, _ = make_client(today=today)
    return client, today


@pytest.mark.parametrize("path", PATHS)
def test_every_read_needs_a_session(path: str) -> None:
    client, today = world()
    assert client.get(f"/v1/tenants/{TENANT_A.id}/{path}").status_code == 401
    assert (
        client.get(
            f"/v1/tenants/{TENANT_A.id}/{path}", headers={"Authorization": "Bearer not.a.jwt"}
        ).status_code
        == 401
    )
    assert today.calls == []


@pytest.mark.parametrize("path", PATHS)
def test_a_foreign_unknown_or_malformed_tenant_is_the_same_404_and_the_data_layer_is_never_asked(
    path: str,
) -> None:
    client, today = world()
    bodies = {
        client.get(f"/v1/tenants/{t}/{path}", headers=auth("a_owner")).text
        for t in (TENANT_B.id, uuid.uuid4(), "not-a-uuid")
    }
    assert len(bodies) == 1
    assert (
        client.get(f"/v1/tenants/{TENANT_B.id}/{path}", headers=auth("a_owner")).status_code == 404
    )
    assert (
        client.get(f"/v1/tenants/{TENANT_A.id}/{path}", headers=auth("outsider")).status_code == 404
    )
    assert today.calls == []


@pytest.mark.parametrize("user", ["a_owner", "a_admin", "a_sales", "a_viewer"])
@pytest.mark.parametrize("path", ["today", "agents/status"])
def test_today_and_the_helpers_are_open_to_every_member_and_the_database_shapes_it_by_role(
    user: str, path: str
) -> None:
    client, _ = world()
    assert client.get(f"/v1/tenants/{TENANT_A.id}/{path}", headers=auth(user)).status_code == 200


@pytest.mark.parametrize(
    ("user", "status"),
    [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404)],
)
def test_ai_usage_is_owner_and_admin_only(user: str, status: int) -> None:
    client, today = world()
    assert (
        client.get(f"/v1/tenants/{TENANT_A.id}/ai-usage/today", headers=auth(user)).status_code
        == status
    )
    if status != 200:
        assert not [c for c in today.calls if c[0] == "ai_usage"]


def test_today_matches_the_contract() -> None:
    client, _ = world()
    body = client.get(f"/v1/tenants/{TENANT_A.id}/today", headers=auth("a_owner")).json()
    assert set(body) == {"cards", "needs_you", "recent"}
    assert body["cards"] == {"waiting": 1, "money_held_paise": 0, "orders_open": 1}
    item = body["needs_you"][0]
    assert set(item) == {
        "kind",
        "id",
        "customer",
        "city",
        "agent",
        "summary",
        "at",
        "amount_paise",
        "target",
    }
    assert item["target"] == {"type": "quote", "id": ID}
    assert item["summary"] == "Quote 3 for ₹5,000.00 is ready for your approval."


def test_another_businesss_rows_never_appear() -> None:
    client, today = world()
    a = client.get(f"/v1/tenants/{TENANT_A.id}/today", headers=auth("a_owner"))
    b = client.get(f"/v1/tenants/{TENANT_B.id}/today", headers=auth("b_owner"))
    assert "Rival Co" not in a.text and "9999900" not in a.text and "Chennai" not in a.text
    assert "Harbour Retail" not in b.text and "Hyderabad" not in b.text
    # the data layer was asked for exactly the path's tenant, with the caller's own token each time
    assert [c[2] for c in today.calls] == [TENANT_A.id, TENANT_B.id]
    assert len({c[1] for c in today.calls}) == 2, "each person's own token, not a shared one"


def test_the_callers_own_token_is_what_the_data_layer_gets() -> None:
    client, today = world()
    headers = auth("a_sales")
    client.get(f"/v1/tenants/{TENANT_A.id}/today", headers=headers)
    client.get(f"/v1/tenants/{TENANT_A.id}/agents/status", headers=headers)
    token = headers["Authorization"].removeprefix("Bearer ")
    assert [(c[0], c[1]) for c in today.calls] == [
        ("today_summary", token),
        ("agents_status", token),
    ]


def test_ai_usage_in_paise() -> None:
    client, _ = world()
    body = client.get(f"/v1/tenants/{TENANT_A.id}/ai-usage/today", headers=auth("a_owner")).json()
    assert body == {"spent_paise": 0, "cap_paise": 25_000, "left_paise": 25_000}


def test_the_helpers_are_always_all_seven_in_order() -> None:
    client, _ = world()
    body = client.get(f"/v1/tenants/{TENANT_A.id}/agents/status", headers=auth("a_viewer")).json()
    assert [a["agent"] for a in body] == [
        "main",
        "lead_finder",
        "researcher",
        "requirement_analyst",
        "quote_writer",
        "followup_desk",
        "order_desk",
    ]
    assert [a["state"] for a in body][:2] == ["idle", "not_available"]  # main (on) and lead_finder (does not exist)
    assert all(set(a) == {"agent", "state", "job", "last_event"} for a in body)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (repo.Forbidden("42501"), 403, "forbidden"),
        (repo.TokenRejected("PGRST303"), 401, "unauthorized"),
        (repo.UpstreamError("down"), 502, "upstream_error"),
    ],
)
def test_data_layer_refusals_have_fixed_answers(
    error: repo.RepositoryError, status: int, code: str
) -> None:
    client, today = world()
    today.raise_on_next = error
    response = client.get(f"/v1/tenants/{TENANT_A.id}/today", headers=auth("a_owner"))
    assert response.status_code == status and response.json()["error"]["code"] == code


def test_an_unexpected_data_layer_answer_is_a_502_and_nothing_of_it_is_returned() -> None:
    client, today = world()
    today.today[TENANT_A.id] = {"cards": "oops", "secret": "do not echo"}
    response = client.get(f"/v1/tenants/{TENANT_A.id}/today", headers=auth("a_owner"))
    assert response.status_code == 502 and "do not echo" not in response.text


def test_without_the_reads_wired_it_is_a_plain_503() -> None:
    client, _ = make_client()
    for path in PATHS:
        response = client.get(f"/v1/tenants/{TENANT_A.id}/{path}", headers=auth("a_owner"))
        assert (
            response.status_code == 503 and response.json()["error"]["code"] == "today_unavailable"
        )


def test_the_reads_take_no_input_and_cannot_write() -> None:
    client, today = world()
    for path in PATHS:
        url = f"/v1/tenants/{TENANT_A.id}/{path}"
        for method in (client.post, client.put, client.patch, client.delete):
            assert method(url, headers=auth("a_owner")).status_code == 405
    assert today.calls == []
    assert empty_today()["cards"]["waiting"] == 0 and USERS["a_owner"]
