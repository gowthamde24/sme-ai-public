"""Google Calendar 2-way sync (appointment booking slice 4) against a fake Google and an in-memory database: the signed state and PKCE, the event we write (no phone number, ours only), the
worker's pass (write, change, delete, leave, back-off, a revoked token, busy times without our own events, the push channel, a workspace erasure), and the HTTP doors (roles, second factor,
not configured, the public callback and push, disconnect). The database's own rules are pgTAP 206."""

# ruff: noqa: E501

from __future__ import annotations

import dataclasses
import datetime as dt
import logging
import urllib.parse
import uuid
from typing import Any

import pytest

from app.google_calendar.fake import FakeGoogle
from app.google_calendar.google import SCOPES, GoogleError, HttpGoogle
from app.google_calendar.service import GoogleCalendarService
from app.google_calendar.state import StateSigner, code_challenge
from app.google_calendar.sync import (
    GoogleCalendarSync,
    event_body,
    event_id_for,
    person_label,
    subtract,
)
from app.google_calendar.vault import LinkSecret, Vault
from app.workspace_secrets import FakeSecretStore
from tests.fakes import TENANT_A, USERS, auth, make_client
from tests.google_calendar_fakes import FakeCalendarDb, StaticSession

T = f"/v1/tenants/{TENANT_A.id}/integrations/google-calendar"
P = "/v1/integrations/google-calendar"
TENANT = TENANT_A.id
SECRET = f"sme-ws-{TENANT}-google_calendar"
KEY = b"fake-state-key-for-tests-0123456789"


def soon(hours: float = 24) -> dt.datetime:
    return (dt.datetime.now(dt.UTC) + dt.timedelta(hours=hours)).replace(microsecond=0)


class World:
    def __init__(self) -> None:
        self.db = FakeCalendarDb(USERS["a_owner"])
        self.google = FakeGoogle()
        self.store = FakeSecretStore()
        self.vault = Vault(self.store, b"fake-fingerprint-key")
        self.session = StaticSession()
        self.svc = GoogleCalendarService(self.db, self.google, self.vault, StateSigner(KEY), self.session,  # type: ignore[arg-type]
                                         public_base_url="https://api.example.test", web_base_url="https://web.example.test")
        self.sync = GoogleCalendarSync(self.db, self.google, self.vault, public_base_url="https://api.example.test")  # type: ignore[arg-type]
        self.client, _ = make_client()
        rt = self.client.app.state.runtime  # type: ignore[attr-defined]
        self.client.app.state.runtime = dataclasses.replace(rt, google_calendar=self.svc)  # type: ignore[attr-defined]

    def call(self, method: str, path: str, user: str | None, body: Any = None, **claims: Any) -> Any:
        return self.client.request(method, path, json=body, headers=auth(user, **claims) if user else {})

    def connect(self) -> str:
        r = self.call("POST", T + "/connect", "a_owner")
        assert r.status_code == 200, r.text
        url = r.json()["authorize_url"]
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        back = self.client.get(P + "/callback", params={"code": q["code"], "state": q["state"]}, follow_redirects=False)
        assert back.status_code == 303
        return str(back.headers["location"])

    def tick(self) -> dict[str, int]:
        self.db.make_due()
        return self.sync.run("scheduler-token-fake")


@pytest.fixture
def w() -> World:
    return World()


# ------------------------------------------------------------------------------------------------ the state, PKCE, the event body
def test_the_state_is_signed_expires_and_carries_a_pkce_verifier_nobody_stores() -> None:
    clock = [1_000_000.0]
    s = StateSigner(KEY, clock=lambda: clock[0])
    t, m, n = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    state = s.sign(t, m, n)
    got = s.verify(state)
    assert got is not None and (got.tenant_id, got.member_id, got.nonce) == (t, m, n)
    assert s.verify(state[:-2] + ("AA" if not state.endswith("AA") else "BB")) is None   # tampered
    assert StateSigner(b"another-key-another-key-0000").verify(state) is None
    clock[0] += 601
    assert s.verify(state) is None                                                        # 10 minutes
    v = s.code_verifier(n)
    assert v == s.code_verifier(n) and 43 <= len(v) <= 128 and code_challenge(v) != v


