"""The Owner's training of how the assistant talks on calls. Every text is the Owner's own words; an answer, a greeting or an example never states an amount, a percentage or a promise (the same rule as
the lead playbook); the never-say list is enforced by code on every spoken line (app/talk_training/guard.py)."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.leadspack.models import PRICE_OR_PROMISE
from app.opening.render import braces_ok
from app.talk_training import introduce

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


class SayLike(_Strict):
    """"Say it like this" (owner, 6 Nov 2026, app v4): the business's own way of saying something, and optionally what to say it INSTEAD of ("pattu cheera" instead of "silk saree")."""

    say: Short
    instead_of: Short | None = None

    @field_validator("say")
    @classmethod
    def _say(cls, value: str) -> str:
        return _no_price_or_promise(value)


class IntroduceAs(_Strict):
    """"Introduce as" (owner, 11 Nov 2026): business name (default), the owner's name, or the Owner's own words. Always says "AI assistant"; no digit, link, or "human/person" words (app/talk_training/introduce.py)."""

    kind: Literal["business", "owner", "custom"] = "business"
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None

    @model_validator(mode="after")
    def _valid(self) -> IntroduceAs:
        try:
            introduce.check(self.kind, self.text)
        except introduce.IntroduceError as err:
            raise ValueError(f"introduce_as:{err.reason}") from None
        return self


class TalkTraining(_Strict):
    """What the Owner edits. `greeting` per language (optional; the assistant ALWAYS also says it is an AI); `address`: plain (default: the name or nothing, never "sir / madam"), sir_madam, garu
    (Telugu "...garu"), ji (Hindi "...ji")."""

    greeting: dict[Language, Said] = {}
    introduce_as: IntroduceAs = IntroduceAs()
    address: Address = "plain"          # DEPRECATED (11 Nov 2026): folded into `tone`; still read and kept, never lost
    tone: Literal["respectful", "friendly"] | None = None   # the Owner's saved tone for calls to customers (the panel "How your assistant speaks"); None = not chosen yet (the business type decides)
    questions: list[Ask] = []
    never_say: list[Short] = []
    say_like: list[SayLike] = []
    objections: list[Objection] = []
    examples: list[Example] = []

    @field_validator("greeting")
    @classmethod
    def _greeting(cls, value: dict[str, str]) -> dict[str, str]:
        for text in value.values():
            _no_price_or_promise(text)
            if not braces_ok(text):   # the same four placeholders as the opening line: {customer} {assistant} {business} {agent_role}
                raise ValueError("invalid")
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

    @field_validator("say_like")
    @classmethod
    def _say_like(cls, value: list[SayLike]) -> list[SayLike]:
        if len(value) > 20:
            raise ValueError("too_many_say_like")
        if len({v.say.casefold() for v in value}) != len(value):
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


class DraftIn(_Strict):
    """One sentence from the Owner: what the business is and how they like to talk."""

    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=400)]
    language: Language = "en"


class DraftOut(_Strict):
    """A DRAFT to read and change; nothing is saved. `source`: `ai` (the model wrote it) or `template` (no model answered: the pack's defaults). `dropped`: pieces of the model's answer that broke a rule."""

    training: TalkTraining
    source: Literal["ai", "template"]
    dropped: int
    saved: Literal[False] = False
    wording: Literal["draft"] = "draft"


class PracticeTurn(_Strict):
    who: Literal["customer", "assistant"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]


class PracticeIn(_Strict):
    """A text practice call: the turns so far (the last is the customer's), the call's language, and optionally an unsaved training to try."""

    language: Language = "te"
    turns: Annotated[list[PracticeTurn], Field(min_length=1, max_length=20)]
    training: TalkTraining | None = None

    @field_validator("turns")
    @classmethod
    def _last_is_the_customer(cls, value: list[PracticeTurn]) -> list[PracticeTurn]:
        if value[-1].who != "customer":
            raise ValueError("the last turn must be the customer's")
        return value


class PracticeOut(_Strict):
    reply: str
    ended: bool        # the assistant closed the call (a bye, or the conversation was over)
    handover: bool     # the customer asked for a person: on a real call the team calls back
    simulated: Literal[True] = True
