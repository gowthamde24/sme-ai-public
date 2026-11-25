"""An in-memory Microsoft for the tests (and local development): the user's default calendar, counts every call, can be told to fail. Nothing leaves the process. Its authorize URL points straight back at OUR
callback with a code that starts with `fake-code-`."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import datetime as dt
import secrets
import urllib.parse
from typing import Any

from app.calendar_in.microsoft import SCOPES, BusyEvent, Grant, MicrosoftError, graph_time


class FakeMicrosoft:
    def __init__(self) -> None:
        self.events: dict[str, dict[str, Any]] = {}
        self.foreign: list[BusyEvent] = []        # events of the owner's that we did not write
        self.refresh_tokens: set[str] = set()
        self.calls: list[str] = []
        self.fail: dict[str, MicrosoftError] = {}
        self.granted: frozenset[str] = frozenset(SCOPES)
        self.txn: dict[str, str] = {}
        self.times: dict[str, tuple[dt.datetime | None, dt.datetime | None]] = {}

    def __repr__(self) -> str:
        return "FakeMicrosoft()"

    def _call(self, name: str) -> None:
        self.calls.append(name)
        if name in self.fail:
            raise self.fail.pop(name)

    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str:
        return redirect_uri + "?" + urllib.parse.urlencode({"code": "fake-code-" + code_challenge[:16], "state": state})

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> Grant:
        self._call("exchange_code")
        if not code.startswith("fake-code-"):
            raise MicrosoftError("revoked", 400)
        refresh = "fake-refresh-" + secrets.token_urlsafe(12)
        self.refresh_tokens.add(refresh)
        return Grant(refresh, "fake-access-" + refresh[-8:], self.granted)

    def refresh(self, refresh_token: str) -> Grant:
        self._call("refresh")
        if refresh_token not in self.refresh_tokens:
            raise MicrosoftError("revoked", 400)
        self.refresh_tokens.discard(refresh_token)   # a refresh rotates the token, as Microsoft does
        new = "fake-refresh-" + secrets.token_urlsafe(12)
        self.refresh_tokens.add(new)
        return Grant(new, "fake-access-" + new[-8:], self.granted)

    def create_event(self, access: str, txn_id: str, body: dict[str, Any]) -> str:
        self._call("create_event")
        if txn_id in self.txn:   # transactionId: a retried create makes no second event
            return self.txn[txn_id]
        eid = "AAMk" + secrets.token_urlsafe(18)
        self.events[eid] = {**copy.deepcopy(body), "id": eid, "transactionId": txn_id}
        self.times[eid] = (graph_time(body.get("start")), graph_time(body.get("end")))
        self.txn[txn_id] = eid
        return eid

    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> None:
        self._call("patch_event")
        if event_id not in self.events:
            raise MicrosoftError("not_found", 404)
        self.events[event_id].update(copy.deepcopy(body))
        self.times[event_id] = (graph_time(self.events[event_id].get("start")), graph_time(self.events[event_id].get("end")))

    def delete_event(self, access: str, event_id: str) -> None:
        self._call("delete_event")
        self.events.pop(event_id, None)
        self.times.pop(event_id, None)

    def calendar_view(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[BusyEvent]:
        self._call("calendar_view")
        out = list(self.foreign)
        for eid in self.events:
            s, e = self.times.get(eid, (None, None))
            if s is not None and e is not None:
                out.append(BusyEvent(eid, s, e, "busy"))
        return [b for b in out if b.ends_at > time_min and b.starts_at < time_max]