def test_the_event_names_first_name_and_initial_never_a_phone_number_and_is_marked_ours() -> None:
    vid = uuid.uuid4()
    body = event_body({"visit_id": str(vid), "person_name": "Priya Sharma", "purpose": "Bridal saree, call +91 98765 43210 or priya@example.test", "party_size": 3,
                       "starts_at": "2026-11-20T04:30:00+00:00", "ends_at": "2026-11-20T05:00:00+00:00"})
    assert body["summary"] == "Appointment: Priya S."
    assert "98765" not in body["description"] and "@" not in body["description"]
    assert body["description"].startswith("Purpose: Bridal saree") and body["description"].endswith("Party size: 3")
    assert body["start"] == {"dateTime": "2026-11-20T10:00:00+05:30", "timeZone": "Asia/Kolkata"}
    assert body["extendedProperties"]["private"]["stack19_visit_id"] == str(vid)
    erased = event_body({"visit_id": str(vid), "person_name": None, "purpose": "erased:1", "party_size": 1, "starts_at": "2026-11-20T04:30:00+00:00", "ends_at": "2026-11-20T05:00:00+00:00"})
    assert erased["summary"] == "Appointment" and erased["description"] == "Party size: 1"
    assert person_label("Ravi") == "Ravi" and person_label("  ") is None and person_label("9876543210") is None
    assert event_id_for(vid).startswith("s19") and set(event_id_for(vid)) <= set("abcdefghijklmnopqrstuv0123456789")


def test_busy_blocks_lose_our_own_spans() -> None:
    def h(x: int) -> dt.datetime:
        return dt.datetime(2026, 11, 20, x, tzinfo=dt.UTC)

    assert subtract([(h(9), h(12))], [(h(10), h(11))]) == [(h(9), h(10)), (h(11), h(12))]
    assert subtract([(h(9), h(10))], [(h(9), h(10))]) == []
    assert subtract([(h(9), h(10)), (h(13), h(14))], []) == [(h(9), h(10)), (h(13), h(14))]


def test_the_real_adapter_asks_for_exactly_the_two_scopes_offline_with_pkce() -> None:
    url = HttpGoogle("fake-client-id", "fake-client-secret").authorize_url(state="s", code_challenge="c", redirect_uri="https://api.example.test/cb")
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    assert q["scope"].split() == list(SCOPES) == ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"]
    assert (q["access_type"], q["code_challenge_method"], q["response_type"]) == ("offline", "S256", "code")
    assert "fake-client-secret" not in url


# ------------------------------------------------------------------------------------------------ connect
def test_connect_needs_the_owner_and_the_second_factor(w: World) -> None:
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert w.call("POST", T + "/connect", user).status_code == 403
    assert w.call("POST", T + "/connect", "a_owner", aal="aal1").status_code == 403
    assert w.call("POST", T + "/connect", "b_owner").status_code == 404


