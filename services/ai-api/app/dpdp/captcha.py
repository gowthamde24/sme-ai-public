"""Captcha behind an interface (job DQ part 4): "captcha-ready". `none` (today, everywhere) accepts every request; `turnstile` checks the token with Cloudflare's siteverify (the secret is the
owner's, in Secret Manager; no account is made here). A missing or wrong token is a refusal, and so is a verifier that cannot be reached (closed on failure, so a switched-on captcha is never skipped)."""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

logger = logging.getLogger("app.dpdp.captcha")
SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class CaptchaVerifier(Protocol):
    name: str

    def ok(self, token: str | None, remote_ip: str | None) -> bool: ...


class NoCaptcha:
    name = "none"

    def ok(self, token: str | None, remote_ip: str | None) -> bool:
        return True


class FakeCaptcha:
    """For tests and local runs of a switched-on captcha: only the token 'pass' is good."""

    name = "fake"

    def ok(self, token: str | None, remote_ip: str | None) -> bool:
        return token == "pass"  # noqa: S105  (a test password, not a secret)


class TurnstileCaptcha:
    name = "turnstile"

    def __init__(self, secret: str, *, client: httpx.Client | None = None) -> None:
        self._secret = secret
        self._client = client or httpx.Client(timeout=httpx.Timeout(5.0, connect=3.0))

    def ok(self, token: str | None, remote_ip: str | None) -> bool:
        if not token:
            return False
        data = {"secret": self._secret, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            response = self._client.post(SITEVERIFY, data=data)
            return bool(response.is_success and response.json().get("success") is True)
        except (httpx.HTTPError, ValueError):
            logger.error("captcha: the verifier could not be reached")
            return False


def build_captcha(name: str, secret: str | None) -> CaptchaVerifier:
    if name == "none":
        return NoCaptcha()
    if name == "fake":
        return FakeCaptcha()
    if name == "turnstile":
        if not secret:
            raise ValueError("CAPTCHA_PROVIDER=turnstile needs CAPTCHA_SECRET")
        return TurnstileCaptcha(secret)
    raise ValueError("CAPTCHA_PROVIDER must be none or turnstile")
