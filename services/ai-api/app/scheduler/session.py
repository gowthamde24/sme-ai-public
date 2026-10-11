"""The worker's sign-in. The worker holds NO standing key: it signs in as its registered principal (an ordinary account the operator registered in the database, see the runbook) with a password
that lives in its environment only, and keeps the short-lived access token the sign-in returns. It signs in again before the token runs out and whenever the data layer refuses the token.
Nothing here is ever logged: not the address, not the password, not the token."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import httpx

logger = logging.getLogger("app.scheduler.session")

# sign in again when this share of the token's life is used (the rest is a margin for a slow tick)
REFRESH_AT = 0.75


class SignInError(RuntimeError):
    """The worker could not sign in (wrong password, the stack is down, the account does not exist). The text never carries the reason the server gave."""


class PrincipalSession:
    def __init__(
        self,
        auth_url: str,
        anon_key: str,
        email: str,
        password: str,
        *,
        client: httpx.Client | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._auth_url = auth_url.rstrip("/")
        self._anon_key = anon_key
        self._email = email
        self._password = password
        self._client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))
        self._monotonic = monotonic
        self._token: str | None = None
        self._refresh_after = 0.0

    def close(self) -> None:
        self._client.close()

    def invalidate(self) -> None:
        """Forget the token (the data layer refused it): the next call signs in again."""
        self._token = None

    def token(self) -> str:
        if self._token is None or self._monotonic() >= self._refresh_after:
            self._sign_in()
        assert self._token is not None  # noqa: S101 - _sign_in either sets it or raises
        return self._token

    def _sign_in(self) -> None:
        try:
            response = self._client.post(
                f"{self._auth_url}/token",
                params={"grant_type": "password"},
                json={"email": self._email, "password": self._password},
                headers={"apikey": self._anon_key},
            )
        except httpx.HTTPError as exc:
            logger.error("scheduler sign-in: auth service unreachable: %s", exc.__class__.__name__)
            raise SignInError("the sign-in service is not reachable") from None
        if response.status_code != 200:
            logger.error("scheduler sign-in refused: http=%s", response.status_code)
            raise SignInError("the scheduler account could not sign in")
        try:
            body = response.json()
            token = str(body["access_token"])
            lifetime = float(body.get("expires_in", 3600))
        except (ValueError, KeyError, TypeError):
            raise SignInError("the sign-in answer was not understood") from None
        self._token = token
        self._refresh_after = self._monotonic() + max(30.0, lifetime * REFRESH_AT)
