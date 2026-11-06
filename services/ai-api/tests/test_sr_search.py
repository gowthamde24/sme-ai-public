"""Search for the ⌘K palette (docs/contracts/search.md). The database (pgTAP 173) proves the matching, the role filtering and the timing; here the route: any member, q 2 to 80 characters, the
answer passed through."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/search"


class FakeSearch:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def search(self, token: str, tenant_id: uuid.UUID, q: str) -> dict[str, Any]:
        self.calls.append(q)
        return {"q": q, "groups": [{"kind": "lead", "items": [{"id": str(uuid.uuid4()), "title": "Ravi Kumar", "sub": "…3210"}]}]}


def test_any_member_searches_and_q_is_trimmed() -> None:
    fake = FakeSearch()
    client, _ = make_client(search=fake)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        got = client.get(URL, params={"q": "  ravi "}, headers=auth(user))
        assert got.status_code == 200 and got.json()["groups"][0]["kind"] == "lead", user
    assert fake.calls == ["ravi"] * 4


def test_q_must_be_2_to_80_characters() -> None:
    client, _ = make_client(search=FakeSearch())
    short = client.get(URL, params={"q": " r "}, headers=auth("a_owner"))
    assert short.status_code == 422 and short.json()["error"]["code"] == "validation_error" and short.json()["error"]["fields"] == ["q"]
    long = client.get(URL, params={"q": "x" * 81}, headers=auth("a_owner"))
    assert long.status_code == 422 and long.json()["error"]["fields"] == ["q"]
    assert client.get(URL, headers=auth("a_owner")).status_code == 422


def test_another_workspace_and_no_sign_in() -> None:
    client, _ = make_client(search=FakeSearch())
    assert client.get(f"/v1/tenants/{uuid.uuid4()}/search", params={"q": "ravi"}, headers=auth("a_owner")).status_code in (403, 404)
    assert client.get(URL, params={"q": "ravi"}).status_code == 401
