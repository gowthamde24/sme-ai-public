"""The shapes of a business's own phone number (planner, 18 Nov 2026)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


E164 = Annotated[str, StringConstraints(pattern=r"^\+[0-9]{8,15}$")]


class AvailableNumbersOut(_Strict):
    """The numbers on offer (nothing is rented by looking). `live` false = the provider is a mock (staging): the numbers are made up and cost nothing."""

    live: bool
    items: list[E164]


class TakeIn(_Strict):
    number: E164


class LineOut(_Strict):
    """The business's line, if it has one. `inbound_on` stays false until the first test call has passed (the operator switches it)."""

    state: Literal["none", "ready"]
    number: E164 | None = None
    inbound_on: bool = False
    live: bool


PATTERN = re.compile(r"^[0-9]{0,6}$")
