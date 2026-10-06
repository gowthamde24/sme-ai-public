"""T010 part 1 (ADR 0020): the HMAC of a contact's identifiers (app/suppression/keys.py). Normalisation is pinned by VECTORS (including what is deliberately NOT collapsed), the HMAC by a
known-answer vector computed here with the standard library, and the key ring by its refusals. All values are synthetic."""

from __future__ import annotations

import hashlib
import hmac
import random
import re

import pytest

from app.suppression.keys import KeyRing, KeyVersion, normalise_email, normalise_phone

KEY = b"synthetic-test-key-0123456789"
OTHER = b"synthetic-test-key-9876543210"
RING = KeyRing(KeyVersion(1, KEY))


# ------------------------------------------------------------------------------------------ e-mail
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Buyer@Example.TEST", "buyer@example.test"),
        ("  buyer@example.test \n", "buyer@example.test"),
        ("buyer＠example.test", "buyer@example.test"),  # a full-width @ (NFKC)
        ("ＢＵＹＥＲ@example.test", "buyer@example.test"),  # full-width letters (NFKC)
        # NOT collapsed: a plus-tag, dots and sub-addressing are different keys (over-matching would suppress real people)
        ("buyer+sales@example.test", "buyer+sales@example.test"),
        ("b.u.yer@example.test", "b.u.yer@example.test"),
    ],
)
def test_email_normalisation_is_conservative(raw: str, expected: str) -> None:
    assert normalise_email(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "   ",
        "no-at-sign",
        "two@@example.test",
        "a@b@example.test",
        "@example.test",
        "buyer@nodot",
        "bu yer@example.test",
        "buyer@exa mple.test",
    ],
)
def test_a_string_that_is_not_an_address_has_no_key(raw: str | None) -> None:
    assert normalise_email(raw) is None
    assert RING.key_for("email", raw) is None


# ------------------------------------------------------------------------------------------ phone
@pytest.mark.parametrize(
    "raw",
    [
        "+91 98765 43210",
        "+919876543210",
        "919876543210",
        "00919876543210",
        "098765 43210",
        "098765-43210",
        "(98765) 43210",
        "98765 43210",
        "+91-98765-43210",
        "9876543210",
    ],
)
def test_one_indian_mobile_written_ten_ways_is_one_number(raw: str) -> None:
    assert normalise_phone(raw) == "9876543210"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+1 415 555 0100", "14155550100"),  # another country keeps its digits (no guessing)
        (
            "+00 90000 00001",
            "9000000001",
        ),  # the synthetic reserved range: its call prefix (00) goes
        ("0044 20 7946 0958", "442079460958"),
        ("0123", "123"),  # leading zeros of a short number go
    ],
)
def test_other_numbers_keep_their_digits_without_leading_zeros(raw: str, expected: str) -> None:
    assert normalise_phone(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "abc", "+--", "12", "00", "0" * 6, "1" * 33])
def test_a_number_that_is_too_short_too_long_or_not_digits_has_no_key(raw: str | None) -> None:
    assert normalise_phone(raw) is None
    assert RING.key_for("phone", raw) is None


def test_the_phone_of_a_number_and_of_its_formatting_noise_agree_in_a_property() -> None:
    rng = random.Random(7)
    for _ in range(300):
        ten = str(rng.choice("6789")) + "".join(rng.choice("0123456789") for _ in range(9))
        forms = [
            f"+91 {ten[:5]} {ten[5:]}",
            f"0{ten}",
            f"91{ten}",
            f"0091{ten}",
            f"({ten[:3]}) {ten[3:6]}-{ten[6:]}",
            ten,
        ]
        assert {RING.key_for("phone", f) for f in forms} == {RING.key_for("phone", ten)}


# ------------------------------------------------------------------------------------------ the HMAC
def test_the_key_is_the_documented_hmac_computed_independently() -> None:
    expected = hmac.new(KEY, b"email:buyer@example.test", hashlib.sha256).hexdigest()
    assert RING.key_for("email", "Buyer@Example.test") == expected
    assert (
        RING.key_for("phone", "+91 98765 43210")
        == hmac.new(KEY, b"phone:9876543210", hashlib.sha256).hexdigest()
    )
    assert re.fullmatch(r"[0-9a-f]{64}", expected)
    # a golden vector: a change of the construction is a reviewed act (the stored keys of every contact would stop matching)
    assert expected == "6ab2d4f7b47dada2c266375594f2fc6edbe4095d25bafc5cb5e1582dc1a5592f"
    assert (
        RING.key_for("phone", "9876543210")
        == "7ca6825ae0b78bc64b4cd3260e06e1275f0ac52e6689d9529ee7b58f9b0321fd"
    )


def test_a_different_key_or_kind_or_identifier_gives_a_different_key() -> None:
    other = KeyRing(KeyVersion(1, OTHER))
    a = RING.key_for("email", "buyer@example.test")
    assert a != other.key_for("email", "buyer@example.test")
    assert a != RING.key_for("email", "buyer2@example.test")
    assert RING._digest(RING.current, "email", "x") != RING._digest(
        RING.current, "phone", "x"
    )  # the kind is part of the input
    assert a == RING.key_for(
        "email", " BUYER@example.test "
    )  # and the same address always gives the same key


def test_a_key_never_shows_in_a_representation() -> None:
    for shown in (repr(RING), str(RING), repr(RING.current), str(RING.current)):
        assert "synthetic-test-key" not in shown and "<hidden>" in repr(RING.current)


# ------------------------------------------------------------------------------------------ the ring
@pytest.mark.parametrize("version", [0, -1, 33, 100])
def test_a_version_outside_1_to_32_is_refused(version: int) -> None:
    with pytest.raises(ValueError):
        KeyRing(KeyVersion(version, KEY))


def test_a_short_key_is_refused() -> None:
    with pytest.raises(ValueError):
        KeyRing(KeyVersion(1, b"short"))
    with pytest.raises(ValueError):
        KeyRing(KeyVersion(1, KEY), KeyVersion(2, b"short"))


def test_a_previous_key_must_differ_in_version_and_in_key() -> None:
    with pytest.raises(ValueError):
        KeyRing(KeyVersion(1, KEY), KeyVersion(1, OTHER))
    with pytest.raises(ValueError):
        KeyRing(KeyVersion(2, KEY), KeyVersion(1, KEY))
    KeyRing(KeyVersion(2, KEY), KeyVersion(1, OTHER))


def test_keys_of_records_the_current_version_and_offers_the_previous_for_matching_only() -> None:
    ring = KeyRing(KeyVersion(2, KEY), KeyVersion(1, OTHER))
    keys, also = ring.keys_of("Buyer@Example.test", "+91 98765 43210")
    assert keys == {
        "version": 2,
        "email": ring.key_for("email", "buyer@example.test"),
        "phone": ring.key_for("phone", "9876543210"),
    }
    assert also == {
        "email": [ring.previous_key_for("email", "buyer@example.test")],
        "phone": [ring.previous_key_for("phone", "9876543210")],
    }
    assert also["email"][0] != keys["email"]
    assert ring.match_keys("buyer@example.test", None) == {
        "email": [keys["email"], also["email"][0]]
    }


def test_an_identifier_that_cannot_be_normalised_has_no_key_and_does_not_hide_the_other() -> None:
    keys, also = RING.keys_of("not an address", "+91 98765 43210")
    assert set(keys) == {"version", "phone"} and also == {}
    assert RING.has_keys(keys) is True
    none, _ = RING.keys_of(None, "ab")
    assert RING.has_keys(none) is False
