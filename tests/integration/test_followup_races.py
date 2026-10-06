"""T010 part 2, commit 2, on the REAL stack: TWO connections racing (ADR 0022; lock order CONTACT row (share), LEAD row (update), the suppression key's advisory lock (shared), then the follow-up rows).
As in test_order_races, a psql session HOLDS an open transaction (it runs the function and sleeps before it commits) while a second connection (our API, or PostgREST as the real client) does the
competing write:

  * lock probes: record_touch and create_followup_draft hold the contact row (share), the lead row and the key's advisory lock (shared); suppress_contact holds the contact row and the key's lock
    exclusively and takes no lead lock;
  * draft vs record_touch, in both directions: a draft made from a state that moved is refused (SM226); a touch recorded behind an open draft supersedes it;
  * approve vs suppress, in both directions: never an approved draft for a suppressed contact;
  * create vs create on one lead (different ids, and the same id): one draft, never two;
  * erase vs create, in both directions: an erased contact never keeps an open draft;
  * two contacts that share a key: a suppression of one blocks a draft for the other, whichever commits first;
  * a storm of mixed operations from several clients: no deadlock (the database's own counter), no server error, the invariants hold.
All data is synthetic."""

# ruff: noqa: E501, S608, S311, B023

from __future__ import annotations

import random
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead
from test_requirement_concurrency import Held, _row_is_locked

from app.followups.messages import FOLLOWUP_REFUSALS


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


def timed(action: Callable[[], httpx.Response]) -> tuple[httpx.Response, float]:
    begun = time.monotonic()
    response = action()
    return response, time.monotonic() - begun


