"""T010 part 2, commit 2, on the REAL stack: the follow-up ROUTES of our API (the pattern of test_order_api.py), with real tokens, the real cadence engine and the real database.

  * the whole path through the routes: a policy (Owner, second factor), a first touch a person records, the engine's decision, a draft from the closed template, an approval (Admin, second
    factor), "I sent it", the next cycle; nothing is sent by anything;
  * every role: a Viewer, another workspace, anon, Sales, an Admin, the Owner without a second factor;
  * EVERY SQLSTATE of the family SM220-SM229 and every closed reason that can be reached through the API, with the fixed sentence;
  * the touch times (never after now, 7 days, not before the lead existed, an outbound touch not before the latest one), the 7-day draft age, the 500-touch cap;
  * the question drafts end to end (random ids, the sync, approve, discard);
  * direct PostgREST attacks: no client writes a follow-up table, a Viewer reads none, another workspace's rows are invisible.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import aal1_token
from crm_support import World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead, policy_body
from order_support import OrderWorld
from quote_support import QuoteWorld

from app.followups.messages import FOLLOWUP_REFUSALS


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


def err(r: httpx.Response) -> dict[str, Any]:
    return dict(r.json()["error"])


def refused(r: httpx.Response, sqlstate: str, reason: str | None = None) -> None:
    """The response is the fixed answer for this SQLSTATE and reason."""
    status, name, texts = FOLLOWUP_REFUSALS[sqlstate]
    body = err(r)
    assert r.status_code == status and body["code"] == name, r.text
    assert body["message"] == texts[reason if reason is not None else "-"], r.text
    assert body.get("reason") == reason, r.text
    assert sqlstate not in r.text


# ============================================================================ the whole path
def test_a_follow_up_from_the_first_touch_to_recorded_as_sent_through_the_routes(
    fw: FollowWorld,
) -> None:
    lead = fw.lead("path")
    # nothing is due before a person has written to the lead: the first message is theirs
    page = fw.call("GET", f"/leads/{lead.id}/followup", "sales")
    assert (
        page.status_code == 200
        and page.json()["decision"]["reason_code"] == "initial_outreach_required"
    ), page.text
    assert page.json()["gate"] == {"blocked": None, "stopped": None, "policy_in_force": True}
    refused(fw.draft("sales", lead), "SM225", "initial_outreach")
    first = fw.touch("sales", lead, days_ago=5)  # "I sent it", five days ago
    assert first.status_code == 201 and first.json()["replayed"] is False, first.text
    page = fw.call("GET", f"/leads/{lead.id}/followup", "sales").json()
    assert (
        page["decision"]["action"],
        page["decision"]["reason_code"],
        page["decision"]["touch_number"],
    ) == ("draft_followup", "eligible_now", 2)
    made = fw.draft("sales", lead)
    assert (
        made.status_code == 201
        and made.json()["touch_number"] == 2
        and made.json()["status"] == "draft"
    ), made.text
    draft_id = made.json()["draft_id"]
    shown = fw.get_draft(draft_id)
    assert (
        shown["status"] == "draft"
        and shown["template_code"] == "followup_gentle"
        and shown["channel"] == "email"
    )
    template = fw.sql("select body from public.followup_templates where code = 'followup_gentle'")
    assert (
        shown["body"] == template
    )  # the closed template, copied by the database: the caller supplied no wording
    assert re.fullmatch(r"[0-9a-f]{64}", shown["state_hash"])
    # a second draft for the same touch is refused; the same id replays
    refused(fw.draft("sales", lead), "SM223", "exists")
    again = fw.draft("sales", lead, draft_id=draft_id)
    assert again.status_code == 200 and again.json()["replayed"] is True
    # Sales cannot approve; an Admin can; the approval is recorded with the approver
    assert fw.approve("sales", draft_id).status_code == 403
    ok = fw.approve("admin", draft_id)
    assert ok.status_code == 200 and ok.json() == {
        "draft_id": draft_id,
        "status": "approved",
        "replayed": False,
    }, ok.text
    assert fw.get_draft(draft_id)["approved_by"] == str(fw.admin.id)
    sent = fw.sent("sales", draft_id)
    assert sent.status_code == 201 and sent.json()["status"] == "recorded_sent", sent.text
    assert fw.get_draft(draft_id)["status"] == "recorded_sent"
    touches = fw.call("GET", f"/leads/{lead.id}/followup", "sales").json()["touches"]
    assert [t["direction"] for t in touches] == ["out", "out"] and touches[0][
        "draft_id"
    ] == draft_id
    # the cycle goes on: touch 3 is the last allowed one (the policy allows three); it needs two days after the second touch, so it is not yet
    refused(fw.draft("sales", lead), "SM225", "not_yet")
    fw.invariants()


def test_the_last_touch_uses_the_last_wording_and_the_limit_stops_the_cadence(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead(
        "limit", outs=2
    )  # touches 4 and 5 days ago... the second was 4 days ago: due for touch 3
    made = fw.draft("sales", lead)
    assert made.status_code == 201 and made.json()["touch_number"] == 3, made.text
    assert fw.get_draft(made.json()["draft_id"])["template_code"] == "followup_last"
    third = fw.touch("sales", lead, days_ago=0)
    assert third.status_code == 201
    refused(fw.draft("sales", lead), "SM225", "max_touches")
    assert (
        fw.drafts_of(lead)[0]["discard_code"] == "superseded"
    )  # the new outbound touch superseded the open draft
    fw.invariants()


def test_a_whatsapp_draft_needs_the_phone_key_and_consent_for_whatsapp(fw: FollowWorld) -> None:
    lead = fw.due_lead("wa")
    made = fw.draft("sales", lead, "whatsapp")
    assert made.status_code == 201, made.text
    assert fw.get_draft(made.json()["draft_id"])["channel"] == "whatsapp"


def test_the_due_list_names_what_is_due_and_the_open_draft(fw: FollowWorld) -> None:
    lead = fw.due_lead("due")
    items = {i["lead_id"]: i for i in fw.call("GET", "/followups/due", "sales").json()}
    assert items[lead.id]["action"] == "draft_followup" and items[lead.id]["open_draft_id"] is None
    draft_id = fw.made_draft(lead)
    items = {i["lead_id"]: i for i in fw.call("GET", "/followups/due", "sales").json()}
    assert items[lead.id]["open_draft_id"] == draft_id
    listed = fw.call("GET", f"/followup-drafts?status=active&lead_id={lead.id}", "sales").json()
    assert [d["id"] for d in listed] == [draft_id]


def test_a_retry_of_ask_for_a_draft_replays_whatever_the_clock_says_and_whatever_became_of_the_draft(
    fw: FollowWorld,
) -> None:
    """Commit 4d (migration 20261026090000). The request the API builds carries its clock (`as_of`) in whole seconds; the database used to replay only a byte-identical request, so a retry a second later was a
    `409 conflict`. Now the same draft id for the same tenant, lead and channel returns the stored draft, `replayed: true`, and creates nothing: a second later, after approval, after "I sent it", after a discard."""
    lead = fw.due_lead("retry")
    draft_id = uid()
    first = fw.draft("sales", lead, "email", draft_id)
    assert first.status_code == 201 and first.json()["replayed"] is False, first.text
    time.sleep(1.2)  # across a second boundary
    again = fw.draft("sales", lead, "email", draft_id)
    assert again.status_code == 200 and again.json() == {**first.json(), "replayed": True}, (
        again.text
    )
    assert len(fw.drafts_of(lead)) == 1
    # approved since
    assert fw.approve("admin", draft_id).status_code == 200
    time.sleep(1.1)
    after_approval = fw.draft("sales", lead, "email", draft_id)
    assert after_approval.status_code == 200 and after_approval.json()["replayed"] is True
    assert after_approval.json()["status"] == "approved", after_approval.text
    # recorded as sent since: the retry does not record another touch
    assert fw.sent("sales", draft_id).status_code == 201
    touches = len(fw.touches_of(lead))
    time.sleep(1.1)
    after_sent = fw.draft("sales", lead, "email", draft_id)
    assert after_sent.status_code == 200 and after_sent.json()["status"] == "recorded_sent", (
        after_sent.text
    )
    assert len(fw.touches_of(lead)) == touches and len(fw.drafts_of(lead)) == 1
    # discarded since: the retry returns the discarded draft and makes no new one
    lead2 = fw.due_lead("retry2")
    discarded = fw.made_draft(lead2)
    assert fw.call("POST", f"/followup-drafts/{discarded}/discard", "sales").status_code == 200
    time.sleep(1.1)
    after_discard = fw.draft("sales", lead2, "email", discarded)
    assert after_discard.status_code == 200 and after_discard.json()["status"] == "discarded", (
        after_discard.text
    )
    assert len(fw.drafts_of(lead2)) == 1
    # the same id for another lead, on another channel or in another workspace is still the constant conflict
    other_lead = fw.due_lead("retry3")
    for response in (
        fw.draft("sales", other_lead, "email", draft_id),
        fw.draft("sales", lead, "whatsapp", draft_id),
    ):
        assert response.status_code == 409 and err(response)["code"] == "conflict", response.text
    assert len(fw.drafts_of(other_lead)) == 0
    fwb = FollowWorld(
        fw.client, fw.w, fw.w.b
    )  # workspace B has NO policy and must stay so (test_sm222 relies on it): the replay check comes before the policy check
    lead_b = fwb.lead("retry-b")
    across = fwb.draft("sales", lead_b, "email", draft_id)
    assert across.status_code == 409 and err(across)["code"] == "conflict", across.text
    assert draft_id not in across.text and fwb.drafts_of(lead_b) == []
    assert err(across) == err(
        fw.draft("sales", other_lead, "email", draft_id)
    )  # one answer for another lead and another workspace
    fw.invariants()


# ============================================================================ roles
def test_nobody_without_a_token_no_viewer_and_no_other_workspace_gets_anything(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("roles")
    draft_id = fw.made_draft(lead)
    other = fw.w.b
    for method, path, body in [
        ("GET", "/followup-policy-versions", None),
        ("GET", f"/leads/{lead.id}/followup", None),
        ("POST", f"/leads/{lead.id}/touches", {"id": uid(), "direction": "in", "channel": "email"}),
        ("POST", f"/leads/{lead.id}/followup-drafts", {"id": uid(), "channel": "email"}),
        ("GET", "/followups/due", None),
        ("GET", "/followup-drafts", None),
        ("GET", f"/followup-drafts/{draft_id}", None),
        ("POST", f"/followup-drafts/{draft_id}/discard", None),
    ]:
        assert fw.call(method, path, None, body).status_code == 401, (method, path)
        assert fw.call(method, path, "viewer", body).status_code == 403, (method, path)
        assert fw.call(method, path, other.users["owner"], body).status_code == 404, (
            method,
            path,
        )  # a member of ANOTHER workspace on this path
    assert fw.drafts_of(lead)[0]["status"] == "draft" and len(fw.touches_of(lead)) == 1


def test_a_policy_is_the_owners_with_a_second_factor_and_an_approval_the_owners_or_admins(
    fw: FollowWorld,
) -> None:
    body = policy_body()
    for user in ("admin", "sales", "viewer"):
        assert fw.call("POST", "/followup-policy-versions", user, body).status_code == 403, user
    weak = aal1_token(fw.w.stack, fw.owner)
    r = fw.call("POST", "/followup-policy-versions", None, body, token=weak)
    assert r.status_code == 403 and err(r)["code"] == "mfa_required"
    lead = fw.due_lead("aal")
    draft_id = fw.made_draft(lead)
    state_hash = fw.get_draft(draft_id)["state_hash"]
    for token in (aal1_token(fw.w.stack, fw.owner), aal1_token(fw.w.stack, fw.admin)):
        r = fw.call(
            "POST",
            f"/followup-drafts/{draft_id}/approve",
            None,
            {"state_hash": state_hash},
            token=token,
        )
        assert r.status_code == 403 and err(r)["code"] == "mfa_required"
    assert fw.drafts_of(lead)[0]["status"] == "draft"
    assert (
        fw.call("POST", "/followup-policy-versions", "owner", {**body, "id": uid()}).status_code
        == 201
    )


def test_sales_discards_her_own_draft_but_not_another_persons(fw: FollowWorld) -> None:
    lead = fw.due_lead("own")
    draft_id = str(fw.draft("owner", lead).json()["draft_id"])  # made by the Owner
    refused(fw.call("POST", f"/followup-drafts/{draft_id}/discard", "sales"), "SM228")
    assert fw.call("POST", f"/followup-drafts/{draft_id}/discard", "admin").status_code == 200
    mine = fw.due_lead("own2")
    mine_id = fw.made_draft(mine)
    assert fw.call("POST", f"/followup-drafts/{mine_id}/discard", "sales").status_code == 200
    again = fw.call("POST", f"/followup-drafts/{mine_id}/discard", "sales")
    assert again.status_code == 200 and again.json()["replayed"] is True


# ============================================================================ every SQLSTATE and reason that can be reached through the API
def test_sm220_every_reason_through_the_api(
    fw: FollowWorld, caplog: pytest.LogCaptureFixture
) -> None:
    # contact: the contact asked not to be contacted
    suppressed = fw.due_lead("s220c")
    assert fw.suppress(suppressed).status_code == 200
    refused(fw.draft("sales", suppressed), "SM220", "contact")
    refused(fw.touch("sales", suppressed, "out"), "SM220", "contact")
    # a reply is still recordable, and weakens nothing
    assert fw.touch("sales", suppressed, "in").status_code == 201
    refused(fw.draft("sales", suppressed), "SM220", "contact")
    # consent: none recorded for the channel
    unconsented = fw.lead("s220n", consent=False)
    refused(fw.touch("sales", unconsented, "out"), "SM220", "consent")
    # key: another contact shares the phone number and was suppressed (the WhatsApp key is the phone key)
    shared = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    a = fw.due_lead("s220a", phone_number=shared)
    b = fw.lead("s220b", phone_number=shared)
    assert fw.suppress(b).status_code == 200
    plain = fw.draft("sales", a, "whatsapp")
    refused(plain, "SM220", "key")
    assert fw.draft("sales", a, "email").status_code == 201  # the e-mail key is another key
    # erased_key: a contact that shared the number was ERASED by right
    shared2 = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    c = fw.due_lead("s220c2", phone_number=shared2)
    d = fw.lead("s220d", phone_number=shared2)
    erase(fw, d)
    caplog.set_level(logging.INFO, logger="app.followups.repository")
    hidden = fw.draft("sales", c, "whatsapp")
    refused(
        hidden, "SM220", "key"
    )  # PRIVACY: the client is told `key`, never that another person was erased by right
    assert (
        not re.search(r"erased[\s_-]*key", hidden.text, re.I)
        and "by right" not in hidden.text.lower()
    )
    assert any(
        "sqlstate=SM220" in r.getMessage() and "reason=erased_key" in r.getMessage()
        for r in caplog.records
    ), "the SERVER still distinguishes it"
    assert (
        fw.call("GET", f"/leads/{c.id}/followup?channel=whatsapp", "sales").json()["gate"][
            "blocked"
        ]
        == "key"
    )
    # erased: the contact itself is erased: not even a reply is recorded (erasure wins)
    gone = fw.due_lead("s220e")
    erase(fw, gone)
    refused(fw.draft("sales", gone), "SM220", "erased")
    refused(fw.touch("sales", gone, "in"), "SM220", "erased")
    fw.invariants()


def test_a_lead_the_gate_blocks_is_never_shown_as_due_on_the_real_stack(
    fw: FollowWorld,
) -> None:
    """Commit 4c: the engine sees only the lead's own flag, so for a blocked lead it said 'draft_followup' and the due list said due. The gate's block now overrides it, with the gate's own closed word, and a lead
    blocked on EVERY channel is left out of the due list; a lead blocked on one channel stays listed while the other is open (WhatsApp as a first-class channel: tests/integration/test_followup_whatsapp.py). A shared KEY needs a
    shared PHONE number (the API refuses a second contact with the same e-mail address), so it blocks WhatsApp only. Consent withdrawn for e-mail after a touch blocks e-mail only (these leads also have WhatsApp consent); an
    opted-out contact and an erased contact are blocked on both channels."""

    def due_ids() -> set[str]:
        return {i["lead_id"] for i in fw.call("GET", "/followups/due", "sales").json()}

    def page(lead: Lead, channel: str = "email") -> dict[str, Any]:
        out = fw.call("GET", f"/leads/{lead.id}/followup?channel={channel}", "sales")
        assert out.status_code == 200, out.text
        return dict(out.json())

    def blocked_as(lead: Lead, word: str, channel: str = "email", *, listed: bool) -> None:
        got = page(lead, channel)
        assert got["gate"]["blocked"] == word
        assert got["decision"] == {
            "action": "stop",
            "reason_code": word,
            "terminal": False,
            "touch_number": None,
            "next_eligible_at": None,
            "engine_version": "none",
        }
        assert (lead.id in due_ids()) is listed

    # shared KEY (the case verified in 4b): another contact shares the PHONE number and is suppressed
    phone = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    a = fw.due_lead("blk-a", phone_number=phone)
    b = fw.lead("blk-b", phone_number=phone)
    assert (
        page(a, "whatsapp")["decision"]["action"] == "draft_followup"
    )  # before: nothing in the way
    assert fw.suppress(b).status_code == 200
    blocked_as(a, "key", "whatsapp", listed=True)
    refused(
        fw.draft("sales", a, "whatsapp"), "SM220", "key"
    )  # the database agrees: the screen no longer promises what it refuses
    assert (
        page(a)["decision"]["action"] == "draft_followup" and a.id in due_ids()
    )  # e-mail is its own gate: the lead is still due, on e-mail
    # consent WITHDRAWN after the touch
    c = fw.due_lead("blk-c")
    assert c.id in due_ids()
    withdrawn = fw.w.call(
        fw.owner,
        "POST",
        fw.t,
        "contacts",
        f"/{c.contact_id}/record-consent",
        json={"channel": "email", "status": "withdrawn"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    blocked_as(c, "consent", listed=True)  # WhatsApp is still open
    # the contact asked not to be contacted
    d = fw.due_lead("blk-d")
    assert d.id in due_ids()
    assert fw.suppress(d).status_code == 200
    blocked_as(d, "contact", listed=False)
    blocked_as(d, "contact", "whatsapp", listed=False)
    # an ERASED contact
    e = fw.due_lead("blk-e")
    erase(fw, e)
    blocked_as(e, "erased", listed=False)
    blocked_as(e, "erased", "whatsapp", listed=False)
    # erased BY RIGHT and sharing the number: the client is told `key`, never `erased_key`
    phone2 = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    f = fw.due_lead("blk-f", phone_number=phone2)
    g = fw.lead("blk-g", phone_number=phone2)
    erase(fw, g)
    blocked_as(f, "key", "whatsapp", listed=True)
    text = fw.call("GET", f"/leads/{f.id}/followup?channel=whatsapp", "sales").text
    assert not re.search(r"erased[\s_-]*key", text, re.I) and "by right" not in text.lower()
    fw.invariants()


def erase(fw: FollowWorld, lead: Lead) -> None:
    """Erase the lead's contact by right, through the data layer as the Owner (a person asks, the Owner executes)."""
    rid = uid()
    r = httpx.post(
        f"{fw.w.stack.rest}/rpc/request_erasure",
        headers=fw.w.stack.headers(fw.owner.token),
        json={
            "p_request_id": rid,
            "p_tenant_id": fw.t.id,
            "p_scope": "contact",
            "p_subject_id": lead.contact_id,
        },
        timeout=60,
    )
    assert r.status_code == 200, r.text
    done = httpx.post(
        f"{fw.w.stack.rest}/rpc/execute_erasure",
        headers=fw.w.stack.headers(fw.owner.token),
        json={"p_request_id": rid, "p_dry_run": False},
        timeout=120,
    )
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text


