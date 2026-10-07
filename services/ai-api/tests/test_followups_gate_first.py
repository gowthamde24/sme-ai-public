"""T010 part 2, commit 4c (unit): the gate and the stops come BEFORE the engine in the lead page and the due list. Called directly (no HTTP): the pure rules of `app.followups.service`."""

from __future__ import annotations

import dataclasses
import uuid
from typing import Any

import pytest

from app.followups import cadence_port, service
from app.tenancy.repository import UpstreamError
from tests.followups_fakes import LEAD, NOW, FakeFollowups, snapshot

TENANT = uuid.UUID(int=0x7E7)
OTHER = uuid.UUID(int=0x2EAD)


def page(f: FakeFollowups, channel: str = "email") -> Any:
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


def test_the_due_list_leaves_out_stopped_and_blocked_leads_and_keeps_the_rest() -> None:
    f = FakeFollowups()
    third = uuid.UUID(int=0x3EAD)
    for lead in (OTHER, third):
        f.snapshots[lead] = dataclasses.replace(snapshot(), lead_id=str(lead))
    f.outbound_leads = [LEAD, OTHER, third]
    f.stopped_leads[LEAD] = "order_declined"
    f.blocked_leads[(OTHER, "email")] = "erased"
    assert [str(i.lead_id) for i in service.due_list(f, "tok", TENANT, now=NOW)] == [str(third)]
    f.blocked_leads[(OTHER, "email")] = "key"
    f.stopped_leads.clear()
    assert [str(i.lead_id) for i in service.due_list(f, "tok", TENANT, now=NOW)] == [
        str(LEAD),
        str(third),
    ]
    f.blocked_leads.clear()
    assert len(service.due_list(f, "tok", TENANT, now=NOW)) == 3


def test_a_gate_that_cannot_be_read_fails_the_due_list_rather_than_listing_blindly() -> None:
    f = FakeFollowups()
    f.raise_next = UpstreamError()
    with pytest.raises(UpstreamError):
        service.due_list(f, "tok", TENANT, now=NOW)
