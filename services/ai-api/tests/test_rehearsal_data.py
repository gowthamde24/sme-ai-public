"""The rehearsal data is invented and consistent: the hand-worked figures add up."""

from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parents[3] / "tests" / "rehearsal" / "data"
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"\+?\d[\d ()-]{7,}\d")


def _json(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((DATA / name).read_text())
    return data


def test_hand_worked_quotes_add_up() -> None:
    prices = {  # rupees, from price_list.csv by hand: (unit, break_unit)
        "Q1": 12 * 4000,
        "Q2": 6 * 3100,
        "Q2b": 6 * 3100,
        "Q3": 5 * 4200,
        "Q4": 20 * 2950,
        "Q5": 4 * 4200 + 10 * 2650,
        "Q6": 8 * 4200,
        "Q7": 170 * 4000,
    }
    for key, q in _json("expected.json")["quotes"].items():
        assert key in prices, key
        assert q["subtotal_paise"] == prices[key] * 100, key
        assert q["tax_paise"] * 20 == q["subtotal_paise"], key  # 5 per cent
        assert q["total_paise"] == q["subtotal_paise"] + q["tax_paise"], key
        advance_bps = 2500 if q["owner_only"] else 5000
        assert q["advance_paise"] * 10000 == q["total_paise"] * advance_bps, key


def test_price_list_matches_the_seed_shape() -> None:
    rows = list(csv.DictReader(io.StringIO((DATA / "price_list.csv").read_text())))
    assert len(rows) == 5
    assert {r["tax_bps"] for r in rows} == {"500"} and {r["moq"] for r in rows} == {"4"}
    assert all(r["sku"].startswith("SYN-") for r in rows)


def test_enquiries_point_at_csv_lines_and_carry_no_contact_details() -> None:
    lines = (DATA / "leads.csv").read_text().splitlines()
    enquiries = _json("enquiries.json")["enquiries"]
    assert len(enquiries) == 9
    quotes = _json("expected.json")["quotes"]
    for e in enquiries:
        assert 2 <= e["lead_line"] <= len(lines)
        assert not EMAIL.search(e["text"]) and not PHONE.search(e["text"])
        if e["quote"]:
            assert e["quote"] in quotes and quotes[e["quote"]]["enquiry"] == e["key"]
    assert len({e["lead_line"] for e in enquiries}) == 9


def test_every_email_and_phone_is_invented() -> None:
    text = (DATA / "leads.csv").read_text() + (DATA / "setup.json").read_text()
    for address in EMAIL.findall(text):
        assert address.lower().rsplit(".", 1)[-1] in {"com", "org", "net", "test"}
        assert "example" in address.lower() or "not-an-email" in address, address
    for number in re.findall(r"\+[\d -]{8,}", text):
        assert number.startswith("+00"), number
