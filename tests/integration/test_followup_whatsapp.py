"""WhatsApp as a first-class channel in the follow-up screens (docs/plans/followups-whatsapp.md), commit 1, on the REAL stack.

The SPIKE comes first: the plan rests on the assumption that the database already carries a lead whose contact has ONLY a phone number all the way through WhatsApp (a keyed contact, a first
outbound WhatsApp touch, a WhatsApp draft, an approval, "I sent it"). If this test fails the ticket stops. Nothing here sends anything; a touch and a draft are records. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import re
import uuid
from typing import Any

import pytest
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead
from test_followup_api import erase

from app.followups import service


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


# ============================================================================ the spike
def test_spike_a_phone_only_lead_goes_through_whatsapp_end_to_end(fw: FollowWorld) -> None:
    lead = fw.lead(
        "phone-only", email=False
    )  # a keyed contact with ONLY a phone number; consent for WhatsApp only
    assert lead.email is None and lead.phone is not None
    assert (
        fw.key_of(lead, "phone") != ""
    )  # the phone key exists (made by the real key ring); there is no e-mail key
    assert (
        fw.sql(
            f"select count(*) from suppression.contact_keys where contact_id = '{lead.contact_id}' and email_hmac is not null"
        )
        == "0"
    )

    # the first message is a person's: a first outbound WHATSAPP touch, five days ago
    first = fw.touch("sales", lead, channel="whatsapp", days_ago=5)
    assert first.status_code == 201, first.text

    # the lead's page, read for WhatsApp, says nothing blocks and a draft can be made now
    page = fw.call("GET", f"/leads/{lead.id}/followup?channel=whatsapp", "sales")
    assert page.status_code == 200, page.text
    assert page.json()["gate"] == {"blocked": None, "stopped": None, "policy_in_force": True}
    assert (page.json()["decision"]["action"], page.json()["decision"]["reason_code"]) == (
        "draft_followup",
        "eligible_now",
    )

    # e-mail is closed for this lead (no address: no consent and no key), and the database says so
    refused_email = fw.draft("sales", lead, "email")
    assert (
        refused_email.status_code == 409
        and refused_email.json()["error"]["code"] == "contact_blocked"
    ), refused_email.text

    # a WhatsApp draft, from the closed template
    made = fw.draft("sales", lead, "whatsapp")
    assert made.status_code == 201 and made.json()["touch_number"] == 2, made.text
    draft_id = made.json()["draft_id"]
    shown = fw.get_draft(draft_id)
    assert shown["channel"] == "whatsapp" and shown["status"] == "draft"
    assert shown["body"] == fw.sql(
        f"select body from public.followup_templates where code = '{shown['template_code']}'"
    )

    # Sales cannot approve; an Admin can (with the second factor); then "I sent it"
    assert fw.approve("sales", draft_id).status_code == 403
    ok = fw.approve("admin", draft_id)
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    sent = fw.sent("sales", draft_id)
    assert sent.status_code == 201 and sent.json()["status"] == "recorded_sent", sent.text

    touches = fw.touches_of(lead)
    assert [(t["direction"], t["channel"]) for t in touches] == [
        ("out", "whatsapp"),
        ("out", "whatsapp"),
    ]
    assert touches[1]["draft_id"] == draft_id
    fw.invariants()


# ============================================================================ the due list and the lead page across channels
def due(fw: FollowWorld) -> dict[str, dict[str, Any]]:
    out = fw.call("GET", "/followups/due", "sales")
    assert out.status_code == 200, out.text
    return {i["lead_id"]: i for i in out.json()["items"]}


def page(fw: FollowWorld, lead: Lead, channel: str | None = None) -> dict[str, Any]:
    query = "" if channel is None else f"?channel={channel}"
    out = fw.call("GET", f"/leads/{lead.id}/followup{query}", "sales")
    assert out.status_code == 200, out.text
    return dict(out.json())


def states(item: dict[str, Any]) -> dict[str, str | None]:
    return {c["channel"]: c["blocked"] for c in item["channels"]}


def test_a_phone_only_lead_is_in_the_due_list_with_whatsapp_open_and_opens_on_whatsapp(
    fw: FollowWorld,
) -> None:
    lead = fw.lead("po-due", email=False)
    assert fw.touch("sales", lead, channel="whatsapp", days_ago=5).status_code == 201
    item = due(fw)[lead.id]
    assert (item["action"], item["reason_code"], item["touch_number"]) == (
        "draft_followup",
        "eligible_now",
        2,
    )
    assert (
        states(item)["whatsapp"] is None and states(item)["email"] is not None
    )  # e-mail is closed (no address), WhatsApp is open
    assert item["default_channel"] == "whatsapp" and item["open_draft_channel"] is None
    opened = page(fw, lead)  # no channel asked for: the default
    assert (opened["channel"], opened["default_channel"], opened["gate"]["blocked"]) == (
        "whatsapp",
        "whatsapp",
        None,
    )
    assert opened["decision"]["action"] == "draft_followup"
    assert states(opened) == states(item)
    closed = page(fw, lead, "email")  # asked for e-mail: the page shows why it is closed
    assert (
        closed["channel"] == "email"
        and closed["decision"]["engine_version"] == "none"
        and closed["gate"]["blocked"] == states(item)["email"]
    )
    # a draft on WhatsApp is then the lead's open draft, and the row says on which channel
    made = fw.made_draft(lead, "whatsapp")
    row = due(fw)[lead.id]
    assert (row["open_draft_id"], row["open_draft_channel"], row["default_channel"]) == (
        made,
        "whatsapp",
        "whatsapp",
    )
    fw.invariants()


def test_consent_withdrawn_for_one_channel_leaves_the_lead_listed_on_the_other(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("one-ch")  # e-mail first touch; consent for both channels
    assert states(due(fw)[lead.id]) == {"email": None, "whatsapp": None}
    withdrawn = fw.w.call(
        fw.owner,
        "POST",
        fw.t,
        "contacts",
        f"/{lead.contact_id}/record-consent",
        json={"channel": "email", "status": "withdrawn"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    row = due(fw)[lead.id]
    assert (
        states(row) == {"email": "consent", "whatsapp": None}
        and row["default_channel"] == "whatsapp"
    )
    assert page(fw, lead)["channel"] == "whatsapp"
    assert fw.draft("sales", lead, "email").status_code == 409  # the database agrees
    assert fw.draft("sales", lead, "whatsapp").status_code == 201
    # and the other way round: WhatsApp consent withdrawn too -> blocked on both, not listed
    fw.w.call(
        fw.owner,
        "POST",
        fw.t,
        "contacts",
        f"/{lead.contact_id}/record-consent",
        json={"channel": "whatsapp", "status": "withdrawn"},
    )
    assert lead.id not in due(fw)
    both = page(fw, lead)
    assert [c["blocked"] for c in both["channels"]] == ["consent", "consent"] and both[
        "channel"
    ] == "email"
    fw.invariants()


def test_a_shared_phone_number_blocks_whatsapp_only_and_the_lead_stays_listed(
    fw: FollowWorld,
) -> None:
    shared = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    a = fw.due_lead("sh-a", phone_number=shared)
    b = fw.lead("sh-b", phone_number=shared)
    assert fw.suppress(b).status_code == 200
    row = due(fw)[a.id]
    assert states(row) == {"email": None, "whatsapp": "key"} and row["default_channel"] == "email"
    assert page(fw, a, "whatsapp")["decision"]["reason_code"] == "key"
    assert fw.draft("sales", a, "whatsapp").status_code == 409
    assert fw.draft("sales", a, "email").status_code == 201
    fw.invariants()


def test_an_erased_by_right_marker_on_a_shared_number_reads_key_in_every_channel_state(
    fw: FollowWorld,
) -> None:
    shared = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    a = fw.due_lead("er-a", phone_number=shared)
    b = fw.lead("er-b", phone_number=shared)
    erase(fw, b)
    row = due(fw)[a.id]
    assert states(row) == {"email": None, "whatsapp": "key"}
    for text in (
        fw.call("GET", "/followups/due", "sales").text,
        fw.call("GET", f"/leads/{a.id}/followup", "sales").text,
    ):
        assert not re.search(r"erased[\s_-]*key", text, re.I) and "by right" not in text.lower()
    fw.invariants()


def test_a_stopped_or_fully_blocked_lead_is_not_listed_and_both_tabs_say_so(
    fw: FollowWorld,
) -> None:
    stopped = fw.due_lead("stop-1")
    assert stopped.id in due(fw)
    fw.archive_lead(stopped)
    assert stopped.id not in due(fw)
    for channel in ("email", "whatsapp"):
        got = page(fw, stopped, channel)
        assert (
            got["gate"]["stopped"] == "lead_archived"
            and got["decision"]["reason_code"] == "lead_archived"
        )
    asleep = fw.due_lead("stop-2")
    assert fw.suppress(asleep).status_code == 200
    assert asleep.id not in due(fw)
    assert [c["blocked"] for c in page(fw, asleep)["channels"]] == ["contact", "contact"]
    gone = fw.due_lead("stop-3")
    erase(fw, gone)
    assert gone.id not in due(fw)
    assert [c["blocked"] for c in page(fw, gone)["channels"]] == ["erased", "erased"]
    fw.invariants()


def test_the_default_channel_follows_the_last_outbound_touch(fw: FollowWorld) -> None:
    lead = fw.lead("def-1")
    assert fw.touch("sales", lead, channel="email", days_ago=6).status_code == 201
    assert (
        page(fw, lead)["default_channel"] == "email"
        and due(fw)[lead.id]["default_channel"] == "email"
    )
    assert fw.touch("sales", lead, channel="whatsapp", days_ago=5).status_code == 201
    assert (
        page(fw, lead)["default_channel"] == "whatsapp"
        and due(fw)[lead.id]["default_channel"] == "whatsapp"
    )
    fw.invariants()


def test_a_newer_phone_call_does_not_decide_the_default_channel(fw: FollowWorld) -> None:
    """Two outbound touches only: a third would reach the policy's limit of three, and a lead at its limit is no longer a candidate."""
    lead = fw.lead("def-1b")
    assert fw.touch("sales", lead, channel="whatsapp", days_ago=6).status_code == 201
    granted = fw.w.call(  # a call is an outbound touch like any other, so it needs consent for the phone channel
        fw.owner,
        "POST",
        fw.t,
        "contacts",
        f"/{lead.contact_id}/record-consent",
        json={
            "channel": "phone",
            "status": "granted",
            "basis": "explicit_consent",
            "evidence_type": "web_form",
            "evidence_ref": "ref:def-1b",
        },
    )
    assert granted.status_code == 200, granted.text
    assert (
        fw.touch("sales", lead, channel="phone", days_ago=4).status_code == 201
    )  # the newest outbound touch is a call, which is not a draft channel
    assert (
        page(fw, lead)["default_channel"] == "whatsapp"
        and due(fw)[lead.id]["default_channel"] == "whatsapp"
    )
    fw.invariants()


