# ruff: noqa: E501
"""The number picker's routes (28 Nov 2026) with a fake database and a fake VoiceLink: who may do what, what a customer is shown (never a price), every refusal as a closed word, and the money rules before the purchase."""

from __future__ import annotations

import uuid
from typing import Any

from app.numbers.buyer import BuyerSettings
from app.numbers.service import AlreadyHasNumber, DailyLimit, NumberService, NumberTaken, Paused
from tests.fakes import TENANT_A, auth, make_client
from tests.test_number_buyer import Fake

URL = f"/v1/tenants/{TENANT_A.id}/numbers"
NUMBER = "+919876543210"


class Repo:
    def __init__(self, *, reason: str | None = None, begin_error: Exception | None = None) -> None:
        self.reason, self.begin_error = reason, begin_error
        self.calls: list[tuple[str, Any]] = []
        self.rows: list[dict[str, Any]] = []

    def check(self, token: str, tenant_id: uuid.UUID) -> str | None:
        return self.reason

    def begin(self, token: str, tenant_id: uuid.UUID, number: str, kind: str) -> uuid.UUID:
        if self.begin_error is not None:
            raise self.begin_error
        self.calls.append(("begin", number))
        return uuid.UUID(int=7)

    def finish(self, token: str, claim_id: uuid.UUID, state: str, reason: str | None = None, cost_paise: int | None = None, order_number: str | None = None) -> None:
        self.calls.append(("finish", (state, reason, cost_paise)))

    def attach(self, token: str, claim_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("attach", None))
        self.rows.append({"number": NUMBER, "kind": "mobile", "state": "calls_off", "label": "VoiceLink"})
        return {"number": NUMBER}

    def listing(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self.rows


def world(repo: Repo | None = None, fake: Fake | None = None) -> tuple[Any, Repo, Fake, list[str]]:
    repo, fake = repo or Repo(), fake or Fake()
    alerts: list[str] = []
    service = NumberService(repo, fake.api(), BuyerSettings(client_id=5879, bot_id=1362), alert=alerts.append)
    client, _ = make_client(numbers=service)
    return client, repo, fake, alerts


def test_the_list_shows_numbers_and_their_type_and_never_a_price() -> None:
    client, _, fake, _ = world()
    r = client.get(f"{URL}/available?type=mobile&prefix=9876", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"numbers": [{"number": NUMBER, "display": "+91 98765 43210", "type": "mobile"}], "page": 1, "more": False}
    assert "299" not in r.text and "rate" not in r.text.lower() and "price" not in r.text.lower()
    assert all(m == "GET" for m, path, _ in fake.calls if not path.endswith("/auth/login")), "listing buys nothing (only the login is a POST)"


def test_only_the_owner_or_an_admin_lists_and_only_the_owner_claims() -> None:
    client, repo, _, _ = world()
    assert client.get(f"{URL}/available", headers=auth("a_viewer")).status_code == 403
    assert client.post(f"{URL}/claim", json={"number": NUMBER}, headers=auth("a_admin")).status_code == 403
    assert repo.calls == []
    assert client.get(URL, headers=auth("a_viewer")).status_code == 200, "any member may see the workspace's numbers"


def test_a_closed_reason_comes_back_as_409_numbers_unavailable_with_the_reason_in_both_places() -> None:
    for reason in ("paused", "already_has_number", "not_on_plan", "daily_limit"):
        client, *_ = world(Repo(reason=reason))
        r = client.get(f"{URL}/available", headers=auth("a_owner"))
        assert r.status_code == 409 and r.json()["error"]["code"] == "numbers_unavailable" and r.json()["error"]["reason"] == reason and r.json()["error"]["fields"] == [reason], reason


def test_a_good_claim_buys_attaches_and_answers_ready_with_the_type() -> None:
    client, repo, fake, alerts = world()
    r = client.post(f"{URL}/claim", json={"number": NUMBER, "type": "mobile"}, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json() == {"number": NUMBER, "display": "+91 98765 43210", "type": "mobile", "state": "ready"}
    assert [c[0] for c in repo.calls] == ["begin", "finish", "attach"] and repo.calls[1][1][0] == "routed" and repo.calls[1][1][2] == 29900
    assert any(p.endswith("/purchase/confirm") for _, p, _ in fake.calls) and alerts == []
    assert client.get(URL, headers=auth("a_viewer")).json()["numbers"][0]["display"] == "+91 98765 43210"


def test_the_databases_refusals_are_closed_409s_and_nothing_is_bought() -> None:
    for error, code, reason in ((AlreadyHasNumber(), "numbers_unavailable", "already_has_number"), (Paused(), "numbers_unavailable", "paused"), (DailyLimit(), "numbers_unavailable", "daily_limit"), (NumberTaken(), "number_taken", "number_taken")):
        client, repo, fake, _ = world(Repo(begin_error=error))
        r = client.post(f"{URL}/claim", json={"number": NUMBER}, headers=auth("a_owner"))
        assert r.status_code == 409 and r.json()["error"]["code"] == code and r.json()["error"]["reason"] == reason
        assert not any("purchase" in p for _, p, _ in fake.calls), "no call to VoiceLink's purchase side"


def test_a_low_wallet_is_a_refusal_with_a_needs_you_item_and_the_claim_is_marked_failed() -> None:
    client, repo, fake, alerts = world(fake=Fake(balance=500))
    r = client.post(f"{URL}/claim", json={"number": NUMBER}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["reason"] == "wallet_low" and "price" not in r.text.lower()
    assert ("finish", ("failed", "wallet_low", None)) in repo.calls and len(alerts) == 1 and "Top up" in alerts[0]
    assert not any(p.endswith("/purchase/confirm") for _, p, _ in fake.calls)


def test_a_set_up_that_stops_after_the_purchase_is_not_an_error_for_the_customer_and_tells_the_team() -> None:
    client, repo, _, alerts = world(fake=Fake(route_fails=True))
    r = client.post(f"{URL}/claim", json={"number": NUMBER}, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json()["state"] == "getting_ready"
    assert [c[0] for c in repo.calls] == ["begin", "finish"] and len(alerts) == 1 and "set-up stopped" in alerts[0]


def test_a_bad_number_or_prefix_is_a_422_and_a_picker_that_is_off_is_a_503() -> None:
    client, *_ = world()
    assert client.post(f"{URL}/claim", json={"number": "12345"}, headers=auth("a_owner")).status_code == 422
    assert client.get(f"{URL}/available?prefix=98a", headers=auth("a_owner")).status_code == 422
    off, _ = make_client()
    r = off.get(URL, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "numbers_unavailable"
