"""API-facing models of the Lead Finder (ADR 0119). The contract C2 builds the screens on: docs/contracts/lead-finder.md. Requests are closed: an unknown field is a 422."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ProspectStatus = Literal["new", "researching", "call_ready", "needs_owner", "skipped", "contacted", "qualified", "not_interested"]
Action = Literal["call", "later", "skip", "not_interested", "do_not_call"]
PersonaName = Literal["interested", "price_shopper", "busy_call_later", "not_interested", "wants_whatsapp", "rude_hangs_up"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=300)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SettingsIn(_In):
    fit_bar: Annotated[int, Field(ge=50, le=100)] | None = None
    daily_call_cap: Annotated[int, Field(ge=0, le=500)] | None = None
    call_from_hour: Annotated[int, Field(ge=9, le=20)] | None = None
    call_to_hour: Annotated[int, Field(ge=10, le=21)] | None = None
    searches_per_day: Annotated[int, Field(ge=1, le=20)] | None = None
    results_per_search: Annotated[int, Field(ge=1, le=20)] | None = None


class SettingsOut(_Out):
    fit_bar: int
    daily_call_cap: int
    call_from_hour: int
    call_to_hour: int
    searches_per_day: int
    results_per_search: int
    updated_at: datetime | None = None


class PlanIn(_In):
    """Either the owner's words (`text`: "find new retailers in Jayanagar") or the search itself (`query` + `area`)."""

    text: Text | None = None
    query: Short | None = None
    area: Short | None = None
    max_results: Annotated[int, Field(ge=1, le=20)] | None = None
    language: Literal["en", "te", "kn", "hi", "ta", "ml"] = "en"


class SearchOut(_Out):
    """A search: the plan card before the Owner's OK (`state: planned`), the result card after it (`state: done`)."""

    id: uuid.UUID
    state: Literal["planned", "approved", "done", "failed", "cancelled"]
    query: str
    area: str | None
    category_hint: str | None
    max_results: int
    # fixture = synthetic businesses (demo workspaces), places = Google Maps (Owner Test only)
    provider: Literal["fixture", "places"]
    # the Google SKU one search bills (places_text_search_enterprise), or "fixture"
    sku: str
    est_cost_paise: int
    cost_paise: int
    cost_is_estimate: bool = True
    source_label: str
    found: int
    counts: dict[str, int] | None
    searches_left_today: int | None = None
    # "Google Maps" when the results come from Google: show it next to every Places field
    attribution: str | None
    created_at: datetime
    approved_at: datetime | None
    finished_at: datetime | None


class SearchListOut(_Out):
    items: list[SearchOut]


class ProspectOut(_Out):
    id: uuid.UUID
    search_id: uuid.UUID | None
    name: str
    category: str | None
    area: str | None
    phone: str | None
    website: str | None
    rating: float | None
    review_count: int | None
    lat: float | None
    lng: float | None
    source: Literal["google_maps", "fixture"]
    source_label: str
    attribution: str | None
    status: ProspectStatus
    decision_reason: str | None
    fit_score: int | None
    fit_reason: str | None
    stock_match: dict[str, Any] | None
    owner_approved: bool
    suppressed: bool
    ask_after: datetime | None
    last_contacted_at: datetime | None
    lead_id: uuid.UUID | None
    qualification: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class ProspectListOut(_Out):
    items: list[ProspectOut]
    next_cursor: str | None


class StatsOut(_Out):
    total: int
    by_status: dict[str, int]


class ActionsIn(_In):
    ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=50)]
    action: Action


class ActionResultOut(_Out):
    id: uuid.UUID
    ok: bool
    status: ProspectStatus | None
    error: str | None


class ActionsOut(_Out):
    results: list[ActionResultOut]


class SimulateIn(_In):
    persona: PersonaName
    language: Literal["en", "te"] = "en"


class TurnOut(_Out):
    who: Literal["assistant", "business"]
    text: str
    t: float


class SimulatedCallOut(_Out):
    """A qualifying call in the SIMULATOR: our assistant against a scripted retailer. Nothing is dialled."""

    simulated: Literal[True] = True
    call_id: uuid.UUID
    prospect: ProspectOut
    persona: str
    language: str
    outcome: Literal["qualified", "contacted", "not_interested", "do_not_call"]
    end_reason: str
    summary: str
    whatsapp_ok: bool
    pitched: list[str]
    quote_suggestion: list[dict[str, Any]]
    transcript: list[TurnOut]
    evals: dict[str, bool]


class RedecideOut(_Out):
    changed: int
