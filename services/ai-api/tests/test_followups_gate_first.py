"""T010 part 2, commit 4c (unit): the gate and the stops come BEFORE the engine in the lead page and the due list. Called directly (no HTTP): the pure rules of `app.followups.service`."""

from __future__ import annotations

import dataclasses
import uuid
from typing import Any

import pytest

from app.errors import ApiError
from app.followups import cadence_port, service
from app.tenancy.repository import UpstreamError
from tests.followups_fakes import DRAFT, LEAD, NOW, FakeFollowups, draft_row, snapshot, touch_row

TENANT = uuid.UUID(int=0x7E7)
OTHER = uuid.UUID(int=0x2EAD)


def page(f: FakeFollowups, channel: str | None = "email") -> Any:
    out = service.lead_followup(f, "tok", TENANT, LEAD, channel, now=NOW)
    assert out is not None
    return out


def test_the_public_gate_never_says_erased_key() -> None:
    assert (
        service.public_gate({"blocked": "erased_key", "stopped": None, "policy_in_force": True})[
            "blocked"
        ]
        == "key"
    )
    for word in (None, "contact", "key", "erased", "consent", "unkeyed"):
        assert service.public_gate(
            {"blocked": word, "stopped": "order_accepted", "policy_in_force": False}
        ) == {
            "blocked": word,
            "stopped": "order_accepted",
            "policy_in_force": False,
        }


def test_the_two_overrides_say_no_engine_made_them() -> None:
    stopped, blocked = (
        service.stopped_decision("order_cancelled"),
        service.blocked_decision("consent"),
    )
    assert (stopped.action, stopped.reason_code, stopped.terminal, stopped.engine_version) == (
        "stop",
        "order_cancelled",
        True,
        "none",
    )
    assert (blocked.action, blocked.reason_code, blocked.terminal, blocked.engine_version) == (
        "stop",
        "consent",
        False,
        "none",
    )
    assert (
        stopped.touch_number is None
        and blocked.touch_number is None
        and stopped.next_eligible_at is None
        and blocked.next_eligible_at is None
    )


def test_precedence_is_stop_then_block_then_the_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    f = FakeFollowups()
    assert page(f).decision.action == "draft_followup"  # nothing in the way: the engine's answer
    f.blocked_leads[(LEAD, "email")] = "contact"
    assert (page(f).decision.action, page(f).decision.reason_code) == ("stop", "contact")
    f.stopped_leads[LEAD] = "lead_archived"
    assert page(f).decision.reason_code == "lead_archived"  # the stop wins over the block

    def not_asked(request: Any) -> Any:
        raise AssertionError("the engine must not be asked")

    monkeypatch.setattr(cadence_port, "run_decide", not_asked)
    assert (
        page(f).decision.reason_code == "lead_archived"
    )  # and the engine is never consulted for either
    f.stopped_leads.clear()
    assert page(f).decision.reason_code == "contact"


def test_a_block_for_one_channel_leaves_the_other_open() -> None:
    f = FakeFollowups()
    f.blocked_leads[(LEAD, "whatsapp")] = "key"
    assert page(f, "whatsapp").decision.reason_code == "key"
    assert page(f, "email").decision.action == "draft_followup"


def test_the_due_list_leaves_out_stopped_and_fully_blocked_leads_and_keeps_the_rest() -> None:
    f = FakeFollowups()
    third = uuid.UUID(int=0x3EAD)
    for lead in (OTHER, third):
        f.snapshots[lead] = dataclasses.replace(snapshot(), lead_id=str(lead))
    f.outbound_leads = [LEAD, OTHER, third]
    f.stopped_leads[LEAD] = "order_declined"
    f.blocked_leads[(OTHER, "email")] = "erased"
    f.blocked_leads[(OTHER, "whatsapp")] = "erased"
    assert [str(i.lead_id) for i in service.due_list(f, "tok", TENANT, now=NOW).items] == [
        str(third)
    ]
    f.blocked_leads[(OTHER, "email")] = (
        "key"  # blocked on e-mail only: still listed (WhatsApp is open)
    )
    f.blocked_leads.pop((OTHER, "whatsapp"))
    f.stopped_leads.clear()
    assert [str(i.lead_id) for i in service.due_list(f, "tok", TENANT, now=NOW).items] == [
        str(LEAD),
        str(OTHER),
        str(third),
    ]
    f.blocked_leads.clear()
    assert len(service.due_list(f, "tok", TENANT, now=NOW).items) == 3


