"""Voice notes (job CV, ADR 0088; module `voice_notes`): a campaign's reminder or announcement can also go as a WhatsApp audio message, spoken by a text-to-speech provider behind our interface. Settings, the
voice for each language, the spoken AI disclosure and the fair-use ledger of audio SECONDS (never rupees or tokens). A voice note is the same words the Owner approved, preceded by the disclosure; it is made at
send time and never stored."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Language = Literal["en", "te", "hi", "kn", "ta"]
UsageState = Literal["ok", "warn", "paused"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VoiceSettingsIn(_Strict):
    enabled: bool
    speed: float = Field(ge=0.75, le=1.25)
    # the hours (India time, 9 to 21) inside which a call is asked of a person; one setting for the call list and the voice notes (ADR 0084 part 4)
    call_from_hour: int = Field(ge=9, le=21)
    call_to_hour: int = Field(ge=9, le=21)


class VoiceSettingsOut(_Strict):
    enabled: bool
    speed: float
    call_from_hour: int
    call_to_hour: int
    # always false: recording a call is not offered (ADR 0084 part 4)
    recording: bool
    choices: dict[str, str]
    updated_at: datetime | None = None


class VoiceOut(_Strict):
    code: str
    language: Language
    label: str
    # true = a machine voice made for tests; no human voice is imitated
    synthetic: bool


class VoicesOut(_Strict):
    items: list[VoiceOut]


class VoiceChoiceIn(_Strict):
    # null removes the choice for the language
    voice_code: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]{2,39}$")


class DisclosureOut(_Strict):
    """The line spoken first in every voice note, in the business's name. `usable` is false until a native speaker has reviewed the wording (a draft may be spoken only while the workspace holds synthetic data)."""

    language: Language
    version: int | None = None
    status: Literal["draft", "reviewed"] | None = None
    text: str | None = None
    usable: bool


class UsageOut(_Strict):
    today_seconds: int
    month_seconds: int
    day_percent: int
    month_percent: int
    state: UsageState


class CampaignVoiceIn(_Strict):
    enabled: bool


class CampaignVoiceOut(_Strict):
    campaign_id: uuid.UUID
    enabled: bool
    language: Language
    voice_code: str | None = None
    disclosure: DisclosureOut
    # what stands between this campaign and a voice note: voice_off | no_voice_for_language | disclosure_not_reviewed | allowance_used. A campaign with issues goes as text.
    issues: list[str]
    usage: UsageOut
    # true when this call changed the switch (an approved campaign then goes back to draft: the Owner approves the voice too)
    changed: bool | None = None


class PreviewIn(_Strict):
    # the caller's own id: a retry with the same id counts once on the ledger
    preview_id: uuid.UUID
    language: Language


class PreviewOut(_Strict):
    """A short spoken sample of the disclosure line in the chosen voice."""

    language: Language
    voice_code: str
    content_type: str
    encoding: Literal["base64"]
    data: str
    seconds: int
    usage: UsageOut
