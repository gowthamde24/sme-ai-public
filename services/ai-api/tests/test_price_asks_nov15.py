"""\"Price asked: <item>\" (owner, 15 Nov 2026): the sentence "the shop will confirm the exact price and get back to you" is true because the question is written down and shown in Today."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.assistant.language import MONEY_NOT_CONFIRMED
from tests.fakes import TENANT_A, auth, make_client

A = f"/v1/tenants/{TENANT_A.id}/price-asks"


class FakeAsks:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def record(self, token: str, tenant_id: uuid.UUID, item: str, source: str, lead_id: uuid.UUID | None) -> uuid.UUID:
        for r in self.rows:
            if r["item"] == item and r["answered_at"] is None and r["lead_id"] == lead_id:
                return uuid.UUID(str(r["id"]))
        row = {"id": str(uuid.uuid4()), "item": item, "source": source, "lead_id": lead_id, "customer": None, "asked_at": "2026-11-15T20:00:00+00:00", "answered_at": None}
        self.rows.append(row)
        return uuid.UUID(str(row["id"]))

    def answer(self, token: str, tenant_id: uuid.UUID, ask_id: uuid.UUID) -> None:
        for r in self.rows:
            if r["id"] == str(ask_id):
                r["answered_at"] = "2026-11-15T21:00:00+00:00"

    def list(self, token: str, tenant_id: uuid.UUID, open_only: bool, limit: int) -> list[dict[str, Any]]:
        return [{**r, "lead_id": str(r["lead_id"]) if r["lead_id"] else None} for r in self.rows if not open_only or r["answered_at"] is None][:limit]


def test_staff_write_read_and_answer_and_a_viewer_does_not() -> None:
    asks = FakeAsks()
    client, _ = make_client(price_asks=asks)
    made = client.post(A, json={"item": "Dharmavaram silk saree", "source": "call"}, headers=auth("a_sales"))
    assert made.status_code == 201
    listed = client.get(A, headers=auth("a_owner")).json()["items"]
    assert [i["item"] for i in listed] == ["Dharmavaram silk saree"] and listed[0]["answered_at"] is None
    assert client.post(f"{A}/{made.json()['id']}/answered", headers=auth("a_admin")).json() == {"answered": True}
    assert client.get(A, headers=auth("a_owner")).json()["items"] == []
    assert len(client.get(f"{A}?open=false", headers=auth("a_owner")).json()["items"]) == 1
    assert client.get(A, headers=auth("a_viewer")).status_code == 403 and client.post(A, json={"item": "xx", "source": "call"}, headers=auth("a_viewer")).status_code == 403
    assert client.post(A, json={"item": "x", "source": "call"}, headers=auth("a_owner")).status_code == 422
    assert client.post(A, json={"item": "a price", "source": "telepathy"}, headers=auth("a_owner")).status_code == 422


def test_the_fixed_sentence_is_the_owners_words_and_says_the_shop_will_get_back() -> None:
    assert MONEY_NOT_CONFIRMED["en"] == "I don't want to give you a wrong price. The shop will confirm the exact price and get back to you."
    assert MONEY_NOT_CONFIRMED["te"] == "తప్పు ధర చెప్పకూడదు. Exact ధర షాప్ వాళ్ళు confirm చేసి మీకు చెప్తారు."
    assert set(MONEY_NOT_CONFIRMED) == {"en", "te", "hi", "kn", "ta", "ml", "mr"}


def test_the_today_summary_has_a_price_asks_section_for_staff() -> None:
    import datetime as dt

    from app.bootstrap import today_summary as ts

    sections = {w.name: w for w in ts.wave1(dt.date(2026, 11, 15))}
    assert sections["price_asks"].path.startswith("/price-asks") and "viewer" not in sections["price_asks"].roles
