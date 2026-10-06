"""T010 part 1 on the real stack: TWO connections racing on the suppression keys (ADR 0020). As in test_quote_races, a psql session HOLDS an open transaction (it runs the function and sleeps before
it commits) while a second connection (our API, as the real client) does the competing write:

  * two contacts that share ONE phone number are suppressed at once: the shared key gets ONE suppressed event, not two (the per-key advisory lock);
  * the same two contacts are lifted at once: ONE lifted event (the same lock);
  * recording a contact's keys holds the contact row, so a suppression of that contact waits for it.
Without the lock a competitor would read the key as inactive (the other transaction has not committed) and write its own event. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import TEST_SUPPRESSION_KEY, bearer
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient
from test_requirement_concurrency import Held

from app.suppression.keys import KeyRing, KeyVersion

RING = KeyRing(KeyVersion(1, TEST_SUPPRESSION_KEY.encode()))


@pytest.fixture(scope="module")
def w(eval_world: World) -> World:
    return eval_world


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def contact(client: TestClient, t: Tenant, phone: str) -> str:
    cid = uid()
    r = client.post(
        url(t, "/contacts"),
        json={
            "id": cid,
            "full_name": "Synthetic Person",
            "email": f"race.{uuid.uuid4().hex[:8]}@example.test",
            "phone": phone,
        },
        headers=bearer(t.users["sales"]),
    )
    assert r.status_code == 201, r.text
    return cid


def events(t: Tenant, phone: str, event: str) -> int:
    key = RING.key_for("phone", phone)
    return int(
        operator_sql.sql(
            f"select count(*) from suppression.key_events where tenant_id = '{t.id}' and kind = 'phone' and key_hmac = '{key}' and event = '{event}'"
        ).strip()
    )


def number() -> str:
    return f"+00 9{int(uuid.uuid4().int % 10**9):09d}"


def timed(action: Any) -> tuple[Any, float]:
    begun = time.monotonic()
    response = action()
    return response, time.monotonic() - begun


def test_two_suppressions_of_contacts_sharing_a_number_write_one_event(
    w: World, client: TestClient
) -> None:
    phone = number()
    a, b = contact(client, w.a, phone), contact(client, w.a, phone)
    held = Held(
        w.a.users["sales"],
        f"select public.suppress_contact('{w.a.id}', '{a}', 'opted_out', null, null)",
    )
    held.holding()
    response, waited = timed(
        lambda: client.post(
            url(w.a, f"/contacts/{b}/suppress"),
            json={"reason": "complained"},
            headers=bearer(w.a.users["sales"]),
        )
    )
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (
        response.text,
        waited,
    )  # it waited for the key's lock
    assert events(w.a, phone, "suppressed") == 1, "the shared key was suppressed twice"


def test_two_lifts_of_contacts_sharing_a_number_write_one_event(
    w: World, client: TestClient
) -> None:
    phone = number()
    a, b = contact(client, w.a, phone), contact(client, w.a, phone)
    for c in (a, b):
        assert (
            client.post(
                url(w.a, f"/contacts/{c}/suppress"),
                json={"reason": "opted_out"},
                headers=bearer(w.a.users["sales"]),
            ).status_code
            == 200
        )
    assert events(w.a, phone, "suppressed") == 1
    held = Held(
        w.a.users["owner"],
        f"select public.lift_suppression('{w.a.id}', '{a}', 'written', 'letter:race')",
    )
    held.holding()
    response, waited = timed(
        lambda: client.post(
            url(w.a, f"/contacts/{b}/lift-suppression"),
            json={"evidence_type": "written", "evidence_ref": "letter:race2"},
            headers=bearer(w.a.users["owner"]),
        )
    )
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    assert events(w.a, phone, "lifted") == 1, "the shared key was lifted twice"


def test_a_suppression_waits_for_a_key_recording_on_the_same_contact(
    w: World, client: TestClient
) -> None:
    phone = number()
    c = contact(client, w.a, phone)
    key = RING.key_for("phone", phone)
    held = Held(
        w.a.users["sales"],
        f'select public.record_contact_keys(\'{c}\', \'{{"version": 1, "phone": "{key}"}}\'::jsonb)',
    )
    held.holding()
    response, waited = timed(
        lambda: client.post(
            url(w.a, f"/contacts/{c}/suppress"),
            json={"reason": "opted_out"},
            headers=bearer(w.a.users["sales"]),
        )
    )
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (
        response.text,
        waited,
    )  # the recording holds the contact row until it commits
    assert events(w.a, phone, "suppressed") == 1


def test_two_lifts_at_once_of_contacts_sharing_a_number_release_it(
    w: World, client: TestClient
) -> None:
    """Review fix 1: each lift looks for another suppressed holder. Without the per-key lock held first, two lifts that run together each see the other still suppressed and the
    number stays suppressed for ever; with it the second lift waits, sees the first committed, and releases the number."""
    phone = number()
    a, b = contact(client, w.a, phone), contact(client, w.a, phone)
    for c in (a, b):
        assert (
            client.post(
                url(w.a, f"/contacts/{c}/suppress"),
                json={"reason": "opted_out"},
                headers=bearer(w.a.users["sales"]),
            ).status_code
            == 200
        )
    held = Held(
        w.a.users["owner"],
        f"select public.lift_suppression('{w.a.id}', '{a}', 'written', 'letter:r1')",
    )
    held.holding()
    response, waited = timed(
        lambda: client.post(
            url(w.a, f"/contacts/{b}/lift-suppression"),
            json={"evidence_type": "written", "evidence_ref": "letter:r2"},
            headers=bearer(w.a.users["owner"]),
        )
    )
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    assert events(w.a, phone, "lifted") == 1, "the number was not released (or released twice)"
    key = RING.key_for("phone", phone)
    suppressed = operator_sql.sql(f"select app.key_active('{w.a.id}', 'phone', '{key}')")
    assert suppressed == "f"


def test_two_lifts_at_once_of_contacts_sharing_an_email_key_release_it(
    w: World, client: TestClient
) -> None:
    """The same race for an E-MAIL key. Two addresses cannot share a key through the API (an address is unique per workspace), so the key is recorded through the data layer."""
    a, b = contact(client, w.a, number()), contact(client, w.a, number())
    shared = RING.key_for("email", f"shared.{uuid.uuid4().hex[:8]}@example.test")
    assert shared is not None
    for c in (a, b):
        r = httpx.post(
            f"{w.stack.rest}/rpc/record_contact_keys",
            json={"p_contact_id": c, "p_keys": {"version": 1, "email": shared}},
            headers=w.stack.headers(w.a.users["sales"].token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert (
            client.post(
                url(w.a, f"/contacts/{c}/suppress"),
                json={"reason": "opted_out"},
                headers=bearer(w.a.users["sales"]),
            ).status_code
            == 200
        )
    held = Held(
        w.a.users["owner"],
        f"select public.lift_suppression('{w.a.id}', '{a}', 'written', 'letter:e1')",
    )
    held.holding()
    response, waited = timed(
        lambda: client.post(
            url(w.a, f"/contacts/{b}/lift-suppression"),
            json={"evidence_type": "written", "evidence_ref": "letter:e2"},
            headers=bearer(w.a.users["owner"]),
        )
    )
    held.finish()
    assert response.status_code == 200 and waited > 1.5, (response.text, waited)
    lifted = operator_sql.sql(
        f"select count(*) from suppression.key_events where tenant_id = '{w.a.id}' and kind = 'email' and key_hmac = '{shared}' and event = 'lifted'"
    )
    assert lifted == "1"
    assert operator_sql.sql(f"select app.key_active('{w.a.id}', 'email', '{shared}')") == "f"
