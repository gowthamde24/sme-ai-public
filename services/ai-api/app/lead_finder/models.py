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


class AvailabilityOut(_Out):
    """Whether this business has the Lead Finder at all (a school: never) and which source a search would use here. Never an error: the screens hide the feature when `available` is false."""

    available: bool
    # fixture = made-up businesses (demo workspaces and every workspace until Google is ready); places = Google Maps
    source: Literal["fixture", "places"] | None
    # not_for_your_role: a Viewer (who reads no prospect): hide the feature for them
    # not_in_plan: the workspace is on Lead Desk (owner decision 4 Nov 2026: the Lead Finder is part of AI Workforce); the screens show the upgrade card, not the feature
    reason: Literal["ok", "not_for_this_business", "switched_off", "not_for_your_role", "not_in_plan"]
    upgrade_to: Literal["ai_workforce"] | None = None
    # who it finds (owner decision 4 Nov 2026): a shop's buyers ("businesses") or, for a school, organisations only (associations, companies, coaching centres, vendors, institutions; never individuals)
    audience: Literal["businesses", "organisations"] = "businesses"


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
    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"] = "en"


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


class ChatCardOut(_Out):
    """Job LF-router: the card a chat reply carries (event `lead_finder` of POST /assistant/turns, and `lead_finder` on a message of GET /assistant/conversations/{id}). The search's own state says which
    card: `planned` = the plan card (OK / Cancel; the OK is POST /lead-finder/searches/{id}/approve, or the owner says "yes" in the chat), `done` = the result card, `failed` / `cancelled` = a closed card.
    `can_approve`: Owner or Admin (a Sales member sees the plan, the owner says OK)."""

    search: SearchOut
    can_approve: bool


class SearchListOut(_Out):
    items: list[SearchOut]


class ProspectOut(_Out):
    id: uuid.UUID
    search_id: uuid.UUID | None
    # a Google prospect (route 1) holds no name: it is fetched fresh for this answer; `details_available` false = it could not be fetched now (name, category, area, phone, website, rating empty)
    name: str | None
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
    details_available: bool = True


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


# ---------------------------------------------------------------------------------------------------------------------------------- the quote draft of a qualified call (decision 8)
class QuoteLineOut(_Out):
    """One line of the draft: an item the call pitched, at the Owner's own exact catalogue price, for the quantity the buyer said."""

    item: str
    item_type_code: str
    qty: int
    unit_price_paise: int
    quantity_said: str


class QuoteLeftOutOut(_Out):
    """A suggestion that is NOT in the draft, and why: never a made-up price or quantity."""

    item: str
    reason: Literal["no_price", "no_quantity", "not_in_stock", "not_in_catalogue", "too_many_lines", "item_type_off"]


class QuoteDraftPreviewOut(_Out):
    prospect_id: uuid.UUID
    lead_id: uuid.UUID
    # true when at least one line can go in the draft (the button is shown)
    ready: bool
    lines: list[QuoteLineOut]
    left_out: list[QuoteLeftOutOut]
    # the ids the draft has (made) or will have. Once `made`, open the ENQUIRY's page (/enquiries/{enquiry_id}, Quote tab): a textiles draft lives there
    quote_id: uuid.UUID
    enquiry_id: uuid.UUID
    made: bool


class QuoteDraftIn(_In):
    customer_kind: Literal["new", "repeat"] = "new"
    # a state or union territory code (two capitals), or null: the GST supply is then decided on the quote page
    delivery_state: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")] | None = None


class QuoteDraftOut(_Out):
    quote_id: uuid.UUID
    quote_no: int | None
    enquiry_id: uuid.UUID
    status: Literal["draft"]
    total_paise: int | None
    needs_owner_approval: bool
    lines: list[QuoteLineOut]
    left_out: list[QuoteLeftOutOut]
    replayed: bool
