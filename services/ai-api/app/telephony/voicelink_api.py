"""VoiceLink's REST API for the parts we use (26 Nov 2026; source: VoiceLink's API text, reports/voicelink-llms.txt; owner decision 24 Nov: VoiceLink is the only telephony provider).

  VoicelinkApi      login (username + password -> a Bearer token, kept and renewed on a 401), the wallet (`reseller/profile`), the DIDs we own (`reseller/did/purchased`), a call's detail (`call-log/details`) and
                    `add_lead` (an OUTBOUND call: VoiceLink dials the person from our DID and, when they answer, opens OUR WebSocket bot).
  VoicelinkCaller   the same shape the Plivo placer calls (`place_call` / `cancel_request` / `hang_up`), so the gate, the call row, the dialers and the Owner's test call stay exactly as they are; only the dialling differs.

The password never leaves this module and is never logged; a failure is a CLOSED word (`auth`, `refused`, `unreachable`, `server`, `bad_number`, `no_did`), never VoiceLink's text. UNVERIFIED until the first real call (said in
reports/voicelink-saturday-steps.md): which of `from` / `to` VoiceLink puts in the start event of a call we placed, and whether `did_number` wants the country code in front (we send digits with 91, as their purchased list shows)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import httpx

from app.connectors.phone import normalise
from app.telephony.plivo_api import PlivoError

log = logging.getLogger("app.telephony.voicelink_api")
BASE_URL = "https://app.voicelink.co.in/api/v1"
CLOSED_STATUS = {401: "auth", 403: "auth", 422: "refused", 400: "refused", 404: "refused", 429: "unreachable"}


class VoicelinkError(PlivoError):
    """A refusal or a failure of VoiceLink (a subclass of PlivoError so the placer, the dialers and the routes that already catch it need no change). `reason` is a closed word."""

    data: dict[str, Any] = {}   # the `data` object of a 4xx answer (closed fields only are read), empty otherwise


@dataclass(frozen=True)
class Wallet:
    balance: float
    currency: str


@dataclass(frozen=True)
class LockedOrder:
    order_id: int
    did_count: int
    total: float   # rupees: OUR cost (never shown to a customer)


@dataclass(frozen=True)
class OrderSummary:
    total: float
    did_count: int
    channel_count: int
    wallet_balance: float


@dataclass(frozen=True)
class AvailableDid:
    """One number for sale. `monthly_rate` is OUR cost (rupees a month): for the guardrails and the audit, never for a screen."""

    did_id: int
    number: str   # +91XXXXXXXXXX
    type_label: str
    monthly_rate: float


def digits_with_country(number: str) -> str | None:
    """+919876543210 -> 919876543210 (the form of VoiceLink's DID list); None for anything that is not a plain international number."""
    normal = normalise(number)
    return normal.lstrip("+") if normal else None


def indian_mobile_10(number: str) -> str | None:
    """The 10 digits VoiceLink's add_lead wants (never +91 and never 91 in front: the country code goes in its own field); None when the number is not an Indian 10-digit one."""
    normal = normalise(number)
    if normal is None or not normal.startswith("+91") or len(normal) != 13 or not normal[3:].isdigit():
        return None
    return normal[3:]


class VoicelinkApi:
    def __init__(self, username: str, password: str, *, base_url: str = BASE_URL, client: httpx.Client | None = None, timeout: float = 15.0) -> None:
        self._username, self._password = username, password
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=httpx.Timeout(timeout, connect=5.0))
        self._token: str | None = None
        self._lock = threading.Lock()

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------------------------------------ plumbing
    def _login(self) -> str:
        try:
            r = self._client.post("/auth/login", json={"username": self._username, "password": self._password}, headers={"Accept": "application/json"})
        except httpx.HTTPError as exc:
            log.warning("voicelink login unreachable: %s", exc.__class__.__name__)
            raise VoicelinkError("unreachable") from None
        if r.status_code != 200:
            log.warning("voicelink login refused status=%s", r.status_code)
            raise VoicelinkError("auth", r.status_code)
        try:
            token = str(r.json()["data"]["access_token"])
        except (ValueError, KeyError, TypeError):
            raise VoicelinkError("server") from None
        return token

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        form: dict[str, Any] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> Any:
        for attempt in (1, 2):
            with self._lock:
                if self._token is None:
                    self._token = self._login()
                token = self._token
            try:
                r = self._client.request(method, path, json=json_body, params=params, data=form, files=files, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
            except httpx.HTTPError as exc:
                log.warning("voicelink %s %s unreachable: %s", method, path.split("?")[0], exc.__class__.__name__)
                raise VoicelinkError("unreachable") from None
            if r.status_code == 401 and attempt == 1:   # the token expired: log in again once
                with self._lock:
                    self._token = None
                continue
            if r.status_code >= 500:
                raise VoicelinkError("server", r.status_code)
            if r.status_code >= 400:
                log.warning("voicelink %s %s refused status=%s", method, path.split("?")[0], r.status_code)
                refused = VoicelinkError(CLOSED_STATUS.get(r.status_code, "refused"), r.status_code)
                try:   # what VoiceLink said about WHY (e.g. the list of missing documents): closed fields only are read by the caller, never logged
                    detail = r.json()
                    inner = detail.get("data") if isinstance(detail, dict) else None
                    refused.data = inner if isinstance(inner, dict) else {}
                except ValueError:
                    refused.data = {}
                raise refused
            try:
                body = r.json()
            except ValueError:
                raise VoicelinkError("server") from None
            if isinstance(body, dict) and body.get("status") is False:
                raise VoicelinkError("refused", r.status_code)
            return body.get("data") if isinstance(body, dict) else body
        raise VoicelinkError("auth", 401)

    # ------------------------------------------------------------------------------------------------ what we use
    def wallet(self) -> Wallet:
        """The account's wallet (a read; `reseller/profile`). A postpaid balance can be negative; the unit is the account's currency."""
        data = self._request("GET", "/reseller/profile")
        w = data.get("wallet") if isinstance(data, dict) else None
        try:
            return Wallet(float(w["balance"]), str(w.get("currency") or data.get("currency") or "INR"))   # type: ignore[index,union-attr]
        except (KeyError, TypeError, ValueError, AttributeError):
            raise VoicelinkError("server") from None

    def purchased_dids(self) -> list[dict[str, Any]]:
        """Our numbers at VoiceLink: [{did_number (digits with 91), type_label, expiry_date, is_expired, client_id, ...}] (first page, 100)."""
        data = self._request("GET", "/reseller/did/purchased", params={"per_page": 100})
        rows = data.get("data") if isinstance(data, dict) else None
        return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []

    # ------------------------------------------------------------------------------------------------ the number picker's READS (28 Nov 2026; no money moves here)
    def did_types(self) -> list[dict[str, Any]]:
        """The DID types our plan sells: [{id, name, requires_request}] (`GET /reseller/did-types`). A type with requires_request=1 needs VoiceLink's approval and is never sold by the picker."""
        data = self._request("GET", "/reseller/did-types")
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []

    def available_dids(self, *, did_type: int, prefix: str = "", months: int = 1, per_page: int = 20, page: int = 1) -> list[AvailableDid]:
        """Numbers for sale of one type (2 = Mobile, 3 = Landline), optionally those containing `prefix` digits (`GET /reseller/purchase/dids`; a read: nothing is locked or bought). The monthly rate stays in the object for OUR
        guardrails and is never shown to a customer."""
        params: dict[str, Any] = {"country_code": "+91", "type": did_type, "months": months, "per_page": max(1, min(per_page, 100)), "page": max(1, page)}
        if prefix:
            params["number"] = prefix
        data = self._request("GET", "/reseller/purchase/dids", params=params)
        rows = data.get("data") if isinstance(data, dict) else None
        found: list[AvailableDid] = []
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict):
                continue
            number = digits_with_country(str(r.get("did_number") or ""))
            try:
                found.append(AvailableDid(did_id=int(r["id"]), number=f"+{number}" if number else "", type_label=str(r.get("type_label") or ""), monthly_rate=float(r.get("monthly_rate") or 0)))
            except (KeyError, TypeError, ValueError):
                continue
        return [d for d in found if d.number]

    def websocket_bots(self) -> list[dict[str, Any]]:
        """Our WebSocket bots as VoiceLink holds them: [{id, bot_name, status (1 active), websocket_url, webhook_url, ...}] (`GET /websocket-bot/list`; a read, for the diagnosis script)."""
        data = self._request("GET", "/websocket-bot/list", params={"per_page": 100})
        rows = data.get("data") if isinstance(data, dict) else None
        return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []

    def call_routings(self) -> list[dict[str, Any]]:
        """The routing of each of our numbers: [{did_number, status, for_inbound_call (3 = WebSocket bot), for_outbound_call, ...}] (`GET /call-routing/list`; a read)."""
        data = self._request("GET", "/call-routing/list")
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []

    # ------------------------------------------------------------------------------------------------ the number picker's WRITES (28 Nov 2026): these move money and change the account; only app/numbers/buyer.py calls them
    def lock_did(self, did_id: int, months: int = 1) -> LockedOrder:
        """Lock ONE number and open a draft order (`POST /reseller/purchase/lock-did`). Nothing is charged yet. A number that is no longer free is refused (a closed `refused`)."""
        data = self._request("POST", "/reseller/purchase/lock-did", json_body={"did_ids": [int(did_id)], "months": int(months)})
        try:
            locked = data["locked_dids"]
            return LockedOrder(order_id=int(data["order_id"]), did_count=len(locked), total=float(sum(float(x.get("total_price") or 0) for x in locked)))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise VoicelinkError("server") from None

    def order_summary(self, order_id: int) -> OrderSummary:
        """The server's own totals of a draft order (`GET /reseller/purchase/summary/{id}`): what the order would cost, how many numbers and channels it holds, and the wallet it would be paid from."""
        data = self._request("GET", f"/reseller/purchase/summary/{int(order_id)}")
        try:
            return OrderSummary(total=float(data["total"]), did_count=int(data.get("did_count") or 0), channel_count=int(data.get("channel_count") or 0), wallet_balance=float(data.get("wallet_balance") or 0))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise VoicelinkError("server") from None

    def confirm_purchase(self, order_id: int) -> str:
        """THE PURCHASE (`POST /reseller/purchase/confirm`): the order is paid from OUR wallet. Returns VoiceLink's order number."""
        data = self._request("POST", "/reseller/purchase/confirm", json_body={"order_id": int(order_id)})
        return str(data.get("order_number") or "") if isinstance(data, dict) else ""

    def map_did(self, *, client_id: int, did_id: int, description: str = "", recording: bool = False) -> None:
        """Give a bought number to OUR client (`POST /reseller/client/map-did`), assigned, with call recording OFF unless `recording` (owner decision 28 Nov 2026, option B: ON in the first weeks, and the opening says so; VOICELINK_RECORDING_EXPECTED)."""
        body: dict[str, Any] = {"did_id": int(did_id), "client_id": int(client_id), "user_status": 2, "call_recording": 1 if recording else 0}
        if description:
            body["description"] = description[:200]
        self._request("POST", "/reseller/client/map-did", json_body=body)

    # ------------------------------------------------------------------------------------------------ one client per business (Model B, KYC_PER_CLIENT)
    def create_client(self, *, username: str, email: str, first_name: str, last_name: str, password: str, phone: str | None = None, channel_count: int = 1) -> int:
        """`POST /reseller/client/create`: the business's own VoiceLink client. `wallet_bypass=1`: billing debits OUR wallet (we bill in our credits); `negative_threshold=0`."""
        body: dict[str, Any] = {"username": username, "email": email, "first_name": first_name, "last_name": last_name, "password": password, "is_active": 1,
                                "channel_count": int(channel_count), "negative_threshold": 0, "wallet_bypass": 1}
        if phone:
            body["phone"] = phone
        data = self._request("POST", "/reseller/client/create", json_body=body)
        client_id = data.get("client_id") if isinstance(data, dict) else None
        if isinstance(client_id, bool) or not isinstance(client_id, int) or client_id <= 0:
            raise VoicelinkError("server")
        return client_id

    def kyc_status(self, client_id: int) -> dict[str, Any]:
        data = self._request("GET", "/reseller/kyc/status", params={"client_id": int(client_id)})
        return data if isinstance(data, dict) else {}

    def kyc_step(self, step: str, client_id: int, fields: dict[str, Any]) -> dict[str, Any]:
        """One KYC step for a client: `register-details`, `pan-verify`, `aadhaar-init`, `gst-verify` (the step's own fields; the identity numbers are never logged)."""
        paths = {"register-details": "step-1-register-details", "pan-verify": "step-2-pan-verify", "aadhaar-init": "step-3-aadhaar-init", "gst-verify": "step-4-gst-verify"}
        data = self._request("POST", f"/reseller/kyc/{paths[step]}", json_body={"client_id": int(client_id), **fields})
        return data if isinstance(data, dict) else {}

    def kyc_upload(self, client_id: int, document_type: str, file_name: str, content: bytes, content_type: str) -> dict[str, Any]:
        """The document goes to VoiceLink as multipart (their rule); it is held in memory for this call only."""
        data = self._request("POST", "/reseller/kyc/upload-document", form={"client_id": str(int(client_id)), "document_type": document_type}, files={"document": (file_name, content, content_type)})
        return data if isinstance(data, dict) else {}

    def kyc_final_submit(self, client_id: int) -> dict[str, Any]:
        """`POST /reseller/kyc/final-submit`. The reseller documentation shows no client_id for it: it is sent anyway; whatever VoiceLink answers is shown in plain words."""
        data = self._request("POST", "/reseller/kyc/final-submit", json_body={"client_id": int(client_id)})
        return data if isinstance(data, dict) else {}

    def create_routing(self, *, did_id: int, bot_id: int) -> int:
        """Point a number at our WebSocket bot for inbound and outbound (`POST /call-routing/create`: 3 = WebSocket bot both ways). Returns the routing id."""
        data = self._request("POST", "/call-routing/create", json_body={"did_id": int(did_id), "status": 1, "for_inbound_call": 3, "for_outbound_call": 3, "inbound_websocket_bot_id": int(bot_id), "outbound_websocket_bot_id": int(bot_id)})
        try:
            return int(data["id"])
        except (KeyError, TypeError, ValueError):
            raise VoicelinkError("server") from None

    def call_details(self, call_id: str) -> dict[str, Any]:
        data = self._request("GET", "/call-log/details", params={"call_id": call_id})
        return data if isinstance(data, dict) else {}

    def add_lead(self, *, did_number: str, customer_number: str, custom_parameters: dict[str, str], websocket_url: str, webhook_url: str) -> str:
        """Queue ONE outbound call. Returns VoiceLink's queue id (or "queued" when it names none)."""
        did = digits_with_country(did_number)
        number = indian_mobile_10(customer_number)
        if did is None:
            raise VoicelinkError("no_did")
        if number is None:
            raise VoicelinkError("bad_number")
        data = self._request("POST", "/add_lead", json_body={"did_number": did, "customer_number": number, "country_code": "91", "custom_parameters": json.dumps(custom_parameters, separators=(",", ":")),
                                                              "websocket_url": websocket_url, "webhook_url": webhook_url, "call_limit": 1})
        if isinstance(data, dict):
            for key in ("outbound_queue_id", "queue_id", "id"):
                if data.get(key):
                    return str(data[key])[:100]
        return "queued"


