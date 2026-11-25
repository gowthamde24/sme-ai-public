"""Microsoft, as the Outlook / Microsoft 365 link needs it: the identity platform v2 (authorization code with PKCE, refresh tokens) and Microsoft Graph (the user's default calendar). Plain REST through
GuardedHttp pinned to login.microsoftonline.com and graph.microsoft.com; no Microsoft library.

Sources (read Nov 2026):
  * authorization code flow, endpoints /{tenant}/oauth2/v2.0/authorize and /token, `common` lets work, school and personal accounts sign in, PKCE S256, `offline_access` is asked for explicitly to get a
    refresh token, and a refresh answers a NEW refresh token that replaces the old one:  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow  and
    https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc
  * List calendarView, `GET /me/calendar/calendarView?startDateTime=&endDateTime=` (delegated Calendars.ReadBasic is the least privilege; Calendars.ReadWrite also covers it), `Prefer: outlook.timezone`,
    paging by @odata.nextLink:  https://learn.microsoft.com/en-us/graph/api/user-list-calendarview
  * Create event `POST /me/events` (Calendars.ReadWrite), update `PATCH /me/events/{id}`, delete `DELETE /me/events/{id}`; `transactionId` is the client's own identifier that keeps a retried create from making
    a second event:  https://learn.microsoft.com/en-us/graph/api/user-post-events  and  https://learn.microsoft.com/en-us/graph/api/resources/event
SCOPES: `offline_access` and `Calendars.ReadWrite`. `User.Read` is not asked for: nothing here reads the profile (the account's name is never kept). Whether transactionId is honoured on a personal Outlook.com
account, and the exact error words of an expired grant, are VERIFY WITH A REAL ACCOUNT.

Nothing from Microsoft is logged: a failure is a closed code word (MicrosoftError.code), never Microsoft's text, a token or a body."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import urllib.parse
from dataclasses import dataclass
from typing import Any, Protocol

from app.outbound_http import GuardedHttp, HttpResult

AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"  # noqa: S105 - an address, not a password
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ("offline_access", "https://graph.microsoft.com/Calendars.ReadWrite")
BUSY_STATES = frozenset({"busy", "oof", "tentative"})


class MicrosoftError(Exception):
    """A closed code word: revoked (the grant no longer works), not_found, conflict, forbidden, rate_limited, unavailable, bad_response, missing_scope."""

    def __init__(self, code: str, status: int = 0) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class Grant:
    refresh_token: str
    access_token: str
    scopes: frozenset[str]

    def __repr__(self) -> str:
        return "Grant(<redacted>)"


@dataclass(frozen=True)
class BusyEvent:
    event_id: str
    starts_at: dt.datetime
    ends_at: dt.datetime
    show_as: str


class MicrosoftApi(Protocol):
    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str: ...
    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> Grant: ...
    def refresh(self, refresh_token: str) -> Grant: ...
    def create_event(self, access: str, txn_id: str, body: dict[str, Any]) -> str: ...
    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> None: ...
    def delete_event(self, access: str, event_id: str) -> None: ...
    def calendar_view(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[BusyEvent]: ...


def graph_time(value: Any) -> dt.datetime | None:
    """Graph's {"dateTime": "2026-12-01T10:00:00.0000000", "timeZone": "UTC"} (we ask for UTC) as an aware time."""
    raw = value.get("dateTime") if isinstance(value, dict) else None
    if not isinstance(raw, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw.strip().rstrip("Z")[:26])
    except ValueError:
        return None
    return parsed.replace(tzinfo=dt.UTC) if parsed.tzinfo is None else parsed.astimezone(dt.UTC)


def _code(res: HttpResult) -> str:
    status = res.status or 0
    if res.error in ("timeout", "refused", "tls", "dns", "blocked", "host", "redirect", "too_large", "not_json"):
        return "unavailable"
    if status == 401:
        return "revoked"
    if status in (404, 410):
        return "not_found"
    if status == 409:
        return "conflict"
    if status == 429:
        return "rate_limited"
    if status == 403:
        return "forbidden"
    if status >= 500:
        return "unavailable"
    return "bad_response"


def _hosts(host: str) -> bool:
    return host in ("login.microsoftonline.com", "graph.microsoft.com")


