"""List-price quotes through the API are BYTE-IDENTICAL after manual quotes were added (manual-price quote, slice 3).

The file tests/golden/quotes_list_api_output.json was captured from the API BEFORE any change of slice 3 (the code of slice 2): the raw response bodies of
reading a draft, listing, approving, reading the approved quote and its customer text, for a list-price quote built from the synthetic fixtures. This test
replays the same calls and compares the raw bytes, key order included. A new optional field must not appear in a list-price quote's output: the fields that
only a manual quote needs (`pricing_kind`, `price_source`, `item_type_code`) are left out of a list quote's JSON. The one value that differs between runs, the
approver's id (a fresh test token each time), is replaced by a fixed word before comparing.

The clock is FROZEN at 2026-10-09 12:00 UTC (17:30 in India) while the calls are made: a quote is dated "today in India" and valid for 15 days, and the capture was made
on 2026-10-09, so without a frozen clock this test failed on every other day.

Job AD (D3b, deliberate): the two LISTS (`list_all`, `list_enquiry`) gained `customer` and `city` (the lead's company name and city, for the quotes screen); the golden was
regenerated for exactly those two and every other body is byte-identical to the slice-2 capture."""

# ruff: noqa: E501

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, tzinfo
from pathlib import Path
from typing import Any
from unittest import mock

from app.quotes import builder
from tests.fakes import auth
from tests.quotes_fakes import ENQ, QID
from tests.test_quotes_routes import World

GOLDEN = Path(__file__).parent / "golden" / "quotes_list_api_output.json"
FROZEN_NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz: tzinfo | None = None) -> _FrozenDatetime:
        return cls.fromtimestamp(FROZEN_NOW.timestamp(), tz or UTC)


@contextmanager
def frozen_clock() -> Iterator[None]:
    """`today_ist` (the only clock a quote's dates come from) reads this module's `datetime`."""
    with mock.patch.object(builder, "datetime", _FrozenDatetime):
        yield


def capture() -> dict[str, str]:
    with frozen_clock():
        return _capture()


def _capture() -> dict[str, str]:
    w = World()
    out: dict[str, str] = {}

    def keep(name: str, response: Any) -> None:
        out[name] = re.sub(
            r'"approved_by":"[0-9a-f-]{36}"', '"approved_by":"<user>"', response.text
        )

    keep("create", w.draft())
    keep("get_draft", w.client.get(w.url(f"/quotes/{QID}"), headers=auth("a_sales")))
    keep("list_all", w.client.get(w.url("/quotes"), headers=auth("a_owner")))
    keep("list_enquiry", w.client.get(w.url(f"/enquiries/{ENQ}/quotes"), headers=auth("a_admin")))
    approve = w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    keep("approve", approve)
    keep("get_approved", w.client.get(w.url(f"/quotes/{QID}"), headers=auth("a_sales")))
    keep("text", w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales")))
    return out


def test_a_list_price_quote_reads_exactly_as_it_did_before_manual_quotes() -> None:
    got = capture()
    if (
        os.environ.get("UPDATE_GOLDEN") == "1"
    ):  # only ever run on code that is known to be the old behaviour
        GOLDEN.write_text(json.dumps(got, indent=1, sort_keys=True) + "\n")
    expected = json.loads(GOLDEN.read_text())
    assert sorted(got) == sorted(expected)
    for name in sorted(expected):
        assert got[name] == expected[name], f"{name}: the raw response body changed"