def test_connect_and_callback_store_the_token_only_in_the_secret_store(w: World, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    location = w.connect()
    assert location == f"https://web.example.test/app/tenants/{TENANT}/integrations/google-calendar?google_calendar=connected"
    secret = w.vault.get(SECRET)
    assert secret is not None and secret.refresh_token in w.google.refresh_tokens and len(secret.channel_token) >= 40
    assert "refresh_token" not in str(w.db.rows) and secret.refresh_token not in str(w.db.__dict__)
    assert w.db.secret_rows[TENANT] == w.vault.fingerprint(TENANT, secret.refresh_token)
    assert secret.refresh_token not in caplog.text and secret.channel_token not in caplog.text
    s = w.call("GET", T + "/status", "a_viewer").json()
    assert (s["configured"], s["connected"], s["status"], s["calendar_id"], s["write_events"], s["block_busy"]) == (True, True, "connected", "primary", True, False)


def test_a_state_is_used_once_and_a_forged_one_is_refused(w: World) -> None:
    url = w.call("POST", T + "/connect", "a_owner").json()["authorize_url"]
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    first = w.client.get(P + "/callback", params=q, follow_redirects=False)
    again = w.client.get(P + "/callback", params=q, follow_redirects=False)
    forged = w.client.get(P + "/callback", params={"code": q["code"], "state": "x.y"}, follow_redirects=False)
    assert first.headers["location"].endswith("google_calendar=connected")
    assert again.headers["location"].endswith("google_calendar=expired")
    assert forged.headers["location"] == "https://web.example.test/app?google_calendar=invalid"
    assert w.google.calls.count("exchange_code") == 1


def test_a_refusal_on_googles_screen_or_a_missing_permission_keeps_nothing(w: World) -> None:
    url = w.call("POST", T + "/connect", "a_owner").json()["authorize_url"]
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    denied = w.client.get(P + "/callback", params={"error": "access_denied", "state": q["state"]}, follow_redirects=False)
    assert denied.headers["location"].endswith("google_calendar=denied") and TENANT not in w.db.rows
    w.google.granted_scopes = frozenset({SCOPES[0]})
    url = w.call("POST", T + "/connect", "a_owner").json()["authorize_url"]
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    partial = w.client.get(P + "/callback", params=q, follow_redirects=False)
    assert partial.headers["location"].endswith("google_calendar=missing_scope")
    assert TENANT not in w.db.rows and w.vault.get(SECRET) is None and len(w.google.revoked) == 1


def test_a_reconnect_revokes_the_grant_it_replaces(w: World) -> None:
    w.connect()
    first = w.vault.get(SECRET)
    w.connect()
    second = w.vault.get(SECRET)
    assert first is not None and second is not None and first.refresh_token != second.refresh_token
    assert w.google.revoked == [first.refresh_token]


# ------------------------------------------------------------------------------------------------ the worker: our appointments in their calendar
def test_a_booked_appointment_is_written_once_changed_on_reschedule_deleted_on_cancel(w: World) -> None:
    w.connect()
    vid = w.db.add_visit(TENANT, start=soon(24))
    w.tick()
    eid = event_id_for(vid)
    assert w.google.events[eid]["summary"] == "Appointment: Priya S." and w.db.events[(TENANT, vid)]["state"] == "written"
    assert w.db.rows[TENANT]["google_email"] == "owner@example.test"   # the organizer Google named
    w.google.calls.clear()
    w.tick()
    assert "insert_event" not in w.google.calls and "patch_event" not in w.google.calls   # nothing changed: nothing sent
    w.db.touch(vid, status="confirmed")
    w.tick()
    assert "patch_event" not in w.google.calls                                           # changed, but the event would be the same
    w.db.touch(vid, starts_at=soon(48), ends_at=soon(48) + dt.timedelta(minutes=45))
    w.tick()
    assert w.google.events[eid]["start"]["dateTime"].startswith(soon(48).astimezone(dt.timezone(dt.timedelta(hours=5, minutes=30))).isoformat()[:16])
    w.db.touch(vid, status="cancelled")
    w.tick()
    assert w.google.events[eid]["status"] == "cancelled" and w.db.events[(TENANT, vid)]["state"] == "deleted"


def test_a_completed_or_no_show_appointment_is_left_in_the_calendar(w: World) -> None:
    w.connect()
    vid = w.db.add_visit(TENANT, start=soon(2))
    w.tick()
    w.db.touch(vid, status="completed")
    w.google.calls.clear()
    w.tick()
    assert "delete_event" not in w.google.calls and w.google.events[event_id_for(vid)]["status"] == "confirmed"


def test_an_event_we_did_not_make_is_never_edited(w: World) -> None:
    w.connect()
    vid = w.db.add_visit(TENANT, start=soon(24))
    w.google.events[event_id_for(vid)] = {"id": event_id_for(vid), "summary": "Dentist", "status": "confirmed", "extendedProperties": {"private": {"stack19_visit_id": "someone-else"}}}
    w.tick()
    assert w.google.events[event_id_for(vid)]["summary"] == "Dentist"
    assert w.db.events[(TENANT, vid)]["last_error_code"] == "not_ours"


def test_a_failed_push_is_backed_off_and_retried(w: World) -> None:
    w.connect()
    vid = w.db.add_visit(TENANT, start=soon(24))
    w.google.fail["insert_event"] = GoogleError("unavailable", 503)
    w.tick()
    g = w.db.events[(TENANT, vid)]
    assert (g["state"], g["attempts"], g["last_error_code"]) == ("pending", 1, "unavailable") and g["next_attempt_at"] > dt.datetime.now(dt.UTC)
    w.tick()   # make_due: the back-off passed
    assert w.db.events[(TENANT, vid)]["state"] == "written" and event_id_for(vid) in w.google.events


def test_a_revoked_token_marks_needs_reconnect_and_is_never_retried(w: World) -> None:
    w.connect()
    w.db.add_visit(TENANT, start=soon(24))
    w.google.refresh_tokens.clear()   # the owner removed our access in their Google account
    w.tick()
    assert w.db.rows[TENANT]["status"] == "needs_reconnect"
    w.google.calls.clear()
    w.tick()
    w.tick()
    assert w.google.calls == []
    assert w.call("GET", T + "/status", "a_owner").json()["status"] == "needs_reconnect"


def test_write_events_off_writes_nothing(w: World) -> None:
    w.connect()
    assert w.call("PUT", T + "/settings", "a_owner", {"write_events": False, "block_busy": False}).status_code == 200
    w.db.add_visit(TENANT, start=soon(24))
    w.tick()
    assert w.google.events == {}


# ------------------------------------------------------------------------------------------------ busy times and the push channel
def test_busy_times_are_kept_without_our_own_events_only_when_block_busy_is_on(w: World) -> None:
    w.connect()
    vid = w.db.add_visit(TENANT, start=soon(24))
    foreign = (soon(30), soon(31))
    w.google.foreign_busy = [foreign]
    w.tick()
    assert TENANT not in w.db.busy or w.db.busy[TENANT] == []          # block_busy is off by default
    assert w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True}).json()["block_busy"] is True
    w.tick()
    assert w.db.busy[TENANT] == [foreign]                              # the appointment we wrote is not "busy"
    assert w.db.events[(TENANT, vid)]["state"] == "written"
    assert len(w.google.channels) == 1 and w.google.watch_ttl_s == 7 * 24 * 3600
    (cid, ch), = w.google.channels.items()
    assert ch["address"] == "https://api.example.test/v1/integrations/google-calendar/push" and ch["token"] == w.vault.get(SECRET).channel_token  # type: ignore[union-attr]
    w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": False})
    assert w.db.busy.get(TENANT, []) == [] and w.google.stopped == [cid]


