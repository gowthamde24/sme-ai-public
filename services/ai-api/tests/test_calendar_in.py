"""Calendars in (docs/contracts/commerce-notify.md section D): Calendly and Cal.com bookings (signatures, readers, the door, idempotency, cancel, reschedule, consent, the booking link), the Outlook connect
and its worker pass. Every vendor is a fake or an httpx MockTransport with a fake DNS: no test reaches the network. The fake repository answers as migration 20261231992360's functions do (pgTAP 296
pins the database side)."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any

import httpx
import pytest

from app.calendar_in import bookings, links
from app.calendar_in.fake_microsoft import FakeMicrosoft
from app.calendar_in.microsoft import HttpMicrosoft, MicrosoftError, graph_time
from app.calendar_in.repository import LinkStateError, NotConnectedError
from app.calendar_in.service import CalendarInService, hook_hash
from app.calendar_in.sync import OutlookSync, event_body, txn_id_for
from app.calendar_in.vendors import CalendlyUser, HttpCalendly, VendorError
from app.connector_vault import ConnectorVault
from app.errors import ApiError
from app.google_calendar.state import StateSigner
from app.outbound_http import GuardedHttp
from app.webhooks_out import ssrf
from app.workspace_secrets import FakeSecretStore
from tests.fakes import TENANT_A, USERS, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}/calendars"
BASE = "https://api.example.test"
NOW = dt.datetime(2026, 12, 1, 4, 0, tzinfo=dt.UTC)
PHONE = "+919000000011"
FUTURE = (dt.datetime.now(dt.UTC) + dt.timedelta(days=3)).replace(hour=5, minute=0, second=0, microsecond=0)
PAT = "pat" + "x" * 40


# ============================================================================ fakes
class FakeScheduler:
    def __init__(self) -> None:
        self.invalidated = 0

    def token(self) -> str:
        return "sched-token"

    def invalidate(self) -> None:
        self.invalidated += 1


class FakeBridge:
    def __init__(self) -> None:
        self.sources: list[str] = []
        self.rows: list[dict[str, Any]] = []
        self.fail: ApiError | None = None

    def create_source(self, token: str, tenant_id: uuid.UUID, label: str) -> str:
        self.sources.append(label)
        return "leadsecret" + "a" * 30

    def receive(self, secret: str, row: dict[str, Any]) -> str:
        if self.fail is not None:
            raise self.fail
        self.rows.append(dict(row))
        return "received"


class FakeCalendly:
    def __init__(self) -> None:
        self.subscribed: list[dict[str, Any]] = []
        self.removed: list[str] = []
        self.fail: str | None = None

    def me(self, token: str) -> CalendlyUser:
        if self.fail:
            raise VendorError(self.fail)
        return CalendlyUser("https://api.calendly.com/users/UUUU1111", "https://api.calendly.com/organizations/OOOO1111", "https://calendly.com/example-shop")

    def subscribe(self, token: str, url: str, user: CalendlyUser, signing_key: str) -> str:
        self.subscribed.append({"url": url, "key": signing_key, "token": token})
        return "https://api.calendly.com/webhook_subscriptions/SUB-1234"

    def unsubscribe(self, token: str, ref: str) -> None:
        self.removed.append(ref)


class FakeRepo:
    """The database's calendar functions, as far as these tests need them."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.hashes: dict[str, str] = {}
        self.books: dict[tuple[str, str], dict[str, Any]] = {}
        self.visits: dict[str, dict[str, Any]] = {}
        self.slots_full: set[str] = set()   # start times (iso) that are full
        self.leads: set[str] = {PHONE}      # numbers that have a lead
        self.states: dict[uuid.UUID, dict[str, Any]] = {}
        self.busy: list[tuple[dt.datetime, dt.datetime]] = []
        self.links: dict[str, dict[str, Any]] = {}
        self.visit_rows: list[dict[str, Any]] = []
        self.failed: list[tuple[str, str]] = []
        self.link_failures: list[tuple[str, str, bool]] = []
        self.link_state = {"status": "connected", "write_events": True, "block_busy": False}
        self.outlook_present = False
        self.link_busy_due = True
        self.link_events_due = True

    # ---- the people
    def _json(self, row: dict[str, Any]) -> dict[str, Any]:
        keys = ("kind", "status", "label", "last4", "booking_link", "share_link", "consent_question", "write_events", "block_busy", "last_event_at", "last_synced_at", "last_error_code")
        out = {k: row.get(k) for k in keys}
        kind = row["kind"]
        out["counts_30d"] = {"booked": sum(1 for (k, _), b in self.books.items() if k == kind and b["state"] == "booked"), "cancelled": sum(1 for (k, _), b in self.books.items() if k == kind and b["state"] == "cancelled"),
                             "needs_person": sum(1 for (k, _), b in self.books.items() if k == kind and b["state"] == "needs_person")}
        return out

    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [self._json(r) for r in self.rows.values()]

    def save(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, booking_link: str | None, hook_hash: str, hook_ref: str | None) -> dict[str, Any]:
        old = self.rows.get(kind, {})
        self.rows[kind] = {"kind": kind, "status": "connected", "label": label, "last4": last4, "booking_link": booking_link or old.get("booking_link"), "share_link": old.get("share_link", False),
                           "consent_question": old.get("consent_question"), "hook_ref": hook_ref, "write_events": None, "block_busy": None}
        self.hashes = {h: k for h, k in self.hashes.items() if k != kind}
        self.hashes[hook_hash] = kind
        return self._json(self.rows[kind])

    def settings(self, token: str, tenant_id: uuid.UUID, kind: str, booking_link: str | None, share_link: bool | None, write_events: bool | None, block_busy: bool | None, consent_question: str | None) -> dict[str, Any]:
        row = self.rows.get(kind)
        if row is None:
            raise NotConnectedError("SM891")
        if booking_link is not None:
            row["booking_link"] = booking_link or None
        if share_link is True and not row.get("booking_link"):
            raise ValueError("invalid")
        if share_link is not None:
            row["share_link"] = share_link
        if consent_question is not None:
            row["consent_question"] = consent_question or None
        if kind == "outlook":
            row["write_events"] = row["write_events"] if write_events is None else write_events
            row["block_busy"] = row["block_busy"] if block_busy is None else block_busy
        return self._json(row)

    def ref(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        row = self.rows.get(kind)
        if row is None:
            raise NotConnectedError("SM891")
        return {"kind": kind, "hook_ref": row.get("hook_ref"), "consent_question": row.get("consent_question")}

    def disconnect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        gone = self.rows.pop(kind, None) is not None
        self.hashes = {h: k for h, k in self.hashes.items() if k != kind}
        return {"disconnected": gone}

    def outlook_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        nonce = uuid.uuid4()
        self.states[nonce] = {"used": False}
        return {"nonce": str(nonce), "member_id": str(USERS["a_owner"]), "expires_at": "2026-12-01T10:00:00+00:00"}

    def needs_person(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [{"kind": k, "state": b["state"], "reason": b["reason"]} for (k, _), b in self.books.items() if b["state"] == "needs_person"]

    # ---- the scheduler account
    def hook(self, token: str, hook_hash: str) -> dict[str, Any] | None:
        kind = self.hashes.get(hook_hash)
        return {"tenant_id": str(TENANT_A.id), "kind": kind, "consent_question": self.rows[kind].get("consent_question")} if kind else None

    def booking_apply(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, phone: str | None, email: str | None, starts_at: dt.datetime, ends_at: dt.datetime, purpose: str | None) -> dict[str, Any]:
        key = (kind, external_id)
        b = self.books.get(key)
        if b is not None:
            if b["state"] == "cancelled":
                return {"state": "cancelled", "replayed": True, "visit_id": b["visit_id"]}
            if b["starts_at"] == starts_at and b["state"] in ("booked", "needs_person"):
                return {"state": b["state"], "reason": b["reason"], "replayed": True, "visit_id": b["visit_id"]}
            if b["visit_id"]:
                self.visits[b["visit_id"]]["status"] = "cancelled"
        state: str = "booked"
        reason: str | None = None
        visit: str | None = str(uuid.uuid4())
        if phone not in self.leads:
            state, reason, visit = "needs_person", "no_lead", None
        elif starts_at.isoformat() in self.slots_full:
            state, reason, visit = "needs_person", "full", None
        elif visit is not None:
            self.visits[visit] = {"status": "booked", "starts_at": starts_at, "purpose": purpose}
        self.books[key] = {"state": state, "reason": reason, "visit_id": visit, "starts_at": starts_at}
        return {"state": state, "reason": reason, "replayed": False, "visit_id": visit}

    def booking_cancel(self, token: str, tenant_id: uuid.UUID, kind: str, external_id: str, starts_at: dt.datetime | None, ends_at: dt.datetime | None) -> dict[str, Any]:
        b = self.books.get((kind, external_id))
        if b is None:
            self.books[(kind, external_id)] = {"state": "cancelled", "reason": None, "visit_id": None, "starts_at": starts_at}
            return {"state": "cancelled", "replayed": False, "visit_id": None}
        if b["state"] == "cancelled":
            return {"state": "cancelled", "replayed": True, "visit_id": b["visit_id"]}
        if b["visit_id"] and self.visits[b["visit_id"]]["status"] in ("booked", "confirmed"):
            self.visits[b["visit_id"]]["status"] = "cancelled"
        b["state"] = "cancelled"
        return {"state": "cancelled", "replayed": False, "visit_id": b["visit_id"]}

    def booking_link(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        for kind in ("calendly", "calcom"):
            row = self.rows.get(kind)
            if row and row.get("share_link") and row.get("booking_link"):
                return {"kind": kind, "url": row["booking_link"]}
        return None

    def state_use(self, token: str, nonce: uuid.UUID, tenant_id: uuid.UUID, member_id: uuid.UUID) -> dict[str, Any]:
        s = self.states.get(nonce)
        if s is None or s["used"]:
            raise LinkStateError("SM892")
        s["used"] = True
        return {"tenant_id": str(tenant_id), "member_id": str(member_id)}

    def outlook_connected(self, token: str, tenant_id: uuid.UUID, member_id: uuid.UUID, last4: str | None) -> dict[str, Any]:
        self.rows["outlook"] = {"kind": "outlook", "status": "connected", "label": None, "last4": last4, "booking_link": None, "share_link": False, "write_events": True, "block_busy": False}
        self.outlook_present = True
        return self._json(self.rows["outlook"])

    def outlook_links(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        return [{"tenant_id": str(TENANT_A.id), **self.link_state, "busy_due": self.link_busy_due, "events_due": self.link_events_due}]

    def visits_due(self, token: str, tenant_id: uuid.UUID, limit: int = 25) -> list[dict[str, Any]]:
        due = []
        for v in self.visit_rows:
            link = self.links.get(v["visit_id"], {})
            if link.get("state") == "deleted":
                continue
            if link.get("state") == "written" and link.get("hash") and link.get("visit_updated_at") == v["visit_updated_at"] and v["status"] != "cancelled":
                continue
            due.append({**v, "event_id": link.get("event_id"), "event_state": link.get("state"), "last_pushed_hash": link.get("hash")})
        return due

    def event_done(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str | None, state: str, hash_hex: str | None, visit_updated_at: str) -> dict[str, Any]:
        self.links[str(visit_id)] = {"event_id": event_id, "state": state, "hash": hash_hex, "visit_updated_at": visit_updated_at}
        return {}

    def event_failed(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, code: str) -> dict[str, Any]:
        self.failed.append((str(visit_id), code))
        return {}

    def link_failed(self, token: str, tenant_id: uuid.UUID, work: str, code: str, needs_reconnect: bool) -> dict[str, Any]:
        self.link_failures.append((work, code, needs_reconnect))
        if needs_reconnect:
            self.link_state["status"] = "needs_reconnect"
        return {}

    def busy_replace(self, token: str, tenant_id: uuid.UUID, blocks: list[tuple[dt.datetime, dt.datetime]]) -> dict[str, Any]:
        self.busy = list(blocks)
        return {}

    def own_events(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"visit_id": vid, "event_id": link["event_id"]} for vid, link in self.links.items() if link.get("state") == "written" and link.get("event_id")]

    def scheduler_disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {}


class World:
    def __init__(self, *, microsoft: bool = False, on: bool = True) -> None:
        self.repo = FakeRepo()
        self.store = FakeSecretStore()
        self.vault = ConnectorVault(self.store)
        self.sched = FakeScheduler()
        self.bridge = FakeBridge()
        self.calendly = FakeCalendly()
        self.ms = FakeMicrosoft() if microsoft else None
        self.service = CalendarInService(self.repo, self.vault, self.sched, calendly=self.calendly, microsoft=self.ms, signer=StateSigner(b"outlook|" + b"s" * 24) if microsoft else None,
                                         public_base_url=BASE, web_base_url="https://app.example.test", leads=self.bridge, clock=lambda: float(NOW.timestamp()))
        self.client, _ = make_client()
        if on:
            object.__setattr__(self.client.app.state.runtime, "calendar_in", self.service)  # type: ignore[attr-defined]   # the Runtime is frozen: the test sets the one field

    def owner(self) -> dict[str, str]:
        return auth("a_owner")


def connect_calcom(w: World, **body: Any) -> dict[str, Any]:
    r = w.client.post(f"{T}/calcom/connect", json=body, headers=w.owner())
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def door(setup: dict[str, Any]) -> str:
    return "/v1/webhooks/calendars/calcom/" + str(setup["webhook_url"]).rsplit("/", 1)[1]


def calcom_body(uid: str = "bk1", phone: str | None = PHONE, trigger: str = "BOOKING_CREATED", start: dt.datetime = FUTURE, extra: dict[str, Any] | None = None) -> bytes:
    payload: dict[str, Any] = {"uid": uid, "title": "Showroom visit", "startTime": start.isoformat().replace("+00:00", "Z"), "endTime": (start + dt.timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                               "attendees": [{"name": "Test Buyer", "email": "buyer@example.test", "timeZone": "Asia/Kolkata"}], "responses": {"attendeePhoneNumber": {"label": "Phone", "value": phone}} if phone else {}, "status": "ACCEPTED"}
    payload.update(extra or {})
    return json.dumps({"triggerEvent": trigger, "createdAt": "2026-12-01T03:59:00.000Z", "payload": payload}, separators=(",", ":")).encode()


def sign_calcom(raw: bytes, secret: str) -> dict[str, str]:
    return {"x-cal-signature-256": hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(), "content-type": "application/json"}


def sign_calendly(raw: bytes, key: str, stamp: int | None = None) -> dict[str, str]:
    t = int(NOW.timestamp()) if stamp is None else stamp
    return {"calendly-webhook-signature": f"t={t},v1=" + hmac.new(key.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest(), "content-type": "application/json"}


def calendly_body(event: str = "invitee.created", uri: str = "https://api.calendly.com/scheduled_events/EV1/invitees/IN1", **over: Any) -> bytes:
    payload: dict[str, Any] = {"uri": uri, "email": "buyer@example.test", "name": "Test Buyer", "status": "active" if event == "invitee.created" else "canceled", "text_reminder_number": PHONE,
                               "questions_and_answers": [], "rescheduled": False, "old_invitee": None, "new_invitee": None,
                               "scheduled_event": {"name": "Showroom visit", "start_time": FUTURE.isoformat().replace("+00:00", "Z"), "end_time": (FUTURE + dt.timedelta(minutes=30)).isoformat().replace("+00:00", "Z")}}
    payload.update(over)
    return json.dumps({"event": event, "created_at": "2026-12-01T03:59:00.000000Z", "payload": payload}, separators=(",", ":")).encode()


# ============================================================================ signatures
def test_calendly_signature_is_the_documented_hmac_over_t_dot_body() -> None:
    raw, key, now = b'{"a":1}', "signing-key-1", 1_700_000_000.0
    header = f"t=1700000000,v1={hmac.new(key.encode(), b'1700000000.' + raw, hashlib.sha256).hexdigest()}"
    assert bookings.verify_calendly(raw, header, key, now=now)
    assert not bookings.verify_calendly(raw, header, "other", now=now)
    assert not bookings.verify_calendly(raw + b" ", header, key, now=now)
    assert not bookings.verify_calendly(raw, header, key, now=now + 301)
    assert bookings.verify_calendly(raw, header, key, now=now + 300)
    for bad in (None, "", "t=1700000000", "v1=" + "a" * 64, "t=x,v1=" + "a" * 64, f"t=1700000000,v1={'A' * 64}", "t=1700000000,v1=zz"):
        assert not bookings.verify_calendly(raw, bad, key, now=now)


def test_calcom_signature_is_the_hex_hmac_of_the_raw_body() -> None:
    raw = b'{"triggerEvent":"BOOKING_CREATED"}'
    good = hmac.new(b"secret-1", raw, hashlib.sha256).hexdigest()
    assert bookings.verify_calcom(raw, good, "secret-1")
    assert not bookings.verify_calcom(raw, good, "secret-2")
    assert not bookings.verify_calcom(raw + b"x", good, "secret-1")
    for bad in (None, "", "no-secret-provided", good.upper(), good[:-1]):
        assert not bookings.verify_calcom(raw, bad, "secret-1")


# ============================================================================ the readers
def test_a_calendly_booking_is_read_with_its_number_from_the_reminder_field_or_a_phone_question() -> None:
    b = bookings.parse("calendly", calendly_body())
    assert b is not None and b.action == "created" and b.phone == PHONE and b.email == "buyer@example.test" and b.purpose == "Showroom visit"
    assert b.ends_at - b.starts_at == dt.timedelta(minutes=30) and b.external_id.endswith("/invitees/IN1") and b.replaces is None
    asked = bookings.parse("calendly", calendly_body(text_reminder_number=None, questions_and_answers=[{"question": "Your WhatsApp number", "answer": "9000000012", "position": 0}]))
    assert asked is not None and asked.phone == "+919000000012"
    assert "buyer" not in repr(b) and PHONE not in repr(b)


def test_a_calendly_cancellation_and_a_reschedule() -> None:
    c = bookings.parse("calendly", calendly_body("invitee.canceled"))
    assert c is not None and c.action == "cancelled"
    moved = bookings.parse("calendly", calendly_body(uri="https://api.calendly.com/scheduled_events/EV2/invitees/IN2", old_invitee="https://api.calendly.com/scheduled_events/EV1/invitees/IN1"))
    assert moved is not None and moved.replaces == "https://api.calendly.com/scheduled_events/EV1/invitees/IN1"


def test_a_calcom_booking_reschedule_and_cancel() -> None:
    b = bookings.parse("calcom", calcom_body())
    assert b is not None and b.external_id == "bk1" and b.phone == PHONE and b.name == "Test Buyer" and b.purpose == "Showroom visit"
    moved = bookings.parse("calcom", calcom_body("bk2", trigger="BOOKING_RESCHEDULED", extra={"rescheduleUid": "bk1"}))
    assert moved is not None and moved.replaces == "bk1" and moved.external_id == "bk2"
    c = bookings.parse("calcom", calcom_body(trigger="BOOKING_CANCELLED"))
    assert c is not None and c.action == "cancelled"
    assert bookings.parse("calcom", calcom_body(trigger="BOOKING_REQUESTED")) is None
    assert bookings.parse("calcom", b"not json") is None and bookings.parse("calendly", b"[]") is None
    assert bookings.parse("calcom", calcom_body(phone=None, extra={"smsReminderNumber": "9000000013"})).phone == "+919000000013"  # type: ignore[union-attr]


def test_consent_comes_only_from_the_question_the_owner_named() -> None:
    q = "I agree that this shop may call or WhatsApp me"
    body = calendly_body(questions_and_answers=[{"question": q, "answer": "Yes", "position": 0}])
    assert bookings.parse("calendly", body).consent_text is None  # type: ignore[union-attr]
    assert bookings.parse("calendly", body, q).consent_text == q  # type: ignore[union-attr]
    no = calendly_body(questions_and_answers=[{"question": q, "answer": "No", "position": 0}])
    assert bookings.parse("calendly", no, q).consent_text is None  # type: ignore[union-attr]
    cal = calcom_body(extra={"responses": {"consent": {"label": q, "value": "true"}}})
    assert bookings.parse("calcom", cal, q).consent_text == q  # type: ignore[union-attr]
    assert bookings.parse("calcom", calcom_body(), q).consent_text is None  # type: ignore[union-attr]


# ============================================================================ the door
def test_a_signed_calcom_booking_becomes_a_lead_and_a_visit_once() -> None:
    w = World()
    setup = connect_calcom(w, booking_link="https://cal.com/example-shop/visit")["setup"]
    raw = calcom_body()
    for _ in range(2):
        r = w.client.post(door(setup), content=raw, headers=sign_calcom(raw, setup["secret"]))
        assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(w.repo.visits) == 1 and next(iter(w.repo.visits.values()))["status"] == "booked"
    assert len(w.bridge.rows) == 2 and w.bridge.rows[0]["phone"] == PHONE and w.bridge.rows[0]["external_id"] == w.bridge.rows[1]["external_id"], "the intake de-duplicates on the external id"
    assert "consent" not in w.bridge.rows[0], "no consent question was named: ask first"
    assert w.bridge.sources == ["Cal.com bookings"]


def test_a_wrong_signature_is_401_an_unknown_address_404_and_nothing_is_stored() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    raw = calcom_body()
    assert w.client.post(door(setup), content=raw, headers=sign_calcom(raw, "not-the-secret")).status_code == 401
    assert w.client.post(door(setup), content=raw).status_code == 401
    assert w.client.post("/v1/webhooks/calendars/calcom/" + "x" * 43, content=raw, headers=sign_calcom(raw, setup["secret"])).status_code == 404
    assert w.client.post(door(setup).replace("/calcom/", "/calendly/"), content=raw, headers=sign_calcom(raw, setup["secret"])).status_code == 404, "the address belongs to the other connector"
    assert w.client.post(door(setup), content=b"x" * 70_000, headers=sign_calcom(b"x", setup["secret"])).status_code == 413
    assert not w.repo.visits and not w.bridge.rows


def test_cancel_cancels_the_visit_once_and_a_late_created_cannot_book_it_again() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    created, cancelled = calcom_body(), calcom_body(trigger="BOOKING_CANCELLED")
    w.client.post(door(setup), content=created, headers=sign_calcom(created, setup["secret"]))
    for _ in range(2):
        assert w.client.post(door(setup), content=cancelled, headers=sign_calcom(cancelled, setup["secret"])).status_code == 200
    assert next(iter(w.repo.visits.values()))["status"] == "cancelled"
    w.client.post(door(setup), content=created, headers=sign_calcom(created, setup["secret"]))
    assert len(w.repo.visits) == 1 and next(iter(w.repo.visits.values()))["status"] == "cancelled"


def test_a_reschedule_moves_the_booking_old_visit_cancelled_new_one_made() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    first = calcom_body("bk1")
    moved = calcom_body("bk2", trigger="BOOKING_RESCHEDULED", start=FUTURE + dt.timedelta(hours=2), extra={"rescheduleUid": "bk1"})
    w.client.post(door(setup), content=first, headers=sign_calcom(first, setup["secret"]))
    assert w.client.post(door(setup), content=moved, headers=sign_calcom(moved, setup["secret"])).status_code == 200
    states = sorted(v["status"] for v in w.repo.visits.values())
    assert states == ["booked", "cancelled"]


def test_a_booking_that_does_not_fit_is_kept_for_a_person_and_never_forced_in() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    w.repo.slots_full.add(FUTURE.isoformat())
    full = calcom_body("full1")
    assert w.client.post(door(setup), content=full, headers=sign_calcom(full, setup["secret"])).status_code == 200
    stranger = calcom_body("nolead", phone="9000000099", start=FUTURE + dt.timedelta(days=1))
    w.client.post(door(setup), content=stranger, headers=sign_calcom(stranger, setup["secret"]))
    assert not w.repo.visits
    listed = w.client.get(f"{T}/bookings/needs-person", headers=auth("a_viewer")).json()["items"]
    assert sorted(i["reason"] for i in listed) == ["full", "no_lead"]
    card = next(c for c in w.client.get(f"{T}/connections", headers=auth("a_viewer")).json()["items"] if c["kind"] == "calcom")
    assert card["counts_30d"]["needs_person"] == 2


def test_consent_is_stored_only_with_the_owners_named_question_and_the_lead_gets_it() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    q = "I agree that this shop may call or WhatsApp me"
    assert w.client.put(f"{T}/calcom/settings", json={"consent_question": q}, headers=w.owner()).status_code == 200
    raw = calcom_body(extra={"responses": {"attendeePhoneNumber": {"label": "Phone", "value": PHONE}, "agree": {"label": q, "value": "true"}}})
    w.client.post(door(setup), content=raw, headers=sign_calcom(raw, setup["secret"]))
    row = w.bridge.rows[0]
    assert row["consent"] == "yes" and row["consent_text"] == q and row["consent_at"].startswith("2026-12-01") and "Cal.com" in row["consent_form"]


def test_a_busy_intake_makes_the_vendor_retry_and_other_lead_refusals_do_not_stop_the_booking() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    raw = calcom_body()
    w.bridge.fail = ApiError(429, "rate_limited", "Too many requests.")
    assert w.client.post(door(setup), content=raw, headers=sign_calcom(raw, setup["secret"])).status_code == 503
    w.bridge.fail = ApiError(404, "not_found", "Not found.")
    assert w.client.post(door(setup), content=raw, headers=sign_calcom(raw, setup["secret"])).status_code == 200


def test_a_signed_calendly_booking_works_the_same(caplog: pytest.LogCaptureFixture) -> None:
    w = World()
    r = w.client.post(f"{T}/calendly/connect", json={"access_token": PAT}, headers=w.owner())
    assert r.status_code == 200 and r.json()["connection"]["kind"] == "calendly"
    sub = w.calendly.subscribed[0]
    path = sub["url"].rsplit("/", 1)[1]
    raw = calendly_body()
    with caplog.at_level(logging.DEBUG):
        assert w.client.post("/v1/webhooks/calendars/calendly/" + path, content=raw, headers=sign_calendly(raw, sub["key"])).status_code == 200
        assert w.client.post("/v1/webhooks/calendars/calendly/" + path, content=raw, headers=sign_calendly(raw, "wrong")).status_code == 401
        assert w.client.post("/v1/webhooks/calendars/calendly/" + path, content=raw, headers=sign_calendly(raw, sub["key"], stamp=1_000)).status_code == 401, "an old timestamp is refused"
    assert len(w.repo.visits) == 1
    text = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "9000000011" not in text and "buyer@example.test" not in text and "Test Buyer" not in text and sub["key"] not in text and PAT not in text


# ============================================================================ the cards, settings, disconnect
def test_connect_calendly_keeps_the_token_in_the_vault_and_returns_no_secret() -> None:
    w = World()
    r = w.client.post(f"{T}/calendly/connect", json={"access_token": PAT, "booking_link": "https://calendly.com/example-shop/visit"}, headers=w.owner())
    assert r.status_code == 200
    blob = r.text + json.dumps(w.client.get(f"{T}/connections", headers=auth("a_viewer")).json())
    assert PAT not in blob and w.calendly.subscribed[0]["key"] not in blob and "/v1/webhooks/calendars/" not in blob
    stored = w.vault.get(TENANT_A.id, "calendly")
    assert stored is not None and stored["pat"] == PAT and stored["signing_key"] == w.calendly.subscribed[0]["key"]
    assert w.calendly.subscribed[0]["url"].startswith(BASE + "/v1/webhooks/calendars/calendly/")
    cards = {c["kind"]: c for c in w.client.get(f"{T}/connections", headers=auth("a_viewer")).json()["items"]}
    assert cards["calendly"]["state"] == "connected" and cards["calendly"]["last4"] == "xxxx" and cards["calcom"]["state"] == "not_connected"
    assert cards["outlook"]["state"] == "needs_setup"


def test_calendly_refusals_are_closed_words() -> None:
    w = World()
    w.calendly.fail = "refused"
    assert w.client.post(f"{T}/calendly/connect", json={"access_token": PAT}, headers=w.owner()).json()["error"]["code"] == "calendar_key_refused"
    w.calendly.fail = "plan"
    assert w.client.post(f"{T}/calendly/connect", json={"access_token": PAT}, headers=w.owner()).json()["error"]["code"] == "calendar_plan_refused"
    w.calendly.fail = "unavailable"
    assert w.client.post(f"{T}/calendly/connect", json={"access_token": PAT}, headers=w.owner()).status_code == 502
    w.calendly.fail = None
    assert w.client.post(f"{T}/calendly/connect", json={"access_token": PAT, "booking_link": "https://evil.example.test/calendly.com"}, headers=w.owner()).json()["error"]["code"] == "calendar_link_invalid"
    assert w.client.post(f"{T}/calendly/connect", json={"access_token": "short"}, headers=w.owner()).status_code == 422
    assert not w.store.secrets, "nothing is kept for a connection that failed"


def test_the_booking_link_is_pinned_to_the_vendor_and_said_only_when_shared() -> None:
    assert links.clean_link("calendly", "https://calendly.com/shop/visit") == "https://calendly.com/shop/visit"
    assert links.clean_link("calcom", "https://app.cal.com/shop") == "https://app.cal.com/shop"
    for bad in ("http://calendly.com/x", "https://calendly.com.evil.test/x", "https://evil.test/calendly.com", "https://user:pw@calendly.com/x", "https://calendly.com:8443/x", "https://cal.com/x y", "https://calendly.com/x#frag", "javascript:alert(1)"):
        assert links.clean_link("calendly", bad) is None, bad
    assert links.clean_link("calendly", "https://cal.com/shop") is None, "a Cal.com address is not a Calendly one"
    w = World()
    connect_calcom(w, booking_link="https://cal.com/example-shop/visit")
    assert w.service.booking_link(TENANT_A.id) is None, "off by default"
    assert w.client.put(f"{T}/calcom/settings", json={"share_link": True}, headers=w.owner()).status_code == 200
    fact = w.service.booking_link(TENANT_A.id)
    assert fact is not None and fact["kind"] == "booking" and "https://cal.com/example-shop/visit" in fact["text"] and "Cal.com" in fact["text"]
    assert w.client.put(f"{T}/calcom/settings", json={"booking_link": "https://evil.example.test/x"}, headers=w.owner()).status_code == 422


def test_disconnect_removes_the_subscription_the_key_and_the_door() -> None:
    w = World()
    w.client.post(f"{T}/calendly/connect", json={"access_token": PAT}, headers=w.owner())
    path = w.calendly.subscribed[0]["url"].rsplit("/", 1)[1]
    r = w.client.post(f"{T}/calendly/disconnect", headers=w.owner())
    assert r.status_code == 200 and r.json()["disconnected"] is True
    assert w.calendly.removed == ["https://api.calendly.com/webhook_subscriptions/SUB-1234"]
    assert w.vault.get(TENANT_A.id, "calendly") is None and not w.store.secrets
    raw = calendly_body()
    assert w.client.post("/v1/webhooks/calendars/calendly/" + path, content=raw, headers=sign_calendly(raw, w.calendly.subscribed[0]["key"])).status_code == 404
    assert w.client.post(f"{T}/calendly/disconnect", headers=w.owner()).status_code == 409


def test_roles_and_the_switch() -> None:
    w = World()
    for who in ("a_sales", "a_viewer"):
        assert w.client.post(f"{T}/calcom/connect", json={}, headers=auth(who)).status_code == 403
        assert w.client.put(f"{T}/calcom/settings", json={"share_link": False}, headers=auth(who)).status_code == 403
        assert w.client.post(f"{T}/calcom/disconnect", headers=auth(who)).status_code == 403
        assert w.client.get(f"{T}/connections", headers=auth(who)).status_code == 200
    assert w.client.post(f"{T}/calcom/connect", json={}, headers=auth("a_admin")).status_code == 200
    assert w.client.post(f"{T}/outlook/start", headers=auth("a_admin")).status_code == 403
    assert w.client.get(f"{T}/connections").status_code == 401
    off = World(on=False)
    for method, path in (("get", f"{T}/connections"), ("get", f"{T}/bookings/needs-person"), ("post", f"{T}/calcom/connect"), ("post", f"{T}/calendly/connect"), ("put", f"{T}/calcom/settings"),
                         ("post", f"{T}/calcom/disconnect"), ("post", f"{T}/outlook/start"), ("get", "/v1/calendars/outlook/callback"), ("post", "/v1/webhooks/calendars/calcom/" + "x" * 43)):
        r = getattr(off.client, method)(path, headers=auth("a_owner"), **({"json": {}} if method in ("post", "put") else {}), **({"follow_redirects": False} if method == "get" else {}))
        assert r.status_code == 404, (method, path, r.status_code)


# ============================================================================ Outlook: connect
def test_outlook_says_needs_setup_until_the_microsoft_app_exists() -> None:
    w = World(microsoft=False)
    r = w.client.post(f"{T}/outlook/start", headers=w.owner())
    assert r.status_code == 409 and r.json()["error"]["code"] == "calendar_needs_setup"
    assert next(c for c in w.client.get(f"{T}/connections", headers=w.owner()).json()["items"] if c["kind"] == "outlook")["state"] == "needs_setup"
    cb = w.client.get("/v1/calendars/outlook/callback?code=x&state=y", follow_redirects=False)
    assert cb.status_code == 303 and cb.headers["location"].endswith("calendar_outlook=needs_setup")


def outlook_flow(w: World) -> str:
    r = w.client.post(f"{T}/outlook/start", headers=w.owner())
    assert r.status_code == 200, r.text
    return str(r.json()["authorize_url"])


def test_outlook_connect_callback_stores_the_refresh_token_only_in_the_vault() -> None:
    w = World(microsoft=True)
    url = outlook_flow(w)
    assert url.startswith(BASE + "/v1/calendars/outlook/callback?")
    cb = w.client.get(url[len(BASE):], follow_redirects=False)
    assert cb.status_code == 303 and cb.headers["location"] == f"https://app.example.test/app/tenants/{TENANT_A.id}/connectors?calendar_outlook=connected"
    secret = w.vault.get(TENANT_A.id, "outlook")
    assert secret is not None and secret["refresh_token"].startswith("fake-refresh-")
    card = next(c for c in w.client.get(f"{T}/connections", headers=w.owner()).json()["items"] if c["kind"] == "outlook")
    assert card["state"] == "connected" and secret["refresh_token"] not in json.dumps(card)
    again = w.client.get(url[len(BASE):], follow_redirects=False)
    assert again.headers["location"].endswith("calendar_outlook=expired"), "an authorization is used once"


def test_outlook_callback_refusals_land_on_the_page_with_a_closed_word() -> None:
    w = World(microsoft=True)
    assert w.client.get("/v1/calendars/outlook/callback?code=c&state=forged", follow_redirects=False).headers["location"].endswith("calendar_outlook=invalid")
    url = outlook_flow(w)
    state = url.split("state=")[1].split("&")[0]
    assert w.client.get(f"/v1/calendars/outlook/callback?error=access_denied&state={state}", follow_redirects=False).headers["location"].endswith("calendar_outlook=denied")
    url = outlook_flow(w)
    assert w.client.get(url[len(BASE):].replace("code=fake-code-", "code=bogus-"), follow_redirects=False).headers["location"].endswith("calendar_outlook=error")
    w.ms.granted = frozenset({"offline_access"})  # type: ignore[union-attr]
    url = outlook_flow(w)
    assert w.client.get(url[len(BASE):], follow_redirects=False).headers["location"].endswith("calendar_outlook=missing_scope")
    assert w.vault.get(TENANT_A.id, "outlook") is None, "nothing is kept"


def test_outlook_disconnect_forgets_the_key() -> None:
    w = World(microsoft=True)
    w.client.get(outlook_flow(w)[len(BASE):], follow_redirects=False)
    r = w.client.post(f"{T}/outlook/disconnect", headers=w.owner())
    assert r.status_code == 200 and r.json() == {"disconnected": True, "events_kept": True}
    assert w.vault.get(TENANT_A.id, "outlook") is None


# ============================================================================ Outlook: the worker pass
def visit(vid: uuid.UUID, status: str = "booked", name: str | None = "Priya Sharma", updated: str = "2026-12-01T05:00:00+00:00") -> dict[str, Any]:
    return {"visit_id": str(vid), "starts_at": "2026-12-03T05:30:00+00:00", "ends_at": "2026-12-03T06:00:00+00:00", "status": status, "party_size": 2, "purpose": "Saree visit, call +919000000055",
            "person_name": name, "visit_updated_at": updated}


def synced(w: World) -> OutlookSync:
    w.client.get(outlook_flow(w)[len(BASE):], follow_redirects=False)
    return OutlookSync(w.repo, w.ms, w.vault, clock=lambda: NOW)  # type: ignore[arg-type]


def test_an_appointment_is_written_once_changed_and_deleted_and_the_event_has_no_number() -> None:
    w = World(microsoft=True)
    sync = synced(w)
    vid = uuid.uuid4()
    w.repo.visit_rows = [visit(vid)]
    assert sync.run("tok")["events"] == 1
    assert len(w.ms.events) == 1  # type: ignore[union-attr]
    event = next(iter(w.ms.events.values()))  # type: ignore[union-attr]
    assert event["transactionId"] == txn_id_for(vid) and event["subject"] == "Appointment: Priya S."
    assert "9000000055" not in json.dumps(event) and "Party size: 2" in event["body"]["content"] and event["start"] == {"dateTime": "2026-12-03T05:30:00", "timeZone": "UTC"}
    sync.run("tok")
    assert w.ms.calls.count("create_event") == 1 and w.ms.calls.count("patch_event") == 0, "an unchanged appointment is not sent again"  # type: ignore[union-attr]
    w.repo.visit_rows = [{**visit(vid, updated="2026-12-01T06:00:00+00:00"), "party_size": 3}]
    sync.run("tok")
    assert w.ms.calls.count("patch_event") == 1  # type: ignore[union-attr]
    w.repo.visit_rows = [visit(vid, status="cancelled", updated="2026-12-01T07:00:00+00:00")]
    sync.run("tok")
    assert not w.ms.events and w.repo.links[str(vid)]["state"] == "deleted"  # type: ignore[union-attr]


def test_a_retried_create_makes_no_second_event_and_an_event_the_owner_deleted_is_written_anew() -> None:
    w = World(microsoft=True)
    sync = synced(w)
    vid = uuid.uuid4()
    w.repo.visit_rows = [visit(vid)]
    first = w.ms.create_event("a", txn_id_for(vid), event_body(visit(vid)))  # type: ignore[union-attr]
    assert w.ms.create_event("a", txn_id_for(vid), event_body(visit(vid))) == first  # type: ignore[union-attr]
    sync.run("tok")
    assert len(w.ms.events) == 1  # type: ignore[union-attr]
    w.ms.events.clear()  # type: ignore[union-attr]
    w.ms.txn.clear()  # type: ignore[union-attr]
    w.repo.visit_rows = [{**visit(vid, updated="2026-12-01T09:00:00+00:00"), "party_size": 4}]
    sync.run("tok")
    assert len(w.ms.events) == 1  # type: ignore[union-attr]


def test_busy_times_come_back_without_our_own_events_and_only_busy_states_count() -> None:
    w = World(microsoft=True)
    sync = synced(w)
    s = dt.datetime(2026, 12, 2, 5, 0, tzinfo=dt.UTC)
    from app.calendar_in.microsoft import BusyEvent

    assert w.ms is not None
    w.ms.foreign = [BusyEvent("f1", s, s + dt.timedelta(hours=1), "busy"), BusyEvent("f2", s + dt.timedelta(minutes=30), s + dt.timedelta(hours=2), "oof"),
                    BusyEvent("f3", s + dt.timedelta(days=1), s + dt.timedelta(days=1, hours=1), "free"), BusyEvent("f4", s + dt.timedelta(days=2), s + dt.timedelta(days=2, hours=1), "workingElsewhere")]
    vid = uuid.uuid4()
    w.repo.visit_rows = [visit(vid)]
    w.repo.link_state["block_busy"] = True
    sync.run("tok")
    sync.run("tok")   # the second pass knows our event's id and leaves it out
    assert w.repo.busy == [(s, s + dt.timedelta(hours=2))], "the two busy events merged; free and working-elsewhere do not block; our own appointment is not a block"


def test_a_refresh_token_that_rotates_is_stored_and_a_revoked_grant_stops_the_link() -> None:
    w = World(microsoft=True)
    sync = synced(w)
    before = w.vault.get(TENANT_A.id, "outlook")["refresh_token"]  # type: ignore[index]
    w.repo.visit_rows = [visit(uuid.uuid4())]
    sync.run("tok")
    after = w.vault.get(TENANT_A.id, "outlook")["refresh_token"]  # type: ignore[index]
    assert after != before and after in w.ms.refresh_tokens  # type: ignore[union-attr]
    w.ms.refresh_tokens.clear()  # type: ignore[union-attr]
    sync.run("tok")
    assert w.repo.link_failures[-1] == ("token", "revoked", True)


def test_a_vault_without_the_key_marks_the_link_needs_reconnect() -> None:
    w = World(microsoft=True)
    sync = synced(w)
    w.vault.delete(TENANT_A.id, "outlook")
    sync.run("tok")
    assert w.repo.link_failures == [("token", "secret_missing", True)]


# ============================================================================ the vendors' own calls (a fake transport, a fake DNS)
def _record(sent: list[Any]) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={})

    return handler


def dns() -> ssrf.Resolver:
    return lambda host, port: ["93.184.216.34"]


def test_calendly_calls_are_pinned_to_the_vendor_host_and_send_the_token_as_bearer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/users/me"):
            return httpx.Response(200, json={"resource": {"uri": "https://api.calendly.com/users/UUUU1111", "current_organization": "https://api.calendly.com/organizations/OOOO1111", "scheduling_url": "https://calendly.com/shop"}})
        body = json.loads(request.content)
        if body["scope"] == "organization":
            return httpx.Response(403, json={"title": "Permission Denied", "message": "Please upgrade to a paid Calendly account."})
        return httpx.Response(201, json={"resource": {"uri": "https://api.calendly.com/webhook_subscriptions/SUB-9999"}})

    api = HttpCalendly(GuardedHttp(resolver=dns(), transport=httpx.MockTransport(handler)))
    user = api.me("tok-123")
    ref = api.subscribe("tok-123", "https://api.example.test/v1/webhooks/calendars/calendly/abc", user, "key-1")
    assert ref.endswith("SUB-9999") and user.scheduling_url == "https://calendly.com/shop"
    assert all(r.headers["authorization"] == "Bearer tok-123" and r.headers["host"] == "api.calendly.com" for r in seen)
    bodies = [json.loads(r.content) for r in seen if r.method == "POST"]
    assert [b["scope"] for b in bodies] == ["organization", "user"] and bodies[1]["user"].endswith("UUUU1111") and bodies[0]["signing_key"] == "key-1" and bodies[0]["events"] == ["invitee.created", "invitee.canceled"]


def test_a_calendly_call_to_another_host_or_a_private_name_is_refused_before_anything_is_sent() -> None:
    sent: list[Any] = []
    http = GuardedHttp(resolver=lambda h, p: ["10.0.0.5"], transport=httpx.MockTransport(_record(sent)))
    with pytest.raises(VendorError):
        HttpCalendly(http).me("tok")
    assert not sent
    api = HttpCalendly(GuardedHttp(resolver=dns(), transport=httpx.MockTransport(_record(sent))))
    api.unsubscribe("tok", "https://evil.example.test/webhook_subscriptions/abc")   # not a subscription address of ours: nothing is sent
    assert not sent


def test_microsoft_urls_scopes_and_the_calendar_view_paging() -> None:
    pages = {"p1": {"value": [{"id": "e1", "start": {"dateTime": "2026-12-02T05:00:00.0000000", "timeZone": "UTC"}, "end": {"dateTime": "2026-12-02T06:00:00.0000000", "timeZone": "UTC"}, "showAs": "busy", "isCancelled": False},
                              {"id": "e2", "start": {"dateTime": "2026-12-02T07:00:00.0000000"}, "end": {"dateTime": "2026-12-02T08:00:00.0000000"}, "showAs": "busy", "isCancelled": True}],
                     "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendar/calendarView?$skiptoken=abc"},
             "p2": {"value": [{"id": "e3", "start": {"dateTime": "2026-12-03T05:00:00.0000000"}, "end": {"dateTime": "2026-12-03T06:00:00.0000000"}, "showAs": "tentative", "isCancelled": False}]}}
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=pages["p2" if "skiptoken" in str(request.url) else "p1"])

    ms = HttpMicrosoft("client-id-1", "client-secret-1", http=GuardedHttp(resolver=dns(), transport=httpx.MockTransport(handler)))
    url = ms.authorize_url(state="st", code_challenge="ch", redirect_uri=BASE + "/cb")
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?") and "code_challenge_method=S256" in url and "offline_access" in url and "Calendars.ReadWrite" in url and "client-secret" not in url
    events = ms.calendar_view("access-1", NOW, NOW + dt.timedelta(days=60))
    assert [e.event_id for e in events] == ["e1", "e3"], "a cancelled event is left out and the next page is read"
    assert all(r.headers["authorization"] == "Bearer access-1" and r.headers["prefer"] == 'outlook.timezone="UTC"' for r in seen)
    assert graph_time({"dateTime": "2026-12-02T05:00:00.0000000"}) == dt.datetime(2026, 12, 2, 5, 0, tzinfo=dt.UTC)


def test_microsoft_token_calls_send_the_secret_in_the_body_and_a_bad_grant_is_revoked() -> None:
    forms: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        forms.append(request.content.decode())
        if "refresh_token=dead" in forms[-1]:
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"access_token": "acc", "refresh_token": "ref2", "scope": "Calendars.ReadWrite offline_access"})

    ms = HttpMicrosoft("client-id-1", "client-secret-1", http=GuardedHttp(resolver=dns(), transport=httpx.MockTransport(handler)))
    grant = ms.refresh("ref1")
    assert grant.refresh_token == "ref2" and "client_secret=client-secret-1" in forms[0] and "grant_type=refresh_token" in forms[0] and "ref1" not in repr(grant)
    with pytest.raises(MicrosoftError) as caught:
        ms.refresh("dead")
    assert caught.value.code == "revoked"


def test_the_door_address_is_stored_only_as_a_hash() -> None:
    w = World()
    setup = connect_calcom(w)["setup"]
    path = setup["webhook_url"].rsplit("/", 1)[1]
    assert list(w.repo.hashes) == [hook_hash(path)] and path not in json.dumps(w.repo.rows)
