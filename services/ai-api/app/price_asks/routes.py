"""Price questions to answer (owner, 15 Nov 2026): "Price asked: <item>" is written down when the assistant could not state a price, so "the shop will confirm the exact price and get back to you" is true.

  GET  /price-asks?open=true&limit=50   Owner, Admin, Sales: the questions waiting (or all), newest first: {items: [{id, item, source, kind: price|follow_up, needed_by, lead_id, customer, asked_at, answered_at}]}, earliest deadline first
  POST /price-asks                      Owner, Admin, Sales: {item, source: assistant|call|whatsapp|website, lead_id?} -> {id} (the same words for the same lead within 10 minutes are one question)
  POST /price-asks/{id}/answered        Owner, Admin, Sales: mark it answered
The Today summary reads the first one as the section `price_asks`."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.price_asks.repository import PriceAsksRepository
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/price-asks", tags=["price-asks"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Staff = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PriceAskIn(_Strict):
    item: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    source: Literal["assistant", "call", "whatsapp", "website"]
    lead_id: uuid.UUID | None = None


class PriceAskOut(_Strict):
    id: uuid.UUID
    item: str
    source: str
    kind: Literal["price", "follow_up"] = "price"   # a price the shop has not fixed, or any other promise ("we will check", "we will send")
    needed_by: str | None = None   # the date the customer named ("Sunday"), India time, when they named one
    lead_id: uuid.UUID | None = None
    customer: str | None = None
    asked_at: str
    answered_at: str | None = None


class PriceAsksOut(_Strict):
    items: list[PriceAskOut] = Field(default_factory=list)


class CreatedOut(_Strict):
    id: uuid.UUID


class DoneOut(_Strict):
    answered: bool = True


def _repo(runtime: Runtime) -> PriceAsksRepository:
    if runtime.price_asks is None:
        raise ApiError(503, "price_asks_unavailable", "Price questions are not available right now.")
    repo: PriceAsksRepository = runtime.price_asks
    return repo


@router.get("", response_model=PriceAsksOut)
def list_price_asks(ctx: Staff, runtime: RuntimeDep, open: Annotated[bool, Query()] = True, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> PriceAsksOut:  # noqa: A002
    rows: list[dict[str, Any]] = _repo(runtime).list(ctx.principal.token, ctx.tenant.id, open, limit)
    return PriceAsksOut(items=[PriceAskOut.model_validate(r) for r in rows])


@router.post("", response_model=CreatedOut, status_code=201)
def create_price_ask(body: PriceAskIn, ctx: Staff, runtime: RuntimeDep) -> CreatedOut:
    return CreatedOut(id=_repo(runtime).record(ctx.principal.token, ctx.tenant.id, body.item, body.source, body.lead_id))


@router.post("/{ask_id}/answered", response_model=DoneOut)
def answer_price_ask(ask_id: uuid.UUID, ctx: Staff, runtime: RuntimeDep) -> DoneOut:
    _repo(runtime).answer(ctx.principal.token, ctx.tenant.id, ask_id)
    return DoneOut()
