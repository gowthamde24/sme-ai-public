"""Build the key ring from the settings (T010, ADR 0020). The key comes ONLY from the environment (SUPPRESSION_HMAC_KEY); there is no default. Outside development the process
REFUSES to start without it; in development a missing key leaves the ring empty (contacts are created unkeyed, which is safe, and the status page says so)."""

from __future__ import annotations

import logging

from app.config import ConfigurationError, Settings
from app.suppression.keys import KeyRing, KeyVersion

logger = logging.getLogger("app.suppression.wiring")


def build_key_ring(settings: Settings) -> KeyRing | None:
    key = settings.suppression_hmac_key
    if key is None or not key.get_secret_value():
        if not settings.is_development:
            raise ConfigurationError(
                "SUPPRESSION_HMAC_KEY is required outside development: without it a contact that opted out or was erased could be contacted again."
            )
        logger.warning(
            "no suppression key configured: contacts are created unkeyed (development only)"
        )
        return None
    previous = None
    old = settings.suppression_hmac_key_previous
    if old is not None and old.get_secret_value():
        if settings.suppression_hmac_key_previous_version is None:
            raise ConfigurationError(
                "SUPPRESSION_HMAC_KEY_PREVIOUS needs SUPPRESSION_HMAC_KEY_PREVIOUS_VERSION."
            )
        previous = KeyVersion(
            settings.suppression_hmac_key_previous_version, old.get_secret_value().encode()
        )
    try:
        return KeyRing(
            KeyVersion(settings.suppression_hmac_key_version, key.get_secret_value().encode()),
            previous,
        )
    except ValueError:
        raise ConfigurationError(
            "The suppression key (at least 16 characters) or its version (1 to 32), or the previous key, is not acceptable."
        ) from None