def test_a_moved_event_of_ours_is_read_with_events_get_only(w: World) -> None:
    w.connect()
    w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True})
    vid = w.db.add_visit(TENANT, start=soon(24))
    w.tick()
    w.db.events[(TENANT, vid)]["last_error_code"] = "unavailable"   # not current: the worker reads OUR event from Google
    w.db.events[(TENANT, vid)]["next_attempt_at"] = dt.datetime.now(dt.UTC) + dt.timedelta(hours=1)
    w.db.rows[TENANT]["busy_requested_at"] = dt.datetime.now(dt.UTC) + dt.timedelta(seconds=5)
    w.google.calls.clear()
    w.sync.run("scheduler-token-fake")
    assert "get_event" in w.google.calls and w.db.busy[TENANT] == []
    assert not any(c.startswith("list") for c in w.google.calls)


def test_the_push_door_acknowledges_sync_and_asks_for_a_refresh_only_when_verified(w: World) -> None:
    w.connect()
    w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True})
    w.tick()
    link = w.db.rows[TENANT]
    secret = w.vault.get(SECRET)
    assert secret is not None
    good = {"X-Goog-Channel-ID": link["channel_id"], "X-Goog-Channel-Token": secret.channel_token, "X-Goog-Resource-ID": link["channel_resource_id"], "X-Goog-Resource-State": "exists"}
    assert w.client.post(P + "/push", headers={**good, "X-Goog-Resource-State": "sync"}).status_code == 200
    assert "busy_request" not in w.db.calls
    assert w.client.post(P + "/push", headers={**good, "X-Goog-Channel-Token": "fake-wrong-token"}).status_code == 200
    assert w.client.post(P + "/push", headers={**good, "X-Goog-Resource-ID": "fake-other"}).status_code == 200
    assert w.client.post(P + "/push", headers={**good, "X-Goog-Channel-ID": str(uuid.uuid4())}).status_code == 200
    assert w.client.post(P + "/push", headers={"X-Goog-Resource-State": "exists"}).status_code == 200
    assert "busy_request" not in w.db.calls
    assert w.client.post(P + "/push", headers=good).status_code == 200
    assert w.db.calls.count("busy_request") == 1
    w.google.calls.clear()
    w.sync.run("scheduler-token-fake")
    assert "freebusy" in w.google.calls


def test_the_channel_is_renewed_before_it_expires_and_the_old_one_stopped(w: World) -> None:
    w.connect()
    w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True})
    w.tick()
    old = w.db.rows[TENANT]["channel_id"]
    w.db.rows[TENANT]["channel_expires_at"] = dt.datetime.now(dt.UTC) + dt.timedelta(hours=3)
    w.tick()
    assert w.db.rows[TENANT]["channel_id"] != old and w.google.stopped == [old]


