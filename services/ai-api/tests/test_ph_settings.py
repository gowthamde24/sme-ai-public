"""Phone calls, part 1: the deployment's switches as the gate reads them."""

# ruff: noqa: E501

from __future__ import annotations

from types import SimpleNamespace

from app.telephony.settings import gate_settings


def s(**kw: object) -> SimpleNamespace:
    base = {"telephony_mode": "off", "telephony_live_confirmed": False, "telephony_sandbox_numbers": "", "telephony_max_concurrent": 2}
    return SimpleNamespace(**{**base, **kw})


def test_the_default_is_off_and_nothing_can_be_rung() -> None:
    g = gate_settings(s())
    assert g.mode == "off" and not g.sandbox_numbers and not g.live_confirmed


def test_an_unknown_mode_is_off() -> None:
    assert gate_settings(s(telephony_mode="production")).mode == "off"
    assert gate_settings(s(telephony_mode="sandbox")).mode == "sandbox"


def test_sandbox_numbers_are_read_in_any_spelling_and_junk_is_dropped() -> None:
    g = gate_settings(s(telephony_mode="sandbox", telephony_sandbox_numbers="98765 43210, +91-91234-56789 ,junk,,12"))
    assert g.sandbox_numbers == frozenset({"+919876543210", "+919123456789"})


def test_the_settings_defaults_of_the_app_are_off() -> None:
    from app.config import Settings

    cfg = Settings()
    assert cfg.telephony_mode == "off" and cfg.telephony_live_confirmed is False and cfg.telephony_sandbox_numbers == ""
