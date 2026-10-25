"""The call settings API shapes (job DP part 4). Committed EARLY as a contract (packages/contracts/call_settings.*): Settings > Calls, and the call settings of one campaign, are built against it.

How the assistant behaves on the phone, as DATA: retries, how many calls at once, what to do with a voicemail or a phone menu, silence, the longest call, interruption, listening sounds, how names are pronounced, the key
words the speech recognition should expect, when it may call (and which days it must not), how often one customer may be called, when to pause on its own, who takes over for which topic, and whether the
assistant remembers earlier conversations. One setting per workspace with, per campaign, an OVERRIDE of the parts the owner wants different there (everything else is inherited). Until the owner saves, the API
shows the DEFAULTS of the business type. Telephony does not exist yet: nothing here places a call; the settings are what a dialer will read (`effective`).

A school never makes sales calls and never calls about dues or fees (the school rule, owner decision 25 Oct 2026): its `allowed_purposes` is held and `locked` says so. No child data: nothing refers to a pupil.

NOTE: no `from __future__ import annotations` (the models are attached to endpoint signatures at registration time)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

DayNumber = Annotated[int, Field(ge=1, le=7)]
BusinessType = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,40}$")]
VoicemailAction = Literal["hang_up", "leave_message", "retry_later"]
PhoneMenuAction = Literal["hang_up", "retry_later"]
Sensitivity = Literal["low", "medium", "high"]
Topic = Literal["pricing", "payment", "delivery", "complaint", "visit", "other"]
Purpose = Literal["sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder"]
# text that is spoken or listened for: no markup, braces, at-signs, slashes or control characters
SpokenText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]
WrittenText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]
Keyword = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]
PhoneNumber = Annotated[str, StringConstraints(pattern=r"^\+?[0-9]{7,15}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RetryRule(_Strict):
    """How often to try again, and how long to wait between tries. `count` 0 = never try again."""

    count: Annotated[int, Field(ge=0, le=5)]
    gap_minutes: Annotated[int, Field(ge=5, le=1440, multiple_of=5)]


class Pronunciation(_Strict):
    """How a shop or product name is said: `written` is what appears in the records, `spoken` is how it should sound (in the Latin script or the language's own)."""

    written: WrittenText
    spoken: SpokenText


class CallHours(_Strict):
    """Calling days (Monday = 1 to Sunday = 7) and hours as minutes after midnight, in steps of 15, from 09:00 (540) to 21:00 (1260)."""

    days: Annotated[list[DayNumber], Field(min_length=1, max_length=7)]
    from_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)]
    to_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)]

    @model_validator(mode="after")
    def _order(self) -> "CallHours":
        if self.from_minute >= self.to_minute:
            raise ValueError("calling hours must end after they begin")
        if len(set(self.days)) != len(self.days):
            raise ValueError("a calling day is listed once")
        return self


class HandoverRule(_Strict):
    """When the customer raises this topic, the call is handed to this person's phone."""

    topic: Topic
    person_name: PersonName
    phone: PhoneNumber


class CallSettings(_Strict):
    """Every field, always. The same shape is read and saved (the workspace's)."""

    retry_busy: RetryRule
    retry_no_answer: RetryRule
    # the customer said "call me later" and named no time
    retry_call_later: RetryRule
    # how many calls at once; a plan may allow fewer (the dialer applies the lower)
    concurrent_calls: Annotated[int, Field(ge=1, le=20)]
    detect_voicemail: StrictBool
    voicemail_action: VoicemailAction
    detect_phone_menu: StrictBool
    phone_menu_action: PhoneMenuAction
    # hang up or ask "are you there?" after this much silence
    silence_timeout_seconds: Annotated[int, Field(ge=3, le=30)]
    # the longest call, in seconds, in steps of 30
    max_call_seconds: Annotated[int, Field(ge=30, le=1800, multiple_of=30)]
    # how readily the customer can cut in
    interruption_sensitivity: Sensitivity
    # small sounds like "hmm" and "okay" while listening
    listening_sounds: StrictBool
    pronunciations: Annotated[list[Pronunciation], Field(max_length=50)]
    # words and names the speech recognition should expect (product names, places)
    keywords: Annotated[list[Keyword], Field(max_length=100)]
    # null = the AI assistant's own days and hours (Settings > AI assistant)
    hours: CallHours | None
    # days it must not call, whatever the hours say (at most 60, from yesterday to 400 days ahead)
    holidays: Annotated[list[date], Field(max_length=60)]
    max_calls_per_customer_per_week: Annotated[int, Field(ge=1, le=14)]
    # pause the campaign when this many calls are refused by the carrier within one hour; null = never pause on its own
    auto_pause_refusals_per_hour: Annotated[int, Field(ge=3, le=100)] | None
    # whether the assistant remembers what was said in earlier conversations with this customer
    contact_memory: StrictBool
    handover: Annotated[list[HandoverRule], Field(max_length=8)]
    # what the assistant may phone about
    allowed_purposes: Annotated[list[Purpose], Field(min_length=1, max_length=5)]

    @model_validator(mode="after")
    def _lists(self) -> "CallSettings":
        if len({r.topic for r in self.handover}) != len(self.handover):
            raise ValueError("a topic is handed over to one person")
        if len({p.written.casefold() for p in self.pronunciations}) != len(self.pronunciations):
            raise ValueError("a name is listed once")
        if len(set(self.allowed_purposes)) != len(self.allowed_purposes):
            raise ValueError("a purpose is listed once")
        if len(set(self.holidays)) != len(self.holidays):
            raise ValueError("a day is listed once")
        return self


