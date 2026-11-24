# ruff: noqa: E501
"""The lists routes (28 Nov 2026): who may do what, the flag, plain closed reasons, 201 for new and 200 for a retry, and that the request shapes are strict. The database rules are proved in pgTAP 274."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.sell_lists.repository import ListRefused
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/lists"
LIST = str(uuid.uuid4())
ROW = str(uuid.uuid4())


class FakeLists:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.refuse: str | None = None
        self.created = True

    def _go(self, name: str, payload: Any, out: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, payload))
        if self.refuse:
            raise ListRefused(self.refuse)
        return out

    def lists(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._go("lists", None, {"lists": []})

    def get(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return self._go("get", str(list_id), {"id": str(list_id), "columns": []})

    def create(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, name: str, kind: str) -> dict[str, Any]:
        return self._go("create", (name, kind), {"id": str(list_id), "name": name, "kind": kind, "columns": []})

    def update(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, name: str, make_main: bool) -> dict[str, Any]:
        return self._go("update", (name, make_main), {"id": str(list_id), "name": name})

    def remove(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return self._go("remove", str(list_id), {"removed": True})

    def columns_put(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, columns: list[dict[str, Any]], confirm: bool) -> dict[str, Any]:
        return self._go("columns", (columns, confirm), {"id": str(list_id), "columns": columns})

    def rows(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, limit: int, cursor: str | None, q: str | None) -> dict[str, Any]:
        return self._go("rows", (limit, cursor, q), {"items": [], "next_cursor": None})

    def row_put(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, row_id: uuid.UUID, name: str, cells: dict[str, Any], active: bool) -> dict[str, Any]:
        return self._go("row_put", (name, cells), {"item": {"id": str(row_id), "name": name, "cells": cells, "active": active}, "created": self.created})

    def row_remove(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, row_id: uuid.UUID) -> dict[str, Any]:
        return self._go("row_remove", str(row_id), {"removed": True})


@pytest.fixture
def w() -> tuple[Any, FakeLists]:
    repo = FakeLists()
    client, _ = make_client(sell_lists=repo)
    return client, repo


def test_every_member_reads_and_only_owner_or_admin_writes(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    assert client.get(URL, headers=auth("a_viewer")).status_code == 200
    assert client.get(f"{URL}/{LIST}/rows", headers=auth("a_sales")).status_code == 200
    body = {"id": LIST, "name": "Sarees", "kind": "products"}
    for user in ("a_sales", "a_viewer"):
        assert client.post(URL, json=body, headers=auth(user)).status_code == 403
        assert client.put(f"{URL}/{LIST}/columns", json={"columns": []}, headers=auth(user)).status_code == 403
        assert client.put(f"{URL}/{LIST}/rows/{ROW}", json={"name": "x"}, headers=auth(user)).status_code == 403
    assert not [c for c in repo.calls if c[0] in ("create", "columns", "row_put")]
    assert client.post(URL, json=body, headers=auth("a_admin")).status_code == 201


def test_the_flag_off_is_a_404_for_every_route() -> None:
    client, _ = make_client()
    assert client.get(URL, headers=auth("a_owner")).status_code == 404
    assert client.post(URL, json={"id": LIST, "name": "x", "kind": "other"}, headers=auth("a_owner")).status_code == 404


def test_a_row_is_201_when_new_and_200_when_it_was_there(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    assert client.put(f"{URL}/{LIST}/rows/{ROW}", json={"name": "Cotton", "cells": {"price": 45000}}, headers=auth("a_owner")).status_code == 201
    repo.created = False
    r = client.put(f"{URL}/{LIST}/rows/{ROW}", json={"name": "Cotton", "cells": {"price": 45000}}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"id": ROW, "name": "Cotton", "cells": {"price": 45000}, "active": True}


@pytest.mark.parametrize("reason,status", [("list_limit", 409), ("column_limit", 409), ("row_limit", 409), ("name_taken", 409), ("one_default_price", 409), ("role_taken", 409), ("column_has_data", 409), ("value_not_allowed", 422), ("not_a_price", 422)])
def test_each_database_refusal_is_a_closed_word_in_code_reason_and_fields(w: tuple[Any, FakeLists], reason: str, status: int) -> None:
    client, repo = w
    code = next(k for k, v in __import__("app.sell_lists.repository", fromlist=["REASONS"]).REASONS.items() if v == reason)
    repo.refuse = code
    r = client.put(f"{URL}/{LIST}/rows/{ROW}", json={"name": "x"}, headers=auth("a_owner"))
    err = r.json()["error"]
    assert r.status_code == status and err["code"] == reason and err["reason"] == reason and err["fields"] == [reason]


def test_request_shapes_are_strict(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    bad = [
        (client.post, URL, {"id": LIST, "name": "x", "kind": "gadgets"}),
        (client.post, URL, {"id": LIST, "name": "x", "kind": "other", "extra": 1}),
        (client.post, URL, {"id": "not-a-uuid", "name": "x", "kind": "other"}),
        (client.put, f"{URL}/{LIST}/columns", {"columns": [{"label": "A", "type": "emoji"}]}),
        (client.put, f"{URL}/{LIST}/columns", {"columns": [{"label": "A", "type": "text", "role": "boss"}]}),
        (client.put, f"{URL}/{LIST}/columns", {"columns": [{"label": "A", "type": "rupees", "role": "price", "billing_period": "weekly"}]}),
        (client.put, f"{URL}/{LIST}/rows/{ROW}", {"name": "x", "cells": {"Bad Key": 1}}),
    ]
    for fn, url, body in bad:
        assert fn(url, json=body, headers=auth("a_owner")).status_code == 422, (url, body)
    assert repo.calls == []


def test_columns_carry_the_role_and_the_billing_period_through(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    cols = [{"label": "Join", "type": "rupees", "role": "price", "billing_period": "per_month", "quote_default": True}, {"label": "Link", "type": "link", "role": "how_to_buy"}]
    assert client.put(f"{URL}/{LIST}/columns", json={"columns": cols, "confirm": True}, headers=auth("a_owner")).status_code == 200
    name, payload = repo.calls[-1]
    assert name == "columns" and payload[1] is True and payload[0][0]["billing_period"] == "per_month" and payload[0][1]["role"] == "how_to_buy"
