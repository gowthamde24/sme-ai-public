"""Models of GET/PUT /how-assistant-speaks (docs/contracts/how-assistant-speaks.md). Strict: an unknown field is a 422 naming it."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Tone = Literal["friendly", "respectful", "quick"]
Background = Literal["quiet_office", "shop", "off"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
Style = Literal["everyday_mixed", "everyday_pure"]
Region = Literal["neutral", "coastal", "telangana", "rayalaseema", "chennai", "kongu", "bengaluru", "north_karnataka"]
Kind = Literal["business", "owner", "custom"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToneOut(_Strict):
    value: Tone
    source: Literal["saved", "migrated", "pack_default"]
    pack_default: Tone
    options: list[Tone]


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


class BackgroundOut(_Strict):
    value: Background
    saved: bool
    options: list[BackgroundOption]


class HowAssistantSpeaksOut(_Strict):
    tone: ToneOut
    words: WordsOut
    introduce_as: IntroduceOut
    background: BackgroundOut
    pack_defaults: PackDefaultsOut
    legacy_address: Literal["plain", "sir_madam", "garu", "ji"] | None
    updated_at: datetime | None


class WordsIn(_Strict):
    style: Style
    region: Region | None = None   # DEPRECATED (21 Nov 2026): accepted so an older screen still saves, then ignored: a region never changed a word a customer hears. Never returned.


class IntroduceIn(_Strict):
    kind: Kind
    text: str | None = None


class HowAssistantSpeaksIn(_Strict):
    """Any subset; a key left out is not changed, `null` resets that part to the default. `tone: "casual"` is a 422 (`fields: ["tone"]`)."""

    tone: Tone | None = None
    background: Background | None = None   # the quiet bed under the assistant's voice on calls; `null` = back to the default (quiet_office)
    words: dict[Language, WordsIn | None] | None = None
    introduce_as: IntroduceIn | None = None