# ------------------------------------------------------------------------------------------------ disconnect, erasure
def test_disconnect_revokes_stops_deletes_our_copy_and_keeps_their_events(w: World) -> None:
    w.connect()
    w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True})
    vid = w.db.add_visit(TENANT, start=soon(24))
    w.tick()
    token = w.vault.get(SECRET).refresh_token  # type: ignore[union-attr]
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert w.call("POST", T + "/disconnect", user).status_code == 403
    r = w.call("POST", T + "/disconnect", "a_owner")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["disconnected"], body["events_kept"], body["status"]) == (True, True, "not_connected")
    assert token in w.google.revoked and len(w.google.stopped) == 1
    assert w.store.access(SECRET) is None and TENANT not in w.db.rows and TENANT not in w.db.secret_rows and not w.db.events
    assert w.google.events[event_id_for(vid)]["status"] == "confirmed"
    assert w.call("POST", T + "/sync-now", "a_owner").json()["error"]["code"] == "google_calendar_not_connected"


def test_a_workspace_erasure_disconnects_on_the_next_tick(w: World) -> None:
    w.connect()
    w.db.erased.add(TENANT)
    w.tick()
    assert TENANT not in w.db.rows and w.store.access(SECRET) is None and "scheduler_disconnect" in w.db.calls and len(w.google.revoked) == 1


# ------------------------------------------------------------------------------------------------ the doors
def test_without_the_oauth_client_the_status_says_so_and_the_rest_answers_not_configured() -> None:
    client, _ = make_client()
    s = client.get(T + "/status", headers=auth("a_viewer"))
    assert s.status_code == 200 and s.json()["configured"] is False and s.json()["status"] == "not_connected"
    for method, path, body in (("POST", T + "/connect", None), ("PUT", T + "/settings", {"write_events": True, "block_busy": False}), ("POST", T + "/sync-now", None),
                               ("POST", T + "/disconnect", None), ("GET", P + "/callback", None), ("POST", P + "/push", None)):
        r = client.request(method, path, json=body, headers=auth("a_owner"))
        assert r.status_code == 409 and r.json()["error"]["code"] == "not_configured", (path, r.text)


def test_roles_of_the_other_doors(w: World) -> None:
    w.connect()
    assert w.call("PUT", T + "/settings", "a_admin", {"write_events": True, "block_busy": True}).status_code == 403
    assert w.call("PUT", T + "/settings", "a_owner", {"write_events": "yes", "block_busy": True}).status_code == 422
    assert w.call("PUT", T + "/settings", "a_owner", {"write_events": True, "block_busy": True, "calendar_id": "x"}).status_code == 422
    assert w.call("POST", T + "/sync-now", "a_admin").json()["requested"] is True
    assert w.call("POST", T + "/sync-now", "a_sales").status_code == 403
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert w.call("GET", T + "/status", user).status_code == 200
    assert w.call("GET", T + "/status", "b_owner").status_code == 404


def test_too_many_open_connects_are_refused_for_a_while(w: World) -> None:
    for _ in range(5):
        assert w.call("POST", T + "/connect", "a_owner").status_code == 200
    r = w.call("POST", T + "/connect", "a_owner")
    assert r.status_code == 429 and r.json()["error"]["code"] == "google_calendar_try_later"


def test_the_vault_reads_back_what_it_wrote_and_never_shows_it() -> None:
    v = Vault(FakeSecretStore(), b"fake-fingerprint-key")
    v.put("sme-ws-x-google_calendar", LinkSecret("fake-refresh-abc", "fake-channel-xyz"))
    got = v.get("sme-ws-x-google_calendar")
    assert got == LinkSecret("fake-refresh-abc", "fake-channel-xyz") and "fake-refresh" not in repr(got) and "fake" not in repr(v)
    v.delete("sme-ws-x-google_calendar")
    assert v.get("sme-ws-x-google_calendar") is None


