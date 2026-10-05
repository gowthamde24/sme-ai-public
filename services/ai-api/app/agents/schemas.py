"""Closed output schemas. A model's tool arguments and final result are parsed with these before
anything happens; free model text never selects data (no field is an id, a table, a tenant or
a predicate)."""

from __future__ import annotations

import unicodedata
from typing import Annotated, Literal
from urllib.parse import unquote

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    model_validator,
)

from app.agents.research_vocab import CLAIM_VOCAB
from app.requirements.vocabulary import LINE_KEYS

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


# ---- the Research Agent's tools (T007). Closed schemas: no id, no URL, no free-text claim.
# A path on the lead's own website, never a URL: the host is decided by the runtime from the run's
# company, and with no query string and no "//" there is nothing in it that could name another
# host or carry data out.
Path200 = Annotated[
    str,
    StringConstraints(
        min_length=1, max_length=200, pattern=r"^/(?:[A-Za-z0-9._~%-][A-Za-z0-9._~%/-]*)?$"
    ),
]
PageHandle = Literal["p1", "p2", "p3", "p4", "p5"]
EvidenceHandle = Literal["e1", "e2", "e3"]
Quote300 = Annotated[Clean, StringConstraints(min_length=12, max_length=300)]
Predicate = Literal["buyer_type", "order_scale", "size_band", "operating_status"]


class FetchPageArgs(_Closed):
    path: Path200

    @model_validator(mode="after")
    def _no_dot_segments(self) -> FetchPageArgs:
        # the DECODED path is checked too: %2e%2e, %2f, %3f, %23 and %5c must not smuggle what the
        # pattern forbids
        decoded = unquote(self.path)
        if (
            any(part in ("..", ".") for part in self.path.split("/"))
            or any(part in ("..", ".") for part in decoded.split("/"))
            or any(ch in decoded for ch in "?#\\")
            or decoded.startswith("//")
            or any(unicodedata.category(ch).startswith("C") for ch in decoded)
        ):
            raise ValueError("this path is not allowed")
        return self


class RecordEvidenceArgs(_Closed):
    page: PageHandle
    quote: Quote300


class ProposeClaimArgs(_Closed):
    predicate: Predicate
    value: Annotated[str, StringConstraints(min_length=2, max_length=40)]
    stance: Literal["supports", "context", "contradicts"]
    evidence: EvidenceHandle

    @model_validator(mode="after")
    def _value_is_in_the_predicates_vocabulary(self) -> ProposeClaimArgs:
        if self.value not in CLAIM_VOCAB[self.predicate]:
            raise ValueError("the value is not in this predicate's vocabulary")
        return self


# ---- the Requirement Agent's one tool (T008). Closed schema: no id, no offset, no free-text field
# of ours. The model gives the line, the field, the value AS THE ENQUIRY WORDS IT, how sure it is
# and the QUOTE (a string): the runtime finds the offsets.
FieldName = Literal[
    "saree_type", "fabric", "colour", "quantity", "budget", "deadline", "delivery_city",
    "payment_terms"
]  # fmt: skip
FieldValue = Annotated[Clean, StringConstraints(min_length=1, max_length=120)]
FieldQuote = Annotated[Clean, StringConstraints(min_length=1, max_length=300)]


class ProposeFieldArgs(_Closed):
    line: Annotated[StrictInt, Field(ge=1, le=5)] | None = None
    field: FieldName
    value: FieldValue
    certainty: Literal["stated", "implied", "ambiguous"]
    quote: FieldQuote

    @model_validator(mode="after")
    def _a_line_field_names_its_line_and_an_order_field_does_not(self) -> ProposeFieldArgs:
        if (self.field in LINE_KEYS) != (self.line is not None):
            raise ValueError("line fields need a line (1-5); order fields have none")
        return self
