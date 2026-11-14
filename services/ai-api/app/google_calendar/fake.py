"""An in-memory Google for the tests and local development (GOOGLE_CALENDAR_FAKE=true). It keeps the PRIMARY calendar's events, counts every call, and can be told to fail. Nothing leaves the process.

The fake's authorize URL points straight back at OUR callback with a code that starts with `fake-code-`: the flow can be clicked through locally without Google."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import datetime as dt
import secrets
import urllib.parse
from typing import Any

from app.google_calendar.google import SCOPES, Channel, GoogleError, TokenGrant, event_times


class FakeGoogle:
    def __init__(self, *, email: str = "owner@example.test") -> None:
        self.email = email
        self.events: dict[str, dict[str, Any]] = {}
        self.foreign_busy: list[tuple[dt.datetime, dt.datetime]] = []   # busy times of events we did NOT write
        self.refresh_tokens: set[str] = set()
        self.revoked: list[str] = []
        self.channels: dict[str, dict[str, Any]] = {}
        self.stopped: list[str] = []
        self.calls: list[str] = []
        self.fail: dict[str, GoogleError] = {}       # method name -> the error it raises next (once)
        self.always_fail: dict[str, GoogleError] = {}
        self.granted_scopes: frozenset[str] = frozenset(SCOPES)
        self.watch_ttl_s: int | None = None

    def __repr__(self) -> str:
        return "FakeGoogle()"

    def _call(self, name: str) -> None:
        self.calls.append(name)
        if name in self.always_fail:
            raise self.always_fail[name]
        if name in self.fail:
            raise self.fail.pop(name)

    # ---- OAuth
    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str:
        return redirect_uri + "?" + urllib.parse.urlencode({"code": "fake-code-" + code_challenge[:16], "state": state, "scope": " ".join(SCOPES)})

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenGrant:
        self._call("exchange_code")
        if not code.startswith("fake-code-"):
            raise GoogleError("bad_response", 400)
        refresh = "fake-refresh-" + secrets.token_urlsafe(12)
        self.refresh_tokens.add(refresh)
        return TokenGrant(refresh_token=refresh, access_token="fake-access-" + refresh[-8:], scopes=self.granted_scopes)

    def access_token(self, refresh_token: str) -> str:
        self._call("access_token")
        if refresh_token not in self.refresh_tokens:
            raise GoogleError("revoked", 400)
        return "fake-access-" + refresh_token[-8:]

    def revoke(self, token: str) -> None:
        self._call("revoke")
        self.revoked.append(token)
        self.refresh_tokens.discard(token)

    # ---- events of the primary calendar
    def get_event(self, access: str, event_id: str) -> dict[str, Any] | None:
        self._call("get_event")
        found = self.events.get(event_id)
        return copy.deepcopy(found) if found else None

    def insert_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self._call("insert_event")
        if event_id in self.events:
            raise GoogleError("conflict", 409)
        self.events[event_id] = {**copy.deepcopy(body), "id": event_id, "status": body.get("status", "confirmed"), "organizer": {"email": self.email}}
        return copy.deepcopy(self.events[event_id])

    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self._call("patch_event")
        if event_id not in self.events:
            raise GoogleError("not_found", 404)
        self.events[event_id].update(copy.deepcopy(body))
        return copy.deepcopy(self.events[event_id])

    def delete_event(self, access: str, event_id: str) -> None:
        self._call("delete_event")
        if event_id in self.events:
            self.events[event_id]["status"] = "cancelled"   # Google keeps a deleted event as cancelled

    # ---- busy times: our own (not cancelled) events plus the foreign ones, merged like Google does
    def freebusy(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[tuple[dt.datetime, dt.datetime]]:
        self._call("freebusy")
        spans = list(self.foreign_busy)
        for ev in self.events.values():
            times = event_times(ev)
            if ev.get("status") != "cancelled" and times:
                spans.append(times)
        spans = sorted((max(s, time_min), min(e, time_max)) for s, e in spans if e > time_min and s < time_max)
        merged: list[tuple[dt.datetime, dt.datetime]] = []
        for s, e in spans:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        return merged

    # ---- push channels
    def watch(self, access: str, channel_id: str, token: str, address: str, ttl_s: int) -> Channel:
        self._call("watch")
        self.watch_ttl_s = ttl_s
        resource = "fake-resource-" + channel_id[:8]
        self.channels[channel_id] = {"token": token, "address": address, "resource_id": resource}
        return Channel(resource_id=resource, expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(seconds=ttl_s))

    def stop_channel(self, access: str, channel_id: str, resource_id: str) -> None:
        self._call("stop_channel")
        self.stopped.append(channel_id)
        self.channels.pop(channel_id, None)
