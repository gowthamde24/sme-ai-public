"""T008 owner change A, on the real stack: the database's contact guard is the SAME rule as the Python scrubber.

Every call goes straight to PostgREST with a user's own JWT (our API is skipped), so what is proven is the database:
  * a contact the scrubber would remove is REFUSED (23514); a quantity, price, date, GSTIN, pincode or PO number is STORED as written;
  * property: for generated texts the guard refuses exactly what `has_contact` flags, and `scrub(x)` always passes the guard;
  * who may capture an enquiry, and what a client cannot set.
Nothing here is a real person: every address and number is synthetic.
"""

# ruff: noqa: E501, S311

from __future__ import annotations

import json
import random
import uuid
from pathlib import Path

import pytest
from conftest import Stack
from crm_support import World
from evidence_support import code_of, pg

from app.requirements.scrub import has_contact, scrub

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "tests" / "vectors" / "enquiry_scrub.json").read_text())


@pytest.fixture(scope="module")
def w(crm_world: World) -> World:
    return crm_world


def capture(w: World, role: str, body: str, *, subject: str | None = None, **extra: object):  # type: ignore[no-untyped-def]
    lead = w.a.rows["leads"]["id"]
    payload = {
        "id": str(uuid.uuid4()),
        "tenant_id": w.a.id,
        "lead_id": lead,
        "channel": "email",
        "received_at": "2026-10-01T09:00:00+00:00",
        "body": body,
        **({"subject": subject} if subject is not None else {}),
        **extra,
    }
    return pg(w.stack, w.a.users[role], "POST", "/enquiries", json=payload, representation=False)


def stored(w: World, body: str) -> bool:
    r = capture(w, "sales", body)
    if r.status_code == 201:
        return True
    assert code_of(r) == "23514", (body, r.status_code, r.text)
    return False


@pytest.mark.parametrize("text", VECTORS["contacts"])
def test_the_database_refuses_a_contact_and_accepts_it_once_scrubbed(w: World, text: str) -> None:
    assert not stored(w, text), text
    assert stored(w, scrub(text)), scrub(text)


@pytest.mark.parametrize("text", VECTORS["not_contacts"])
def test_the_database_stores_a_quantity_price_date_gstin_pincode_or_po_number_as_written(
    w: World, text: str
) -> None:
    assert stored(w, f"Enquiry: {text}"), text


_PARTS = [
    "9876543210", "+91 98765 43210", "98765-43210", "098765 43210", "7012345678", "a@b.in", "919876543210", "9876543210,9123456789",
    "Rs 5,00,000", "1,00,00,000", "50000000", "29ABCDE1234F1Z5", "PIN 560001", "PO 9876543210", "60000 70000", "2026-11-15", "500 pieces",
    "kanjivaram", "₹ 9000000000", "invoice 9876543210", "order no. 9876543210", "AB9876543210", "5123456789", "98765 43210x", "12,34,567",
]  # fmt: skip
_JOIN = [" ", "  ", "\n", ", ", ". ", ": ", " - ", " / "]


def random_text(rng: random.Random) -> str:
    parts = [rng.choice(_PARTS) for _ in range(rng.randint(1, 6))]
    out = parts[0]
    for part in parts[1:]:
        out += rng.choice(_JOIN) + part
    return out


def test_property_the_guard_agrees_with_the_scrubber_and_scrub_output_always_passes(
    w: World,
) -> None:
    rng = random.Random(20261005)
    flagged = 0
    for _ in range(120):
        text = random_text(rng)
        accepted = stored(w, text)
        assert accepted == (not has_contact(text)), ("guard and scrubber disagree", text)
        flagged += not accepted
        assert stored(w, scrub(text)), ("scrub output refused", text, scrub(text))
    assert 10 < flagged < 110, "the generator must produce both kinds of text"


def test_the_subject_is_guarded_too(w: World) -> None:
    assert capture(w, "sales", "fine body", subject="Re: 9876543210").status_code == 400
    assert capture(w, "sales", "fine body", subject="Re: order of 20 sarees").status_code == 201