def recording_on(row: dict[str, Any]) -> bool:
    """Does VoiceLink record the calls of this number? Its list says `call_recording` as 0/1 or a word (Yes/No): anything but a clear "off" counts as on, so a surprise is never taken for safe."""
    value = row.get("call_recording", row.get("call_recording_label"))
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ("0", "no", "false", "off", "disabled", "")


class VoicelinkBalanceReader:
    """The daily balance check's reader (app/ops/plivo_balance.py `AccountReader`): the wallet as the two facts the check uses. A wallet in another currency than the check's is a failed read (a limit that cannot be compared is never a silent pass)."""

    def __init__(self, api: VoicelinkApi, *, currency: str) -> None:
        self._api, self._currency = api, currency.upper()

    def account_details(self) -> dict[str, Any]:
        wallet = self._api.wallet()
        if wallet.currency.upper() != self._currency:
            raise VoicelinkError("bad_response")
        out: dict[str, Any] = {"cash_credits": wallet.balance, "auto_recharge": None}
        try:   # how many of our numbers VoiceLink records on its network (a read; a failure here never fails the wallet read)
            out["recording_numbers"] = sum(1 for row in self._api.purchased_dids() if recording_on(row))
        except VoicelinkError:
            pass
        return out


class VoicelinkCaller:
    """What `PlivoOutbound` calls (the PlivoCaller protocol). It reads the call's identity from the answer address the placer built (row, workspace, language, purpose, kind: closed words and ids, no number), puts it
    into VoiceLink's `custom_parameters` (VoiceLink hands it back in the WebSocket's `start`), and points VoiceLink at OUR bot address and OUR webhook, both carrying the secret token."""

    def __init__(self, api: VoicelinkApi, *, public_base: str, ws_token: Callable[[], str]) -> None:
        self._api = api
        self._base = public_base.rstrip("/")
        self._token = ws_token

    def place_call(self, *, from_number: str, to_number: str, answer_url: str, hangup_url: str, ring_timeout: int = 30, time_limit: int = 180) -> str:
        query = dict(parse_qsl(urlsplit(answer_url).query))
        custom: dict[str, str] = {k: query[k] for k in ("call", "tenant", "lang", "p", "k") if k in query}
        if not custom.get("call") or not custom.get("tenant"):
            raise VoicelinkError("refused")
        token = self._token()
        ws = self._base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + f"/v1/telephony/voicelink/ws/{token}"
        hook = f"{self._base}/v1/telephony/voicelink/webhook/{token}"
        return self._api.add_lead(did_number=from_number, customer_number=to_number, custom_parameters=custom, websocket_url=ws, webhook_url=hook)

    def cancel_request(self, request_uuid: str) -> bool:   # VoiceLink documents no way to cancel a queued lead: the row is closed on our side and the call, if it still rings, is refused at the socket
        return False

    def hang_up(self, call_uuid: str) -> bool:
        return False


__all__ = ["AvailableDid", "LockedOrder", "OrderSummary", "recording_on", "VoicelinkApi", "VoicelinkBalanceReader", "VoicelinkCaller", "VoicelinkError", "Wallet", "digits_with_country", "indian_mobile_10"]
