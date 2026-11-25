"""Builds the extra-lines service from the deployment's settings (EXTRA_LINES, off). The channel provider is the FAKE one (nothing is bought, nobody is called) unless VOICELINK_CHANNEL_BUY is on AND the VoiceLink
login is given; the VoiceLink adapter is a skeleton that refuses with `not_built` until its purchase call is written from VoiceLink's API text (never reached by a test)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.config import Settings
from app.extra_lines.channel import ChannelProvider, FakeChannels, VoicelinkChannels
from app.extra_lines.service import ExtraLinesService, PostgrestLinesRepository
from app.telephony.voicelink_api import VoicelinkApi

log = logging.getLogger("app.extra_lines.wiring")


def build_extra_lines(settings: Settings, rest_url: str, anon_key: str, business_kyc: Any = None, phone: Any = None, alert: Callable[[str], None] | None = None) -> ExtraLinesService | None:
    if not settings.extra_lines:
        return None
    channels: ChannelProvider = FakeChannels()
    user = settings.voicelink_username.get_secret_value() if settings.voicelink_username else ""
    password = settings.voicelink_password.get_secret_value() if settings.voicelink_password else ""
    if settings.voicelink_channel_buy:
        if user and password and business_kyc is not None:
            channels = VoicelinkChannels(VoicelinkApi(user, password, base_url=settings.voicelink_api_base), enabled=True, client_for=business_kyc.client_for, wallet_floor_inr=float(settings.picker_wallet_floor_inr))
        else:
            log.warning("channel buying stays off: VOICELINK_CHANNEL_BUY is on but the VoiceLink login or the business accounts are missing")
    store = getattr(phone, "store", None)
    tell = getattr(store, "telephony_alert", None)
    limits = getattr(store, "workspace_lines", None)
    return ExtraLinesService(
        PostgrestLinesRepository(rest_url, anon_key), channels,
        alert=alert if alert is not None else ((lambda detail: tell(False, detail)) if tell is not None else None),
        forget=limits.forget if limits is not None else None,
        is_production=not settings.is_development and settings.admin_environment == "production",
    )


def build_extra_lines_pass(settings: Settings, rest_url: str, anon_key: str) -> Callable[[str], int] | None:
    """The worker's monthly pass (renew what is due, give grace, pause, end; retry a channel that was paid for; give a channel back). None while EXTRA_LINES is off. A team message uses the pass's own account."""
    from app.rpc_base import RpcClient

    rpc = RpcClient(rest_url, anon_key)
    current = {"token": ""}

    def tell(detail: str) -> None:
        rpc.call(current["token"], "ops_telephony_setting_report", {"p_ok": False, "p_detail": detail[:480]})

    service = build_extra_lines(settings, rest_url, anon_key, alert=tell)
    if service is None:
        return None

    def run(token: str) -> int:
        current["token"] = token
        return service.renew(token)

    return run
