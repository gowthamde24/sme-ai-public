"""Request bodies of the WhatsApp routes (job BR). Strict: an unknown field is a 422. No field names a status that the database decides."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import StringConstraints

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
    """What Embedded Signup returned to the browser: the account and the number the shop picked, and the short `code`. No token, no secret."""

    waba_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")]
    phone_number_id: Annotated[str, StringConstraints(pattern=r"^[0-9]{5,30}$")]
    code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.~-]{10,512}$")] | None = None


class TemplateIn(_Strict):
    name: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,59}$")]
    language: Language
    category: Literal["utility", "marketing", "authentication"]
    purpose: Literal["visit", "followup", "order_status", "info", "reminder"]
    # one variable, {{1}}, with words before and after it
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=1024)]


class TemplateStatusIn(_Strict):
    status: Literal["submitted", "approved", "rejected", "paused", "disabled"]


__all__ = ["AccountIn", "ApiUuid", "ChatAssistantIn", "ChatDoneIn", "TemplateIn", "TemplateStatusIn"]
__all__ = ["AccountIn", "ConnectIn", "ApiUuid", "TemplateIn", "TemplateStatusIn"]
