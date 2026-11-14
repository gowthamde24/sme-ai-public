"""Builds the in-app KYC (app/phone_kyc) from settings: it needs the Plivo account's Auth ID and Auth Token (the ones that place calls). Without them it is absent (503 kyc_unavailable)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.phone_kyc.repository import PostgrestKycRepository
from app.phone_kyc.service import PhoneKycService
from app.telephony.plivo_admin import PlivoCompliance

logger = logging.getLogger("app.phone_kyc")


def build_phone_kyc(settings: Settings, rest_url: str, anon_key: str, secrets: Any) -> PhoneKycService | None:
    if not settings.plivo_auth_id or settings.plivo_auth_token is None:
        return None
    try:
        plivo = PlivoCompliance(settings.plivo_auth_id, settings.plivo_auth_token.get_secret_value())
    except ValueError:
        logger.warning("phone kyc is off: the Plivo Auth ID is not valid")
        return None
    return PhoneKycService(PostgrestKycRepository(rest_url, anon_key), plivo, getattr(secrets, "store", None), live=settings.plivo_kyc_live)
