"""Request and response shapes of the sign-up routes (docs/contracts/signup.md). Closed words only; no phone number, e-mail or code in any response."""

# ruff: noqa: E501

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusOut(_Strict):
    open: bool
    terms_version: str
    privacy_version: str
    aup_version: str
    phone_required: bool
    email_confirmed: bool
    email_blocked: bool
    consent_done: bool
    phone_verified: bool
    trial_claimed: bool


class ConsentIn(_Strict):
    kind: Literal["terms", "privacy", "aup"]
    version: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._-]{1,20}$")]


class ConsentOut(_Strict):
    ok: Literal[True] = True


class PhoneStartIn(_Strict):
    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=20)]


class PhoneStartOut(_Strict):
    ok: Literal[True] = True
    expires_in_s: int
    debug_code: str | None = (
        None  # only on a staging API with the fake sender and SIGNUP_FAKE_CODE_ECHO; never in production (refused at start-up)
    )


class PhoneVerifyIn(_Strict):
    code: Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")]


class PhoneVerifyOut(_Strict):
    ok: Literal[True] = True


class TrialClaimOut(_Strict):
    granted: bool
    reason: str | None = (
        None  # closed word: already_granted, phone_used, closed, email_unconfirmed, email_blocked, phone_not_verified, consent_missing, email_used, daily_cap
    )
    balance_paise: int | None = None