def both(
    first: Callable[[], httpx.Response], second: Callable[[], httpx.Response]
) -> list[httpx.Response]:
    barrier = threading.Barrier(2)

    def go(action: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return [f.result(timeout=90) for f in [pool.submit(go, first), pool.submit(go, second)]]


def code(r: httpx.Response) -> str:
    try:
        return str(r.json()["error"]["code"])
    except (ValueError, KeyError, TypeError):
        return ""


def key_locked(tenant: str, kind: str, hmac: str, *, exclusive_probe: bool) -> bool:
    """Is the key's advisory lock held by another session? An exclusive try fails against ANY holder; a shared try fails only against an exclusive one."""
    fn = "pg_try_advisory_xact_lock" if exclusive_probe else "pg_try_advisory_xact_lock_shared"
    got = FollowWorld.sql(
        f"select {fn}(hashtextextended('suppression_key:{tenant}:{kind}:{hmac}', 0))"
    )
    return got == "f"


def deadlocks() -> int:
    return int(
        FollowWorld.sql("select deadlocks from pg_stat_database where datname = current_database()")
    )


# ------------------------------------------------------------------------------ lock probes
def test_record_touch_and_create_hold_the_contact_the_lead_and_the_key_shared(
    fw: FollowWorld,
) -> None:
    for what in ("touch", "draft"):
        lead = fw.due_lead(f"probe-{what}")
        statement = fw.touch_sql(lead) if what == "touch" else fw.create_sql(lead)
        held = Held(fw.sales, statement)
        held.holding()
        try:
            assert _row_is_locked("contacts", lead.contact_id), (
                f"{what}: the contact row lock (share)"
            )
            assert _row_is_locked("leads", lead.id), f"{what}: the lead row lock"
            assert key_locked(fw.t.id, "email", fw.key_of(lead, "email"), exclusive_probe=True), (
                f"{what}: the key's advisory lock"
            )
            assert not key_locked(
                fw.t.id, "email", fw.key_of(lead, "email"), exclusive_probe=False
            ), f"{what}: held SHARED (a second reader is not blocked)"
        finally:
            out = held.finish()
        assert "{" in out


def test_suppress_holds_the_contact_and_the_key_exclusively_and_takes_no_lead_lock(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("probe-suppress")
    held = Held(fw.sales, fw.suppress_sql(lead))
    held.holding()
    try:
        assert _row_is_locked("contacts", lead.contact_id), "the contact row lock"
        assert not _row_is_locked("leads", lead.id), (
            "suppress_contact must not lock the lead (the lock order has the lead BELOW the contact)"
        )
        assert key_locked(fw.t.id, "email", fw.key_of(lead, "email"), exclusive_probe=False), (
            "the key's lock is EXCLUSIVE (even a shared try fails)"
        )
    finally:
        held.finish()


# ------------------------------------------------------------------------------ draft vs record_touch
def test_a_draft_made_from_a_state_that_a_touch_has_since_changed_is_refused(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("r1a")
    held = Held(fw.sales, fw.touch_sql(lead, "out"))
    held.holding()
    response, waited = timed(
        lambda: fw.draft("sales", lead)
    )  # reads the old state, then waits for the lead lock
    held.finish()
    assert response.status_code == 409 and code(response) == "followup_mismatch" and waited > 1.5, (
        response.text,
        waited,
    )
    assert fw.drafts_of(lead) == [] and len(fw.touches_of(lead)) == 2
    fw.invariants()


def test_a_touch_that_waits_for_a_draft_supersedes_it(fw: FollowWorld) -> None:
    lead = fw.due_lead("r1b")
    held = Held(fw.sales, fw.create_sql(lead))
    held.holding()
    response, waited = timed(lambda: fw.touch("sales", lead, "out"))
    held.finish()
    assert response.status_code == 201 and waited > 1.5, (response.text, waited)
    [only] = fw.drafts_of(lead)
    assert (only["status"], only["discard_code"]) == ("discarded", "superseded")
    assert len(fw.touches_of(lead)) == 2
    fw.invariants()


def test_a_reply_that_waits_for_an_approved_draft_discards_it(fw: FollowWorld) -> None:
    lead = fw.due_lead("r1c")
    draft_id = fw.made_draft(lead)
    held = Held(fw.owner, fw.approve_sql(draft_id))
    held.holding()
    response, waited = timed(lambda: fw.touch("sales", lead, "in"))
    held.finish()
    assert response.status_code == 201 and waited > 1.5
    assert (
        fw.get_draft(draft_id)["status"] == "discarded"
        and fw.get_draft(draft_id)["discard_code"] == "reply_recorded"
    )
    refused = fw.sent("sales", draft_id)
    assert refused.status_code == 409 and code(refused) == "draft_state"


# ------------------------------------------------------------------------------ approve vs suppress
def test_a_suppression_that_waits_for_an_approval_discards_the_approved_draft(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("r2a")
    draft_id = fw.made_draft(lead)
    held = Held(fw.owner, fw.approve_sql(draft_id))
    held.holding()
    response, waited = timed(lambda: fw.suppress(lead))
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    shown = fw.get_draft(draft_id)
    assert (shown["status"], shown["discard_code"]) == ("discarded", "suppressed"), shown
    fw.invariants()


def test_an_approval_that_waits_for_a_suppression_is_refused_and_never_stored(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("r2b")
    draft_id = fw.made_draft(lead)
    state_hash = fw.get_draft(draft_id)["state_hash"]
    held = Held(fw.sales, fw.suppress_sql(lead))
    held.holding()
    response, waited = timed(
        lambda: fw.call(
            "POST", f"/followup-drafts/{draft_id}/approve", "owner", {"state_hash": state_hash}
        )
    )
    held.finish()
    assert response.status_code == 409 and code(response) == "draft_state" and waited > 1.5, (
        response.text,
        waited,
    )
    assert response.json()["error"]["reason"] == "not_draft"
    assert fw.get_draft(draft_id)["status"] == "discarded"
    fw.invariants()


def test_approve_and_suppress_at_once_never_leave_an_approved_draft_for_a_suppressed_contact(
    fw: FollowWorld,
) -> None:
    for i in range(5):
        lead = fw.due_lead(f"r2c{i}")
        draft_id = fw.made_draft(lead)
        a, b = both(lambda: fw.approve("owner", draft_id), lambda: fw.suppress(lead))
        assert b.status_code == 200, b.text
        assert a.status_code in (200, 409), a.text
        assert fw.get_draft(draft_id)["status"] == "discarded", (a.text, fw.get_draft(draft_id))
        fw.invariants()


# ------------------------------------------------------------------------------ create vs create
def test_two_creates_for_one_lead_at_once_make_one_draft(fw: FollowWorld) -> None:
    for i in range(5):
        lead = fw.due_lead(f"r3a{i}")
        a, b = both(lambda: fw.draft("sales", lead), lambda: fw.draft("admin", lead))
        assert sorted((a.status_code, b.status_code)) == [201, 409], (a.text, b.text)
        loser = a if a.status_code == 409 else b
        assert code(loser) == "draft_state" and loser.json()["error"]["reason"] == "exists"
        assert len(fw.drafts_of(lead)) == 1
        fw.invariants()


def test_the_same_draft_id_twice_at_once_records_once_and_replays(fw: FollowWorld) -> None:
    for i in range(3):
        lead = fw.due_lead(f"r3b{i}")
        draft_id = uid()
        a, b = both(
            lambda: fw.draft("sales", lead, draft_id=draft_id),
            lambda: fw.draft("sales", lead, draft_id=draft_id),
        )
        assert sorted((a.status_code, b.status_code)) == [200, 201], (a.text, b.text)
        assert len(fw.drafts_of(lead)) == 1


def test_a_second_create_that_waits_for_the_first_is_refused_as_existing(fw: FollowWorld) -> None:
    lead = fw.due_lead("r3c")
    held = Held(fw.sales, fw.create_sql(lead))
    held.holding()
    response, waited = timed(lambda: fw.draft("admin", lead))
    held.finish()
    assert (
        response.status_code == 409
        and response.json()["error"]["reason"] == "exists"
        and waited > 1.5
    ), (response.text, waited)
    assert len(fw.drafts_of(lead)) == 1


# ------------------------------------------------------------------------------ erase vs create
def test_a_create_that_waits_for_an_erasure_is_refused_as_erased(fw: FollowWorld) -> None:
    lead = fw.due_lead("r4a")
    request = fw.erase_request(lead)
    held = Held(fw.owner, f"select public.execute_erasure('{request}', false)")
    held.holding()
    response, waited = timed(lambda: fw.draft("sales", lead))
    held.finish()
    assert (
        response.status_code == 409
        and code(response) == "contact_blocked"
        and response.json()["error"]["reason"] == "erased"
        and waited > 1.5
    ), (response.text, waited)
    assert fw.drafts_of(lead) == []


def test_an_erasure_that_waits_for_a_create_discards_the_new_draft_as_erased(
    fw: FollowWorld,
) -> None:
    lead = fw.due_lead("r4b")
    request = fw.erase_request(lead)
    held = Held(fw.sales, fw.create_sql(lead))
    held.holding()
    response, waited = timed(lambda: fw.execute_erasure(request))
    held.finish()
    assert (
        response.status_code == 200 and response.json()["status"] == "executed" and waited > 1.5
    ), (response.text, waited)
    [only] = fw.drafts_of(lead)
    assert (only["status"], only["discard_code"]) == ("discarded", "erased")
    fw.invariants()


def test_erase_and_create_at_once_never_leave_an_open_draft_for_an_erased_contact(
    fw: FollowWorld,
) -> None:
    for i in range(4):
        lead = fw.due_lead(f"r4c{i}")
        request = fw.erase_request(lead)
        a, b = both(lambda: fw.execute_erasure(request), lambda: fw.draft("sales", lead))
        assert a.status_code == 200, a.text
        assert b.status_code in (201, 409), b.text
        assert all(d["status"] == "discarded" for d in fw.drafts_of(lead)), fw.drafts_of(lead)
        fw.invariants()


# ------------------------------------------------------------------------------ two contacts that share a key
def test_a_suppression_of_a_contact_that_shares_the_number_blocks_the_other_whichever_commits_first(
    fw: FollowWorld,
) -> None:
    shared = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    a = fw.due_lead("r5a", phone_number=shared)
    b = fw.lead("r5b", phone_number=shared)
    # (1) the draft commits first, the suppression of the OTHER contact waits for the key's shared lock, then the draft stays (the gate runs at approval and "sent")
    held = Held(fw.sales, fw.create_sql(a, channel="whatsapp"))
    held.holding()
    response, waited = timed(lambda: fw.suppress(b))
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    [mine] = fw.drafts_of(a)
    assert mine["status"] == "draft"
    refused = fw.approve(
        "owner", mine["id"]
    )  # the gate again, at approval: the key is suppressed now
    assert refused.status_code == 409 and refused.json()["error"]["reason"] == "key", refused.text
    # (2) the suppression holds the key exclusively first: a draft for the other contact waits, then is refused
    c = fw.due_lead("r5c", phone_number=(shared2 := "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"))
    d = fw.lead("r5d", phone_number=shared2)
    held2 = Held(fw.sales, fw.suppress_sql(d))
    held2.holding()
    response2, waited2 = timed(lambda: fw.draft("sales", c, "whatsapp"))
    held2.finish()
    assert (
        response2.status_code == 409
        and response2.json()["error"]["reason"] == "key"
        and waited2 > 1.5
    ), (response2.text, waited2)
    assert fw.drafts_of(c) == []


# ------------------------------------------------------------------------------ a storm
def test_a_storm_of_mixed_operations_deadlocks_nothing_errors_nowhere_and_leaves_the_invariants(
    fw: FollowWorld,
) -> None:
    rng = random.Random(20261007)
    shared = "+00 9" + f"{uuid.uuid4().int % 10**9:09d}"
    leads: list[Lead] = [fw.due_lead(f"st{i}") for i in range(5)]
    leads += [fw.due_lead("st-sh1", phone_number=shared), fw.lead("st-sh2", phone_number=shared)]
    before = deadlocks()
    statuses: list[int] = []
    lock = threading.Lock()

    def latest_draft(lead: Lead) -> str | None:
        rows = fw.call("GET", f"/followup-drafts?lead_id={lead.id}&status=active", "owner")
        return str(rows.json()[0]["id"]) if rows.status_code == 200 and rows.json() else None

    def operation(seed: int) -> None:
        local = random.Random(seed)
        lead = local.choice(leads)
        op = local.choice(
            [
                "touch_out",
                "touch_in",
                "draft",
                "draft_wa",
                "approve",
                "discard",
                "sent",
                "suppress",
                "read",
                "gate",
                "draft",
                "approve",
            ]
        )
        if op == "touch_out":
            r = fw.touch("sales", lead, "out", local.choice(["email", "whatsapp"]))
        elif op == "touch_in":
            r = fw.touch("admin", lead, "in")
        elif op in ("draft", "draft_wa"):
            r = fw.draft(
                local.choice(["sales", "admin", "owner"]),
                lead,
                "whatsapp" if op == "draft_wa" else "email",
            )
        elif op == "suppress":
            r = (
                fw.suppress(lead, local.choice(["opted_out", "manual", "bounced"]))
                if local.random() < 0.15
                else fw.call("GET", f"/leads/{lead.id}/followup", "sales")
            )
        elif op == "read":
            r = fw.call("GET", f"/leads/{lead.id}/followup", "sales")
        elif op == "gate":
            r = fw.call("GET", "/followups/due", "sales")
        else:
            draft = latest_draft(lead)
            if draft is None:
                return
            r = {
                "approve": lambda: fw.approve("owner", draft),
                "discard": lambda: fw.call("POST", f"/followup-drafts/{draft}/discard", "admin"),
                "sent": lambda: fw.sent("sales", draft),
            }[op]()
        with lock:
            statuses.append(r.status_code)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for f in [pool.submit(operation, rng.randrange(10**9)) for _ in range(160)]:
            f.result(timeout=300)
    assert statuses and all(s in (200, 201, 403, 404, 409, 422) for s in statuses), sorted(
        set(statuses)
    )
    assert not any(s >= 500 for s in statuses)
    assert deadlocks() == before, "the database detected a deadlock"
    fw.invariants()
    assert len(statuses) > 100


def test_every_code_the_storm_can_meet_is_a_fixed_answer(fw: FollowWorld) -> None:
    """(The storm accepts only 2xx/4xx; this pins that every 409 it can meet is one of OUR fixed codes.)"""
    known = {name for _, name, _ in FOLLOWUP_REFUSALS.values()} | {
        "conflict",
        "invalid_value",
        "validation_error",
        "not_found",
        "forbidden",
        "mfa_required",
        "contact_suppressed",
    }
    lead = fw.due_lead("fixed")
    seen: dict[str, Any] = {}
    for r in (
        fw.draft("sales", lead),
        fw.draft("sales", lead),
        fw.touch("sales", lead, "out", days_ago=9),
    ):
        if r.status_code >= 400:
            seen[r.text] = code(r)
    assert set(seen.values()) <= known, seen
