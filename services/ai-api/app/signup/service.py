"""Sign-up rules in words. The database decides everything (migration 20261231990700); here the phone is cleaned, the code is made, hashed with the server's key and sent, and the database's closed answers become the API's refusals."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import uuid
from typing import Any

from app.errors import ApiError
from app.rpc_base import RpcClient
from app.signup.sender import FakeSender, PhoneCodeSender, PhoneCodeUnavailable

_PHONE = re.compile(r"^\+[1-9][0-9]{9,14}$")
_INDIA = re.compile(r"^[6-9][0-9]{9}$")
_INDIA_91 = re.compile(r"^91[6-9][0-9]{9}$")


def clean_phone(raw: str) -> str | None:
    """One number in one shape (+919848012345), or None. +00 test numbers are not accepted: a trial needs a real phone."""
    digits = re.sub(r"[^0-9+]", "", raw or "")
    if _INDIA.fullmatch(digits):
        return "+91" + digits
    if _INDIA_91.fullmatch(digits):
        return "+" + digits
    if _PHONE.fullmatch(digits) and not digits.startswith("+00"):
        return digits
    return None


class SignupRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def status(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "signup_status", {})

    def consent(self, token: str, kind: str, version: str) -> dict[str, Any]:
        return self._rpc.object(
            token, "signup_consent_record", {"p_kind": kind, "p_version": version}
        )

    def phone_start(
        self, token: str, phone_hash: str, code_hash: str, ip_hash: str | None
    ) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "signup_phone_start",
            {"p_phone_hash": phone_hash, "p_code_hash": code_hash, "p_ip_hash": ip_hash},
        )

    def phone_verify(self, token: str, code_hash: str) -> dict[str, Any]:
        return self._rpc.object(token, "signup_phone_verify", {"p_code_hash": code_hash})

    def claim(self, token: str, tenant_id: uuid.UUID, ip_hash: str | None = None) -> dict[str, Any]:
        return self._rpc.object(token, "signup_trial_claim", {"p_tenant_id": str(tenant_id), "p_ip_hash": ip_hash})


# the closed words of the database -> the API's plain refusals (status, code, sentence)
_REFUSALS: dict[str, tuple[int, str, str]] = {
    "closed": (409, "signup_closed", "Sign-up is not open yet."),
    "email_unconfirmed": (409, "email_unconfirmed", "Confirm your e-mail first."),
    "email_blocked": (422, "email_not_allowed", "Please use your own, permanent e-mail address."),
    "rate": (429, "rate_limited", "Too many tries. Please try again in an hour."),
    "phone_taken": (409, "phone_taken", "That phone number is already used by another account."),
    "no_code": (422, "code_missing", "Ask for a new code first."),
    "expired": (422, "code_expired", "That code is too old. Ask for a new one."),
    "too_many_tries": (429, "code_locked", "Too many wrong codes. Ask for a new code."),
    "wrong_code": (422, "code_wrong", "That code is not right."),
}


def _refusal(out: dict[str, Any]) -> ApiError:
    reason = str(out.get("reason") or "")
    status, code, message = _REFUSALS.get(
        reason, (409, "signup_refused", "That did not work. Please try again.")
    )
    extra: dict[str, Any] = {"reason": reason}
    tries = out.get("tries_left")
    if isinstance(tries, int) and not isinstance(tries, bool):
        extra["tries_left"] = tries
    headers = {"Retry-After": "3600"} if status == 429 and reason == "rate" else None
    return ApiError(status, code, message, extra=extra, headers=headers)


class SignupService:
    def __init__(
        self,
        repo: SignupRepository,
        key: bytes,
        sender: PhoneCodeSender,
        *,
        echo_code: bool = False,
        proxy_hops: int = 0,
    ) -> None:
        self.proxy_hops = proxy_hops
        self._repo = repo
        self._key = key
        self._sender = sender
        self._echo = echo_code

    def _mac(self, text: str) -> str:
        return hmac.new(self._key, text.encode(), hashlib.sha256).hexdigest()

    def status(self, token: str) -> dict[str, Any]:
        return self._repo.status(token)

    def consent(self, token: str, kind: str, version: str) -> None:
        self._repo.consent(token, kind, version)

    def phone_start(
        self, token: str, user_id: uuid.UUID, raw_phone: str, ip: str | None
    ) -> dict[str, Any]:
        phone = clean_phone(raw_phone)
        if phone is None:
            raise ApiError(
                422,
                "validation_error",
                "That phone number is not valid.",
                extra={"fields": ["phone"]},
            )
        code = f"{secrets.randbelow(1_000_000):06d}"
        out = self._repo.phone_start(
            token,
            self._mac("phone:" + phone),
            self._mac(f"code:{user_id}:{code}"),
            self._mac("ip:" + ip)[:32] if ip else None,
        )
        if not out.get("ok"):
            raise _refusal(out)
        try:
            self._sender.send(phone, code)
        except PhoneCodeUnavailable:
            raise ApiError(
                503,
                "phone_code_unavailable",
                "We cannot send a code right now. Please try again later.",
            ) from None
        result: dict[str, Any] = {"ok": True, "expires_in_s": int(out.get("expires_in_s") or 600)}
        if self._echo and isinstance(self._sender, FakeSender):
            result["debug_code"] = code
        return result

    def phone_verify(self, token: str, user_id: uuid.UUID, code: str) -> None:
        out = self._repo.phone_verify(token, self._mac(f"code:{user_id}:{code}"))
        if not out.get("ok"):
            raise _refusal(out)

    def claim(self, token: str, tenant_id: uuid.UUID, ip: str | None = None) -> dict[str, Any]:
        out = self._repo.claim(token, tenant_id, self._mac("ip:" + ip)[:32] if ip else None)
        return {
            "granted": bool(out.get("granted")),
            "reason": out.get("reason"),
            "balance_paise": out.get("balance_paise"),
        }
