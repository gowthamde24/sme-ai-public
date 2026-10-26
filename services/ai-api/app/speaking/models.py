"""Speaking style (job DS): how the assistant talks, per workspace and language. Strict: an unknown field is a 422. The contract is packages/contracts/speaking_style.* ."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.agents import register

Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
Style = Literal["everyday_mixed", "everyday_pure", "formal"]
Region = Literal["neutral", "coastal", "telangana", "rayalaseema", "chennai", "kongu", "bengaluru", "north_karnataka"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LanguageStyle(_Strict):
    style: Style
    region: Region = "neutral"


class SpeakingStyleIn(_Strict):
    """All languages at once; a language left out goes back to the default (everyday_mixed, neutral)."""

    languages: dict[Language, LanguageStyle]

    @model_validator(mode="after")
    def _regions_belong_to_their_language(self) -> SpeakingStyleIn:
        for language, choice in self.languages.items():
            if choice.region not in register.REGIONS[language]:
                raise ValueError(f"{choice.region} is not a region of {language}")
        return self


class LanguageStyleOut(_Strict):
    style: Style
    region: Region
    saved: bool
    # `approved`: the owner read the example lines of this language; `draft`: they wait for a native reader
    examples: Literal["approved", "draft"]


class OptionsOut(_Strict):
    styles: list[Style]
    default_style: Style
    regions: dict[Language, list[Region]]


class SpeakingStyleOut(_Strict):
    languages: dict[Language, LanguageStyleOut]
    options: OptionsOut
