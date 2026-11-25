"""Calendly's REST API, as the connect needs it (https://developer.calendly.com/api-docs): the owner's personal access token (Bearer) reads `GET /users/me` (their user and organization addresses) and makes the
webhook subscription `POST /webhook_subscriptions` {url, events [invitee.created, invitee.canceled], organization, scope, signing_key}; `DELETE` takes it down on disconnect. We choose the signing key
(Calendly allows it for a personal access token, https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures), so the key is known to us from the first message. An organization-scoped
subscription needs an organization admin or owner; when Calendly refuses it (403) we try the user scope, which sees the owner's own events.

Calendly's documentation also says some events need a paid plan (a 403 "Please upgrade to a paid Calendly account.") while its FAQ says webhooks are on every plan: verify with a real account.
Every call goes through app.outbound_http.GuardedHttp pinned to api.calendly.com. A refusal is a closed word, never Calendly's text, and the token is never logged."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Protocol

from app.outbound_http import GuardedHttp

API = "https://api.calendly.com"
_SUB = re.compile(r"https://api\.calendly\.com/webhook_subscriptions/[A-Za-z0-9_-]{4,100}")
_URI = re.compile(r"https://api\.calendly\.com/(users|organizations)/[A-Za-z0-9_-]{4,100}")


class VendorError(Exception):
    """A closed word: refused (the key was not accepted), plan (a plan that does not allow it), unavailable, bad_response."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CalendlyUser:
    user_uri: str
    organization_uri: str
    scheduling_url: str | None


class CalendlyApi(Protocol):
    def me(self, token: str) -> CalendlyUser: ...
    def subscribe(self, token: str, url: str, user: CalendlyUser, signing_key: str) -> str: ...
    def unsubscribe(self, token: str, ref: str) -> None: ...


def _host(host: str) -> bool:
    return host == "api.calendly.com"


class HttpCalendly:
    def __init__(self, http: GuardedHttp | None = None) -> None:
        self._http = http or GuardedHttp()

    def __repr__(self) -> str:
        return "HttpCalendly()"

    def _call(self, method: str, url: str, token: str, **kw: Any) -> Any:
        r = self._http.request(method, url, headers={"Authorization": f"Bearer {token}"}, allowed_host=_host, **kw)
        if r.ok:
            return r.data if r.data is not None else {}
        if r.status in (401, 403, 404):
            raise VendorError("plan" if r.status == 403 else "refused")
        if r.status == 409:
            raise VendorError("conflict")
        raise VendorError("unavailable")

    def me(self, token: str) -> CalendlyUser:
        res = self._call("GET", f"{API}/users/me", token)
        resource = res.get("resource") if isinstance(res, dict) else None
        if not isinstance(resource, dict):
            raise VendorError("bad_response")
        user, org, sched = resource.get("uri"), resource.get("current_organization"), resource.get("scheduling_url")
        if not isinstance(user, str) or not _URI.fullmatch(user) or not isinstance(org, str) or not _URI.fullmatch(org):
            raise VendorError("bad_response")
        return CalendlyUser(user, org, sched if isinstance(sched, str) else None)

    def subscribe(self, token: str, url: str, user: CalendlyUser, signing_key: str) -> str:
        body = {"url": url, "events": ["invitee.created", "invitee.canceled"], "organization": user.organization_uri, "signing_key": signing_key}
        try:
            res = self._call("POST", f"{API}/webhook_subscriptions", token, json_body={**body, "scope": "organization"})
        except VendorError as exc:
            if exc.code not in ("plan", "refused"):
                raise
            res = self._call("POST", f"{API}/webhook_subscriptions", token, json_body={**body, "scope": "user", "user": user.user_uri})
        resource = res.get("resource") if isinstance(res, dict) else None
        ref = resource.get("uri") if isinstance(resource, dict) else None
        if not isinstance(ref, str) or not _SUB.fullmatch(ref):
            raise VendorError("bad_response")
        return ref

    def unsubscribe(self, token: str, ref: str) -> None:
        if not _SUB.fullmatch(ref):
            return
        try:
            self._call("DELETE", ref, token)
        except VendorError as exc:
            if exc.code != "refused":   # a subscription that is already gone (404) or a token that no longer works leaves nothing for us to remove
                raise
