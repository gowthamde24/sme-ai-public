"""The business's own ExoPhone (owner, 6 Nov 2026): Hyderabad 040 4590 3172 replaces the shared trial number. A landline line must be read as +91 and its ten digits wherever we compare the
number a call was made TO (the start message, Exotel's own record, the stream-url request); the caller keeps the mobile rule. The strict rule holds (the sandbox list, Exotel's record, one at a time),
and the call length comes from TELEPHONY_MAX_CALL_S (staging 180, never above 300)."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import SecretStr

from app.connectors.phone import normalise, normalise_line
from app.telephony import exotel, gate, inbound
from tests.test_dv_browser_voice import arun
from tests.test_ph_inbound import OWNER, TENANT, FakeStore

LINE = "+914045903172"


@pytest.mark.parametrize("raw", ["04045903172", "040-4590 3172", "4045903172", "914045903172", "+91 40 4590 3172", "+914045903172"])
def test_a_hyderabad_landline_is_one_number(raw: str) -> None:
    assert normalise_line(raw) == LINE


def test_mobiles_are_unchanged_and_the_shared_rule_does_not_take_landlines() -> None:
    for raw in ("09502380998", "+919502380998", "9502380998"):
        assert normalise_line(raw) == normalise(raw) == OWNER
    assert normalise("04045903172") is None, "callers and leads keep the mobile rule"
    for junk in ("", "0000", "12345", "040459031", "00404590317200", None, 42):
        assert normalise_line(junk) is None, junk


class Calls:
    def __init__(self, to: str) -> None:
        self.to = to

    async def get(self, call_sid: str, *, retries_s: tuple[float, ...] = ()) -> inbound.ProviderCall | None:
        return inbound.ProviderCall(status="in-progress", from_number=OWNER, to_number=normalise_line(self.to))


def _start(to: str, frm: str = OWNER) -> exotel.Start:
    return exotel.Start(stream_sid="XP1", call_sid="CA1", account_sid="stack191", from_number=frm, to_number=to, sample_rate=16000)


@arun
async def test_a_call_to_the_landline_is_admitted_by_the_strict_rule() -> None:
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), outbound=False, max_concurrent=1)
    now = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)
    for to in ("04045903172", "4045903172", "+914045903172"):
        store = FakeStore()
        got = await inbound.admit(_start(to), gs, find_line=store.line_find, calls=Calls(to), active_calls=0, now=now)  # type: ignore[arg-type]
        assert isinstance(got, inbound.Admitted) and got.tenant_id == TENANT and got.rule == "exotel_lookup", to
        assert store.asked == [LINE], "the line is looked up as +91 and ten digits"
    refused = await inbound.admit(_start("04045903172", frm="+919876543210"), gs, find_line=FakeStore().line_find, calls=Calls("04045903172"), active_calls=0, now=now)  # type: ignore[arg-type]
    assert isinstance(refused, gate.Refused) and refused.reason == "not_on_sandbox_list", "a number that is not on the list is refused"
    busy = await inbound.admit(_start("04045903172"), gs, find_line=FakeStore().line_find, calls=Calls("04045903172"), active_calls=1, now=now)  # type: ignore[arg-type]
    assert isinstance(busy, gate.Refused) and busy.reason == "too_many_calls", "one call at a time"


def test_the_call_length_comes_from_the_setting_and_is_never_above_300(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings
    from app.telephony import wiring

    built: dict[str, Any] = {}

    class Spy:
        def __init__(self, **kw: Any) -> None:
            built.update(kw)

    monkeypatch.setattr(wiring, "InboundService", Spy)
    for value, want in ((180, 180), (900, 300), (5, 30)):
        built.clear()
        settings = Settings(_env_file=None, environment="development", telephony_mode="sandbox", telephony_max_call_s=value, telephony_sandbox_numbers=OWNER,  # type: ignore[call-arg]
                            exotel_stream_secret=SecretStr("s" * 48), public_base_url="https://api.example.test", scheduler_email="w@example.test", scheduler_password=SecretStr("pw-for-tests-only"))
        wiring.build_phone_inbound(settings, "http://rest.invalid", "http://supabase.invalid", "anon")
        assert built["max_call_s"] == want, (value, built.get("max_call_s"))
