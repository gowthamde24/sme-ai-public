"""API-facing models of the catalogue (job AY, ADR 0069). The contract the web is built on: docs in the job AY report.

Photos are reached by SIGNED URLs that expire (`expires_in_seconds`): fetch them again when they have; never store one. A price band is words (`price_band_label`); an exact price (`price_paise`,
`price_text`) is there only when the Owner set one. Requests are closed: an unknown field is a 422. Nothing here carries a bucket, a storage path or a token."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints

from app.catalogue.vocab import Colour, Fabric, Occasion, PriceBand, Stock, Zari

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Border = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CatalogueItemIn(_Strict):
    """The whole item at once; the same id again changes it. `active` can be true only while the item has a photo. `price_paise` is the EXACT price: leave the field OUT to keep it as it is; send a number to
    set it or `null` to clear it. Only the Owner, with a second factor, may send it at all."""

    name: Name
    fabric: Fabric
    colours: Annotated[list[Colour], Field(min_length=1, max_length=4)]
    zari: Zari = "none"
    border: Border | None = None
    occasions: Annotated[list[Occasion], Field(max_length=4)] = []
    price_band: PriceBand
    stock_status: Stock = "in_stock"
    active: StrictBool = False
    price_paise: Annotated[int, Field(ge=100, le=100_000_000)] | None = None


class ReorderIn(_Strict):
    photo_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=8)]


class PhotoOut(_Strict):
    id: uuid.UUID
    # 1 = the cover
    position: int
    url: str | None
    thumb_url: str | None
    width: int
    height: int
    bytes: int
    expires_in_seconds: int


class ItemBase(_Strict):
    id: uuid.UUID
    name: str
    fabric: Fabric
    fabric_label: str
    colours: list[Colour]
    zari: Zari
    border: str | None
    occasions: list[Occasion]
    price_band: PriceBand
    price_band_label: str
    # the exact price, only when the Owner set one
    price_paise: int | None
    price_text: str | None
    stock_status: Stock
    stock_label: str
    active: bool
    photo_count: int
    created_at: datetime
    updated_at: datetime


class CatalogueItemSummary(ItemBase):
    """A list row: the cover photo only."""

    cover: PhotoOut | None


class CatalogueItemOut(ItemBase):
    photos: list[PhotoOut]


class CatalogueListOut(_Strict):
    items: list[CatalogueItemSummary]
    next_cursor: str | None


class SaveResultOut(_Strict):
    item: CatalogueItemOut
    created: bool


class PhotoResultOut(_Strict):
    photo: PhotoOut
    replayed: bool
    item: CatalogueItemOut
