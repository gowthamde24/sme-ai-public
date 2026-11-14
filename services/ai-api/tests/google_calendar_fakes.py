"""An in-memory stand-in for the database side of Google Calendar (app/google_calendar/repository.py), with the same rules as migration 20261231800000 where the tests lean on them."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from app.google_calendar.repository import LinkStateError, NotConnectedError
from app.tenancy.repository import Forbidden


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class FakeCalendarDb:
    def __init__(self, owner: uuid.UUID) -> None:
        self.owner = owner
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}
        self.events: dict[tuple[uuid.UUID, uuid.UUID], dict[str, Any]] = {}
        self.visits: dict[uuid.UUID, dict[str, Any]] = {}     # visit id -> {tenant_id, starts_at, ends_at, status, party_size, purpose, person_name, updated_at}
        self.busy: dict[uuid.UUID, list[tuple[dt.datetime, dt.datetime]]] = {}
        self.states: dict[uuid.UUID, dict[str, Any]] = {}
        self.secret_rows: dict[uuid.UUID, str] = {}
        self.erased: set[uuid.UUID] = set()
        self.calls: list[str] = []

    # ---- helpers for the tests
    def add_visit(self, tenant: uuid.UUID, *, start: dt.datetime, minutes: int = 30, status: str = "booked", person: str | None = "Priya Sharma", purpose: str | None = "Saree trial", party: int = 2) -> uuid.UUID:
        vid = uuid.uuid4()
        self.visits[vid] = {"tenant_id": tenant, "starts_at": start, "ends_at": start + dt.timedelta(minutes=minutes), "status": status, "party_size": party, "purpose": purpose,
                            "person_name": person, "updated_at": now()}
        return vid

    def touch(self, vid: uuid.UUID, **changes: Any) -> None:
        self.visits[vid].update(changes, updated_at=now() + dt.timedelta(seconds=1))

    def make_due(self) -> None:
        for e in self.events.values():
            e["next_attempt_at"] = now() - dt.timedelta(seconds=1)
        for link in self.rows.values():
            link["busy_next_at"] = None
            link["channel_next_at"] = None

    def _status(self, tenant: uuid.UUID) -> dict[str, Any]:
        link = self.rows.get(tenant)
        if link is None:
            return {"connected": False, "status": "not_connected", "google_email": None, "calendar_id": None, "calendar_name": None, "write_events": False, "block_busy": False,
                    "last_synced_at": None, "last_error_code": None}
        return {"connected": True, **{k: link[k] for k in ("status", "google_email", "calendar_id", "calendar_name", "write_events", "block_busy", "last_synced_at", "last_error_code")}}

    def _link(self, tenant: uuid.UUID) -> dict[str, Any]:
        link = self.rows.get(tenant)
        if link is None:
            raise NotConnectedError("SM881")
        return link

    # ---- the people
    def status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("status")
        return self._status(tenant_id)

    def connect_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("connect_start")
        if sum(1 for s in self.states.values() if s["tenant_id"] == tenant_id and s["used_at"] is None) >= 5:
            raise LinkStateError("SM882")
        nonce = uuid.uuid4()
        self.states[nonce] = {"tenant_id": tenant_id, "member_id": self.owner, "expires_at": now() + dt.timedelta(minutes=10), "used_at": None}
        return {"nonce": str(nonce), "member_id": str(self.owner), "expires_at": self.states[nonce]["expires_at"].isoformat()}

    def ref(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        link = self._link(tenant_id)
        return {"status": link["status"], "calendar_id": "primary", "secret_name": f"sme-ws-{tenant_id}-google_calendar", "channel_id": link["channel_id"], "channel_resource_id": link["channel_resource_id"]}

    def settings_set(self, token: str, tenant_id: uuid.UUID, write_events: bool, block_busy: bool) -> dict[str, Any]:
        self.calls.append("settings_set")
        link = self._link(tenant_id)
        stop = None
        if not block_busy:
            self.busy.pop(tenant_id, None)
            if link["channel_id"]:
                stop = {"channel_id": link["channel_id"], "channel_resource_id": link["channel_resource_id"]}
                link.update(channel_id=None, channel_resource_id=None, channel_expires_at=None)
        if block_busy and not link["block_busy"]:
            link["busy_requested_at"] = now()
        link.update(write_events=write_events, block_busy=block_busy)
        return {**self._status(tenant_id), "stop_channel": stop}

    def sync_now(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        link = self._link(tenant_id)
        link["busy_requested_at"] = now()
        return {**self._status(tenant_id), "requested": True}

    def _forget(self, tenant_id: uuid.UUID) -> dict[str, Any]:
        had = self.rows.pop(tenant_id, None) is not None
        for key in [k for k in self.events if k[0] == tenant_id]:
            del self.events[key]
        self.busy.pop(tenant_id, None)
        self.secret_rows.pop(tenant_id, None)
        return {"disconnected": had}

    def disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("disconnect")
        return self._forget(tenant_id)

    # ---- the scheduler account
    def state_use(self, token: str, nonce: uuid.UUID, tenant_id: uuid.UUID, member_id: uuid.UUID) -> dict[str, Any]:
        s = self.states.get(nonce)
        if s is None or s["tenant_id"] != tenant_id or s["member_id"] != member_id or s["used_at"] is not None or s["expires_at"] <= now():
            raise LinkStateError("SM882")
        s["used_at"] = now()
        if member_id != self.owner:
            raise Forbidden("42501")
        return {"tenant_id": str(tenant_id), "member_id": str(member_id), "secret_name": f"sme-ws-{tenant_id}-google_calendar", "reconnect": tenant_id in self.rows}

    def connected(self, token: str, tenant_id: uuid.UUID, member_id: uuid.UUID, fingerprint: str) -> dict[str, Any]:
        self.calls.append("connected")
        old = self.rows.get(tenant_id)
        stop = {"channel_id": old["channel_id"], "channel_resource_id": old["channel_resource_id"]} if old and old["channel_id"] else None
        base = old or {"google_email": None, "calendar_id": "primary", "calendar_name": None, "write_events": True, "block_busy": False, "last_synced_at": None}
        self.rows[tenant_id] = {**base, "status": "connected", "member_id": member_id, "last_error_code": None, "channel_id": None, "channel_resource_id": None, "channel_expires_at": None,
                                 "busy_requested_at": now(), "busy_refreshed_at": None, "busy_next_at": None, "channel_next_at": None, "connected_at": now()}
        self.secret_rows[tenant_id] = fingerprint
        return {**self._status(tenant_id), "stop_channel": stop}

    def links_list(self) -> list[dict[str, Any]]:
        out = []
        for tenant, link in sorted(self.rows.items()):
            connected = link["status"] == "connected"
            refreshed = link["busy_refreshed_at"]
            busy_due = connected and link["block_busy"] and (link["busy_next_at"] is None or link["busy_next_at"] <= now()) and (
                refreshed is None or refreshed < now() - dt.timedelta(minutes=30) or (link["busy_requested_at"] and link["busy_requested_at"] > refreshed))
            channel_due = connected and link["block_busy"] and (link["channel_next_at"] is None or link["channel_next_at"] <= now()) and (
                link["channel_id"] is None or link["channel_expires_at"] < now() + dt.timedelta(days=1))
            out.append({"tenant_id": str(tenant), "status": link["status"], "calendar_id": "primary", "write_events": link["write_events"], "block_busy": link["block_busy"],
                        "secret_name": f"sme-ws-{tenant}-google_calendar", "channel_id": link["channel_id"], "channel_resource_id": link["channel_resource_id"],
                        "channel_expires_at": link["channel_expires_at"], "email_unknown": link["google_email"] is None, "erase": tenant in self.erased,
                        "busy_due": busy_due, "channel_due": channel_due, "events_due": connected and link["write_events"] and bool(self.visits_due("", tenant, 1))})
        return out

    def links(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        return self.links_list()

    def visits_due(self, token: str, tenant_id: uuid.UUID, limit: int = 25) -> list[dict[str, Any]]:
        out = []
        for vid, v in sorted(self.visits.items(), key=lambda kv: kv[1]["starts_at"]):
            if v["tenant_id"] != tenant_id:
                continue
            g = self.events.get((tenant_id, vid))
            if g is None:
                due = v["status"] in ("booked", "confirmed", "arrived") and v["ends_at"] > now()
            else:
                due = g["state"] != "deleted" and g["next_attempt_at"] <= now() and (g["state"] == "pending" or g["last_error_code"] is not None or v["updated_at"] > (g["visit_updated_at"] or dt.datetime.min.replace(tzinfo=dt.UTC)))
            if due:
                out.append({"visit_id": str(vid), "starts_at": v["starts_at"].isoformat(), "ends_at": v["ends_at"].isoformat(), "status": v["status"], "party_size": v["party_size"],
                            "purpose": v["purpose"], "person_name": v["person_name"], "visit_updated_at": v["updated_at"].isoformat(),
                            "event_id": g["event_id"] if g else None, "event_state": g["state"] if g else None, "last_pushed_hash": g["last_pushed_hash"] if g else None,
                            "attempts": g["attempts"] if g else 0})
        return out[:limit]

    def event_done(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str, state: str, hash_hex: str | None, visit_updated_at: str) -> dict[str, Any]:
        self.events[(tenant_id, visit_id)] = {"event_id": event_id, "state": state, "last_pushed_hash": hash_hex, "visit_updated_at": dt.datetime.fromisoformat(visit_updated_at),
                                              "attempts": 0, "next_attempt_at": now(), "last_error_code": None}
        self.rows[tenant_id]["last_synced_at"] = now().isoformat()
        return {"state": state}

    def event_failed(self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, event_id: str, code: str) -> dict[str, Any]:
        g = self.events.setdefault((tenant_id, visit_id), {"event_id": event_id, "state": "pending", "last_pushed_hash": None, "visit_updated_at": None, "attempts": 0})
        g["attempts"] += 1
        g["next_attempt_at"] = now() + dt.timedelta(minutes=2 ** g["attempts"])
        g["last_error_code"] = code
        self.rows[tenant_id]["last_error_code"] = code
        return {"attempts": g["attempts"]}

    def link_failed(self, token: str, tenant_id: uuid.UUID, work: str, code: str, needs_reconnect: bool) -> dict[str, Any]:
        link = self._link(tenant_id)
        link["last_error_code"] = code
        if needs_reconnect:
            link["status"] = "needs_reconnect"
        if work in ("busy", "token"):
            link["busy_next_at"] = now() + dt.timedelta(minutes=2)
        if work in ("channel", "token"):
            link["channel_next_at"] = now() + dt.timedelta(minutes=2)
        return {"status": link["status"]}

    def own_events(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        out = []
        for (t, vid), g in self.events.items():
            v = self.visits[vid]
            if t == tenant_id and g["state"] == "written":
                out.append({"visit_id": str(vid), "event_id": g["event_id"], "starts_at": v["starts_at"].isoformat(), "ends_at": v["ends_at"].isoformat(),
                            "current": g["last_error_code"] is None and g["visit_updated_at"] >= v["updated_at"] and v["status"] != "cancelled"})
        return out

    def busy_replace(self, token: str, tenant_id: uuid.UUID, blocks: list[tuple[dt.datetime, dt.datetime]]) -> dict[str, Any]:
        link = self._link(tenant_id)
        self.busy[tenant_id] = sorted(set(blocks)) if link["block_busy"] else []
        link.update(busy_refreshed_at=now(), last_synced_at=now().isoformat(), last_error_code=None)
        return {"blocks": len(self.busy[tenant_id])}

    def channel_set(self, token: str, tenant_id: uuid.UUID, channel_id: uuid.UUID, resource_id: str, expires_at: dt.datetime) -> dict[str, Any]:
        link = self._link(tenant_id)
        stop = {"channel_id": link["channel_id"], "channel_resource_id": link["channel_resource_id"]} if link["channel_id"] else None
        link.update(channel_id=str(channel_id), channel_resource_id=resource_id, channel_expires_at=expires_at)
        return {"stop_channel": stop}

    def channel_lookup(self, token: str, channel_id: uuid.UUID) -> dict[str, Any] | None:
        for tenant, link in self.rows.items():
            if link["channel_id"] == str(channel_id) and link["status"] == "connected" and link["block_busy"]:
                return {"tenant_id": str(tenant), "secret_name": f"sme-ws-{tenant}-google_calendar", "channel_resource_id": link["channel_resource_id"]}
        return None

    def busy_request(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("busy_request")
        self.rows[tenant_id]["busy_requested_at"] = now() + dt.timedelta(seconds=1)
        return {"requested": True}

    def set_email(self, token: str, tenant_id: uuid.UUID, email: str) -> dict[str, Any]:
        self.rows[tenant_id]["google_email"] = email.lower()
        return {"ok": True}

    def scheduler_disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("scheduler_disconnect")
        return self._forget(tenant_id)


class StaticSession:
    def __init__(self) -> None:
        self.invalidated = 0

    def token(self) -> str:
        return "scheduler-token-fake"

    def invalidate(self) -> None:
        self.invalidated += 1
