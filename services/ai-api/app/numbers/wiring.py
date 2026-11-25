"""Builds the number picker's service from the deployment's settings: off unless PHONE_PICKER is on AND a VoiceLink login and our client and bot ids are given (a half-configured picker never spends money)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.numbers.buyer import BuyerSettings
from app.numbers.service import NumberService, PostgrestNumberRepository
from app.telephony.voicelink_api import VoicelinkApi

log = logging.getLogger("app.numbers.wiring")


def build_numbers(settings: Settings, rest_url: str, anon_key: str, business_kyc: Any = None) -> NumberService | None:
    if not settings.phone_picker:
        return None
    user = settings.voicelink_username.get_secret_value() if settings.voicelink_username else ""
    password = settings.voicelink_password.get_secret_value() if settings.voicelink_password else ""
    if not (user and password and settings.picker_client_id and settings.picker_bot_id):
        log.warning("number_picker off: PHONE_PICKER is on but the VoiceLink login, PICKER_CLIENT_ID or PICKER_BOT_ID is missing")
        return None
    api = VoicelinkApi(user, password, base_url=settings.voicelink_api_base)
    buyer = BuyerSettings(client_id=int(settings.picker_client_id), bot_id=int(settings.picker_bot_id), wallet_floor_inr=float(settings.picker_wallet_floor_inr), max_total_inr=float(settings.picker_max_total_inr))
    return NumberService(PostgrestNumberRepository(rest_url, anon_key), api, buyer, kyc=business_kyc)   # KYC_PER_CLIENT: the number goes to the workspace's own client
