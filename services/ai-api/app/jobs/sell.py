"""What you sell, the four styles that are not products (25 Nov 2026; docs/contracts/what-you-sell.md; migration 20261231988100). The database decides who may write, that an amount is the Owner's, that texts are clean and that a style
keeps only its own keys; this module carries the calls (with the CALLER's token) and checks the SHAPE of an entry by its style, with the same limits the web adapter (apps/web/lib/api/what-you-sell.ts) keeps on what it reads.
The data layer's text is never returned: a refusal is a closed word chosen by the routes."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as _dt
import uuid
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)

from app.rpc_base import RpcClient

Style = Literal["services", "courses", "properties", "pricelist"]
STYLES: tuple[str, ...] = ("services", "courses", "properties", "pricelist")
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Paise = Annotated[int, Field(ge=0, le=100_000_000_000)]
Day = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _day(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        _dt.date.fromisoformat(value)
    except ValueError:
        raise ValueError("day") from None
    return value


class ServiceIn(_Strict):
    name: Name
    minutes: Annotated[int, Field(ge=5, le=1440)] | None = None
    price_paise: Paise | None = None
    price_from: bool = False
    booking: Literal["any_day", "not_sunday", "book_ahead"]
    place: Literal["at_shop", "at_home", "both"] | None = None


class Seats(_Strict):
    state: Literal["open", "left", "full"]
    count: Annotated[int, Field(ge=1, le=100_000)] | None = None

    @model_validator(mode="after")
    def _count_only_with_left(self) -> Seats:
        if (self.state == "left") != (self.count is not None):
            raise ValueError("count")
        return self


class CourseIn(_Strict):
    name: Name
    batch: Short = ""
    starts_on: Day | None = None
    fee_paise: Paise | None = None
    seats: Seats
    total: Annotated[int, Field(ge=1, le=100_000)] | None = None
    description: Note | None = None

    @model_validator(mode="after")
    def _day_ok(self) -> CourseIn:
        _day(self.starts_on)
        return self


class PropertyIn(_Strict):
    name: Name
    location: Short = ""
    size: Annotated[int, Field(ge=1, le=10_000_000)]
    size_unit: Literal["sq_ft", "sq_yd", "acre", "cent"]
    note: Note | None = None
    price_paise: Paise | None = None
    status: Literal["available", "booked", "sold"]


class Rate(_Strict):
    from_qty: Annotated[int, Field(ge=1, le=10_000_000)]
    rate_paise: Paise


class PriceIn(_Strict):
    name: Name
    moq: Annotated[int, Field(ge=1, le=10_000_000)]
    unit: Literal["piece", "metre", "kg", "set", "dozen"]
    rates: Annotated[list[Rate], Field(min_length=1, max_length=8)]
    good_until: Day | None = None

    @model_validator(mode="after")
    def _order(self) -> PriceIn:
        _day(self.good_until)
        for before, after in zip(self.rates, self.rates[1:], strict=False):   # bigger orders never cost more per piece, and the quantities go up (the rule the price-list import keeps)
            if after.from_qty <= before.from_qty or after.rate_paise > before.rate_paise:
                raise ValueError("rates")
        return self


MODELS: dict[str, TypeAdapter[Any]] = {"services": TypeAdapter(ServiceIn), "courses": TypeAdapter(CourseIn), "properties": TypeAdapter(PropertyIn), "pricelist": TypeAdapter(PriceIn)}


def check_entry(style: str, body: Any) -> tuple[str, dict[str, Any]] | list[str]:
    """(name, the style's other fields) for a valid body, else the list of field names that are wrong (never their values)."""
    try:
        parsed = MODELS[style].validate_python(body)
    except ValidationError as err:
        fields = sorted({str(e["loc"][0]) if e["loc"] else "body" for e in err.errors()})
        return fields or ["body"]
    data: dict[str, Any] = parsed.model_dump(mode="json")
    name = str(data.pop("name"))
    return name, data


class SellStore:
    """The database's door for the entries (RPCs of migration 20261231988100). The caller's token goes with every call."""

    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def list(self, token: str, tenant_id: uuid.UUID, style: str, limit: int, cursor: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "sell_entry_list", {"p_tenant_id": str(tenant_id), "p_style": style, "p_limit": limit, "p_after": cursor})

    def put(self, token: str, tenant_id: uuid.UUID, style: str, entry_id: uuid.UUID, name: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "sell_entry_put", {"p_tenant_id": str(tenant_id), "p_style": style, "p_id": str(entry_id), "p_name": name, "p_data": data})

    def remove(self, token: str, tenant_id: uuid.UUID, style: str, entry_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_entry_remove", {"p_tenant_id": str(tenant_id), "p_style": style, "p_id": str(entry_id)})
