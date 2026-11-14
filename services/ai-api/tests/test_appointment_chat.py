"""Booking a visit by WhatsApp (appointment booking, 14 Nov 2026): what the customer's message is, what is asked of the database and the fixed words that come back. The database's rules are pgTAP 210 and 211."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.autoreply.booking import BookingFlow
from app.visits import booking_texts as bt

TENANT, LEAD, ENQ = uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3)
T1 = datetime(2026, 11, 3, 5, 30, tzinfo=UTC)   # 11:00 India time
T2 = datetime(2026, 11, 3, 6, 0, tzinfo=UTC)


class FakeBooking:
    def __init__(self, **answers: Any) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.a = {"offer": {"offer_id": str(uuid.uuid4()), "offered": [{"n": 1, "starts_at": T1.isoformat()}, {"n": 2, "starts_at": T2.isoformat()}], "reason": None},
                  "choice": {"status": "booked", "starts_at": T1.isoformat(), "moved": False}, "cancel": {"status": "cancelled"}, "next": {"visit_id": None}, **answers}

    def offer_slots(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, language: str, visit: uuid.UUID | None) -> dict[str, Any]:
        self.calls.append(("offer", (language, visit)))
        return self.a["offer"]  # type: ignore[no-any-return]

    def book_choice(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, choice: int, visit_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("choice", (choice, visit_id)))
        return self.a["choice"]  # type: ignore[no-any-return]

    def cancel(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("cancel", None))
        return self.a["cancel"]  # type: ignore[no-any-return]

    def next_visit(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("next", None))
        return self.a["next"]  # type: ignore[no-any-return]


def item(text: str) -> dict[str, Any]:
    return {"tenant_id": str(TENANT), "lead_id": str(LEAD), "enquiry_id": str(ENQ), "text": text}


def flow(**answers: Any) -> tuple[BookingFlow, FakeBooking]:
    repo = FakeBooking(**answers)
    return BookingFlow(repo), repo


def test_a_message_about_booking_gets_the_free_times_numbered() -> None:
    f, repo = flow()
    r = f.handle("tok", item("I want to book an appointment"))
    assert r is not None and r.language == "en" and not r.hold and r.gloss_en is None
    assert "1) Tuesday, 3 November at 11:00 am" in r.text and "2) Tuesday, 3 November at 11:30 am" in r.text and "Reply with the number" in r.text
    assert repo.calls == [("next", None), ("offer", ("en", None))]


def test_other_messages_are_left_to_the_usual_reply() -> None:
    f, repo = flow()
    for text in ("what is the price of a silk saree?", "thank you", "", "   ", "ok 5 pieces please"):
        assert f.handle("tok", item(text)) is None, text
    assert repo.calls == []
    assert f.handle("tok", {**item("book"), "lead_id": None}) is None


def test_a_number_books_the_offered_time_once_per_message() -> None:
    f, repo = flow()
    r = f.handle("tok", item("2"))
    assert r is not None and r.text.startswith("Done. Your visit is booked for Tuesday, 3 November at 11:00 am")
    (_, (choice, visit_id)), = repo.calls
    assert choice == 2 and visit_id == uuid.uuid5(uuid.NAMESPACE_URL, f"sme-ai-appointment:{TENANT}:{LEAD}:{ENQ}")
    for text in (" 3. ", "3)", "1"):
        assert f.handle("tok", item(text)) is not None


def test_a_number_with_no_offer_is_an_ordinary_message() -> None:
    f, _ = flow(choice={"status": "no_offer"})
    assert f.handle("tok", item("2")) is None
    f2, _ = flow(choice={"status": "bad_choice"})
    assert f2.handle("tok", item("9")) is None


def test_a_time_that_was_just_taken_offers_new_ones() -> None:
    f, repo = flow(choice={"status": "taken"})
    r = f.handle("tok", item("1"))
    assert r is not None and r.text.startswith("Sorry, that time was just taken") and "1) " in r.text
    assert [c[0] for c in repo.calls] == ["choice", "next", "offer"]


def test_nothing_free_says_so_and_a_person_follows() -> None:
    f, _ = flow(offer={"offer_id": None, "offered": [], "reason": "no_free_slot"})
    r = f.handle("tok", item("book a slot"))
    assert r is not None and r.text.startswith("Sorry, there is no free time")


def test_when_the_owner_has_not_switched_booking_on_nothing_changes() -> None:
    f, _ = flow(offer={"offer_id": None, "offered": [], "reason": "off"})
    assert f.handle("tok", item("book")) is None


def test_reschedule_needs_a_visit_and_moves_that_one() -> None:
    f, repo = flow()
    r = f.handle("tok", item("RESCHEDULE"))
    assert r is not None and r.text.startswith("I could not find a visit")
    visit = uuid.uuid4()
    f2, repo2 = flow(**{"next": {"visit_id": str(visit), "starts_at": T1.isoformat()}})
    r2 = f2.handle("tok", item("Reschedule please"))
    assert r2 is not None and "1) " in r2.text and repo2.calls == [("next", None), ("offer", ("en", visit))]
    f3, _ = flow(choice={"status": "booked", "starts_at": T2.isoformat(), "moved": True})
    r3 = f3.handle("tok", item("1"))
    assert r3 is not None and r3.text.startswith("Done. Your visit is moved to")


def test_a_second_booking_request_tells_them_about_the_first() -> None:
    f, repo = flow(**{"next": {"visit_id": str(uuid.uuid4()), "starts_at": T1.isoformat()}})
    r = f.handle("tok", item("I want to book"))
    assert r is not None and r.text.startswith("You already have a visit on Tuesday, 3 November at 11:00 am") and repo.calls == [("next", None)]


def test_cancel_cancels_their_own_visit() -> None:
    f, _ = flow()
    r = f.handle("tok", item("cancel"))
    assert r is not None and r.text.startswith("Your visit is cancelled")
    f2, _ = flow(cancel={"status": "no_visit"})
    r2 = f2.handle("tok", item("CANCEL my booking"))
    assert r2 is not None and r2.text.startswith("I could not find a visit")


def test_telugu_is_a_draft_that_waits_for_a_person_and_carries_an_english_gloss() -> None:
    f, _ = flow()
    r = f.handle("tok", item("అపాయింట్‌మెంట్ బుక్ చేయాలి"))
    assert r is not None and r.language == "te" and r.hold is True and r.gloss_en is not None and r.gloss_en.startswith("These times are free")
    assert "1) మంగళవారం, 3 నవంబర్" in r.text


def test_every_language_has_every_message_and_names_no_place_or_price() -> None:
    place = ("shop", "store", "showroom", "షాపు", "దుకాణ", "दुकान", "ಅಂಗಡಿ")
    assert set(bt.TEMPLATES) == {"en", "te", "hi", "kn"}
    for language, words in bt.TEMPLATES.items():
        assert set(words) == set(bt.TEMPLATES["en"]), language
        for kind, text in words.items():
            assert not any(p in text.casefold() for p in place), (language, kind)
            assert ("{list}" in text) == ("{list}" in bt.TEMPLATES["en"][kind]) and ("{when}" in text) == ("{when}" in bt.TEMPLATES["en"][kind]), (language, kind)


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn"])
def test_every_message_renders(language: str) -> None:
    for kind in bt.TEMPLATES["en"]:
        text = bt.render(kind, language, starts_at=T1, slots=[T1, T2])  # type: ignore[arg-type]
        assert text and "{" not in text
