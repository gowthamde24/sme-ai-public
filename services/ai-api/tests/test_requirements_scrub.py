"""T008 owner change A: the contact scrubber is conservative, and the database guard is the same pattern.

* the contacts in tests/vectors/enquiry_scrub.json are removed; the non-contacts (comma-grouped amounts, Rs / INR / rupee amounts,
  quantities, dates, GSTINs, pincodes, PO / order / invoice numbers, two round numbers) come back byte for byte;
* property: scrub(x) never holds a contact, is idempotent, and leaves the rest of a text alone;
* the two regular expressions are installed in the migration verbatim (the database guard cannot drift from this file);
* the integration test tests/integration/test_enquiries_guard.py runs the same vectors and the property through the real database.
"""

# ruff: noqa: E501, S311

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from app.requirements.scrub import CONTACT_MARKER, EMAIL_PATTERN, PHONE_PATTERN, has_contact, scrub

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "tests" / "vectors" / "enquiry_scrub.json").read_text())


@pytest.mark.parametrize("text", VECTORS["contacts"])
def test_a_contact_is_removed(text: str) -> None:
    assert has_contact(text)
    out = scrub(text)
    assert CONTACT_MARKER in out
    assert not has_contact(out)


@pytest.mark.parametrize("text", VECTORS["not_contacts"])
def test_a_quantity_price_date_gstin_pincode_or_po_number_is_never_altered(text: str) -> None:
    assert not has_contact(text)
    assert scrub(text) == text


def test_the_named_cases_of_the_owner() -> None:
    for text in ["1,00,00,000", "Rs 5,00,000", "50000000", "29ABCDE1234F1Z5", "PIN 560001"]:
        assert scrub(f"order {text} please") == f"order {text} please"


def test_only_the_contact_changes_inside_a_longer_text() -> None:
    text = "Hi, need 500 pieces by 2026-11-15 at Rs 4,500 each (GSTIN 29ABCDE1234F1Z5). Call 98765 43210 or mail a@b.in. PIN 560001."
    assert scrub(text) == (
        "Hi, need 500 pieces by 2026-11-15 at Rs 4,500 each (GSTIN 29ABCDE1234F1Z5). "
        f"Call {CONTACT_MARKER} or mail {CONTACT_MARKER}. PIN 560001."
    )


_CONTACT_PARTS = [
    "9876543210", "+91 98765 43210", "98765-43210", "098765 43210", "91 9876543210", "7012345678", "a@b.in", "x.y+z@mail.example.co",
    "9876543210,9123456789", "9876543210/9123456789", "919876543210",
]  # fmt: skip
_PLAIN_PARTS = [
    "Rs 5,00,000", "1,00,00,000", "50000000", "29ABCDE1234F1Z5", "PIN 560001", "PO 9876543210", "60000 70000", "2026-11-15", "500 pieces",
    "kanjivaram", "by Diwali", "₹ 9000000000", "invoice 9876543210", "12 sarees", "order no. 9876543210",
]  # fmt: skip
_JOINERS = [" ", "  ", "\n", ", ", ". ", ": ", " - ", " / ", "; "]


def _random_text(rng: random.Random) -> str:
    parts = [rng.choice(_CONTACT_PARTS + _PLAIN_PARTS) for _ in range(rng.randint(1, 8))]
    out = parts[0]
    for part in parts[1:]:
        out += rng.choice(_JOINERS) + part
    return out


def test_property_scrub_output_never_holds_a_contact_and_is_stable() -> None:
    rng = random.Random(20261005)
    for _ in range(3000):
        text = _random_text(rng)
        out = scrub(text)
        assert not has_contact(out), (text, out)
        assert scrub(out) == out, (text, out)


def test_property_plain_texts_are_untouched() -> None:
    rng = random.Random(7)
    for _ in range(3000):
        parts = [rng.choice(_PLAIN_PARTS) for _ in range(rng.randint(1, 8))]
        text = rng.choice(_JOINERS).join(parts)
        assert scrub(text) == text, text


def test_the_database_guard_uses_exactly_these_patterns() -> None:
    # the LATEST definition of app.text_has_contact among the T008 migrations is the one in force
    migrations = sorted((ROOT / "supabase" / "migrations").glob("202610150*_t008_*.sql"))
    body = ""
    for path in migrations:
        text = path.read_text()
        start = text.find("function app.text_has_contact")
        while start != -1:
            end = text.index("$$;", text.index("as $$", start))
            body = text[start:end]
            start = text.find("function app.text_has_contact", end)
    assert body, "no definition of app.text_has_contact found"
    assert f"p ~* '{EMAIL_PATTERN}'" in body
    assert f"p ~* '{PHONE_PATTERN}'" in body