def test_sm221_a_contact_that_was_never_keyed_cannot_be_contacted(fw: FollowWorld) -> None:
    unkeyed = fw.lead("s221", keyed=False)
    assert (
        fw.sql(
            f"select count(*) from suppression.contact_keys where contact_id = '{unkeyed.contact_id}'"
        )
        == "0"
    )
    refused(fw.touch("sales", unkeyed, "out"), "SM221")
    refused(fw.draft("sales", unkeyed), "SM221")
    assert (
        fw.call("GET", f"/leads/{unkeyed.id}/followup", "sales").json()["gate"]["blocked"]
        == "unkeyed"
    )
    assert fw.touch("sales", unkeyed, "in").status_code == 201  # a reply is still recordable


def test_sm222_no_policy_in_force(fw: FollowWorld) -> None:
    other = FollowWorld(fw.client, fw.w, fw.w.b)  # workspace B never published a policy
    lead = other.lead("s222")
    other.touch("sales", lead, days_ago=5)
    r = other.draft("sales", lead)
    refused(r, "SM222")
    page = other.call("GET", f"/leads/{lead.id}/followup", "sales").json()
    assert page["decision"] is None and page["gate"]["policy_in_force"] is False


def test_sm223_every_reason(fw: FollowWorld) -> None:
    lead = fw.due_lead("s223")
    draft_id = fw.made_draft(lead)
    refused(fw.draft("sales", lead), "SM223", "exists")
    refused(fw.sent("sales", draft_id), "SM223", "not_approved")
    assert fw.call("POST", f"/followup-drafts/{draft_id}/discard", "sales").status_code == 200
    refused(fw.approve("owner", draft_id), "SM223", "not_draft")
    sent_lead = fw.due_lead("s223b")
    sent_id = fw.made_draft(sent_lead)
    assert fw.approve("owner", sent_id).status_code == 200
    assert fw.sent("sales", sent_id).status_code == 201
    refused(fw.call("POST", f"/followup-drafts/{sent_id}/discard", "owner"), "SM223", "closed")
    refused(fw.sent("sales", sent_id), "SM223", "closed")


