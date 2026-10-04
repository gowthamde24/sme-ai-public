"""Closed output schemas. A model's tool arguments and final result are parsed with these before
anything happens; free model text never selects data (no field is an id, a table, a tenant or
a predicate)."""

from __future__ import annotations

import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

_ALLOWED_FORMAT = {"‌", "‍", "‎", "‏"}  # joiners and direction marks: legal in Indic scripts


def _clean(value: str) -> str:
    for ch in value:
        cat = unicodedata.category(ch)
        if (
            (cat == "Cc" and ch != "\n")
            or cat in {"Cs", "Co", "Cn"}
            or (cat == "Cf" and ch not in _ALLOWED_FORMAT)
        ):
            raise ValueError("control or hidden characters are not allowed")
    return value


Clean = Annotated[str, AfterValidator(_clean)]
Note500 = Annotated[Clean, StringConstraints(min_length=1, max_length=500)]
Value200 = Annotated[Clean, StringConstraints(min_length=1, max_length=200)]
Summary300 = Annotated[Clean, StringConstraints(min_length=1, max_length=300)]


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WriteNoteArgs(_Closed):
    text: Note500


class WriteObservationArgs(_Closed):
    value: Value200
    stance: Literal["supports", "context", "contradicts"]


class FinalResult(_Closed):
    summary: Summary300
    uncertainty: Literal["low", "medium", "high"]
