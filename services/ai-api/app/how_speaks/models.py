"""Models of GET/PUT /how-assistant-speaks (docs/contracts/how-assistant-speaks.md). Strict: an unknown field is a 422 naming it."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictBool

Tone = Literal["friendly", "respectful", "quick", "professional", "calm_caring", "cheerful", "confident"]
Background = Literal["off", "quiet_office", "busy_office", "call_centre", "shop", "market", "showroom", "clinic_reception", "home", "street"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
Style = Literal["everyday_mixed", "everyday_pure"]
Region = Literal["neutral", "coastal", "telangana", "rayalaseema", "chennai", "kongu", "bengaluru", "north_karnataka"]
Kind = Literal["business", "owner", "custom"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToneOptionOut(_Strict):
    id: Tone
    label: dict[str, str]
    hint: dict[str, str]
    best_for: list[str]
    reviewed: bool   # false until a native reader has approved the te/hi/kn words


class ToneOut(_Strict):
    value: Tone
    source: Literal["saved", "migrated", "pack_default"]
    pack_default: Tone
    options: list[ToneOptionOut]


class WordsLanguageOut(_Strict):
    style: Style
    saved: bool
    examples: Literal["approved", "draft"]


class WordsOptionsOut(_Strict):
    styles: list[Style]


class WordsOut(_Strict):
    languages: dict[Language, WordsLanguageOut]
    options: WordsOptionsOut


class IntroducePreviewOut(_Strict):
    te: str
    en: str


class IntroduceOut(_Strict):
    kind: Kind
    text: str | None
    options: list[Kind]
    owner_name: str | None
    preview: IntroducePreviewOut


class PackDefaultsOut(_Strict):
    tone: Tone
    words: Style


class BackgroundOption(_Strict):
    id: Background
    label: dict[Language, str]   # the words on the screen in all seven languages (drafts for a native reader)
    sample_url: str | None = None   # "/v1/background-samples/<id>.mp3": a 6 s voice-free loop, pre-recorded; null for Off (docs/contracts/voice-styles.md section 2)


class BackgroundOut(_Strict):
    value: Background
    saved: bool
    options: list[BackgroundOption]


class SayAiOut(_Strict):
    value: bool    # true by default (lawyer's opinion, 25 Nov 2026): the greeting says it is an AI assistant; false only after the written undertaking
    saved: bool    # the owner chose (false = the default)
    undertaking_accepted_at: datetime | None = None   # when the Owner accepted the written undertaking that allows switching it off (who is kept too); None = not accepted


class HowAssistantSpeaksOut(_Strict):
    tone: ToneOut
    words: WordsOut
    introduce_as: IntroduceOut
    background: BackgroundOut
    say_ai_when_greeting: SayAiOut
    pack_defaults: PackDefaultsOut
    legacy_address: Literal["plain", "sir_madam", "garu", "ji"] | None
    updated_at: datetime | None


class WordsIn(_Strict):
    style: Style
    region: Region | None = None   # DEPRECATED (21 Nov 2026): accepted so an older screen still saves, then ignored: a region never changed a word a customer hears. Never returned.


class IntroduceIn(_Strict):
    kind: Kind
    text: str | None = None


class UndertakingIn(_Strict):
    accepted: Literal[True]   # the Owner ticked "I accept this undertaking"


class HowAssistantSpeaksIn(_Strict):
    """Any subset; a key left out is not changed, `null` resets that part to the default. `tone: "casual"` is a 422 (`fields: ["tone"]`)."""

    tone: Tone | None = None
    say_ai_undertaking: UndertakingIn | None = None   # sent with `say_ai_when_greeting: false`: the Owner accepts the written undertaking; the server stores when and who (a later "off" needs no new one)
    say_ai_when_greeting: StrictBool | None = None   # greet with "I'm the AI assistant of {business}" (true, the default) or the name only (false: only with the undertaking, else 409 ai_undertaking_required); `null` = back to the default. A non-boolean is a 422.
    background: Background | None = None   # the quiet bed under the assistant's voice on calls; `null` = back to the default (off)
    words: dict[Language, WordsIn | None] | None = None
    introduce_as: IntroduceIn | None = None
