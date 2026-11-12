"""Models of GET/PUT /how-assistant-speaks (docs/contracts/how-assistant-speaks.md). Strict: an unknown field is a 422 naming it."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Tone = Literal["respectful", "friendly"]
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
    region: Region
    saved: bool
    examples: Literal["approved", "draft"]


class WordsOptionsOut(_Strict):
    styles: list[Style]
    regions: dict[Language, list[Region]]


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
    region: Region


class HowAssistantSpeaksOut(_Strict):
    tone: ToneOut
    words: WordsOut
    introduce_as: IntroduceOut
    pack_defaults: PackDefaultsOut
    legacy_address: Literal["plain", "sir_madam", "garu", "ji"] | None
    updated_at: datetime | None


class WordsIn(_Strict):
    style: Style
    region: Region = "neutral"


class IntroduceIn(_Strict):
    kind: Kind
    text: str | None = None


class HowAssistantSpeaksIn(_Strict):
    """Any subset; a key left out is not changed, `null` resets that part to the default. `tone: "casual"` is a 422 (`fields: ["tone"]`)."""

    tone: Tone | None = None
    words: dict[Language, WordsIn | None] | None = None
    introduce_as: IntroduceIn | None = None
