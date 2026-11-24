"""The number picker's service (28 Nov 2026): what an Owner may see and do about picking a phone number. The platform rules (switch, plan, daily cap, one purchase per number) are the database's; the wallet floor and the
price limits are the buyer's; this module only joins them in the right order and says every refusal as a closed word.

A customer is shown a number and its type, NEVER a price (ours or VoiceLink's)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Protocol

from app.numbers.buyer import TYPES, BuyerSettings, PickerRefused, buy
from app.rpc_base import RpcClient
from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError
from app.tenancy.repository import RepositoryError

log = logging.getLogger("app.numbers.service")
PAGE = 20


class PickerBlocked(RepositoryError):
    """The picker will not do this now. `reason` is a closed word: not_on_plan, already_has_number, paused, daily_limit, number_taken, wallet_low, unavailable."""

    reason = "unavailable"

    def __init__(self, reason: str | None = None) -> None:
        super().__init__(reason or self.reason)
        if reason:
            self.reason = reason


class NotOnPlan(PickerBlocked):
    reason = "not_on_plan"


class AlreadyHasNumber(PickerBlocked):
    reason = "already_has_number"


class Paused(PickerBlocked):
    reason = "paused"


class DailyLimit(PickerBlocked):
    reason = "daily_limit"


class NumberTaken(PickerBlocked):
    reason = "number_taken"


class NumberRepository(Protocol):
    def check(self, token: str, tenant_id: uuid.UUID) -> str | None: ...
    def begin(self, token: str, tenant_id: uuid.UUID, number: str, kind: str) -> uuid.UUID: ...
    def finish(self, token: str, claim_id: uuid.UUID, state: str, reason: str | None = None, cost_paise: int | None = None, order_number: str | None = None) -> None: ...
    def attach(self, token: str, claim_id: uuid.UUID) -> dict[str, Any]: ...
    def listing(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestNumberRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM931": NotOnPlan, "SM932": AlreadyHasNumber, "SM933": Paused, "SM934": DailyLimit, "SM935": NumberTaken}, client=client)

    def check(self, token: str, tenant_id: uuid.UUID) -> str | None:
        out = self._rpc.call(token, "number_claim_check", {"p_tenant_id": str(tenant_id)})
        return str(out) if out else None

    def begin(self, token: str, tenant_id: uuid.UUID, number: str, kind: str) -> uuid.UUID:
        return uuid.UUID(str(self._rpc.call(token, "number_claim_begin", {"p_tenant_id": str(tenant_id), "p_number": number, "p_kind": kind})))

    def finish(self, token: str, claim_id: uuid.UUID, state: str, reason: str | None = None, cost_paise: int | None = None, order_number: str | None = None) -> None:
        self._rpc.call(token, "number_claim_finish", {"p_id": str(claim_id), "p_state": state, "p_reason": reason, "p_cost_paise": cost_paise, "p_order_number": order_number})

    def attach(self, token: str, claim_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "number_claim_attach", {"p_id": str(claim_id)})

    def listing(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        out = self._rpc.call(token, "numbers_list", {"p_tenant_id": str(tenant_id)})
        return [r for r in out if isinstance(r, dict)] if isinstance(out, list) else []


def display(number: str) -> str:
    """+919876543210 -> +91 98765 43210 (never anything else of the number is hidden: it is the business's own line)."""
    digits = number[3:] if number.startswith("+91") else number.lstrip("+")
    return f"+91 {digits[:5]} {digits[5:]}" if len(digits) == 10 else number


@dataclass(frozen=True)
class Offer:
    number: str
    display: str
    type: str


@dataclass(frozen=True)
class Claimed:
    number: str
    display: str
    type: str
    state: str   # "ready" (set up and attached, calls OFF) or "getting_ready" (bought; the team is finishing the set-up)


class NumberService:
    def __init__(
        self,
        repo: NumberRepository,
        api: VoicelinkApi,
        buyer: BuyerSettings,
        *,
        alert: Callable[[str], None] | None = None,
        client_for: Callable[[str, uuid.UUID], int | None] | None = None,
    ) -> None:
        self._repo, self._api, self._buyer, self._alert = repo, api, buyer, alert
        self._client_for = client_for   # KYC_PER_CLIENT: the workspace's own VoiceLink client (None = its KYC is not complete)

    def numbers(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"number": r["number"], "display": display(str(r["number"])), "type": r.get("kind") or "mobile", "state": r.get("state"), "label": r.get("label")} for r in self._repo.listing(token, tenant_id)]

    def available(self, token: str, tenant_id: uuid.UUID, kind: str, prefix: str, page: int = 1) -> tuple[list[Offer], bool]:
        reason = self._repo.check(token, tenant_id)
        if reason:
            raise PickerBlocked(reason)
        did_type = TYPES.get(kind)
        if did_type is None:
            raise PickerBlocked("unavailable")
        try:
            rows = self._api.available_dids(did_type=did_type, prefix=prefix, per_page=PAGE + 1, page=max(1, page))
        except VoicelinkError as exc:
            log.warning("number_picker list_failed reason=%s", exc.reason)
            raise PickerBlocked("unavailable") from None
        return [Offer(r.number, display(r.number), kind) for r in rows[:PAGE]], len(rows) > PAGE

    def claim(self, token: str, tenant_id: uuid.UUID, number: str, kind: str) -> Claimed:
        buyer = self._buyer
        if self._client_for is not None:
            client_id = self._client_for(token, tenant_id)
            if client_id is None:
                raise PickerBlocked("kyc_required")
            buyer = replace(buyer, client_id=client_id)
        claim_id = self._repo.begin(token, tenant_id, number, kind)   # every platform rule, atomically, or a closed refusal
        try:
            bought = buy(self._api, buyer, number, kind)
        except PickerRefused as refused:
            self._repo.finish(token, claim_id, "failed", refused.reason)
            if refused.reason in ("wallet_low", "vendor_unavailable"):
                self._tell(f"Number picker: a purchase was stopped ({refused.reason}). " + ("Top up the VoiceLink wallet." if refused.reason == "wallet_low" else "Check VoiceLink's purchase list: an order may have gone through."))
            raise PickerBlocked("number_taken" if refused.reason == "number_taken" else "wallet_low" if refused.reason == "wallet_low" else "unavailable") from None
        self._repo.finish(token, claim_id, bought.stage, None, round(bought.cost_inr * 100), bought.order_number)
        if bought.complete:
            self._repo.attach(token, claim_id)
            return Claimed(bought.number, display(bought.number), kind, "ready")
        self._tell(f"Number picker: a number was bought but its set-up stopped at '{bought.stage}'. Finish it in the VoiceLink portal (give it to the client, then point it at the bot).")
        return Claimed(bought.number, display(bought.number), kind, "getting_ready")

    def _tell(self, detail: str) -> None:
        if self._alert is not None:
            try:
                self._alert(detail)
            except Exception as exc:  # noqa: BLE001 - only the class is logged; a failed alert never spoils the answer
                log.warning("number_picker alert_failed %s", exc.__class__.__name__)