def test_sm224_a_draft_whose_state_moved_is_stale_and_so_is_a_wrong_fingerprint(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("s224")
    draft_id = fw.made_draft(lead)
    r = fw.call("POST", f"/followup-drafts/{draft_id}/approve", "owner", {"state_hash": "0" * 64})
    refused(r, "SM224")
    fw.policy()  # a new policy version in force: every draft made under the old one is stale
    refused(fw.approve("owner", draft_id), "SM224")
    assert fw.drafts_of(lead)[0]["status"] == "draft"
    # a draft older than seven days is stale too: neither approved nor recorded as sent
    old = fw.due_lead("s224o")
    old_id = fw.made_draft(old)
    fw.sql(
        f"alter table public.followup_drafts disable trigger followup_drafts_guard_update; update public.followup_drafts set created_at = now() - interval '7 days 1 second' where id = '{old_id}'; alter table public.followup_drafts enable trigger followup_drafts_guard_update"
    )
    refused(fw.approve("owner", old_id), "SM224")


def test_sm225_every_reason_that_is_reachable(fw: FollowWorld) -> None:
    refused(fw.draft("sales", fw.lead("s225i")), "SM225", "initial_outreach")
    fresh = fw.lead("s225n")
    assert fw.touch("sales", fresh).status_code == 201  # a touch just now: the gap is a day
    refused(fw.draft("sales", fresh), "SM225", "not_yet")
    capped = fw.due_lead("s225m", outs=3)
    refused(fw.draft("sales", capped), "SM225", "max_touches")
    replied = fw.due_lead("s225r")
    assert fw.touch("sales", replied, "in").status_code == 201
    refused(fw.draft("sales", replied), "SM225", "replied")
    lost = fw.due_lead("s225l")
    assert (
        fw.w.call(
            fw.owner,
            "PATCH",
            fw.t,
            "leads",
            f"/{lost.id}",
            json={"status": "disqualified", "disqualified_reason": "no fit"},
        ).status_code
        == 200
    )
    refused(fw.draft("sales", lost), "SM225", "closed")
    won = fw.due_lead("s225w")
    fw.sql(
        f"insert into public.opportunities (tenant_id, company_id, contact_id, lead_id, title, status) select tenant_id, company_id, contact_id, id, 'Synthetic won deal', 'won' from public.leads where id = '{won.id}'"
    )
    refused(fw.draft("sales", won), "SM225", "closed")
    future = fw.due_lead("s225f")
    fw.plant_touch(
        future, "out", "now() + interval '1 hour'", recorded_sql="now() + interval '2 hours'"
    )
    refused(fw.draft("sales", future), "SM225", "future_history")
    for lead in (fresh, capped, replied, lost, won, future):
        assert fw.drafts_of(lead) == [], lead


def test_sm226_a_stale_read_is_refused_and_nothing_is_written(
    fw: FollowWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A client that built its request from state that has moved since (a touch recorded in between): the database rebuilds the request and refuses the difference."""
    from app.followups.repository import PostgrestFollowupsRepository

    lead = fw.due_lead("s226")
    repo = fw.client.app.state.runtime.followups  # type: ignore[attr-defined]
    assert isinstance(repo, PostgrestFollowupsRepository)
    stale = repo.lead_snapshot(fw.owner.token, uuid.UUID(fw.t.id), uuid.UUID(lead.id))
    fw.plant_touch(
        lead, "in", "now() - interval '1 minute'"
    )  # state moves behind the reader's back
    monkeypatch.setattr(repo, "lead_snapshot", lambda token, tenant, lead_id: stale)
    refused(fw.draft("sales", lead), "SM226")
    assert fw.drafts_of(lead) == []


def test_sm227_the_stops_reachable_through_the_api(fw: FollowWorld) -> None:
    def shown_as_stopped(lead: Lead, reason: str) -> None:
        """Commit 4b: a lead the database stopped is shown as `stop` with that reason (never the engine's 'draft_followup', which does not know orders) and is not in the due list."""
        page = fw.call("GET", f"/leads/{lead.id}/followup", "sales").json()
        assert page["decision"] == {
            "action": "stop",
            "reason_code": reason,
            "terminal": True,
            "touch_number": None,
            "next_eligible_at": None,
            "engine_version": "none",
        }
        assert lead.id not in {
            i["lead_id"] for i in fw.call("GET", "/followups/due", "sales").json()
        }

    live = fw.due_lead("s227live")  # not stopped: the engine answers and the lead is due
    assert (
        fw.call("GET", f"/leads/{live.id}/followup", "sales").json()["decision"]["action"]
        == "draft_followup"
    )
    assert live.id in {i["lead_id"] for i in fw.call("GET", "/followups/due", "sales").json()}
    archived = fw.due_lead("s227a")
    fw.archive_lead(archived)
    refused(fw.draft("sales", archived), "SM227", "lead_archived")
    shown_as_stopped(archived, "lead_archived")
    assert (
        fw.call("GET", f"/leads/{archived.id}/followup", "sales").json()["gate"]["stopped"]
        == "lead_archived"
    )
    # orders through the real quote and order path: accepted, declined, cancelled
    qw = QuoteWorld(fw.w, fw.t, n_products=2)
    qw.price_version([qw.item(0, 400000, 4, 500)])
    qw.policy_version()
    ow = OrderWorld(qw)
    ow.policy()
    for label, event, expected in (
        ("s227x", "customer_accept", "order_accepted"),
        ("s227y", "customer_decline", "order_declined"),
        ("s227z", "cancel", "order_cancelled"),
    ):
        lead = fw.due_lead(label)
        _, requirement = qw.requirement([("kanjivaram", 12)], lead_id=lead.id)
        assert qw.pick(requirement, 1, 0, 12).status_code == 200
        quote = str(qw.create(requirement).json()["quote_id"])
        assert qw.approve(quote).status_code == 200
        order = ow.create_order(quote)
        assert order.status_code == 200, order.text
        order_id = str(order.json()["order_id"])
        if event != "cancel":
            assert ow.run_event(order_id, "sales", "send_quote").response.status_code == 200
            reason = "price" if event == "customer_decline" else None
            assert ow.run_event(order_id, "sales", event, reason=reason).response.status_code == 200
        else:
            assert ow.run_event(order_id, "admin", "cancel").response.status_code == 200
        refused(fw.draft("sales", lead), "SM227", expected)
        assert (
            fw.call("GET", f"/leads/{lead.id}/followup", "sales").json()["gate"]["stopped"]
            == expected
        )
        shown_as_stopped(lead, expected)
    withdrawn = fw.due_lead("s227w")
    _, requirement = qw.requirement([("kanjivaram", 12)], lead_id=withdrawn.id)
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    quote = str(qw.create(requirement).json()["quote_id"])
    assert qw.approve(quote).status_code == 200
    w = fw.w.stack
    assert (
        httpx.post(
            f"{w.rest}/rpc/withdraw_approved_quote",
            headers=w.headers(fw.owner.token),
            json={"p_quote_id": quote, "p_code": "price_changed"},
            timeout=60,
        ).status_code
        == 200
    )
    refused(fw.draft("sales", withdrawn), "SM227", "quote_withdrawn")
    shown_as_stopped(withdrawn, "quote_withdrawn")


def test_sm229_the_touch_cap(fw: FollowWorld) -> None:
    lead = fw.lead("s229")
    fw.sql(
        f"insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) select gen_random_uuid(), tenant_id, id, contact_id, 'in', 'email', now() - make_interval(secs => n) from public.leads, generate_series(1, 500) n where id = '{lead.id}'"
    )
    refused(fw.touch("sales", lead, "in"), "SM229")
    refused(fw.touch("sales", lead, "out"), "SM229")


# ============================================================================ the times
def test_the_time_rules_of_a_touch_through_the_api(fw: FollowWorld) -> None:
    lead = fw.lead("times", age_days=3)
    now = datetime.now(UTC)

    def at(delta: timedelta, direction: str = "in") -> httpx.Response:
        return fw.call(
            "POST",
            f"/leads/{lead.id}/touches",
            "sales",
            {
                "id": uid(),
                "direction": direction,
                "channel": "email",
                "occurred_at": (now + delta).isoformat(),
            },
        )

    for bad, why in (
        (at(timedelta(minutes=5)), "the future"),
        (at(timedelta(days=-4)), "before the lead existed"),
        (at(timedelta(days=-8)), "over seven days"),
    ):
        assert bad.status_code == 422 and err(bad)["code"] == "invalid_value", why
    assert (
        fw.call(
            "POST",
            f"/leads/{lead.id}/touches",
            "sales",
            {
                "id": uid(),
                "direction": "in",
                "channel": "email",
                "occurred_at": "2026-10-05T10:00:00",
            },
        ).status_code
        == 422
    )  # naive time
    assert at(timedelta(days=-2), "out").status_code == 201
    assert (
        at(timedelta(days=-2, hours=-1), "out").status_code == 422
    )  # an outbound touch before the latest outbound touch
    assert at(timedelta(days=-2, hours=-1), "in").status_code == 201  # a reply may be recorded late
    assert fw.touch("sales", lead).status_code == 201  # null is now


def test_a_touch_replays_and_conflicts(fw: FollowWorld) -> None:
    lead = fw.lead("replay")
    tid = uid()
    first = fw.touch("sales", lead, "in", touch_id=tid)
    assert first.status_code == 201
    again = fw.touch("owner", lead, "in", touch_id=tid)
    assert again.status_code == 200 and again.json()["replayed"] is True
    other = fw.touch("sales", lead, "in", "whatsapp", touch_id=tid)
    assert other.status_code == 409 and err(other)["code"] == "conflict"
    assert len(fw.touches_of(lead)) == 1


def test_an_unknown_lead_or_draft_is_a_404_and_a_malformed_id_too(fw: FollowWorld) -> None:
    for path in (
        f"/leads/{uuid.uuid4()}/followup",
        f"/followup-drafts/{uuid.uuid4()}",
        "/leads/not-a-uuid/followup",
        "/followup-drafts/not-a-uuid",
    ):
        assert fw.call("GET", path, "sales").status_code == 404, path
    assert (
        fw.call(
            "POST",
            f"/leads/{uuid.uuid4()}/followup-drafts",
            "sales",
            {"id": uid(), "channel": "email"},
        ).status_code
        == 404
    )
    assert (
        fw.call(
            "POST", f"/followup-drafts/{uuid.uuid4()}/sent", "sales", {"touch_id": uid()}
        ).status_code
        == 404
    )


# ============================================================================ question drafts
def test_question_drafts_end_to_end_with_random_ids(fw: FollowWorld) -> None:
    qw = QuoteWorld(fw.w, fw.t, n_products=2)
    _, requirement = qw.requirement([("kanjivaram", 12)], city=None)
    first = fw.call("POST", f"/requirements/{requirement}/question-drafts/sync", "sales")
    assert first.status_code == 200, first.text
    drafts = first.json()["drafts"]
    assert drafts and all(d["status"] == "draft" and d["line_no"] in range(0, 6) for d in drafts)
    texts = {d["question_code"]: d["question_text"] for d in drafts}
    assert (
        "missing_delivery_city" in texts
        and texts["missing_delivery_city"] == "Which city should we deliver to?"
    )
    ids = {d["id"] for d in drafts}
    again = fw.call("POST", f"/requirements/{requirement}/question-drafts/sync", "admin")
    assert (
        again.status_code == 200
        and again.json()["changed"] == 0
        and {d["id"] for d in again.json()["drafts"]} == ids
    )  # a true retry changes nothing
    target = drafts[0]["id"]
    approved = fw.call("POST", f"/question-drafts/{target}/approve", "sales")
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert fw.call("POST", f"/question-drafts/{target}/approve", "owner").json()["replayed"] is True
    assert (
        fw.call("POST", f"/question-drafts/{target}/discard", "sales").json()["status"]
        == "discarded"
    )
    refused_q = fw.call("POST", f"/question-drafts/{target}/approve", "sales")
    refused(refused_q, "SM223", "closed")
    # the discarded question comes back on the next sync, under a NEW random id (a derived id would collide)
    third = fw.call("POST", f"/requirements/{requirement}/question-drafts/sync", "sales")
    assert third.status_code == 200 and third.json()["changed"] >= 1
    new_ids = {d["id"] for d in third.json()["drafts"]}
    assert target not in new_ids
    listed = fw.call("GET", f"/requirements/{requirement}/question-drafts", "sales").json()
    assert {d["id"] for d in listed} == new_ids
    assert (
        fw.call("GET", f"/requirements/{requirement}/question-drafts", "viewer").status_code == 403
    )
    assert (
        fw.call("POST", f"/requirements/{uuid.uuid4()}/question-drafts/sync", "sales").status_code
        == 404
    )
    assert (
        fw.sql(
            f"select count(*) from public.audit_events where entity_type = 'question_draft' and tenant_id = '{fw.t.id}'"
        )
        != "0"
    )


def test_a_question_that_is_no_longer_derived_is_resolved_by_the_next_sync(fw: FollowWorld) -> None:
    from quote_support import rpc

    qw = QuoteWorld(fw.w, fw.t, n_products=2)
    enquiry, requirement = qw.requirement([("kanjivaram", 12)], city=None, confirm=False)
    first = fw.call("POST", f"/requirements/{requirement}/question-drafts/sync", "sales").json()[
        "drafts"
    ]
    city = next(d for d in first if d["question_code"] == "missing_delivery_city")
    added = rpc(
        fw.w,
        fw.sales.token,
        "add_requirement_field",
        p_enquiry_id=enquiry,
        p_line=None,
        p_key="delivery_city",
        p_value_text="Hyderabad",
    )
    assert added.status_code == 200, added.text
    after = fw.call("POST", f"/requirements/{requirement}/question-drafts/sync", "sales")
    assert after.status_code == 200 and after.json()["changed"] >= 1
    assert city["id"] not in {d["id"] for d in after.json()["drafts"]}
    assert (
        fw.sql(
            f"select status || '/' || discard_code from public.question_drafts where id = '{city['id']}'"
        )
        == "discarded/resolved"
    )


# ============================================================================ direct PostgREST: the data layer refuses by itself
def test_no_client_writes_a_follow_up_table_and_a_viewer_reads_none(fw: FollowWorld) -> None:
    lead = fw.due_lead("direct")
    draft_id = fw.made_draft(lead)
    stack = fw.w.stack
    for table, row in (
        (
            "lead_touches",
            {
                "id": uid(),
                "tenant_id": fw.t.id,
                "lead_id": lead.id,
                "direction": "in",
                "channel": "email",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        ),
        ("followup_drafts", {"id": uid(), "tenant_id": fw.t.id}),
        ("followup_policy_versions", {"id": uid(), "tenant_id": fw.t.id}),
        ("question_drafts", {"id": uid(), "tenant_id": fw.t.id}),
    ):
        for user in (fw.owner, fw.admin, fw.sales):
            assert pg(stack, user, "POST", f"/{table}", json=row).status_code in (401, 403), (
                table,
                user.label,
            )
            assert pg(
                stack,
                user,
                "PATCH",
                f"/{table}?id=eq.{draft_id}",
                json={
                    "followup_drafts": {"status": "approved"},
                    "lead_touches": {"channel": "phone"},
                    "followup_policy_versions": {"max_touches": 9},
                    "question_drafts": {"status": "approved"},
                }[table],
            ).status_code in (401, 403, 404), (table, user.label)
            assert pg(stack, user, "DELETE", f"/{table}?id=eq.{draft_id}").status_code in (
                401,
                403,
            ), (table, user.label)
        assert pg(stack, None, "GET", f"/{table}").status_code in (401, 403)
        assert pg(stack, fw.viewer, "GET", f"/{table}?tenant_id=eq.{fw.t.id}").json() == [], table
        assert (
            pg(stack, fw.w.b.users["owner"], "GET", f"/{table}?tenant_id=eq.{fw.t.id}").json() == []
        ), table
    assert fw.drafts_of(lead)[0]["status"] == "draft"


def test_the_definer_functions_refuse_a_viewer_and_another_workspace_with_one_answer(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("rpc")
    stack = fw.w.stack
    body = {
        "p_touch_id": uid(),
        "p_lead_id": lead.id,
        "p_direction": "in",
        "p_channel": "email",
        "p_occurred_at": None,
    }
    answers = {
        httpx.post(
            f"{stack.rest}/rpc/record_touch", headers=stack.headers(u.token), json=body, timeout=60
        ).text
        for u in (fw.viewer, fw.w.b.users["owner"], fw.w.b.users["sales"])
    }
    unknown = httpx.post(
        f"{stack.rest}/rpc/record_touch",
        headers=stack.headers(fw.viewer.token),
        json={**body, "p_lead_id": uid()},
        timeout=60,
    ).text
    assert answers == {unknown} and "42501" in unknown
    assert fw.touches_of(lead) == fw.touches_of(lead) and all(
        t["direction"] == "out" for t in fw.touches_of(lead)
    )


def test_the_responses_never_carry_a_key_or_the_engine_texts(fw: FollowWorld) -> None:
    lead = fw.due_lead("canary")
    draft_id = fw.made_draft(lead)
    keys = fw.sql(
        f"select concat_ws(' ', email_hmac, phone_hmac) from suppression.contact_keys where contact_id = '{lead.contact_id}'"
    ).split()
    assert len(keys) == 2
    bodies = [
        fw.call("GET", f"/leads/{lead.id}/followup", "sales").text,
        fw.call("GET", f"/followup-drafts/{draft_id}", "sales").text,
        fw.call("GET", "/followup-drafts", "sales").text,
        fw.call("GET", "/followups/due", "sales").text,
        fw.draft("sales", lead).text,
    ]
    for text in bodies:
        assert (
            not any(k in text for k in keys)
            and "request_text" not in text
            and "result_text" not in text
            and "canonical_hash" not in text
        )
