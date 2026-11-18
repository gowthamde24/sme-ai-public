"""Builds the phone-number service from settings: `PHONE_NUMBERS_PROVIDER` = off (absent, 503), fake (staging: made-up numbers, nothing rented) or plivo (the real adapter; needs the Plivo Auth ID and Token and the
workspace secret store, and is never the default)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.phone_numbers.provider import FakeNumbers, NumberProvider, PlivoSubaccountNumbers
from app.phone_numbers.repository import PostgrestNumbersRepository
from app.phone_numbers.service import PhoneNumbersService
from app.telephony.plivo_admin import PlivoAdmin

logger = logging.getLogger("app.phone_numbers")


def build_phone_numbers(settings: Settings, rest_url: str, anon_key: str, secrets: Any) -> PhoneNumbersService | None:
    mode = (settings.phone_numbers_provider or "off").strip().lower()
    base = (settings.public_base_url or "").strip()
    if mode == "off" or not base:
        return None
    provider: NumberProvider
    if mode == "fake":
        provider = FakeNumbers()
    elif mode == "plivo":
        store = getattr(secrets, "store", None)
        if not settings.plivo_auth_id or settings.plivo_auth_token is None or store is None:
            logger.warning("phone numbers are off: PHONE_NUMBERS_PROVIDER=plivo needs the Plivo account and the secret store")
            return None
        main = PlivoAdmin(settings.plivo_auth_id, settings.plivo_auth_token.get_secret_value())
        provider = PlivoSubaccountNumbers(main, lambda auth_id, token: PlivoAdmin(auth_id, token), store.access)
    else:
        logger.warning("phone numbers are off: PHONE_NUMBERS_PROVIDER must be off, fake or plivo")
        return None
    return PhoneNumbersService(PostgrestNumbersRepository(rest_url, anon_key), provider, base)