class CallSettingsOverride(_Strict):
    """What ONE campaign changes. Every field may be null = inherit the workspace's. Not overridable: holidays, handover and the allowed purposes (they belong to the business, not to a campaign)."""

    retry_busy: RetryRule | None = None
    retry_no_answer: RetryRule | None = None
    retry_call_later: RetryRule | None = None
    concurrent_calls: Annotated[int, Field(ge=1, le=20)] | None = None
    detect_voicemail: StrictBool | None = None
    voicemail_action: VoicemailAction | None = None
    detect_phone_menu: StrictBool | None = None
    phone_menu_action: PhoneMenuAction | None = None
    silence_timeout_seconds: Annotated[int, Field(ge=3, le=30)] | None = None
    max_call_seconds: Annotated[int, Field(ge=30, le=1800, multiple_of=30)] | None = None
    interruption_sensitivity: Sensitivity | None = None
    listening_sounds: StrictBool | None = None
    # this campaign's own list REPLACES the workspace's (an empty list = none for this campaign)
    pronunciations: Annotated[list[Pronunciation], Field(max_length=50)] | None = None
    keywords: Annotated[list[Keyword], Field(max_length=100)] | None = None
    hours: CallHours | None = None
    max_calls_per_customer_per_week: Annotated[int, Field(ge=1, le=14)] | None = None
    auto_pause_refusals_per_hour: Annotated[int, Field(ge=3, le=100)] | None = None
    # `auto_pause_refusals_per_hour` null means inherit; to switch the pause OFF for one campaign set this true
    auto_pause_off: StrictBool | None = None
    contact_memory: StrictBool | None = None


class EffectiveHours(_Strict):
    days: list[DayNumber]
    from_minute: int
    to_minute: int
    # "assistant" = taken from Settings > AI assistant; "workspace" = this setting; "campaign" = the campaign's override
    source: Literal["assistant", "workspace", "campaign"]


class EffectiveCallSettings(_Strict):
    """The settings a dialer applies to one campaign (or to the workspace's own calls): the workspace's with the campaign's override on top, and the hours resolved."""

    settings: CallSettings
    hours: EffectiveHours
    # which fields the campaign changed (empty for the workspace)
    overridden: list[str]


class OptionOut(_Strict):
    id: str
    label: str
    description: str | None = None


class OptionsOut(_Strict):
    voicemail_actions: list[OptionOut]
    phone_menu_actions: list[OptionOut]
    sensitivities: list[OptionOut]
    topics: list[OptionOut]
    purposes: list[OptionOut]


class CallSettingsOut(_Strict):
    # the settings in force: what the owner saved, or the defaults of the business type before the first save
    settings: CallSettings
    saved: bool
    defaults: CallSettings
    business_type: BusinessType
    effective: EffectiveCallSettings
    options: OptionsOut
    # the days and hours of Settings > AI assistant, which `hours: null` follows
    assistant_hours: CallHours
    # fields this business type may not change, with the value they are held at (a school: no sales calls, none about dues or fees)
    locked: dict[str, list[str]]
    updated_at: datetime | None
    wording: Literal["draft"]


class CampaignCallSettingsOut(_Strict):
    campaign_id: uuid.UUID
    overrides: CallSettingsOverride
    saved: bool
    effective: EffectiveCallSettings
    updated_at: datetime | None
