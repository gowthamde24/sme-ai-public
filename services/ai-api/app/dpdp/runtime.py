"""What the DPDP routes hold (job DQ part 4): the repository, the captcha, the two inbox addresses (from the environment, never in code) and the per-address limits of the two public doors."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.dpdp.captcha import CaptchaVerifier, NoCaptcha
from app.dpdp.repository import DpdpRepository
from app.errors import ApiError
from app.integrations.ratelimit import SlidingWindow

ANSWER_WITHIN_DAYS = 30  # the database sets the same 30 days (migration 20261202090200); a test keeps the two equal
PER_ADDRESS_PER_HOUR = 5
PER_CONTACT_PER_HOUR = 3


@dataclass
class DpdpRuntime:
    repository: DpdpRepository
    privacy_email: str | None = None
    hello_email: str | None = None
    captcha: CaptchaVerifier = field(default_factory=NoCaptcha)
    by_address: SlidingWindow = field(default_factory=lambda: SlidingWindow(PER_ADDRESS_PER_HOUR, 3600.0))
    by_contact: SlidingWindow = field(default_factory=lambda: SlidingWindow(PER_CONTACT_PER_HOUR, 3600.0))

    def new_id(self) -> str:
        return str(uuid.uuid4())

    def guard(self, address: str, contact: str, token: str | None) -> None:
        """The API's part of the limits (the database holds its own caps behind the public key): per address, per contact, then the captcha."""
        if not self.by_address.allow("addr:" + address):
            raise ApiError(429, "rate_limited", "Too many requests. Please try again a little later.", retry_after=int(self.by_address.retry_after("addr:" + address)))
        if contact and not self.by_contact.allow("contact:" + contact.strip().lower()):
            raise ApiError(429, "rate_limited", "Too many requests. Please try again a little later.", retry_after=int(self.by_contact.retry_after("contact:" + contact.strip().lower())))
        if not self.captcha.ok(token, None if address == "unknown" else address):
            raise ApiError(400, "captcha_failed", "We could not check that you are a person. Please try again.")
