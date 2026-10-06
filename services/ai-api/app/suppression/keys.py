"""The HMAC of a contact's identifiers (ADR 0020). Pure: no I/O, no clock, no database.

The key is held OUTSIDE the database (the API's configuration) and never leaves this module's caller: nothing here logs, returns or formats a key, an identifier or an HMAC in a message.
A plain hash would not do: phone numbers are brute-forceable, a keyed HMAC is not (without the key).

Normalisation is CONSERVATIVE on purpose: an address written another way (a plus-tag, different dots, another mailbox) is a different key. Over-matching would suppress real people.
  * e-mail: Unicode NFKC, trimmed, lower-cased. Dots and plus-tags are NOT collapsed.
  * phone: digits only; the international call prefix `00` is dropped; an Indian mobile written with `+91`, `91` or a leading `0` is reduced to its ten digits; anything else keeps its digits
    without leading zeros. 3 to 32 digits (the contact column's own limit).
A key is `HMAC-SHA256(key, kind + ":" + normalised)` in lower-case hex; the database stores it with the key's version."""

from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata
from dataclasses import dataclass

EMAIL = "email"
PHONE = "phone"
MIN_KEY_BYTES = 16  # a key shorter than this is refused at start-up (a typo, not a secret)
_NON_DIGIT = re.compile(r"\D")


def normalise_email(value: str | None) -> str | None:
    if value is None:
        return None
    text = unicodedata.normalize("NFKC", value).strip().lower()
    if not text or text.count("@") != 1 or any(ch.isspace() for ch in text):
        return None
    local, _, domain = text.partition("@")
    return text if local and "." in domain else None


def normalise_phone(value: str | None) -> str | None:
    if value is None:
        return None
    digits = _NON_DIGIT.sub("", unicodedata.normalize("NFKC", value))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    digits = digits.lstrip("0")
    return digits if 3 <= len(digits) <= 32 else None


@dataclass(frozen=True)
class KeyVersion:
    version: int
    key: bytes = b""

    def __repr__(self) -> str:  # a key never appears in a log line or a traceback
        return f"KeyVersion(version={self.version}, key=<hidden>)"


@dataclass(frozen=True)
class KeyRing:
    """The CURRENT key (used to record) and at most one PREVIOUS key (used only to match, so a rotation never forgets a suppressed address)."""

    current: KeyVersion
    previous: KeyVersion | None = None

    def __post_init__(self) -> None:
        if not 1 <= self.current.version <= 32 or len(self.current.key) < MIN_KEY_BYTES:
            raise ValueError("the suppression key or its version is not acceptable")
        if self.previous is not None and (
            not 1 <= self.previous.version <= 32
            or self.previous.version == self.current.version
            or len(self.previous.key) < MIN_KEY_BYTES
            or self.previous.key == self.current.key
        ):
            raise ValueError("the previous suppression key or its version is not acceptable")

    @staticmethod
    def _digest(version: KeyVersion, kind: str, normalised: str) -> str:
        return hmac.new(version.key, f"{kind}:{normalised}".encode(), hashlib.sha256).hexdigest()

    def key_for(self, kind: str, raw: str | None) -> str | None:
        """The CURRENT-version key of an identifier as the contact holds it, or None if it cannot be normalised."""
        return self._digest_of(self.current, kind, raw)

    def previous_key_for(self, kind: str, raw: str | None) -> str | None:
        return None if self.previous is None else self._digest_of(self.previous, kind, raw)

    def _digest_of(self, version: KeyVersion, kind: str, raw: str | None) -> str | None:
        norm = (
            normalise_email(raw)
            if kind == EMAIL
            else normalise_phone(raw)
            if kind == PHONE
            else None
        )
        return None if norm is None else self._digest(version, kind, norm)

    def keys_of(
        self, email: str | None, phone: str | None
    ) -> tuple[dict[str, object], dict[str, list[str]]]:
        """(the keys to RECORD, the previous-version keys for MATCHING only) for a contact's identifiers. An identifier that cannot be normalised has no key."""
        keys: dict[str, object] = {"version": self.current.version}
        also: dict[str, list[str]] = {}
        for kind, raw in ((EMAIL, email), (PHONE, phone)):
            current = self.key_for(kind, raw)
            if current is not None:
                keys[kind] = current
            old = self.previous_key_for(kind, raw)
            if old is not None:
                also[kind] = [old]
        return keys, also

    def match_keys(self, email: str | None, phone: str | None) -> dict[str, list[str]]:
        """For check_suppression: every version's key of each identifier."""
        out: dict[str, list[str]] = {}
        for kind, raw in ((EMAIL, email), (PHONE, phone)):
            found = [
                k
                for k in (self.key_for(kind, raw), self.previous_key_for(kind, raw))
                if k is not None
            ]
            if found:
                out[kind] = found
        return out

    def has_keys(self, keys: dict[str, object]) -> bool:
        return EMAIL in keys or PHONE in keys