def test_a_phone_only_lead_is_listed_on_whatsapp_and_one_row_carries_both_channels() -> None:
    f = FakeFollowups()
    f.drafts.clear()  # the fake starts with one open e-mail draft; this lead has none
    f.blocked_leads[(LEAD, "email")] = "unkeyed"  # no e-mail address, so no e-mail key
    f.last_out_channel[LEAD] = "whatsapp"
    (item,) = service.due_list(f, "tok", TENANT, now=NOW).items
    assert (item.action, item.reason_code, item.default_channel) == (
        "draft_followup",
        "eligible_now",
        "whatsapp",
    )
    assert [(c.channel, c.blocked) for c in item.channels] == [
        ("email", "unkeyed"),
        ("whatsapp", None),
    ]
    assert item.open_draft_channel is None


def test_a_gate_that_says_erased_key_reaches_no_channel_state() -> None:
    f = FakeFollowups()
    f.blocked_leads[(LEAD, "whatsapp")] = "erased_key"
    out = page(f)
    assert [(c.channel, c.blocked) for c in out.channels] == [("email", None), ("whatsapp", "key")]
    (item,) = service.due_list(f, "tok", TENANT, now=NOW).items
    assert "erased_key" not in item.model_dump_json() and "erased_key" not in out.model_dump_json()


def test_an_erased_marker_on_the_email_gate_reads_key_in_the_due_row_too() -> None:
    f = FakeFollowups()
    f.blocked_leads[(LEAD, "email")] = "erased_key"
    (item,) = service.due_list(f, "tok", TENANT, now=NOW).items
    assert [(c.channel, c.blocked) for c in item.channels] == [("email", "key"), ("whatsapp", None)]
    assert "erased_key" not in item.model_dump_json()


def test_a_due_row_takes_its_default_from_the_open_draft_then_the_last_outbound_touch() -> None:
    f = FakeFollowups()
    f.last_out_channel[LEAD] = "email"
    f.drafts[DRAFT] = draft_row(
        channel="whatsapp"
    )  # a WhatsApp draft is open, though the last message went by e-mail
    (item,) = service.due_list(f, "tok", TENANT, now=NOW).items
    assert (item.open_draft_id, item.open_draft_channel, item.default_channel) == (
        DRAFT,
        "whatsapp",
        "whatsapp",
    )
    f.drafts.clear()  # no draft: where the last message went decides (both channels are open)
    for last in ("whatsapp", "email"):
        f.last_out_channel[LEAD] = last
        (item,) = service.due_list(f, "tok", TENANT, now=NOW).items
        assert (item.open_draft_channel, item.default_channel) == (None, last)


# ----------------------------------------------------------------------------- the default channel (no preferred-channel field exists)
OPEN = {"blocked": None, "stopped": None, "policy_in_force": True}


def gates(email: str | None = None, whatsapp: str | None = None, stopped: str | None = None) -> Any:
    return {
        "email": {**OPEN, "blocked": email, "stopped": stopped},
        "whatsapp": {**OPEN, "blocked": whatsapp, "stopped": stopped},
    }


def test_the_default_channel_is_the_open_drafts_then_the_last_outbound_then_email_then_whatsapp() -> (
    None
):
    d = service.default_channel
    assert (
        d(gates(), "whatsapp", "email") == "whatsapp"
    )  # a draft a person has open wins over where they last wrote
    assert d(gates(), None, "whatsapp") == "whatsapp"  # carry on where you last spoke
    assert d(gates(), None, None) == "email"  # nothing to go on: e-mail
    assert d(gates(email="consent"), None, None) == "whatsapp"  # e-mail closed: the open one
    assert d(gates(), None, "phone") == "email"  # a call is not a draft channel


