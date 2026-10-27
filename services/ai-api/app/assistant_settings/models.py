"""The AI assistant's settings API shapes (job DM, C1 part). Committed EARLY as a contract (packages/contracts/assistant_settings.*): Settings > AI assistant is built against it.

One setting per workspace: the assistant's name, its voice, its languages, its way of talking and speed, what it may do on a call, when it hands over to the owner and when it may call. Until the owner saves,
the API shows the DEFAULTS of the business type, so the screen can be skipped. The words "AI assistant" are always said: the introduction is composed from fixed wording (`intro`) and is not a field.
No child data: nothing here refers to a pupil's record."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

LanguageWord = Literal["en", "te", "hi", "kn", "ta", "ml"]
PersonaWord = Literal["female_warm", "female_clear", "male_calm", "male_lively", "own_voice"]
StyleWord = Literal["warm", "respectful", "quick"]
# the business type is the pack's code (data: packages/packs); code never lists them
BusinessType = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,40}$")]

# the name carries no markup, braces, at-signs or slashes (it is spoken and shown, never interpreted)
AssistantName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AssistantSettings(_Strict):
    """Every field, always. The same shape is read and saved."""

    # what customers hear: "<name>, the AI assistant of <business>". The words "AI assistant" are always said and cannot be removed.
    name: AssistantName
    voice_persona: PersonaWord
    # the language of the first call; it switches to the customer's own when `auto_switch_language`
    main_language: LanguageWord
    auto_switch_language: bool
    # Telugu-English, Hindi-English mixing
    allow_english_mixing: bool
    style: StyleWord
    # 1.0 = normal; 0.75 to 1.25 in steps of 0.05
    speed: Annotated[float, Field(ge=0.75, le=1.25, multiple_of=0.05)]
    # what it may do on calls
    may_answer_prices: bool
    may_book_visits: bool
    may_send_media: bool
    may_talk_dues: bool
    # the highest discount it may offer, in whole percent (0 = none)
    max_discount_percent: Annotated[int, Field(ge=0, le=50)]
    # hand over to the owner when
    handover_owner_asked: bool
    handover_upset: bool
    # an order above this amount in paise; null = this rule is off
    handover_order_above_paise: Annotated[int, Field(ge=1, le=100_000_000_000)] | None
    # calling days, Monday = 1 to Sunday = 7
    call_days: Annotated[list[Annotated[int, Field(ge=1, le=7)]], Field(min_length=1, max_length=7)]
    # calling hours as minutes after midnight, in steps of 15, from 09:00 (540) to 21:00 (1260)
    call_from_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)]
    call_to_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)]

    @model_validator(mode="after")
    def _order(self) -> AssistantSettings:
        if self.call_from_minute >= self.call_to_minute:
            raise ValueError("calling hours must end after they begin")
        if len(set(self.call_days)) != len(self.call_days):
            raise ValueError("a calling day is listed once")
        return self


class OptionOut(_Strict):
    id: str
    label: str
    description: str | None = None


class VoiceAvailabilityOut(_Strict):
    # a voice exists for this persona in this language
    available: bool
    # a machine voice with no human behind it (until a real voice is added after a native speaker listened)
    synthetic: bool


class PersonaOut(_Strict):
    id: PersonaWord
    label: str
    description: str
    languages: dict[LanguageWord, VoiceAvailabilityOut]


class OptionsOut(_Strict):
    personas: list[PersonaOut]
    styles: list[OptionOut]
    # each language's name in its own script
    languages: list[OptionOut]


class AssistantOut(_Strict):
    # the settings in force: what the owner saved, or the defaults of the business type before the first save
    settings: AssistantSettings
    # false until the owner saves once: the screen can say "you can skip this, these are good defaults"
    saved: bool
    # the defaults of this business type (for "reset to defaults")
    defaults: AssistantSettings
    business_name: str
    business_type: BusinessType
    # the fixed introduction in each language, with the name and the business filled in; "AI assistant" is always in it
    intro: dict[LanguageWord, str]
    # true when this business has voice notes: a save then also sets their speed, calling hours and voices
    voice_notes_follow: bool
    options: OptionsOut
    updated_at: datetime | None
    # fields this business type may not change, with the value they are held at (the school rule: an education workspace's assistant never discusses dues, fees or marks, gives no discount and has no order
    # limit; those go only as fixed template messages from the school's records). The screen shows them switched off; the API refuses a save that says otherwise.
    locked: dict[str, bool | int | None]
    # a draft wording awaiting native review
    wording: Literal["draft"]


class PreviewOut(_Strict):
    language: LanguageWord
    style: StyleWord
    name: str
    # the sample line with the business's name and the assistant's name filled in; it states "AI assistant"
    text: str
    intro: str
    wording: Literal["draft"]


class TranscriptLineOut(_Strict):
    speaker: Literal["assistant", "customer"]
    text: str


class OutcomePreviewOut(_Strict):
    outcome: Literal["positive"]
    category: Literal["interested"]
    reason: str


class TestCallOut(_Strict):
    # "fake" until telephony exists: no call is made, nothing is sent, nothing is stored
    mode: Literal["fake"]
    status: Literal["simulated"]
    note: str
    transcript: list[TranscriptLineOut]
    outcome: OutcomePreviewOut
