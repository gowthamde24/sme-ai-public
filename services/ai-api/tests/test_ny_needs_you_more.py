"""Needs you gains three kinds (migration 20261228100000; C2's requests on the owner's list, 4 Nov 2026), and a kind the API does not know yet is LEFT OUT instead of failing the whole Today (the lesson of the
same day: a model that knew one plan made a workspace's page answer 500)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.today.service import needs_item, needs_items, shape_today

T = str(uuid.UUID(int=0xA))


def row(kind: str, ref: str, amount: int | None, target: str, customer: str | None = "Sri Sai Builders") -> dict[str, Any]:
    return {"kind": kind, "id": str(uuid.uuid4()), "customer": customer, "city": "Anantapur", "agent": "quote_writer" if kind == "material_quote_approval" else "followup_desk", "ref": ref,
            "amount_paise": amount, "at": "2026-11-04T10:00:00Z", "target": {"type": target, "id": str(uuid.uuid4())}}


def test_a_draft_materials_quote_reads_like_a_quote() -> None:
    item = needs_item(row("material_quote_approval", "7", 4200000, "material_quote"))
    assert item.summary == "Materials quote 7 for ₹42,000.00 is ready for your approval." and item.target.type == "material_quote" and item.customer == "Sri Sai Builders"


def test_a_draft_campaign_says_what_it_is_and_that_nothing_is_sent() -> None:
    item = needs_item(row("campaign_approval", "fee_due", None, "campaign", customer="Term 2 fee reminder"))
    assert item.summary == "A fee reminder is drafted and waiting for your approval. Nothing is sent before you approve it."
    assert needs_item(row("campaign_approval", "something_new", None, "campaign")).summary.startswith("A message campaign is drafted")


def test_a_schools_overdue_fees_are_a_count_and_a_total_never_a_name() -> None:
    item = needs_item(row("fees_overdue", "3", 1250000, "fees", customer=None))
    assert item.customer == "Fees due" and item.summary == "Fees are overdue on 3 fee accounts: ₹12,500.00 in all. The fee list shows whose."
    assert needs_item(row("fees_overdue", "1", 500000, "fees", customer=None)).summary.startswith("Fees are overdue on 1 fee account:")


def test_a_kind_the_api_does_not_know_is_left_out_and_today_still_answers() -> None:
    rows = [row("quote_approval", "4", 100000, "quote"), row("a_kind_from_the_future", "x", None, "quote"), row("fees_overdue", "2", 7500, "fees", customer=None),
            {**row("quote_approval", "5", 1, "quote"), "target": {"type": "somewhere_new", "id": str(uuid.uuid4())}}]
    assert [i.kind for i in needs_items(rows)] == ["quote_approval", "fees_overdue"]
    today = shape_today({"cards": {"waiting": 4, "money_held_paise": 0, "orders_open": 0}, "needs_you": rows, "recent": []})
    assert [i.kind for i in today.needs_you] == ["quote_approval", "fees_overdue"]
