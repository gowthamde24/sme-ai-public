"""API-facing models of store visits, the opening hours and the slots (job AS, ADR 0067). The contract the web is built on: docs in the job AS report.

Every status and outcome is a closed word. Times are ISO instants (the screen shows them in Asia/Kolkata); `date` is the India calendar date of the start; a slot is named by its India clock time
"HH:MM". Money is integer paise. Nothing here carries a phone number, a key, a token or another business's data. Requests are closed: an unknown field is a 422."""

from __future__ import annotations

import datetime as dt
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator

Language = Literal["en", "te", "hi", "kn", "ta"]
VisitStatus = Literal["booked", "confirmed", "arrived", "completed", "no_show", "cancelled"]
Outcome = Literal["bought", "will_return", "not_interested"]
Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SlotStart = Annotated[str, StringConstraints(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]
Clock = Annotated[str, StringConstraints(pattern=r"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$")]
Purpose = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
# an advance is optional and never required; when asked for it is an amount in paise (at most 10 lakh rupees)
AdvancePaise = Annotated[int, Field(ge=1, le=100_000_000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------------------------ hours
class DayHours(_Strict):
    """Opening and closing time of one weekday, "HH:MM" (closing up to "24:00": the last slot then ends at midnight). A closed day is `null` in the week."""

    open: SlotStart
    close: Clock

    @field_validator("close")
    @classmethod
    def _after_open(cls, close: str, info: object) -> str:
        opened = getattr(info, "data", {}).get("open")
        if opened is not None and not opened < close:
            raise ValueError("close must be after open")
        return close


class StoreSettingsIn(_Strict):
    """The whole week at once: every weekday is present, null = closed that day. `closed_dates` are single closed days (holidays)."""

    weekly_hours: dict[Weekday, DayHours | None]
    closed_dates: Annotated[list[dt.date], Field(max_length=200)] = []
    slot_minutes: Literal[15, 20, 30, 45, 60, 90, 120]
    max_parallel: Annotated[int, Field(ge=1, le=50)]

    @field_validator("weekly_hours")
    @classmethod
    def _all_seven(cls, week: dict[str, DayHours | None]) -> dict[str, DayHours | None]:
        if set(week) != set(WEEKDAYS):
            raise ValueError("every weekday must be present (null = closed)")
        return week


class StoreSettingsOut(_Strict):
    weekly_hours: dict[Weekday, DayHours | None]
    closed_dates: list[dt.date]
    slot_minutes: int
    max_parallel: int
    # true while the business has never saved its own hours: these are the defaults (every day 10:00 to 20:30, 30-minute slots, 2 at once)
    is_default: bool


class SlotOut(_Strict):
    start: str
    starts_at: datetime
    ends_at: datetime
    capacity: int
    free: int
    # an earlier slot of today: it can still be booked (a walk-in being written down) but it is behind us
    past: bool


class SlotsOut(_Strict):
    date: dt.date
    open: bool
    reason: Literal["closed_day", "closed_date", "past"] | None
    slot_minutes: int
    max_parallel: int
    slots: list[SlotOut]


# ------------------------------------------------------------------------------------------------ visits
class BookVisitIn(_Strict):
    """Book a visit for a lead. The caller's `visit_id` makes a retry safe. There is NO field for a status, a contact, a source or an approver: the database decides them."""

    visit_id: uuid.UUID
    lead_id: uuid.UUID
    date: dt.date
    slot_start: SlotStart
    party_size: Annotated[int, Field(ge=1, le=50)] = 1
    purpose: Purpose | None = None
    note: Note | None = None
    # optional, off unless given: asking for an advance never blocks a visit
    advance_paise: AdvancePaise | None = None


class ChangeVisitIn(_Strict):
    """Move a visit that has not happened and/or change its details. Leave a field out to keep it. A visit that moves goes back to `booked` (the customer must confirm again).
    `date` and `slot_start` go together. `clear_advance` drops the advance; it cannot be combined with `advance_paise`."""

    date: dt.date | None = None
    slot_start: SlotStart | None = None
    party_size: Annotated[int, Field(ge=1, le=50)] | None = None
    purpose: Purpose | None = None
    note: Note | None = None
    advance_paise: AdvancePaise | None = None
    clear_advance: StrictBool = False


class CancelVisitIn(_Strict):
    reason: Reason | None = None


class CompleteVisitIn(_Strict):
    """How the visit ended. `bought` may also start the order: give `order_id` (yours, so a retry makes one order) and, if the customer has more than one approved quote, `quote_id`.
    That uses the existing order flow: an APPROVED quote of this customer, an Owner or Admin with a second factor."""

    outcome: Outcome
    order_id: uuid.UUID | None = None
    quote_id: uuid.UUID | None = None


class SendMessageIn(_Strict):
    """Make a confirmation or a reminder of a visit in the customer's language. The words are fixed templates (the outbox policy decides what happens to them)."""

    kind: Literal["confirmation", "reminder"]
    language: Language = "en"


class OfferVisitIn(_Strict):
    language: Language = "en"


class VisitOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID | None
    # company name, the contact's short name ("Priya S.") and the city; null when there is none or the record was erased
    customer: str | None
    contact_name: str | None
    who: str
    city: str | None
    date: dt.date
    starts_at: datetime
    ends_at: datetime
    party_size: int
    purpose: str | None
    note: str | None
    status: VisitStatus
    source: Literal["staff", "assistant"]
    outcome: Outcome | None
    order_id: uuid.UUID | None
    advance_requested: bool
    advance_paise: int | None
    confirmation_message_id: uuid.UUID | None
    reminder_message_id: uuid.UUID | None
    # true once the message has really gone out through the channel
    confirmation_sent: bool
    reminder_sent: bool
    cancel_reason: str | None
    created_at: datetime
    confirmed_at: datetime | None
    arrived_at: datetime | None
    closed_at: datetime | None


class VisitResultOut(_Strict):
    visit: VisitOut
    replayed: bool = False


class VisitChangeOut(_Strict):
    visit: VisitOut
    moved: bool


class VisitCompleteOut(_Strict):
    visit: VisitOut
    order_id: uuid.UUID | None
    replayed: bool


class VisitListOut(_Strict):
    # the India dates asked for (today when nothing was asked)
    from_: dt.date = Field(alias="from")
    to: dt.date
    items: list[VisitOut]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TodayVisitOut(_Strict):
    """What the Today page needs for "At the store today": one line per visit that is still to come or here now."""

    id: uuid.UUID
    lead_id: uuid.UUID
    starts_at: datetime
    # short name: "Priya S."
    who: str
    # people with them: party_size - 1
    extra: int
    topic: str | None
    # confirmed | reminder_sent | requested (booked, the customer has not confirmed). A customer who is here now (`visit_status` arrived) shows as confirmed.
    status: Literal["confirmed", "reminder_sent", "requested"]
    visit_status: Literal["booked", "confirmed", "arrived"]


class TodayVisitsOut(_Strict):
    date: dt.date
    items: list[TodayVisitOut]


class MessageResultOut(_Strict):
    """The message the visit made in the outbox (read it there); `dispatched` is set when an Owner or Admin's action also handed due messages to the channel."""

    visit: VisitOut
    message: OutboxMessageOut
    replayed: bool
    dispatched: DispatchOut | None = None


class OfferVisitOut(_Strict):
    request: CallRequestOut
    message: OutboxMessageOut
    replayed: bool
    dispatched: DispatchOut | None = None


from app.outbox.models import CallRequestOut, DispatchOut, OutboxMessageOut  # noqa: E402

MessageResultOut.model_rebuild()
OfferVisitOut.model_rebuild()