# ------------------------------------------------------------------------------------------------ the real adapter's requests (httpx mock: nothing leaves the process)
def test_the_http_adapter_speaks_plain_rest_and_maps_refusals_to_closed_codes() -> None:
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path == "/token":
            form = dict(urllib.parse.parse_qsl(request.content.decode()))
            if form.get("grant_type") == "refresh_token":
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "fake-access", "refresh_token": "fake-refresh", "scope": " ".join(SCOPES), "expires_in": 3599})
        if path.endswith("/freeBusy"):
            return httpx.Response(200, json={"calendars": {"primary": {"busy": [{"start": "2026-11-20T04:30:00Z", "end": "2026-11-20T05:00:00Z"}]}}})
        if path.endswith("/events/watch"):
            return httpx.Response(200, json={"resourceId": "fake-res", "expiration": "1795000000000"})
        if path.endswith("/events/s19abc"):
            return httpx.Response(404, json={"error": {"errors": [{"reason": "notFound"}]}})
        if path == "/revoke":
            return httpx.Response(200)
        return httpx.Response(500)

    g = HttpGoogle("fake-client-id", "fake-client-secret", client=httpx.Client(transport=httpx.MockTransport(handler)))
    grant = g.exchange_code("fake-code", "fake-verifier", "https://api.example.test/cb")
    assert grant.refresh_token == "fake-refresh" and set(SCOPES) <= grant.scopes and "fake-refresh" not in repr(grant)
    form = dict(urllib.parse.parse_qsl(seen[0].content.decode()))
    assert form["code_verifier"] == "fake-verifier" and form["grant_type"] == "authorization_code"
    with pytest.raises(GoogleError) as e:
        g.access_token("fake-refresh")
    assert e.value.code == "revoked"
    busy = g.freebusy("fake-access", dt.datetime(2026, 11, 20, tzinfo=dt.UTC), dt.datetime(2026, 12, 20, tzinfo=dt.UTC))
    assert busy == [(dt.datetime(2026, 11, 20, 4, 30, tzinfo=dt.UTC), dt.datetime(2026, 11, 20, 5, tzinfo=dt.UTC))]
    assert seen[-1].headers["authorization"] == "Bearer fake-access"
    ch = g.watch("fake-access", "chan-1", "fake-chan-token", "https://api.example.test/push", 604800)
    assert ch.resource_id == "fake-res" and ch.expires_at.year == 2026
    import json as _json
    assert _json.loads(seen[-1].content)["params"] == {"ttl": "604800"}
    assert g.get_event("fake-access", "s19abc") is None
    g.delete_event("fake-access", "s19abc")   # gone already: fine
    g.revoke("fake-refresh")
    with pytest.raises(GoogleError) as e:
        g.stop_channel("fake-access", "c", "r")
    assert e.value.code == "unavailable"


def test_the_secret_store_deletes_the_secret_or_destroys_every_version() -> None:
    import httpx

    from app.workspace_secrets import GcpSecretStore, SecretStoreError

    seen: list[tuple[str, str]] = []

    def allowed(req: httpx.Request) -> httpx.Response:
        if "metadata.google.internal" in str(req.url):
            return httpx.Response(200, json={"access_token": "fake-tok", "expires_in": 3600})
        seen.append((req.method, req.url.path))
        return httpx.Response(200, json={})

    GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(allowed))).delete("sme-ws-x-google_calendar")
    assert seen == [("DELETE", "/v1/projects/project-2757c07e/secrets/sme-ws-x-google_calendar")]
    seen.clear()

    def no_delete(req: httpx.Request) -> httpx.Response:
        if "metadata.google.internal" in str(req.url):
            return httpx.Response(200, json={"access_token": "fake-tok", "expires_in": 3600})
        seen.append((req.method, req.url.path))
        if req.method == "DELETE":
            return httpx.Response(403, json={})
        if req.method == "GET":
            return httpx.Response(200, json={"versions": [{"name": "projects/p/secrets/s/versions/1"}, {"name": "projects/p/secrets/s/versions/2"}]})
        return httpx.Response(200, json={})

    GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(no_delete))).delete("sme-ws-x-google_calendar")
    assert ("POST", "/v1/projects/p/secrets/s/versions/1:destroy") in seen and ("POST", "/v1/projects/p/secrets/s/versions/2:destroy") in seen
    with pytest.raises(SecretStoreError, match="delete_refused"):
        GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"access_token": "fake-tok"}) if "metadata" in str(r.url) else httpx.Response(403)))).delete("x")