def test_a_lead_at_the_policy_limit_is_no_longer_in_the_due_list_but_its_page_still_opens(
    fw: FollowWorld,
) -> None:
    """Three outbound touches under a limit of three: the engine stops for good, so the candidates function drops the lead (a decision of the due-candidates ticket); its own page still shows the touches and the stop."""
    lead = fw.due_lead("at-limit", outs=3)
    assert lead.id not in due(fw)
    got = page(fw, lead)
    assert (
        got["decision"]["action"] == "stop"
        and got["decision"]["reason_code"] == "max_touches_reached"
    )
    assert len(got["touches"]) == 3


def test_an_open_draft_decides_the_channel_and_blocks_a_draft_on_the_other_one(
    fw: FollowWorld,
) -> None:
    lead = fw.lead("def-2")
    assert fw.touch("sales", lead, channel="whatsapp", days_ago=5).status_code == 201
    assert page(fw, lead)["default_channel"] == "whatsapp"
    draft = fw.made_draft(lead, "email")  # the open draft's channel wins over where they last wrote
    assert (
        page(fw, lead)["default_channel"] == "email"
        and due(fw)[lead.id]["default_channel"] == "email"
    )
    assert due(fw)[lead.id]["open_draft_channel"] == "email"
    assert (
        page(fw, lead, "whatsapp")["default_channel"] == "email"
    )  # an explicit tab is honoured; the default is still the draft's
    other = fw.draft("sales", lead, "whatsapp")  # one active draft per touch, across channels
    assert other.status_code == 409, other.text
    assert [d["id"] for d in fw.drafts_of(lead)] == [draft]
    fw.invariants()


def test_the_due_list_reads_gates_for_at_most_the_fixed_bound_on_the_real_stack(
    fw: FollowWorld,
) -> None:
    assert service.DUE_LIST_MAX_LEADS == 30
    assert len(due(fw)) <= service.DUE_LIST_MAX_LEADS
