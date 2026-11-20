"""The WhatsApp platform token's expiry, read from Meta once a day (planner, 20 Nov 2026; Customer Zero code list item 1).

Every shop's WhatsApp calls use ONE platform token (the system user's, secret `sme-whatsapp-token`). When it stops working every send fails at once, so the owner is warned 14 days before: the worker asks Meta's
`debug_token` (the token asks about itself: `input_token` and `access_token` are the same token, so no app secret is needed here) for the day it stops, and writes that day into the credential deadlines
(`ops_credential_deadline_set`). The database's existing alert run then raises the "Needs you" item in the staff console and e-mails the owner (one `warn` alert from 14 days before, one `over` alert on the day),
on the REAL date, also after someone renews the token. A token that never expires is the year 2100 (never warns); a token Meta calls invalid is expired now.

Nothing about the token is logged or stored: only a closed word on failure and the date on success. Off by default (`TOKEN_EXPIRY_CHECK`); one read a day, a failing read is tried again after an hour (the database says
whether a read is due, so most ticks do nothing)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from app.config import Settings

logger = logging.getLogger("app.ops.token_expiry")
logging.getLogger("httpx").setLevel(logging.WARNING)   # its INFO line would carry the request address, and the address carries the token
logging.getLogger("httpcore").setLevel(logging.WARNING)

KEY = "whatsapp.platform_token"
LABEL = "The WhatsApp platform token"
WARN_DAYS = 14
WHAT_TO_DO = "Make a new long-lived token for the Stack19 system user in Meta Business settings, store it as the secret sme-whatsapp-token, and redeploy the API and the worker."


class TokenCheckError(Exception):
    """A closed reason (`unreachable`, `refused`, `bad_response`): never a body, never the token."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class TokenFacts:
    valid: bool
    expires_at: datetime | None   # None: it never expires (Meta says 0)


class TokenReader(Protocol):
    def facts(self) -> TokenFacts: ...


def _moment(raw: Any) -> datetime | None:
    """Meta's seconds since 1970; 0 or missing means "never"."""
    if isinstance(raw, bool) or not isinstance(raw, int | float) or raw <= 0:
        return None
    return datetime.fromtimestamp(int(raw), tz=UTC)


def parse_debug(body: Any) -> TokenFacts:
    """Meta's debug_token answer as the two facts: is it valid, and the EARLIEST day it stops (the token's own expiry or its data access expiry). Anything unexpected is a bad_response (never guessed)."""
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get("is_valid"), bool):
        raise TokenCheckError("bad_response")
    days = [d for d in (_moment(data.get("expires_at")), _moment(data.get("data_access_expires_at"))) if d is not None]
    return TokenFacts(bool(data["is_valid"]), min(days) if days else None)


class MetaDebugToken:
    def __init__(self, base: str, version: str, token: str, *, client: httpx.Client | None = None) -> None:
        self._url = f"{base.rstrip('/')}/{version}/debug_token"
        self._token = token
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def facts(self) -> TokenFacts:
        try:
            response = self._client.get(self._url, params={"input_token": self._token, "access_token": self._token})
        except httpx.HTTPError as exc:
            logger.warning("token expiry: Meta unreachable (%s)", exc.__class__.__name__)
            raise TokenCheckError("unreachable") from None
        if not response.is_success:
            logger.warning("token expiry: Meta answered http=%s", response.status_code)
            raise TokenCheckError("refused")
        try:
            return parse_debug(response.json())
        except ValueError:
            raise TokenCheckError("bad_response") from None


class CredentialRpc(Protocol):
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


class TokenExpiryCheck:
    def __init__(self, reader: TokenReader, rpc: CredentialRpc, *, clock: Any = None) -> None:
        self._reader, self._rpc = reader, rpc
        self._now = clock or (lambda: datetime.now(UTC))

    def run(self, token: str) -> str:
        """One pass (every tick; the database says whether a read is due). Returns idle | ok | failed."""
        if self._rpc.call(token, "ops_credential_check_due", {"p_key": KEY, "p_hours": 24, "p_retry_minutes": 60}) is not True:
            return "idle"
        self._rpc.call(token, "ops_credential_check_attempt", {"p_key": KEY, "p_label": LABEL})
        try:
            facts = self._reader.facts()
        except TokenCheckError as exc:
            logger.warning("token expiry: the token could not be read (%s); tried again in an hour", exc.reason)
            return "failed"
        expires = facts.expires_at if facts.valid else self._now()   # an invalid token is expired now
        self._rpc.call(token, "ops_credential_deadline_set", {"p_key": KEY, "p_label": LABEL, "p_expires_at": expires.isoformat() if expires else None, "p_warn_days": WARN_DAYS, "p_what_to_do": WHAT_TO_DO})
        logger.info("token expiry: read, valid=%s, expires=%s", facts.valid, expires.date().isoformat() if expires else "never")
        return "ok"


class ConfigurationError(Exception):
    pass


def build_token_expiry(settings: Settings, rest_url: str, anon_key: str, *, reader: TokenReader | None = None, rpc: CredentialRpc | None = None) -> TokenExpiryCheck | None:
    """The check for the worker, or None while TOKEN_EXPIRY_CHECK is off (the default). On but without a token stops the worker at start rather than failing quietly."""
    if not settings.token_expiry_check:
        return None
    if reader is None:
        secret = settings.whatsapp_access_token.get_secret_value() if settings.whatsapp_access_token is not None else ""
        if not secret:
            raise ConfigurationError("TOKEN_EXPIRY_CHECK needs WHATSAPP_ACCESS_TOKEN")
        reader = MetaDebugToken(settings.whatsapp_api_base, settings.whatsapp_graph_version, secret)
    if rpc is None:
        from app.rpc_base import RpcClient

        rpc = RpcClient(rest_url, anon_key, {})
    return TokenExpiryCheck(reader, rpc)
