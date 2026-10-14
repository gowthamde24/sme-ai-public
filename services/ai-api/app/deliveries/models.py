"""API-facing models of deliveries (job CN, ADR 0085, module `deliveries`): an order is delivered in trips; each trip has a vehicle, a driver, a site contact, the quantities it carries, a status, a delivery note
(challan) and, when it is delivered, a proof: a photo and the name of the person who received the goods. Requests are closed. The challan has NO amounts (a GST invoice stays in the owner's accounting system)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints

TripStatus = Literal["planned", "loaded", "on_the_way", "delivered", "problem", "cancelled"]
SettableStatus = Literal["planned", "loaded", "on_the_way", "problem", "cancelled"]
ProblemCode = Literal["truck_breakdown", "customer_not_ready", "site_closed", "wrong_material", "road_blocked", "other"]
Language = Literal["en", "te", "hi", "kn", "ta"]
Vehicle = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$")]
DriverName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
DriverPhone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[+]?[0-9][0-9 -]{6,18}$")]
Eta = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{1,2}(:[0-9]{2})?( ?[ap]m)?$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TripLineIn(_Strict):
    """`line_no` is the line of the order's quote; `quantity` is in pieces for a piece or area line and in the sold unit (bags, tonnes) for the others."""

    line_no: Annotated[StrictInt, Field(ge=1, le=5)]
    quantity: Annotated[StrictInt, Field(ge=1, le=10_000_000)]


class TripPlanIn(_Strict):
    """Plan a trip. `trip_id` is the caller's, so a retry is safe. The site is the order's unless another is given. The trips of an order never carry more of a line than the order holds."""

    trip_id: uuid.UUID
    planned_date: date
    vehicle_no: Vehicle | None = None
    driver_name: DriverName | None = None
    driver_phone: DriverPhone | None = None
    site_id: uuid.UUID | None = None
    site_contact_id: uuid.UUID | None = None
    lines: Annotated[list[TripLineIn], Field(min_length=1, max_length=5)]


class TripUpdateIn(_Strict):
    """Change a trip that is planned or in problem (the whole set of details; `lines`, when sent, replaces the quantities)."""

    planned_date: date
    vehicle_no: Vehicle | None = None
    driver_name: DriverName | None = None
    driver_phone: DriverPhone | None = None
    site_id: uuid.UUID | None = None
    site_contact_id: uuid.UUID | None = None
    lines: Annotated[list[TripLineIn], Field(min_length=1, max_length=5)] | None = None


class TripStatusIn(_Strict):
    """planned -> loaded -> on_the_way (delivered has its own call: it needs the proof). `problem` needs a reason from the closed list; a problem goes back to `planned` when rescheduled."""

    status: SettableStatus
    problem_code: ProblemCode | None = None


class TripNotifyIn(_Strict):
    """Tell the site contact how the trip is going. The words are fixed templates (no amounts, no model); `message_id` is the caller's, so a retry is safe. The outbox's own rules apply to it (consent, the
    number's suppression key, quiet hours, the daily limit); it goes by itself only when the owner has switched automatic sending on."""

    message_id: uuid.UUID
    kind: Literal["left", "soon", "delivered", "delay"]
    eta: Eta | None = None
    language: Language = "en"


class TripLineOut(_Strict):
    quote_line_id: uuid.UUID
    line_no: int
    name: str
    quantity: int
    unit: str


class ProofOut(_Strict):
    received_by: str
    recorded_at: datetime
    width: int
    height: int
    bytes: int
    photo_url: str | None
    expires_in_seconds: int


class TripOut(_Strict):
    id: uuid.UUID
    order_id: uuid.UUID
    order_no: int
    trip_no: int
    challan_no: int
    site_id: uuid.UUID | None
    site_contact_id: uuid.UUID | None
    planned_date: date
    vehicle_no: str | None
    driver_name: str | None
    driver_phone: str | None
    status: TripStatus
    problem_code: ProblemCode | None
    created_at: datetime
    updated_at: datetime
    delivered_at: datetime | None
    lines: list[TripLineOut]
    proof: ProofOut | None


class TripEventOut(_Strict):
    seq: int
    from_status: TripStatus | None
    to_status: TripStatus
    problem_code: ProblemCode | None
    recorded_at: datetime


class TripDetailOut(TripOut):
    events: list[TripEventOut]


class TripListOut(_Strict):
    items: list[TripOut]


class ChallanSiteOut(_Strict):
    name: str
    address_line: str | None
    city: str | None
    pin: str | None
    access_notes: str | None


class ChallanContactOut(_Strict):
    name: str
    phone: str | None


class ChallanLineOut(_Strict):
    line_no: int
    description: str
    quantity: int
    unit: str
    hsn: str | None


class ChallanOut(_Strict):
    """The delivery note: who, what, where, how. No amounts, no rates, no GST."""

    challan_no: int
    trip_no: int
    order_no: int
    date: date
    business: str
    customer: str | None
    site: ChallanSiteOut | None
    site_contact: ChallanContactOut | None
    vehicle_no: str | None
    driver_name: str | None
    driver_phone: str | None
    status: TripStatus
    lines: list[ChallanLineOut]
    received_by: str | None
    received_at: datetime | None


class NotifyOut(_Strict):
    """What the outbox did with the message: queued (it goes by itself), needs_approval (a person decides first) or blocked (and why)."""

    message_id: uuid.UUID
    status: Literal["queued", "needs_approval", "blocked", "sent", "failed"]
    reason: str
    text: str
    replayed: bool
