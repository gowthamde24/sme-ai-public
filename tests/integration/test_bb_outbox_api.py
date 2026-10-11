"""Job BB (ADR 0070) on the real stack: the English gloss, the events of a message, the filtered and paged log with its counts, the Dispatch button's counts, and quiet hours per business, through OUR API
with real JWT verification, real PostgREST and the real database functions. The local fake adapter is the only channel; nothing reaches a real one. The worker's signed photo addresses are tested in
test_scheduler_api.py (the worker's own account) and the database rules in pgTAP 81.

Time: like test_outbox_api.py, the module runs twice with the outbox clock pinned to 14:00 IST (day) and 23:30 IST (night), on yesterday's India date."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Any

import operator_sql
import test_outbox_api as _base
from conftest import Stack, aal1_token
from test_outbox_api import PINS, Box, body_of, pin_clock

box = _base.box  # the fixture: it runs this module at both pins

IST = timezone(timedelta(hours=5, minutes=30))


def yesterday() -> str:
    return (datetime.now(IST).date() - timedelta(days=1)).isoformat()


def get(box: Box, user: str, path: str) -> Any:
    return box.call(user, "GET", path)


def make(box: Box, text: str, *, category: str = "other", **extra: Any) -> tuple[str, Any]:
    """A message that waits for a person (category 'other' is never automatic)."""
    lead = box.lead()
    mid = str(uuid.uuid4())
    r = box.submit("sales", lead, text, category=category, message_id=mid, **extra)
    assert r.status_code == 200, r.text
    return mid, r.json()["message"]


# ---------------------------------------------------------------------------------------------- the gloss
def test_the_gloss_is_stored_edited_cleared_and_shown(box: Box) -> None:
    mid, message = make(box, "మీ కోసం కొత్త చీరలు ఉన్నాయి.", language="te", gloss_en="We have new sarees for you.")
    assert message["status"] == "needs_approval" and message["gloss_en"] == "We have new sarees for you."
    assert get(box, "sales", f"/outbox/messages/{mid}").json()["gloss_en"] == "We have new sarees for you."
    r = box.call("owner", "POST", f"/outbox/messages/{mid}/edit", {"text": "మీ కోసం కొత్త పట్టు చీరలు ఉన్నాయి.", "gloss_en": "We have new silk sarees for you."})
    assert r.status_code == 200 and r.json()["gloss_en"] == "We have new silk sarees for you."
    r = box.call("owner", "POST", f"/outbox/messages/{mid}/edit", {"text": "మళ్ళీ కొత్త చీరలు ఉన్నాయి."})
    assert r.status_code == 200 and r.json()["gloss_en"] is None, "editing the words without a gloss clears the old one"
    assert operator_sql.sql(f"select gloss_en is null from public.outbox_messages where id = '{mid}'") == "t"


def test_a_retry_with_another_gloss_is_a_conflict_and_a_bad_gloss_is_refused(box: Box) -> None:
    lead = box.lead()
    mid = str(uuid.uuid4())
    first = box.submit("sales", lead, "A note from the shop.", category="other", message_id=mid, gloss_en="A note from the shop (gloss).")
    assert first.status_code == 200
    same = box.submit("sales", lead, "A note from the shop.", category="other", message_id=mid, gloss_en="A note from the shop (gloss).")
    assert same.status_code == 200 and same.json()["replayed"] is True
    other = box.submit("sales", lead, "A note from the shop.", category="other", message_id=mid, gloss_en="A different gloss.")
    assert other.status_code == 409, other.text
    bad = box.submit("sales", box.lead(), "Hello there friend.", category="other", gloss_en="x")
    assert bad.status_code == 422


def test_the_gloss_is_erased_with_the_contact(box: Box) -> None:
    mid, _ = make(box, "Hello Zed Qxjv, we have your saree.", gloss_en="Hello Zed Qxjv, we have your saree.")
    assert operator_sql.sql(f"select gloss_en from public.outbox_messages where id = '{mid}'").startswith("Hello Zed")
    # the registry says the gloss goes with the words (the erase functions are pinned by test_migration_copies_bb.py and run in pgTAP 39 to 44)
    assert operator_sql.sql("select count(*) from erasure.registry where table_name = 'outbox_messages' and column_name = 'gloss_en'") == "4"


# ---------------------------------------------------------------------------------------------- events
def test_the_detail_lists_the_steps_with_who_and_when_and_no_text(box: Box) -> None:
    text = f"Unique words {uuid.uuid4().hex[:8]} for the event test."
    mid, _ = make(box, text)
    box.call("owner", "POST", f"/outbox/messages/{mid}/edit", {"text": text + " Edited."})
    approved = box.call("owner", "POST", f"/outbox/messages/{mid}/approve")
    assert approved.status_code == 200, approved.text
    detail = get(box, "sales", f"/outbox/messages/{mid}").json()
    steps = detail["events"]
    kinds = [e["kind"] for e in steps]
    assert kinds[:4] == ["made", "needs_approval", "edited", "approved"], kinds
    night = box.pin_name == "night"
    assert (kinds[4:] == ["held"]) if night else (kinds[4:] == ["sent"]), kinds
    owner = str(box.w.a.users["owner"].id)
    assert steps[0]["actor"]["kind"] == "person" and steps[0]["actor"]["user_id"] == str(box.w.a.users["sales"].id)
    assert steps[2]["actor"]["user_id"] == owner and steps[3]["actor"]["user_id"] == owner
    assert steps[1]["actor"] == {"kind": "system", "user_id": None, "name": None} and steps[1]["reason"] == "category_other"
    assert set(steps[0]) == {"kind", "reason", "reason_text", "at", "actor"}
    assert text not in str(steps) and "Edited" not in str(steps), "no message text in an event"
    times = [e["at"] for e in steps]
    assert times == sorted(times), "in order"
    # the log and the approvals list carry no events
    assert all(i["events"] is None for i in get(box, "owner", "/outbox/messages?limit=5").json()["items"])


def test_a_rejection_and_a_block_are_their_own_steps(box: Box) -> None:
    mid, _ = make(box, "Some words that will be rejected.")
    box.call("owner", "POST", f"/outbox/messages/{mid}/reject")
    kinds = [e["kind"] for e in get(box, "owner", f"/outbox/messages/{mid}").json()["events"]]
    assert kinds == ["made", "needs_approval", "rejected"], kinds


def test_events_are_not_readable_directly_by_a_viewer_or_another_business(box: Box) -> None:
    mid, _ = make(box, "Words for the visibility test.")
    assert box.call("viewer", "GET", f"/outbox/messages/{mid}").status_code == 403
    assert box.call("owner", "GET", f"/outbox/messages/{mid}", tenant=str(box.w.b.id)).status_code in (403, 404)
    assert int(operator_sql.sql(f"select count(*) from public.outbox_events where message_id = '{mid}'")) >= 2


# ---------------------------------------------------------------------------------------------- the filtered log and the counts
def test_the_log_filters_by_tab_customer_and_date_and_pages_by_cursor(box: Box) -> None:
    marker = uuid.uuid4().hex[:8]
    made = [make(box, f"Words number {n} {marker} for the log test.") for n in range(3)]
    ids = [m[0] for m in made]
    customers = {m[1]["customer"] for m in made}
    assert all(c for c in customers)
    one = made[0][1]["customer"]
    day = yesterday()
    waiting = get(box, "owner", f"/outbox/messages?tab=waiting&from={day}&to={day}&limit=100").json()
    assert set(ids) <= {i["id"] for i in waiting["items"]}
    by_name = get(box, "owner", f"/outbox/messages?customer={one[:12]}&limit=100").json()
    assert made[0][0] in {i["id"] for i in by_name["items"]}
    assert all(i["customer"] and one[:12].lower() in i["customer"].lower() for i in by_name["items"]), "only that customer's"
    # the words are never searched
    assert get(box, "owner", f"/outbox/messages?customer={marker}").json()["items"] == []
    # dates: yesterday holds them, today does not
    today = datetime.now(IST).date().isoformat()
    assert get(box, "owner", f"/outbox/messages?tab=waiting&from={today}").json()["items"] == []
    # a tab the messages are not in
    sent_tab = {i["id"] for i in get(box, "owner", f"/outbox/messages?tab=sent&from={day}&to={day}&limit=100").json()["items"]}
    assert not (set(ids) & sent_tab)
    # paging: limit 1 walks the waiting tab without a gap or a repeat
    seen: list[str] = []
    cursor = ""
    for _ in range(200):
        page = get(box, "owner", f"/outbox/messages?tab=waiting&limit=1{cursor}").json()
        seen += [i["id"] for i in page["items"]]
        if not page["next_cursor"]:
            break
        cursor = f"&after={page['next_cursor']}"
    assert len(seen) == len(set(seen)), "no repeat"
    assert set(ids) <= set(seen), "no gap"
    assert seen[: len(seen)] == [i["id"] for i in get(box, "owner", "/outbox/messages?tab=waiting&limit=100").json()["items"]][: len(seen)]


def test_the_filters_are_validated_and_exclusive(box: Box) -> None:
    for bad in ("tab=bogus", "customer=a", "from=nope", "tab=sent&status=sent", f"customer=Ravi&lead_id={uuid.uuid4()}"):
        assert get(box, "owner", f"/outbox/messages?{bad}").status_code == 422, bad
    assert get(box, "viewer", "/outbox/messages?tab=sent").status_code == 403
    assert get(box, "owner", "/outbox/messages?from=2026-10-04&to=2026-10-01").status_code in (400, 422)


def test_the_summary_counts_the_tabs_and_what_dispatch_would_do(box: Box) -> None:
    make(box, f"Words {uuid.uuid4().hex[:8]} for the summary.")
    s = get(box, "owner", "/outbox/summary").json()
    assert set(s) == {"waiting", "scheduled", "sent", "blocked", "due_now", "held_for_later"}
    assert s["waiting"] >= 1 and all(isinstance(v, int) and v >= 0 for v in s.values())
    day = yesterday()
    narrow = get(box, "owner", f"/outbox/summary?from={day}&to={day}").json()
    assert narrow["waiting"] <= s["waiting"] and narrow["due_now"] == s["due_now"], "due_now is not narrowed"
    assert get(box, "sales", "/outbox/summary").status_code == 200
    assert get(box, "viewer", "/outbox/summary").status_code == 403
    assert box.call("owner", "GET", "/outbox/summary", tenant=str(box.w.b.id)).status_code in (403, 404)


def test_the_dispatch_button_is_this_businesses_and_says_what_is_still_waiting(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    r = box.submit("sales", lead, "Thank you for writing to us, we are open today.", category="reply_to_inbound")
    assert r.status_code == 200
    out = box.call("owner", "POST", "/outbox/dispatch").json()
    assert set(out) == {"sent", "failed", "retry_later", "still_due", "held_for_later", "platform_switch_on"}
    assert out["platform_switch_on"] is True and out["retry_later"] == 0
    summary = get(box, "owner", "/outbox/summary").json()
    assert out["held_for_later"] == summary["held_for_later"] and out["still_due"] == summary["due_now"]
    if box.pin_name == "night":
        assert out["held_for_later"] >= 1, "at 23:30 a message waits for the morning"
    assert box.call("sales", "POST", "/outbox/dispatch").status_code == 403
    other = box.call("owner", "POST", "/outbox/dispatch", box="b", tenant=str(box.w.b.id))
    assert other.status_code == 200 and other.json()["sent"] == 0, "business B's button only ever touches business B"


# ---------------------------------------------------------------------------------------------- quiet hours per business
def test_quiet_hours_are_read_set_by_the_owner_with_a_second_factor_and_used_by_the_policy(box: Box, stack: Stack) -> None:
    default = body_of(box.call("admin", "GET", "/outbox/settings"))
    assert (default["quiet_hours_start"], default["quiet_hours_end"]) == (21, 9)
    base = {"auto_send_enabled": True, "per_customer_daily_limit": 3}
    try:
        # the Owner (aal2) sets 19:00 to 10:00
        r = box.call("owner", "PUT", "/outbox/settings", {**base, "quiet_hours_start": 19, "quiet_hours_end": 10})
        assert r.status_code == 200 and (r.json()["quiet_hours_start"], r.json()["quiet_hours_end"]) == (19, 10)
        # refusals
        assert box.client.put(box.url("/outbox/settings"), json={**base, "quiet_hours_start": 20}, headers={"Authorization": f"Bearer {aal1_token(stack, box.w.a.users['owner'])}"}).status_code == 403
        assert box.call("admin", "PUT", "/outbox/settings", {**base, "quiet_hours_start": 20}).status_code == 403
        assert box.call("sales", "PUT", "/outbox/settings", {**base, "quiet_hours_start": 20}).status_code == 403
        for bad in ({"quiet_hours_start": 18}, {"quiet_hours_start": 24}, {"quiet_hours_end": 6}, {"quiet_hours_end": 11}):
            assert box.call("owner", "PUT", "/outbox/settings", {**base, **bad}).status_code == 422, bad
        # a field left out keeps its value
        r = box.call("owner", "PUT", "/outbox/settings", base)
        assert (r.json()["quiet_hours_start"], r.json()["quiet_hours_end"]) == (19, 10)
        # the policy reads this business's hours: at 09:30 (open by default) the message is held until 10:00
        pin_clock(time(9, 30))
        lead = box.lead()
        box.inbound(lead, ago="30 minutes")
        m = box.submit("sales", lead, "Thank you for writing to us, we are open today.", category="reply_to_inbound").json()["message"]
        assert (m["status"], m["reason"]) == ("queued", "quiet_hours"), m
        yest = datetime.now(IST).date() - timedelta(days=1)
        assert datetime.fromisoformat(m["scheduled_for"]) == datetime.combine(yest, time(10, 0), tzinfo=IST)
        # business B has its own (default) hours: 09:30 is open for it
        assert operator_sql.sql(f"select app.outbox_in_quiet_hours(app.outbox_now(), '{box.w.b.id}')") == "f"
        assert operator_sql.sql(f"select app.outbox_in_quiet_hours(app.outbox_now(), '{box.tenant}')") == "t"
    finally:
        box.call("owner", "PUT", "/outbox/settings", {**base, "quiet_hours_start": 21, "quiet_hours_end": 9})
        pin_clock(PINS[box.pin_name])
