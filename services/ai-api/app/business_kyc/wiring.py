"""Builds the business KYC service: off unless KYC_PER_CLIENT is on and the VoiceLink login and the return page are given."""

# ruff: noqa: E501

from __future__ import annotations

import logging

from app.business_kyc.service import BusinessKycService, RpcRepo
from app.config import Settings
from app.telephony.voicelink_api import VoicelinkApi

log = logging.getLogger("app.business_kyc.wiring")


def build_business_kyc(settings: Settings, rest_url: str, anon_key: str) -> BusinessKycService | None:
    if not settings.kyc_per_client:
        return None
    user = settings.voicelink_username.get_secret_value() if settings.voicelink_username else ""
    password = settings.voicelink_password.get_secret_value() if settings.voicelink_password else ""
    if not (user and password and (settings.kyc_return_url or "").startswith("https://")):
        log.warning("business_kyc off: KYC_PER_CLIENT is on but the VoiceLink login or KYC_RETURN_URL (https) is missing")
        return None
    return BusinessKycService(RpcRepo(rest_url, anon_key), VoicelinkApi(user, password, base_url=settings.voicelink_api_base), return_url=str(settings.kyc_return_url))