def test_the_wiring_stays_off_without_the_client_and_needs_every_part() -> None:
    from app.config import Settings
    from app.google_calendar.wiring import build_google_calendar, build_google_calendar_sync

    assert build_google_calendar(Settings(_env_file=None), "http://rest", "http://sb", "anon") is None  # type: ignore[call-arg]
    assert build_google_calendar_sync(Settings(_env_file=None), "http://rest", "anon") is None  # type: ignore[call-arg]
    full = {"google_oauth_client_id": "fake-client-id", "google_oauth_client_secret": "fake-client-secret", "workspace_secrets": "fake", "scheduler_email": "s@example.test",
            "scheduler_password": "fake-password", "public_base_url": "https://api.example.test", "api_cors_origins": "https://web.example.test"}
    svc = build_google_calendar(Settings(_env_file=None, **full), "http://rest", "http://sb", "anon")  # type: ignore[call-arg, arg-type]
    assert svc is not None and svc.redirect_uri == "https://api.example.test/v1/integrations/google-calendar/callback"
    assert svc.back(TENANT, "connected").startswith("https://web.example.test/app/tenants/")
    for drop in ("google_oauth_client_secret", "workspace_secrets", "scheduler_password", "public_base_url"):
        assert build_google_calendar(Settings(_env_file=None, **{k: v for k, v in full.items() if k != drop}), "http://rest", "http://sb", "anon") is None, drop  # type: ignore[call-arg, arg-type]
    assert build_google_calendar_sync(Settings(_env_file=None, **full), "http://rest", "anon") is not None  # type: ignore[call-arg, arg-type]
    no_client = {k: v for k, v in full.items() if not k.startswith("google")}
    assert build_google_calendar(Settings(_env_file=None, google_calendar_fake=True, **no_client), "http://rest", "http://sb", "anon") is not None, "the fake: development only"  # type: ignore[call-arg, arg-type]
    assert build_google_calendar_sync(Settings(_env_file=None, google_calendar_fake=True, api_env="production", **no_client), "http://rest", "anon") is None  # type: ignore[call-arg, arg-type]


def test_the_worker_runs_the_pass_each_tick_and_a_crash_never_fails_the_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.scheduler.worker import Worker

    class Session:
        def token(self) -> str:
            return "fake-scheduler-token"

        def invalidate(self) -> None:
            pass

    ran: list[str] = []

    class Pass:
        def run(self, token: str) -> dict[str, int]:
            ran.append(token)
            raise RuntimeError("boom")

    monkeypatch.setattr("app.scheduler.worker.run_tick", lambda *a, **k: "ticked")
    worker = Worker(object(), object(), Session(), google_calendar=Pass())  # type: ignore[arg-type]
    assert worker.tick_once() == "ticked"  # type: ignore[comparison-overlap]
    assert ran == ["fake-scheduler-token"]


def test_the_owner_script_refuses_without_the_flag_and_never_prints_a_value(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("google_oauth_client_register", Path(__file__).resolve().parents[3] / "scripts" / "google_oauth_client_register.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.valid_id("123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com") and not mod.valid_id("hello")
    assert mod.valid_secret("fake-SECRET_value-0123456789") and not mod.valid_secret("short")
    assert mod.main(["--project", mod.STAGING_PROJECT]) == 1
    assert mod.main(["--i-know-this-writes-staging-secrets", "--project", "some-other-project"]) == 1
    calls: list[tuple[list[str], str | None]] = []
    def fake_gcloud(args: list[str], stdin: str | None = None) -> int:
        calls.append((args, stdin))
        return 1 if args[1] == "describe" else 0

    monkeypatch.setattr(mod, "gcloud", fake_gcloud)
    answers = iter(["123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com", "fake-SECRET_value-0123456789", "fake-SECRET_value-0123456789"])
    monkeypatch.setattr(mod.getpass, "getpass", lambda prompt="": next(answers))
    assert mod.main(["--i-know-this-writes-staging-secrets", "--project", mod.STAGING_PROJECT]) == 0
    out = capsys.readouterr()
    assert "fake-SECRET" not in out.out + out.err and "abcdefghijklmnop" not in out.out + out.err
    created = [(a, s) for a, s in calls if a[1] == "create"]
    assert [a[2] for a, _ in created] == ["sme-google-oauth-client-id", "sme-google-oauth-client-secret"]
    assert all("fake-SECRET" not in " ".join(a) for a, _ in calls), "a value never goes on the command line"
    assert created[1][1] == "fake-SECRET_value-0123456789", "it goes on stdin"