def test_the_default_channel_never_names_a_closed_channel_while_another_is_open() -> None:
    d = service.default_channel
    assert (
        d(gates(whatsapp="key"), "whatsapp", "whatsapp") == "email"
    )  # the draft's and the last touch's channel are closed
    assert d(gates(email="key"), "email", "email") == "whatsapp"
    assert (
        d(gates(whatsapp="key"), "whatsapp", "email") == "email"
    )  # the open draft's channel is closed: fall through to the last outbound
    assert (
        d(gates(email="contact", whatsapp="contact"), "whatsapp", "whatsapp") == "email"
    )  # both closed: e-mail, so the page shows why
    assert (
        d(gates(stopped="order_accepted"), "whatsapp", "whatsapp") == "email"
    )  # a stop closes both


def test_the_lead_page_resolves_its_default_from_the_open_draft_and_the_last_outbound_touch() -> (
    None
):
    f = FakeFollowups()
    f.drafts.clear()  # the fake starts with one open e-mail draft; start with none
    assert page(f, None).default_channel == "email" and page(f, None).channel == "email"
    f.touch_rows = [  # newest first, as the repository returns them
        {**touch_row("whatsapp"), "occurred_at": "2026-10-06T08:00:00Z"},
        {**touch_row("email"), "occurred_at": "2026-10-05T08:00:00Z"},
    ]
    assert page(f, None).default_channel == "whatsapp"
    assert (
        page(f, "email").channel == "email" and page(f, "email").default_channel == "whatsapp"
    )  # an explicit channel is honoured, the default is still reported
    f.drafts[DRAFT] = draft_row(
        status="approved", channel="email"
    )  # a draft a person has open on e-mail
    assert page(f, None).default_channel == "email"
    f.drafts[DRAFT] = draft_row(status="discarded", channel="email")
    assert page(f, None).default_channel == "whatsapp"  # a finished draft is not "open"


def test_the_lead_page_default_ignores_a_reply_and_a_phone_call() -> None:
    f = FakeFollowups()
    f.drafts.clear()
    f.touch_rows = [  # newest first
        {
            **touch_row("whatsapp", direction="in")
        },  # the customer replied on WhatsApp: that is not where YOU last wrote
        {**touch_row("email")},
    ]
    assert page(f, None).default_channel == "email"
    f.touch_rows = [  # the newest outbound touch is a call, which is not a draft channel: the one before it decides
        {**touch_row("phone")},
        {**touch_row("whatsapp")},
        {**touch_row("email")},
    ]
    assert page(f, None).default_channel == "whatsapp"


# ----------------------------------------------------------------------------- the fixed bound
def test_the_due_list_reads_gates_for_at_most_thirty_leads() -> None:
    assert service.DUE_LIST_MAX_LEADS == 30
    f = FakeFollowups()
    many = [uuid.UUID(int=0x5000 + i) for i in range(100)]
    for lead in many:
        f.snapshots[lead] = dataclasses.replace(snapshot(), lead_id=str(lead))
    f.outbound_leads = many
    items = service.due_list(f, "tok", TENANT, now=NOW).items
    assert len(items) == 30 and [str(i.lead_id) for i in items] == [str(x) for x in many[:30]]
    assert len(f.sent("gate")) == 60  # two channels per candidate, never more
    assert f.sent("due_candidates") == [{"after": None, "limit": 30, "scan_max": 300}]


def test_a_caller_cannot_raise_the_bound_and_may_lower_it() -> None:
    f = FakeFollowups()
    many = [uuid.UUID(int=0x6000 + i) for i in range(100)]
    for lead in many:
        f.snapshots[lead] = dataclasses.replace(snapshot(), lead_id=str(lead))
    f.outbound_leads = many
    assert len(service.due_list(f, "tok", TENANT, limit=10_000, now=NOW).items) == 30
    assert f.sent("due_candidates") == [{"after": None, "limit": 30, "scan_max": 300}]
    f.calls.clear()
    assert len(service.due_list(f, "tok", TENANT, limit=5, now=NOW).items) == 5
    assert f.sent("due_candidates") == [{"after": None, "limit": 5, "scan_max": 300}]


def test_a_gate_that_cannot_be_read_fails_the_due_list_rather_than_listing_blindly() -> None:
    f = FakeFollowups()
    f.gate_error = UpstreamError()
    with pytest.raises(UpstreamError):
        service.due_list(f, "tok", TENANT, now=NOW)