class HttpMicrosoft:
    def __init__(self, client_id: str, client_secret: str, *, http: GuardedHttp | None = None) -> None:
        self._id, self._secret = client_id, client_secret
        self._http = http or GuardedHttp()

    def __repr__(self) -> str:
        return "HttpMicrosoft(<client>)"

    def _send(self, method: str, url: str, *, access: str | None = None, **kw: Any) -> HttpResult:
        headers = {"Authorization": f"Bearer {access}"} if access else {}
        headers.update(kw.pop("headers", {}))
        res = self._http.request(method, url, headers=headers, allowed_host=_hosts, **kw)
        if not res.ok:
            raise MicrosoftError(_code(res), res.status or 0)
        return res

    def _token(self, form: dict[str, str]) -> Grant:
        res = self._http.request("POST", TOKEN_URL, form={**form, "client_id": self._id, "client_secret": self._secret}, allowed_host=_hosts)
        if not res.ok:
            # the token endpoint answers 400 {"error": "invalid_grant"} for a grant that no longer works; the body is only read for that one word
            raise MicrosoftError("revoked" if res.status in (400, 401) else _code(res), res.status or 0)
        d = res.data if isinstance(res.data, dict) else {}
        refresh, access = d.get("refresh_token"), d.get("access_token")
        if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
            raise MicrosoftError("bad_response", res.status or 0)
        return Grant(refresh, access, frozenset(str(d.get("scope") or "").split()))

    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str) -> str:
        query = {"client_id": self._id, "response_type": "code", "redirect_uri": redirect_uri, "response_mode": "query", "scope": " ".join(SCOPES), "state": state,
                 "code_challenge": code_challenge, "code_challenge_method": "S256", "prompt": "select_account"}
        return AUTH_URL + "?" + urllib.parse.urlencode(query)

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> Grant:
        return self._token({"grant_type": "authorization_code", "code": code, "code_verifier": code_verifier, "redirect_uri": redirect_uri, "scope": " ".join(SCOPES)})

    def refresh(self, refresh_token: str) -> Grant:
        return self._token({"grant_type": "refresh_token", "refresh_token": refresh_token, "scope": " ".join(SCOPES)})

    def create_event(self, access: str, txn_id: str, body: dict[str, Any]) -> str:
        res = self._send("POST", f"{GRAPH}/me/events", access=access, json_body={**body, "transactionId": txn_id})
        eid = res.data.get("id") if isinstance(res.data, dict) else None
        if not isinstance(eid, str) or not eid:
            raise MicrosoftError("bad_response", res.status or 0)
        return eid

    def patch_event(self, access: str, event_id: str, body: dict[str, Any]) -> None:
        self._send("PATCH", f"{GRAPH}/me/events/{urllib.parse.quote(event_id, safe='')}", access=access, json_body=body)

    def delete_event(self, access: str, event_id: str) -> None:
        try:
            self._send("DELETE", f"{GRAPH}/me/events/{urllib.parse.quote(event_id, safe='')}", access=access)
        except MicrosoftError as exc:
            if exc.code != "not_found":   # gone already: the same result
                raise

    def calendar_view(self, access: str, time_min: dt.datetime, time_max: dt.datetime) -> list[BusyEvent]:
        q = urllib.parse.urlencode({"startDateTime": time_min.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "endDateTime": time_max.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    "$select": "id,start,end,showAs,isCancelled", "$top": "100"})
        url: str | None = f"{GRAPH}/me/calendar/calendarView?{q}"
        out: list[BusyEvent] = []
        for _page in range(30):   # at most 3,000 events in the window
            if url is None:
                break
            res = self._send("GET", url, access=access, headers={"Prefer": 'outlook.timezone="UTC"'})
            d = res.data if isinstance(res.data, dict) else {}
            for item in d.get("value") or []:
                if not isinstance(item, dict) or item.get("isCancelled"):
                    continue
                s, e, eid = graph_time(item.get("start")), graph_time(item.get("end")), item.get("id")
                if s and e and e > s and isinstance(eid, str):
                    out.append(BusyEvent(eid, s, e, str(item.get("showAs") or "").lower()))
            nxt = d.get("@odata.nextLink")
            url = nxt if isinstance(nxt, str) and nxt.startswith(GRAPH + "/") else None
        return out
