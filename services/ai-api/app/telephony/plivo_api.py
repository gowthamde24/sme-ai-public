"""Plivo's REST API, the little of it we call (job 3 phase B): place a call, hang one up. HTTP Basic with the Auth ID and the Auth Token; both stay inside this object: they are never logged, never returned, never in an error.

  place_call   POST https://api.plivo.com/v1/Account/<auth id>/Call/   {from, to, answer_url, answer_method, hangup_url, hangup_method, ring_timeout, time_limit}   ->   request_uuid
               Plivo asks `answer_url` when the callee picks up (so the media socket opens only for an answered call) and `hangup_url` when the call ends, with a reason.
  hang_up      DELETE https://api.plivo.com/v1/Account/<auth id>/Call/<call uuid>/

India (Plivo's documentation, read 10 Nov 2026): the caller id (`from`) must be a Plivo-rented Indian number, and both legs must stay in India, so a call goes from one of our Plivo numbers to an Indian number.
`from` and `to` are sent as digits with the country code and no "+" (the form Plivo itself shows in its callbacks); this exact form is checked by the first real outbound call.

A failure is a closed word (`PlivoError.reason`): timeout | unavailable | unauthorized | rate_limited | rejected | bad_response. A 200 is "a call was fired", not "a call was placed": the status arrives at the hangup URL."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

logger = logging.getLogger("app.telephony.plivo_api")
_UUID = re.compile(r"^[A-Za-z0-9-]{8,100}$")
BASE = "https://api.plivo.com"


class PlivoError(Exception):
    """Plivo refused or could not be reached. `reason` is a closed word; nothing else (no body, no number) is kept."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def digits(number: str) -> str:
    """+919876543210 -> 919876543210"""
    return "".join(c for c in number if c.isdigit())


class PlivoApi:
    def __init__(self, auth_id: str, auth_token: str, *, base: str = BASE, client: httpx.Client | None = None) -> None:
        if not re.fullmatch(r"[A-Za-z0-9]{6,40}", auth_id or ""):
            raise ValueError("PLIVO_AUTH_ID is not an Auth ID")
        if not re.fullmatch(r"https://[A-Za-z0-9.-]{3,100}/?", base):
            raise ValueError("the Plivo base must be https:// and a host name")
        self._id, self._auth, self._base = auth_id, (auth_id, auth_token), base.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))

    def __repr__(self) -> str:
        return "PlivoApi(<credentials hidden>)"

    def _send(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        try:
            response = self._client.request(method, f"{self._base}/v1/Account/{self._id}/{path}", json=body, auth=self._auth)
        except httpx.TimeoutException:
            raise PlivoError("timeout") from None
        except httpx.HTTPError as exc:
            logger.warning("plivo unreachable: %s", exc.__class__.__name__)
            raise PlivoError("unavailable") from None
        if response.status_code in (401, 403):
            raise PlivoError("unauthorized")
        if response.status_code == 429:
            raise PlivoError("rate_limited")
        if response.status_code >= 500:
            logger.warning("plivo error: http=%s", response.status_code)
            raise PlivoError("unavailable")
        if response.status_code >= 400:
            logger.warning("plivo refused: http=%s", response.status_code)   # (the reason text can hold a number: never logged)
            raise PlivoError("rejected")
        return response

    def place_call(self, *, from_number: str, to_number: str, answer_url: str, hangup_url: str, ring_timeout: int = 30, time_limit: int = 180) -> str:
        """Fire a call. Returns Plivo's request uuid (the call's id in the callbacks)."""
        body = {"from": digits(from_number), "to": digits(to_number), "answer_url": answer_url, "answer_method": "POST", "hangup_url": hangup_url, "hangup_method": "POST",
                "ring_timeout": int(ring_timeout), "time_limit": int(time_limit)}
        response = self._send("POST", "Call/", body)
        try:
            uuid_ = str(response.json()["request_uuid"])
        except (ValueError, KeyError, TypeError):
            raise PlivoError("bad_response") from None
        if not _UUID.fullmatch(uuid_):
            raise PlivoError("bad_response")
        return uuid_

    def cancel_request(self, request_uuid: str) -> bool:
        """Cancel a call that has not been answered yet (queued or ringing) by the request uuid `place_call` returned. False when Plivo no longer knows it (it was answered, or it ended)."""
        if not _UUID.fullmatch(request_uuid or ""):
            return False
        try:
            self._send("DELETE", f"Request/{request_uuid}/")
        except PlivoError as exc:
            if exc.reason == "rejected":
                return False
            raise
        return True

    def hang_up(self, call_uuid: str) -> bool:
        """End a live call. False when Plivo no longer knows it (it had ended)."""
        if not _UUID.fullmatch(call_uuid or ""):
            return False
        try:
            self._send("DELETE", f"Call/{call_uuid}/")
        except PlivoError as exc:
            if exc.reason == "rejected":
                return False
            raise
        return True


class FakePlivoApi:
    """No network, no key: remembers what it was asked to dial."""

    def __init__(self) -> None:
        self.placed: list[dict[str, str]] = []
        self.hung_up: list[str] = []
        self.cancelled: list[str] = []
        self.cancel_result = True
        self.fail_with: str | None = None

    def place_call(self, *, from_number: str, to_number: str, answer_url: str, hangup_url: str, ring_timeout: int = 30, time_limit: int = 180) -> str:
        if self.fail_with:
            raise PlivoError(self.fail_with)
        self.placed.append({"from": from_number, "to": to_number, "answer_url": answer_url, "hangup_url": hangup_url})
        return f"00000000-0000-0000-0000-{len(self.placed):012d}"

    def cancel_request(self, request_uuid: str) -> bool:
        self.cancelled.append(request_uuid)
        return self.cancel_result

    def hang_up(self, call_uuid: str) -> bool:
        self.hung_up.append(call_uuid)
        return True
