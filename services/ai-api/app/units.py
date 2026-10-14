"""The closed list of selling units (job CK, blueprint section 5.2). One place for the API; the database's copy is packs.units (a pgTAP test and an integration test keep the two equal).

`set` is older than the rest (a saree-and-blouse set); the others arrived with the construction pack. A unit is a LABEL on a quantity: the quote engine multiplies a whole number of units by a price
in paise and never converts between units."""

from __future__ import annotations

from typing import Literal

SaleUnit = Literal["piece", "set", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"]
SALE_UNITS: tuple[str, ...] = ("piece", "set", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload")
