"""Missed calls and the click-to-call bridge (job BZ, ADR 0080). Exotel only (its public documentation, read 2026-10-12, is complete enough to build against; Knowlarity's API reference could not be
found publicly, so no Knowlarity adapter was written).

  Bridge   POST https://<subdomain>/v1/Accounts/<sid>/Calls/connect.json (basic auth: API key and token), form From (rung FIRST: the shop's own phone), To (the customer, rung when the shop picks up),
           CallerId (the ExoPhone), TimeLimit, TimeOut, StatusCallback + StatusCallbackEvents[]=terminal, CustomField. Answer: Call.Sid and Call.Status. "A 200 is not a call placed": the status arrives at the callback.
  Missed   the ExoPhone's flow has a Passthru applet that requests OUR address with CallSid, CallFrom, CallTo, Direction, CurrentTime (GET or POST, set in the dashboard). Exotel signs nothing there, so the
           address carries a long secret (EXOTEL_WEBHOOK_TOKEN) and the call is believed only through it.

The customer's number is handed to the provider in memory and kept nowhere here; the API never logs it."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Protocol

import httpx

from app.connectors.errors import ProviderError

logger = logging.getLogger("app.connectors.calls")
STATUSES = frozenset({"queued", "in-progress", "completed", "failed", "busy", "no-answer", "canceled"})
_SID = re.compile(r"^[A-Za-z0-9_.-]{4,100}$")


class CallBridge(Protocol):
    name: str

    def connect(self, from_number: str, to_number: str, custom_field: str, status_callback: str | None) -> tuple[str, str]:
        """Ring `from_number` first, then `to_number`. Returns (the provider's call id, a status from STATUSES)."""
        ...


class ExotelBridge:
    name = "exotel"

    def __init__(self, sid: str, api_key: str, api_token: str, caller_id: str, *, subdomain: str = "api.in.exotel.com", client: httpx.Client | None = None) -> None:
        if not re.fullmatch(r"[A-Za-z0-9.-]{3,100}", subdomain):
            raise ValueError("EXOTEL_SUBDOMAIN is not a host name")
        self._sid, self._auth, self._caller_id = sid, (api_key, api_token), caller_id
        self._base = f"https://{subdomain}"
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "ExotelBridge(<keys hidden>)"

    def connect(self, from_number: str, to_number: str, custom_field: str, status_callback: str | None) -> tuple[str, str]:
        data: dict[str, Any] = {
            "From": from_number,
            "To": to_number,
            "CallerId": self._caller_id,
            "TimeLimit": "1800",
            "TimeOut": "30",
            "CustomField": custom_field,
        }
        if status_callback:
            data["StatusCallback"] = status_callback
            data["StatusCallbackEvents[]"] = "terminal"
            data["StatusCallbackContentType"] = "application/json"
        try:
            response = self._client.post(f"{self._base}/v1/Accounts/{self._sid}/Calls/connect.json", data=data, auth=self._auth)
        except httpx.TimeoutException:
            raise ProviderError("timeout") from None
        except httpx.HTTPError as exc:
            logger.warning("telephony provider unreachable: %s", exc.__class__.__name__)
            raise ProviderError("unavailable") from None
        if response.status_code in (401, 403):
            raise ProviderError("unauthorized")
        if response.status_code == 429:
            raise ProviderError("rate_limited")  # 200 calls a minute
        if response.status_code >= 400:
            logger.warning("telephony provider refused: http=%s", response.status_code)
            raise ProviderError("rejected" if response.status_code < 500 else "unavailable")
        try:
            call = response.json()["Call"]
            sid, status = str(call["Sid"]), str(call.get("Status", "queued")).lower()
        except (ValueError, KeyError, TypeError):
            raise ProviderError("bad_response") from None
        if not _SID.fullmatch(sid):
            raise ProviderError("bad_response")
        return sid, status if status in STATUSES else "queued"


class FakeBridge:
    """No network, no key: pretends to place a call and remembers who was asked to ring whom."""

    name = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.sids: list[str] = []

    def connect(self, from_number: str, to_number: str, custom_field: str, status_callback: str | None) -> tuple[str, str]:
        self.calls.append((from_number, to_number, custom_field))
        self.sids.append(f"fakecall{uuid.uuid4().hex[:12]}")  # a provider's call ids are never reused
        return self.sids[-1], "queued"


def passthru(params: dict[str, str]) -> tuple[str, str] | None:
    """(call id, caller's number) from a Passthru request, or None when it is not a usable incoming call."""
    sid, caller = params.get("CallSid", ""), params.get("CallFrom", "")
    if not _SID.fullmatch(sid) or not caller:
        return None
    direction = params.get("Direction", "incoming").lower()
    if direction and not direction.startswith("inc"):
        return None
    return sid, caller


def status_of(params: dict[str, Any]) -> tuple[str, str] | None:
    """(call id, status) from a status callback, or None."""
    sid = params.get("CallSid") or params.get("Sid")
    status = str(params.get("Status") or params.get("CallStatus") or "").lower()
    if isinstance(sid, str) and _SID.fullmatch(sid) and status in STATUSES:
        return sid, status
    return None