# ----------------------------------------------------------------------------- the candidates function, the cursor and the left-out count
def fake_many(n: int) -> tuple[FakeFollowups, list[uuid.UUID]]:
    f = FakeFollowups()
    leads = [uuid.UUID(int=0x9000 + i) for i in range(n)]
    for lead in leads:
        f.snapshots[lead] = dataclasses.replace(snapshot(), lead_id=str(lead))
    f.outbound_leads = leads  # oldest last touch first
    f.drafts.clear()
    return f, leads


def test_a_cursor_round_trips_and_is_made_of_the_time_and_the_lead_only() -> None:
    lead = uuid.UUID(int=0xABC)
    text = service.encode_cursor(("2026-10-02T08:30:00.123456+00:00", lead))
    assert "=" not in text and set(text) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )
    assert len(text) <= service.CURSOR_MAX_CHARS
    assert service.decode_cursor(text) == ("2026-10-02T08:30:00.123456+00:00", lead)
    assert (
        service.decode_cursor(service.encode_cursor(("2026-10-02T08:30:00Z", lead)))[0]
        == "2026-10-02T08:30:00+00:00"
    )  # normalised, microseconds kept exactly


def _b64(obj: object) -> str:
    import base64
    import json

    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "!!!",
        "x" * 201,
        "é" * 10,
        "bm90IGpzb24",  # base64 of "not json"
        _b64([1, 2]),
        _b64({"at": "2026-10-02T08:30:00+00:00"}),
        _b64({"at": "2026-10-02T08:30:00+00:00", "id": str(uuid.UUID(int=1)), "extra": 1}),
        _b64({"at": "2026-10-02T08:30:00", "id": str(uuid.UUID(int=1))}),  # no offset
        _b64({"at": "yesterday", "id": str(uuid.UUID(int=1))}),
        _b64({"at": "2026-10-02T08:30:00+00:00", "id": "not-a-uuid"}),
        _b64(
            {"at": "2026-10-02T08:30:00+00:00", "id": str(uuid.UUID(int=0xABC)).upper()}
        ),  # not the canonical text
        _b64({"at": 5, "id": str(uuid.UUID(int=1))}),
    ],
)
def test_anything_that_is_not_exactly_our_cursor_is_a_422_and_nothing_is_asked_of_the_database(
    bad: str,
) -> None:
    f, _ = fake_many(2)
    with pytest.raises(ApiError) as caught:
        service.due_list(f, "tok", TENANT, cursor=bad, now=NOW)
    assert (caught.value.status_code, caught.value.code) == (422, "validation_error")
    assert f.sent("due_candidates") == []


def test_the_page_is_asked_for_with_the_page_size_the_scan_cap_and_the_decoded_cursor() -> None:
    f, leads = fake_many(3)
    cursor = service.encode_cursor(("2026-09-01T00:00:00+00:00", leads[0]))
    service.due_list(f, "tok", TENANT, cursor=cursor, now=NOW)
    assert f.sent("due_candidates") == [
        {"after": ("2026-09-01T00:00:00+00:00", leads[0]), "limit": 30, "scan_max": 300}
    ]
    assert service.DUE_SCAN_MAX == 300


def test_a_walk_by_cursor_reaches_every_lead_once_in_order_with_at_most_sixty_gate_reads_per_request() -> (
    None
):
    f, leads = fake_many(100)
    seen: list[str] = []
    cursor: str | None = None
    requests = 0
    while True:
        before = len(f.sent("gate"))
        page = service.due_list(f, "tok", TENANT, cursor=cursor, now=NOW)
        requests += 1
        assert len(f.sent("gate")) - before <= 2 * service.DUE_LIST_MAX_LEADS
        assert len(page.items) <= service.DUE_LIST_MAX_LEADS
        seen += [str(i.lead_id) for i in page.items]
        cursor = page.next_cursor
        if cursor is None:
            break
        assert requests < 10
    assert seen == [str(x) for x in leads]  # every lead exactly once, oldest first
    assert requests == 4  # 30 + 30 + 30 + 10


