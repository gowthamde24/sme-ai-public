"""Request bodies of the WhatsApp routes (job BR). Strict: an unknown field is a 422. No field names a status that the database decides."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.crm.models import ApiUuid, _Strict

Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]


class AccountIn(_Strict):
    waba_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")]
    phone_number_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")]
    display_phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=24)] | None = None
    coexistence: bool = False
    # the NAME of the secret that holds the token (never the token)
    token_ref: Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_.:-]{0,59}$")]


class ChatAssistantIn(_Strict):
    enabled: bool


class ChatDoneIn(_Strict):
    done: bool
class ConnectIn(_Strict):
    """What Embedded Signup returned to the browser: the account and the number the shop picked, and the short `code`. No token, no secret. Version 4 sends `waba_id`; version 5 sends `messaging_account_ids` (and
    `is_on_biz_app`) instead: either is accepted, and the API checks the ids against what the signup really shared. A missing `phone_number_id` is found when the account holds exactly one number."""

    waba_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")] | None = None
    messaging_account_ids: Annotated[list[Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")]], Field(max_length=5)] | None = None
    phone_number_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")] | None = None
    code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.~-]{10,512}$")]   # required (18 Nov 2026): the signup must be proved ours
    coexistence: bool = False   # the shop kept its WhatsApp Business app on this number (v4: the event FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING)
    is_on_biz_app: bool | None = None   # v5: the same fact, as Meta's payload says it

    @model_validator(mode="after")
    def _an_account(self) -> ConnectIn:
        if self.waba_id is None and not self.messaging_account_ids:
            raise ValueError("an account id is required")
        return self


class TemplateIn(_Strict):
    name: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,59}$")]
    language: Language
    category: Literal["utility", "marketing", "authentication"]
    purpose: Literal["visit", "followup", "order_status", "info", "reminder", "lead"]
    # one variable, {{1}}, with words before and after it
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=1024)]


class TemplateStatusIn(_Strict):
    status: Literal["submitted", "approved", "rejected", "paused", "disabled"]


__all__ = ["AccountIn", "ApiUuid", "ChatAssistantIn", "ChatDoneIn", "ConnectIn", "TemplateIn", "TemplateStatusIn"]