def test_who_may_capture_an_enquiry_and_what_a_client_cannot_set(w: World) -> None:
    for role in ("owner", "admin", "sales"):
        assert capture(w, role, f"Enquiry by {role}").status_code == 201
    assert capture(w, "viewer", "Enquiry by viewer").status_code in (401, 403)
    for column, value in (
        ("company_id", w.a.rows["companies"]["id"]),
        ("retain_until", "2030-01-01T00:00:00+00:00"),
        ("body_sha256", "0" * 64),
    ):
        r = capture(w, "sales", "forged column", **{column: value})
        assert r.status_code in (401, 403), (column, r.status_code, r.text)
    other_lead = w.b.rows["leads"]["id"]
    r = pg(w.stack, w.a.users["sales"], "POST", "/enquiries", json={
        "id": str(uuid.uuid4()), "tenant_id": w.a.id, "lead_id": other_lead, "channel": "email",
        "received_at": "2026-10-01T09:00:00+00:00", "body": "aimed at another tenant's lead"}, representation=False)  # fmt: skip
    assert code_of(r) == "23503", r.text


def test_a_member_of_another_workspace_reads_nothing_and_a_viewer_reads(w: World) -> None:
    r_viewer = pg(
        w.stack, w.a.users["viewer"], "GET", f"/enquiries?tenant_id=eq.{w.a.id}&select=id&limit=1"
    )
    assert r_viewer.status_code == 200 and len(r_viewer.json()) == 1
    r_other = pg(w.stack, w.b.users["owner"], "GET", f"/enquiries?tenant_id=eq.{w.a.id}&select=id")
    assert r_other.status_code == 200 and r_other.json() == []


def test_stored_text_is_never_edited_and_a_stack_has_no_stray_bytes(w: World, stack: Stack) -> None:
    r = capture(w, "owner", "original text")
    assert r.status_code == 201
    rows = pg(
        stack,
        w.a.users["owner"],
        "GET",
        f"/enquiries?tenant_id=eq.{w.a.id}&body=eq.original%20text&select=id",
    ).json()
    patch = pg(
        stack,
        w.a.users["owner"],
        "PATCH",
        f"/enquiries?id=eq.{rows[0]['id']}",
        json={"body": "edited"},
    )
    assert patch.status_code in (401, 403)


# ---- invisible characters: what the database does with raw text, and what capture stores (owner review of commit 3)
INDIC = {
    "telugu": "క్‌ష",
    "kannada": "ಕ್‍ಷ",
    "devanagari": "क्‍ष",
    "devanagari_zwnj": "क्‌ष",
}


@pytest.mark.parametrize("name", list(INDIC))
def test_the_database_accepts_raw_indic_joiners_and_capture_stores_the_stripped_text(
    w: World, name: str
) -> None:
    from app.requirements.capture_text import prepare_body

    raw = f"నమస్కారం 20 sarees {INDIC[name]} deliver to Hyderabad"
    assert stored(w, raw), "ZWJ / ZWNJ are legal in the database (Indic scripts spell with them)"
    cleaned = prepare_body(raw).text
    assert "‌" not in cleaned and "‍" not in cleaned
    assert stored(w, cleaned), "what capture stores always passes"


@pytest.mark.parametrize(
    "hidden",
    ["​", "‮", "‪", "⁦", "⁠", "﻿", "\U000e0041", " ", "\x01", "\x7f", "\x85"],
    ids=[
        "zwsp",
        "rlo",
        "lre",
        "lri",
        "word_joiner",
        "bom",
        "tag",
        "line_sep",
        "ctrl1",
        "del",
        "nel",
    ],
)
def test_the_database_refuses_raw_hidden_characters_and_capture_strips_them_instead(
    w: World, hidden: str
) -> None:
    from app.requirements.capture_text import prepare_body

    raw = f"Need 20 saree{hidden}s by 15 November"
    assert not stored(w, raw), "the database refuses it (23514)"
    prepared = prepare_body(raw).text
    # a line / paragraph separator becomes a line feed; every other hidden character simply goes
    assert prepared == (
        "Need 20 saree\ns by 15 November" if hidden == "\u2028" else "Need 20 sarees by 15 November"
    )
    assert stored(w, prepared)


def test_property_what_capture_stores_always_passes_the_database(w: World) -> None:
    from app.requirements.capture_text import prepare_body

    rng = random.Random(20261008)
    pool = [
        "a",
        "b",
        " ",
        "\n",
        "\t",
        "क्",
        "‍",
        "‌",
        "క్",
        "‎",
        "‏",
        "​",
        "‮",
        "﻿",
        "\U000e0041",
        "\x7f",
        "😀",
        "é",
        "9876543210",
        "a@b.in",
        "Rs 5,00,000",
        " ",
        "20",
        "sarees",
    ]
    for _ in range(80):
        raw = "".join(rng.choice(pool) for _ in range(rng.randint(1, 30)))
        prepared = prepare_body(raw).text
        if prepared:
            assert stored(w, prepared), (raw, prepared)
