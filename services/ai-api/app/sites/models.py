"""API-facing models of customer sites (job CN, ADR 0085, module `sites`). A customer (a company) has many sites: where a truck goes. Requests are closed: an unknown field is a 422. The site contact is a CONTACT
of the business (so consent, the suppression key and the quiet hours apply to messages to them); a phone number does not belong in the free text of a site."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Line300 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
City = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Pin = Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{5}$")]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Distance = Annotated[StrictInt, Field(ge=0, le=5000)]
Lane = Annotated[StrictInt, Field(ge=1, le=100)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SiteIn(_Strict):
    """The whole site at once; the same id again changes it (the customer never changes). `distance_km` is the distance from the yard, entered by the owner: freight by the kilometre reads it. A map pin is both numbers or neither."""

    company_id: uuid.UUID
    name: Name
    address_line: Line300 | None = None
    city: City | None = None
    pin: Pin | None = None
    map_lat: Latitude | None = None
    map_lng: Longitude | None = None
    distance_km: Distance | None = None
    lane_width_ft: Lane | None = None
    night_delivery: StrictBool = False
    unloading_help: StrictBool = False
    access_notes: Notes | None = None
    site_contact_id: uuid.UUID | None = None
    active: StrictBool = True


class SiteOut(_Strict):
    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    address_line: str | None
    city: str | None
    pin: str | None
    map_lat: float | None
    map_lng: float | None
    distance_km: int | None
    lane_width_ft: int | None
    night_delivery: bool
    unloading_help: bool
    access_notes: str | None
    site_contact_id: uuid.UUID | None
    active: bool
    created_at: datetime
    updated_at: datetime


class SiteSaveOut(_Strict):
    site: SiteOut
    created: bool


class SiteListOut(_Strict):
    items: list[SiteOut]
    next_cursor: str | None
