"""The Owner's training of how the assistant talks on calls. Every text is the Owner's own words; an answer, a greeting or an example never states an amount, a percentage or a promise (the same rule as
the lead playbook); the never-say list is enforced by code on every spoken line (app/talk_training/guard.py)."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.leadspack.models import PRICE_OR_PROMISE

Address = Literal["plain", "sir_madam", "garu", "ji"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
Ask = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
Said = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
Answer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]


def _no_price_or_promise(value: str) -> str:
    if PRICE_OR_PROMISE.search(value):
        raise ValueError("price_or_promise")
    return value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Objection(_Strict):
    hears: Said
    answer: Answer

    @field_validator("answer")
    @classmethod
    def _answer(cls, value: str) -> str:
        return _no_price_or_promise(value)


class Example(_Strict):
    customer: Said
    answer: Answer

    @field_validator("answer")
    @classmethod
    def _answer(cls, value: str) -> str:
        return _no_price_or_promise(value)


class TalkTraining(_Strict):
    """What the Owner edits. `greeting` per language (optional; the assistant ALWAYS also says it is an AI); `address`: plain (default: the name or nothing, never "sir / madam"), sir_madam, garu
    (Telugu "...garu"), ji (Hindi "...ji")."""

    greeting: dict[Language, Said] = {}
    address: Address = "plain"
    questions: list[Ask] = []
    never_say: list[Short] = []
    objections: list[Objection] = []
    examples: list[Example] = []

    @field_validator("greeting")
    @classmethod
    def _greeting(cls, value: dict[str, str]) -> dict[str, str]:
        for text in value.values():
            _no_price_or_promise(text)
        return value

    @field_validator("questions")
    @classmethod
    def _questions(cls, value: list[str]) -> list[str]:
        if len(value) > 8:
            raise ValueError("too_many_questions")
        return value

    @field_validator("never_say")
    @classmethod
    def _never_say(cls, value: list[str]) -> list[str]:
        if len(value) > 20:
            raise ValueError("too_many_never_say")
        if len({v.casefold() for v in value}) != len(value):
            raise ValueError("duplicate")
        return value

    @field_validator("objections")
    @classmethod
    def _objections(cls, value: list[Objection]) -> list[Objection]:
        if len(value) > 8:
            raise ValueError("too_many_objections")
        return value

    @field_validator("examples")
    @classmethod
    def _examples(cls, value: list[Example]) -> list[Example]:
        if len(value) > 5:
            raise ValueError("too_many_examples")
        return value


class TalkTrainingOut(_Strict):
    training: TalkTraining          # what is in force: the saved one, else the defaults
    saved: bool
    defaults: TalkTraining          # for "reset to defaults"
    rules: list[str]                # the platform's own rules, always on, not editable
    updated_at: datetime | None
    wording: Literal["draft"] = "draft"
