"""Job AY (ADR 0069): Agent OWL can FIND sarees in the catalogue and SEND up to four of their photos with a short caption. Both run under the caller's own token. Finding is a deterministic search (no
model, no vision) whose results are citable sources; the money in them is exactly what the database holds (a band in words; an exact price only if the Owner set one). Sending goes through the outbox
under the send policy: the tool decides nothing about it, names no phone, status, tenant or price, and a repeat of the same ask is the same message. The real stack is
tests/integration/test_catalogue_api.py; the policy is pgTAP 76 and 80."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.assistant.tools import (
    ACTION_TOOLS,
    READ_TOOLS,
    Ctx,
    FindCatalogueArgs,
    SendCatalogueArgs,
    State,
    find_catalogue_items,
    send_catalogue_items,
)
from app.crm.repository import ConflictError, InvalidReferenceError
from app.tenancy.repository import Forbidden
from tests.catalogue_fakes import FakeCatalogue, item_row, photo_row
from tests.outbox_fakes import FakeOutbox

TENANT = uuid.UUID(int=1)
RUN = uuid.UUID(int=2)
LEAD = uuid.UUID(int=3)
I1, I2, I3 = (str(uuid.UUID(int=n)) for n in (11, 12, 13))
P1, P2, P3 = (str(uuid.UUID(int=n)) for n in (21, 22, 23))


def make(catalogue: FakeCatalogue | None, outbox: FakeOutbox | None = None) -> Ctx:
    return Ctx(
        db=None,  # type: ignore[arg-type]
        runtime=SimpleNamespace(catalogue=catalogue, outbox=outbox),  # type: ignore[arg-type]
        token="caller-token",
        tenant=TENANT,
        run_id=RUN,
        state=State(),
    )


def stocked() -> FakeCatalogue:
    db = FakeCatalogue()
    db.items[I1] = item_row(
        I1,
        [photo_row(I1, P1, 1), photo_row(I1, "x" * 36, 2)],
        name="Maroon Kanchi pattu",
        colours=["maroon", "gold"],
        price_paise=None,
    )
    db.items[I2] = item_row(
        I2,
        [photo_row(I2, P2, 1)],
        name="Green Dharmavaram",
        fabric="dharmavaram_silk",
        price_band="10k_25k",
        price_paise=1_250_000,
        stock_status="few_left",
    )
    db.items[I3] = item_row(I3, [], name="No photo yet", active=False)
    return db


# ---------------------------------------------------------------------------------------------- find
def test_finding_sends_the_filters_as_the_databases_arguments_under_the_callers_token() -> None:
    db = stocked()
    out = find_catalogue_items(
        make(db),
        FindCatalogueArgs(
            fabric="kanchi_pattu",
            colour="maroon",
            occasion="wedding",
            price_band="25k_50k",
            in_stock=True,
        ),
    )
    assert out.note == "ok"
    token, sent = db.calls[0][1], db.calls[0][2]
    assert token == "caller-token"
    assert sent == {
        "p_fabric": "kanchi_pattu",
        "p_colours": ["maroon"],
        "p_occasions": ["wedding"],
        "p_price_bands": ["25k_50k"],
        "p_in_stock_only": True,
        "p_include_inactive": False,
        "p_limit": 6,
    }


def test_an_empty_ask_lists_the_active_items_and_each_is_a_citable_source_without_a_page() -> None:
    db = stocked()
    c = make(db)
    out = find_catalogue_items(c, FindCatalogueArgs())
    assert [i.label for i in out.items] == ["Maroon Kanchi pattu", "Green Dharmavaram"], (
        "the inactive one is not found"
    )
    assert all(i.type == "catalogue_item" and i.open is None for i in out.items)
    first = out.items[0]
    assert (
        first.fields["fabric"] == "Kanchi pattu"
        and first.fields["colours"] == "maroon, gold"
        and first.fields["price_band"] == "₹25,000 to ₹50,000"
    )
    assert (
        first.fields["price"] is None
        and first.fields["photos"] == 2
        and first.fields["stock"] == "In stock"
    )


def test_an_exact_price_is_given_in_rupees_and_only_that_amount_is_allowed_in_an_answer() -> None:
    db = stocked()
    c = make(db)
    out = find_catalogue_items(c, FindCatalogueArgs())
    green = out.items[1]
    assert green.fields["price"] == "₹12,500.00"
    assert c.state.allowed_paise == {1_250_000}, "the assistant may repeat this amount and no other"


def test_nothing_found_is_a_closed_note() -> None:
    assert (
        find_catalogue_items(make(FakeCatalogue()), FindCatalogueArgs(fabric="georgette")).note
        == "no_matching_items"
    )
    assert find_catalogue_items(make(None), FindCatalogueArgs()).note == "unavailable"


@pytest.mark.parametrize(
    "bad",
    [
        {"fabric": "x" * 25},
        {"colour": "y" * 13},
        {"occasion": "funeral"},
        {"price_band": "cheap"},
        {"tenant_id": "x"},
        {"limit": 100},
        {"include_inactive": True},
        {"price": 10},
    ],
)
def test_the_finder_takes_nothing_but_its_closed_filters(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        FindCatalogueArgs(**bad)


# ---------------------------------------------------------------------------------------------- send
def send_args(**over: Any) -> SendCatalogueArgs:
    base: dict[str, Any] = {
        "lead_id": LEAD,
        "item_ids": [uuid.UUID(I1), uuid.UUID(I2)],
        "language": "en",
        "caption": "Here are two sarees you may like.",
    }
    return SendCatalogueArgs(**{**base, **over})


def test_it_queues_one_message_with_each_items_cover_photo_through_the_outbox() -> None:
    db, box = stocked(), FakeOutbox()
    c = make(db, box)
    out = send_catalogue_items(c, send_args())
    assert out.note == "ok" and len(out.items) == 1 and out.items[0].type == "outbox_message"
    (call,) = [x for x in box.calls if x[0] == "outbox_submit"]
    assert call[1] == "caller-token", "under the caller's own rights"
    sent = call[2]
    assert sent["p_media"] == [P1, P2], "the COVER photo of each item, in the order asked"
    assert (
        sent["p_channel"],
        sent["p_category"],
        sent["p_source"],
        sent["p_body"],
        sent["p_language"],
    ) == ("whatsapp", "info", "assistant", "Here are two sarees you may like.", "en")
    assert (
        sent["p_model_flagged"] is False
        and sent["p_uncertain"] is False
        and sent["p_keep_record"] is False
    )
    assert sent["p_tenant_id"] == str(TENANT) and sent["p_lead_id"] == str(LEAD)
    assert out.items[0].open == ("outbox_message", uuid.UUID(sent["p_message_id"]))
    assert "2 photos" in out.items[0].label


def test_the_same_ask_twice_is_one_message_and_another_ask_another_one() -> None:
    box = FakeOutbox()
    send_catalogue_items(make(stocked(), box), send_args())
    send_catalogue_items(make(stocked(), box), send_args())
    send_catalogue_items(
        make(stocked(), box), send_args(caption="Another caption for the same two.")
    )
    ids = [c[2]["p_message_id"] for c in box.calls if c[0] == "outbox_submit"]
    assert ids[0] == ids[1] != ids[2]


def test_the_tool_decides_nothing_about_the_policy_and_names_no_price() -> None:
    for name in SendCatalogueArgs.model_fields:
        assert name in {"lead_id", "item_ids", "language", "caption"}
    for bad in (
        {"price": 5},
        {"status": "queued"},
        {"phone": "+00 1"},
        {"tenant_id": str(TENANT)},
        {"photo_ids": [P1]},
        {"media": [P1]},
    ):
        with pytest.raises(ValidationError):
            send_args(**bad)


@pytest.mark.parametrize(
    "override",
    [
        {"item_ids": []},
        {"item_ids": [uuid.UUID(int=n) for n in range(5)]},
        {"caption": "x"},
        {"caption": "y" * 301},
        {"language": "xx"},
    ],
)
def test_the_arguments_are_closed(override: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        send_args(**override)


def test_a_caption_not_in_the_stated_language_is_refused_before_anything_is_made() -> None:
    box = FakeOutbox()
    out = send_catalogue_items(make(stocked(), box), send_args(language="te"))
    assert out.note == "caption_not_in_the_stated_language" and box.calls == []


def test_an_item_that_is_gone_inactive_or_without_a_photo_is_a_closed_note_and_nothing_is_sent() -> (
    None
):
    db, box = stocked(), FakeOutbox()
    assert (
        send_catalogue_items(make(db, box), send_args(item_ids=[uuid.UUID(I3)])).note
        == "item_not_available"
    )
    db.items[I1]["active"] = False
    assert (
        send_catalogue_items(make(db, box), send_args(item_ids=[uuid.UUID(I1)])).note
        == "item_not_available"
    )
    assert (
        send_catalogue_items(make(db, box), send_args(item_ids=[uuid.UUID(int=999)])).note
        == "item_not_found"
    )
    assert [c for c in box.calls if c[0] == "outbox_submit"] == []


def test_the_databases_refusals_are_closed_notes() -> None:
    for error, note in (
        (Forbidden("42501"), "not_allowed_for_this_person"),
        (InvalidReferenceError("23503"), "not_found"),
        (ConflictError("23505"), "already_exists_with_other_details"),
    ):
        box = FakeOutbox()
        box.raise_next = error
        assert send_catalogue_items(make(stocked(), box), send_args()).note == note


def test_the_same_item_asked_twice_makes_one_photo() -> None:
    box = FakeOutbox()
    send_catalogue_items(make(stocked(), box), send_args(item_ids=[uuid.UUID(I1), uuid.UUID(I1)]))
    assert box.calls[0][2]["p_media"] == [P1]


def test_unavailable_when_the_catalogue_or_the_outbox_is_missing() -> None:
    assert send_catalogue_items(make(None, FakeOutbox()), send_args()).note == "unavailable"
    assert send_catalogue_items(make(stocked(), None), send_args()).note == "unavailable"


def test_the_tools_are_registered_one_read_one_action() -> None:
    assert "find_catalogue_items" in {t.name for t in READ_TOOLS if not t.action}
    send = next(t for t in ACTION_TOOLS if t.name == "send_catalogue_items")
    assert send.action is True, "it counts against the per-run limit on actions"


@pytest.mark.parametrize(
    ("said", "meant"),
    [("Kanjivaram", "kanchi_pattu"), ("kanchi pattu", "kanchi_pattu"), ("Soft Silk", "soft_silk"), ("dharmavaram", "dharmavaram_silk"), ("cotton-silk", "cotton_silk"), ("Benarasi", "banarasi")],
)
def test_common_names_of_a_fabric_are_matched_to_the_closed_list(said: str, meant: str) -> None:
    db = stocked()
    find_catalogue_items(make(db), FindCatalogueArgs(fabric=said))
    assert db.calls[0][2]["p_fabric"] == meant
