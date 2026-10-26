"""Request bodies of the DPDP routes (job DQ part 4). Strict: an unknown field is a 422. The contract is docs/contracts/dpdp.md."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import StringConstraints, model_validator

from app.crm.models import ApiUuid, _Strict

GrievanceKind = Literal["access", "correction", "erasure", "withdraw_consent", "complaint", "other"]
Version = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")]
Captcha = Annotated[str, StringConstraints(max_length=2048)]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class PublicGrievanceIn(_Strict):
    grievance_id: ApiUuid | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    contact: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
    kind: GrievanceKind
    details: Annotated[str, StringConstraints(max_length=4000)] = ""
    language: Literal["en", "te", "hi", "kn"] | None = None
    captcha_token: Captcha | None = None


class WaitlistIn(_Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    # the closed list of business types is the database's to check (a wrong word is a 422 from there); no pack id is spelled in code
    business_type: Annotated[str, StringConstraints(pattern=r"^[a-z_]{2,30}$")]
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=7, max_length=30)] | None = None
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=200)] | None = None
    language: Literal["en", "te", "hi", "kn", "ta", "ml"]
    marketing_opt_in: bool = False
    notice_version: Version
    captcha_token: Captcha | None = None

    @model_validator(mode="after")
    def _a_way_to_reach_them(self) -> WaitlistIn:
        if not self.phone and not self.email:
            raise ValueError("a phone number or an e-mail address is needed")
        if self.email and not _EMAIL.match(self.email):
            raise ValueError("that e-mail address is not valid")
        return self


class MarketingConsentIn(_Strict):
    given: bool
    via: Literal["signup", "google", "settings"] = "settings"


class ProfileIn(_Strict):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