def test_leads_the_database_function_drops_never_reach_the_gate_or_the_engine() -> None:
    f, leads = fake_many(6)
    f.not_candidates = {leads[1], leads[4]}  # a reply, the touch limit: the function drops them
    page = service.due_list(f, "tok", TENANT, now=NOW)
    assert [str(i.lead_id) for i in page.items] == [
        str(x) for i, x in enumerate(leads) if i not in (1, 4)
    ]
    asked = {a["p_lead_id"] for a in f.sent("gate")}
    assert str(leads[1]) not in asked and str(leads[4]) not in asked
    assert page.left_out == 0


def test_left_out_counts_what_was_not_shown_for_a_reason_a_person_may_want_to_know() -> None:
    f, leads = fake_many(6)
    f.stopped_leads[leads[0]] = "order_accepted"  # stopped after the candidates were read
    f.blocked_leads[(leads[1], "email")] = "consent"
    f.blocked_leads[(leads[1], "whatsapp")] = "key"  # blocked on every channel
    f.blocked_leads[(leads[2], "email")] = "consent"  # blocked on ONE channel: still shown
    del f.snapshots[leads[3]]  # its state cannot be read
    f.snapshots[leads[4]] = snapshot(
        touches=snapshot().touches
        + (
            dataclasses.replace(
                snapshot().touches[0],
                id=str(uuid.UUID(int=0x7001)),
                occurred_at=NOW.replace(year=2027),
            ),
        )
    )  # the engine REJECTS it
    page = service.due_list(f, "tok", TENANT, now=NOW)
    assert [str(i.lead_id) for i in page.items] == [str(leads[2]), str(leads[5])]
    assert page.left_out == 4


def test_an_engine_stop_is_not_a_row_and_is_not_counted_as_left_out() -> None:
    """The candidates function should never send a lead the engine stops for good; if the engine says stop anyway (a reply it was not told about), the lead is not a row of the working list, and it is not a lead that was
    'left out' (that count is for leads that could not be shown, not for leads with nothing to do)."""
    f, leads = fake_many(2)
    reply = dataclasses.replace(
        snapshot().touches[0], id=str(uuid.UUID(int=0x7002)), direction="in"
    )
    f.snapshots[leads[0]] = snapshot(touches=snapshot().touches + (reply,))
    page = service.due_list(f, "tok", TENANT, now=NOW)
    assert [str(i.lead_id) for i in page.items] == [str(leads[1])]
    assert page.left_out == 0


def test_without_a_policy_in_force_the_page_is_empty_and_the_engine_is_never_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    f, _ = fake_many(3)
    f.candidates_policy_in_force = False

    def not_asked(request: Any) -> Any:
        raise AssertionError("the engine must not be asked")

    monkeypatch.setattr(cadence_port, "run_decide", not_asked)
    page = service.due_list(f, "tok", TENANT, now=NOW)
    assert (page.items, page.next_cursor, page.policy_in_force, page.left_out) == (
        [],
        None,
        False,
        0,
    )
    assert f.sent("gate") == []


def test_the_open_draft_and_the_last_channel_come_with_the_candidate_and_no_draft_list_is_read() -> (
    None
):
    f, leads = fake_many(2)
    f.drafts[DRAFT] = draft_row(channel="whatsapp", lead_id=str(leads[1]))
    f.last_out_channel[leads[0]] = "whatsapp"
    page = service.due_list(f, "tok", TENANT, now=NOW)
    first, second = page.items
    assert (first.open_draft_id, first.open_draft_channel, first.default_channel) == (
        None,
        None,
        "whatsapp",
    )
    assert (second.open_draft_id, second.open_draft_channel, second.default_channel) == (
        DRAFT,
        "whatsapp",
        "whatsapp",
    )
    assert f.sent("list_drafts") == []


def test_the_page_size_cannot_be_raised_and_may_be_lowered_by_a_caller() -> None:
    f, _ = fake_many(100)
    assert len(service.due_list(f, "tok", TENANT, limit=10_000, now=NOW).items) == 30
    assert len(service.due_list(f, "tok", TENANT, limit=5, now=NOW).items) == 5
    assert [c["limit"] for c in f.sent("due_candidates")] == [30, 5]
