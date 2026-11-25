"""Calls charged to the wallet (migration 20261231991700; app/billing/call_charge.py): the charge is carried to the database once, a failure never breaks the call, the reconcile pass charges what was missed,
the wallet's answer closes the right door in each direction, and a blocked answer is never remembered. The prices and the free cases are in pgTAP 285; here is the API's side."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest

from app.billing.call_charge import CallCharger
from app.telephony import gate
from app.telephony.inbound_store import InboundStore
from app.telephony.plivo_outbound import OutboundRefused, PostgrestOutboundRepo
from app.telephony.voicelink_routes import admit

T = uuid.uuid4()


class Rpc:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.answers: dict[str, Any] = {}
        self.fail = False

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((token, function, args))
        if self.fail:
            raise RuntimeError("down")
        import copy

        return copy.deepcopy(self.answers.get(function))


def test_the_charge_carries_the_answered_seconds_once_and_uses_the_system_token() -> None:
    rpc = Rpc()
    rpc.answers["pricing_charge_call"] = {"charged_paise": 750, "replayed": False}
    call = uuid.uuid4()
    out = CallCharger(rpc, lambda: "system").charge(T, call, 70)  # type: ignore[arg-type]
    assert out == {"charged_paise": 750, "replayed": False}
    assert rpc.calls == [("system", "pricing_charge_call", {"p_tenant_id": str(T), "p_call_id": str(call), "p_seconds": 70, "p_answered": True})]
    assert CallCharger(rpc, lambda: "s").charge(T, call, -5) is not None and rpc.calls[-1][2]["p_seconds"] == 0   # type: ignore[arg-type]


def test_a_failed_charge_never_breaks_the_call() -> None:
    rpc = Rpc()
    rpc.fail = True
    assert CallCharger(rpc, lambda: "s").charge(T, uuid.uuid4(), 30) is None  # type: ignore[arg-type]


def test_reconcile_charges_what_the_list_names_and_counts_only_new_charges(caplog: pytest.LogCaptureFixture) -> None:
    rpc = Rpc()
    a, b = uuid.uuid4(), uuid.uuid4()
    rpc.answers["pricing_uncharged_calls"] = [{"tenant_id": str(T), "call_id": str(a), "seconds": 61}, {"tenant_id": str(T), "call_id": str(b), "seconds": 20}, {"bad": 1}]
    rpc.answers["pricing_charge_call"] = {"charged_paise": 500, "replayed": False}
    assert CallCharger(rpc, lambda: "s").reconcile() == 2  # type: ignore[arg-type]
    charged = [c for c in rpc.calls if c[1] == "pricing_charge_call"]
    assert [c[2]["p_call_id"] for c in charged] == [str(a), str(b)] and [c[2]["p_seconds"] for c in charged] == [61, 20]
    rpc.answers["pricing_charge_call"] = {"charged_paise": 500, "replayed": True}
    assert CallCharger(rpc, lambda: "s").reconcile() == 0  # type: ignore[arg-type]


def test_the_inbound_line_carries_the_wallet_block_and_never_remembers_it() -> None:
    rpc = Rpc()
    rpc.answers["phone_line_find"] = {"tenant_id": str(T), "provider": "voicelink", "inbound_on": True, "wallet": {"exempt": False, "outbound_ok": True, "inbound_ok": False}}
    store = InboundStore(rpc, SimplePrincipal(), wallet_enforced=True)  # type: ignore[arg-type]
    assert store.line_find("+911")["wallet_inbound_blocked"] is True  # type: ignore[index]
    rpc.answers["phone_line_find"]["wallet"]["inbound_ok"] = True
    again = store.line_find("+911")
    assert again is not None and again["wallet_inbound_blocked"] is False, "after a top-up the very next call is answered: a blocked answer was not cached"
    rpc.answers["phone_line_find"]["wallet"]["inbound_ok"] = False
    assert store.line_find("+911")["wallet_inbound_blocked"] is False, "an open answer stays cached for its short time"  # type: ignore[index]
    off = InboundStore(rpc, SimplePrincipal(), wallet_enforced=False)  # type: ignore[arg-type]
    assert "wallet_inbound_blocked" not in (off.line_find("+912") or {}), "switched off: the wallet is not looked at"


class SimplePrincipal:
    def token(self) -> str:
        return "tok"


def test_voicelink_refuses_an_inbound_call_past_the_floor_as_billing_blocked() -> None:
    class Start:
        from_number = "+919876543210"
        to_number = "+911234567890"

    def find(number: str) -> dict[str, Any]:
        return {"tenant_id": str(T), "provider": "voicelink", "inbound_on": True, "wallet_inbound_blocked": True}

    settings = gate.Settings(mode="live", live_confirmed=True)
    out = asyncio.run(admit(Start(), settings, find_line=find, active_calls=0, now=__import__("datetime").datetime.now(__import__("datetime").UTC)))
    assert isinstance(out, gate.Refused) and out.reason == "billing_blocked"


def test_an_outbound_call_is_refused_wallet_low_when_the_balance_does_not_cover_a_minute() -> None:
    rpc = Rpc()
    rpc.answers["phone_line_for_tenant"] = {"provider": "voicelink", "wallet": {"outbound_ok": False, "inbound_ok": True}}
    on = PostgrestOutboundRepo(rpc, "voicelink", wallet_enforced=True)  # type: ignore[arg-type]
    line = on.line_for_tenant("t", T)
    assert line is not None and line["billing_blocked"] is True and line["wallet_low"] is True
    off = PostgrestOutboundRepo(rpc, "voicelink", wallet_enforced=False)  # type: ignore[arg-type]
    assert "billing_blocked" not in (off.line_for_tenant("t", T) or {})
    assert OutboundRefused("billing_blocked", wallet_low=True).wallet_low is True and OutboundRefused("billing_blocked").wallet_low is False
