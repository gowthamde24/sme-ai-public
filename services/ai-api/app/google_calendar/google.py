"""Google, as this feature needs it: OAuth (authorization code with PKCE, offline access), the primary calendar's events (ours only), freebusy, and push channels. Plain REST over httpx: no Google SDK.

SCOPES (docs/plans/google-oauth-verification.md, checked against Google's scope table and the method pages, Nov 2026):
  * https://www.googleapis.com/auth/calendar.events    events.insert / get / patch / delete of the appointments WE write, and events.watch (the push channel). The scope the owner's plan and the
                                                        verification pack name. `calendar` would add sharing and deleting calendars. (`calendar.events.owned`, "calendars you own", is a little
                                                        narrower and is also accepted by these methods: switching is this line plus the consent screen, if Google's review asks for it.)
  * https://www.googleapis.com/auth/calendar.freebusy  freebusy.query: busy/free times only, no titles, no attendees. freebusy.query does NOT accept calendar.events, so it is the one extra scope.
                                                        `calendar.events.freebusy` (availability of every calendar the user can see) and `calendar.readonly` (all event contents) are both wider.
No calendarlist scope: v1 writes to and reads the PRIMARY calendar only (no calendar picker). No openid/email scope: the account's address is the organizer Google names on the first event we write.

Nothing from Google is logged: an error is a closed code word (GoogleError.code), never Google's text, a token or a body."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import logging
import urllib.parse
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

logger = logging.getLogger("app.google_calendar.google")

SCOPES = ("https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy")
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - an address, not a password
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
PRIMARY = "primary"
OWN_EVENT_FIELDS = "id,status,start,end,organizer(email),extendedProperties"


class GoogleError(Exception):
    """A closed code word: revoked (the refresh token no longer works), not_found, conflict, forbidden, rate_limited, unavailable, bad_response, missing_scope."""

    def __init__(self, code: str, status: int = 0) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class TokenGrant:
    refresh_token: str
    access_token: str
    scopes: frozenset[str]

    def __repr__(self) -> str:
        return "TokenGrant(<redacted>)"


@dataclass(frozen=True)
class Channel:
    resource_id: str
    expires_at: dt.datetime


class GoogleApi(Protocol):
    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str: ...
    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenGrant: ...
    def access_token(self, refresh_token: str) -> str: ...
    def revoke(self, token: str) -> None: ...
    def get_event(self, access: str, event_id: str) -> dict[str, Any] | None: ...
    def insert_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]: ...
    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]: ...
    def delete_event(self, access: str, event_id: str) -> None: ...
    def freebusy(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[tuple[dt.datetime, dt.datetime]]: ...
    def watch(self, access: str, channel_id: str, token: str, address: str, ttl_s: int) -> Channel: ...
    def stop_channel(self, access: str, channel_id: str, resource_id: str) -> None: ...


def rfc3339(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def parse_time(raw: Any) -> dt.datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        value = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo is not None else None


def event_times(event: dict[str, Any]) -> tuple[dt.datetime, dt.datetime] | None:
    start = parse_time((event.get("start") or {}).get("dateTime"))
    end = parse_time((event.get("end") or {}).get("dateTime"))
    return (start, end) if start and end and end > start else None


def _code_for(status: int, body: Any) -> str:
    reason = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, str):
            reason = err
        elif isinstance(err, dict):
            errors = err.get("errors")
            if isinstance(errors, list) and errors and isinstance(errors[0], dict):
                reason = str(errors[0].get("reason") or "")
    if reason == "invalid_grant" or status == 401:
        return "revoked"
    if status in (404, 410):
        return "not_found"
    if status == 409:
        return "conflict"
    if status == 429 or reason in ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"):
        return "rate_limited"
    if status == 403:
        return "forbidden"
    if status >= 500:
        return "unavailable"
    return "bad_response"


class HttpGoogle:
    """The real Google over REST. Each call raises GoogleError with a closed code; a log line carries at most the status number."""

    def __init__(self, client_id: str, client_secret: str, *, client: httpx.Client | None = None) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "HttpGoogle(<client>)"

    def _send(self, method: str, url: str, *, access: str | None = None, **kw: Any) -> httpx.Response:
        headers = {"Accept": "application/json"}
        if access is not None:
            headers["Authorization"] = f"Bearer {access}"
        try:
            r = self._http.request(method, url, headers=headers, **kw)
        except httpx.HTTPError:
            raise GoogleError("unavailable") from None
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = None
            code = _code_for(r.status_code, body)
            logger.info("google call refused: status=%d code=%s", r.status_code, code)
            raise GoogleError(code, r.status_code)
        return r

    @staticmethod
    def _json(r: httpx.Response) -> dict[str, Any]:
        try:
            body = r.json()
        except ValueError:
            raise GoogleError("bad_response", r.status_code) from None
        if not isinstance(body, dict):
            raise GoogleError("bad_response", r.status_code)
        return body

    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str:
        query = {
            "client_id": self._client_id, "redirect_uri": redirect_uri, "response_type": "code", "scope": " ".join(SCOPES),
            "access_type": "offline", "prompt": "consent", "include_granted_scopes": "false",
            "state": state, "code_challenge": code_challenge, "code_challenge_method": "S256",
        }
        return AUTH_URL + "?" + urllib.parse.urlencode(query)

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenGrant:
        r = self._send("POST", TOKEN_URL, data={"grant_type": "authorization_code", "code": code, "code_verifier": code_verifier, "redirect_uri": redirect_uri,
                                                "client_id": self._client_id, "client_secret": self._client_secret})
        body = self._json(r)
        refresh, access = body.get("refresh_token"), body.get("access_token")
        if not isinstance(refresh, str) or not refresh or not isinstance(access, str) or not access:
            raise GoogleError("bad_response", r.status_code)
        return TokenGrant(refresh_token=refresh, access_token=access, scopes=frozenset(str(body.get("scope") or "").split()))

    def access_token(self, refresh_token: str) -> str:
        r = self._send("POST", TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": self._client_id, "client_secret": self._client_secret})
        access = self._json(r).get("access_token")
        if not isinstance(access, str) or not access:
            raise GoogleError("bad_response", r.status_code)
        return access

    def revoke(self, token: str) -> None:
        try:
            self._send("POST", REVOKE_URL, data={"token": token})
        except GoogleError as exc:
            if exc.code not in ("bad_response", "revoked"):   # 400 invalid_token: it was revoked already
                raise

    def _event_url(self, event_id: str) -> str:
        return f"{API}/calendars/{PRIMARY}/events/{urllib.parse.quote(event_id, safe='')}"

    def get_event(self, access: str, event_id: str) -> dict[str, Any] | None:
        try:
            r = self._send("GET", self._event_url(event_id), access=access, params={"fields": OWN_EVENT_FIELDS})
        except GoogleError as exc:
            if exc.code == "not_found":
                return None
            raise
        return self._json(r)

    def insert_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]:
        r = self._send("POST", f"{API}/calendars/{PRIMARY}/events", access=access, params={"sendUpdates": "none", "fields": OWN_EVENT_FIELDS}, json={**body, "id": event_id})
        return self._json(r)

    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> dict[str, Any]:
        r = self._send("PATCH", self._event_url(event_id), access=access, params={"sendUpdates": "none", "fields": OWN_EVENT_FIELDS}, json=body)
        return self._json(r)

    def delete_event(self, access: str, event_id: str) -> None:
        try:
            self._send("DELETE", self._event_url(event_id), access=access, params={"sendUpdates": "none"})
        except GoogleError as exc:
            if exc.code != "not_found":   # gone already (410 or 404): the same result
                raise

    def freebusy(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[tuple[dt.datetime, dt.datetime]]:
        r = self._send("POST", f"{API}/freeBusy", access=access, json={"timeMin": rfc3339(time_min), "timeMax": rfc3339(time_max), "items": [{"id": PRIMARY}]})
        calendars = self._json(r).get("calendars")
        entry = None
        if isinstance(calendars, dict):
            entry = calendars.get(PRIMARY) or (next(iter(calendars.values())) if len(calendars) == 1 else None)
        if not isinstance(entry, dict) or entry.get("errors"):
            raise GoogleError("bad_response", r.status_code)
        out: list[tuple[dt.datetime, dt.datetime]] = []
        for b in entry.get("busy") or []:
            if isinstance(b, dict):
                start, end = parse_time(b.get("start")), parse_time(b.get("end"))
                if start and end and end > start:
                    out.append((start, end))
        return out

    def watch(self, access: str, channel_id: str, token: str, address: str, ttl_s: int) -> Channel:
        r = self._send("POST", f"{API}/calendars/{PRIMARY}/events/watch", access=access,
                       json={"id": channel_id, "type": "web_hook", "address": address, "token": token, "params": {"ttl": str(ttl_s)}})
        body = self._json(r)
        resource, expiration = body.get("resourceId"), body.get("expiration")
        try:
            expires = dt.datetime.fromtimestamp(int(str(expiration)) / 1000, tz=dt.UTC)
        except (TypeError, ValueError):
            raise GoogleError("bad_response", r.status_code) from None
        if not isinstance(resource, str) or not resource:
            raise GoogleError("bad_response", r.status_code)
        return Channel(resource_id=resource, expires_at=expires)

    def stop_channel(self, access: str, channel_id: str, resource_id: str) -> None:
        try:
            self._send("POST", f"{API}/channels/stop", access=access, json={"id": channel_id, "resourceId": resource_id})
        except GoogleError as exc:
            if exc.code != "not_found":
                raise
