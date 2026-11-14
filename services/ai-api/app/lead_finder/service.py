"""The Lead Finder (ADR 0119): plan a search, the Owner's OK, run it through ONE source, drop what is already ours, decide each business, and the simulated qualifying call.

Hard rules kept here (and again in the database):
  * LEAD_FINDER=off -> nothing; fixture -> synthetic businesses only; places -> Google Places ONLY in a workspace whose real-data gate is open (Owner Test) and only with a key. A demo workspace never
    reaches Google, whatever the flag says.
  * a business type without the module `lead_finder` (a school) is refused before anything else (403 lead_finder_not_available).
  * no code path here dials: the qualifying call is the simulator (app/lead_finder/qualify.py). A test pins that this package imports no telephony provider and no dialer.
"""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.errors import ApiError
from app.lead_finder import decide, dedupe, intent, packdata, qualify
from app.lead_finder.errors import NotForThisBusinessError
from app.lead_finder.models import (
    ActionResultOut,
    ActionsIn,
    ActionsOut,
    AvailabilityOut,
    PlanIn,
    ProspectListOut,
    ProspectOut,
    RedecideOut,
    SearchListOut,
    SearchOut,
    SettingsIn,
    SettingsOut,
    SimulatedCallOut,
    SimulateIn,
    StatsOut,
    TurnOut,
)
from app.lead_finder.repository import LeadFinderRepository
from app.lead_finder.sources import (
    FixtureSource,
    GooglePlaceDetails,
    GooglePlacesSource,
    MockPlaceDetails,
    MockPlacesSource,
    Place,
    PlaceDetailsSource,
    ProspectSource,
    SearchRequest,
    SourceError,
)
from app.ops.usage import UsageLine, UsageRecorder, google_allowed, record_best_effort
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.lead_finder.service")
ATTRIBUTION = "Google Maps"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_STOCK_WORD = {"in_stock": "in_stock", "few_left": "few_left", "made_to_order": "made_to_order"}


# the "needs you" reasons that are decided again: none is the Owner's own choice
REDECIDE_NEEDS = frozenset({"first_calls", "no_stock_match", "low_stock", "fit_middle"})


def not_available() -> ApiError:
    return ApiError(403, "lead_finder_not_available", "Finding new customers is not available for this business.")


def not_in_plan() -> ApiError:
    """The workspace's plan (Lead Desk) does not have the Lead Finder: it is part of AI Workforce. No charge: the screen shows an upgrade link."""
    return ApiError(403, "not_in_plan", "Finding new customers is part of AI Workforce.", extra={"feature": "lead_finder", "upgrade_to": "ai_workforce"})


INDIVIDUALS = {
    "businesses": "I find businesses and organisations only, never individual people or families.",
    "organisations": ("I find organisations only, never individual people or families: for example apartment associations, companies, coaching centres or transport and event vendors near the "
                      "school. Families are reached only from the school's own enquiry list."),
}


def individuals_not_allowed(data: packdata.PackLeadFinder) -> ApiError:
    """Owner decision 4 Nov 2026: the Lead Finder never looks for individual people or families ("parents in Anantapur"); a school finds organisations only."""
    return ApiError(422, "individuals_not_allowed", INDIVIDUALS[data.audience], extra={"audience": data.audience})


def source_label(provider: str, query: str, area: str | None, now: datetime) -> str:
    what = f"{query} {area}" if area else query
    where = "Google Maps search" if provider == "places" else "Example search (made-up businesses)"
    return f"{where} '{what}', {now.day} {MONTHS[now.month - 1]}"[:240]


def stock_lines(rows: list[dict[str, Any]]) -> list[decide.StockLine]:
    out: list[decide.StockLine] = []
    for r in rows:
        name = str(r.get("name") or "").strip()
        if not name:
            continue
        words = " ".join(str(x) for x in [name, r.get("fabric") or "", " ".join(r.get("occasions") or []), r.get("item_kind") or ""]).replace("_", " ")
        stock = _STOCK_WORD.get(str(r.get("stock_status")), "out_of_stock")
        price = r.get("price_paise")
        out.append(decide.StockLine(name=name[:80], keywords=words.casefold(), price_paise=int(price) if isinstance(price, int) and price > 0 else None,
                                    unit=str(r.get("sell_unit") or "piece"), moq=None, stock=stock))  # type: ignore[arg-type]
    return out


def place_of(row: dict[str, Any]) -> Place:
    return Place(place_id=str(row["place_id"]), name=str(row.get("name") or ""), category=row.get("category"), area=row.get("area"), lat=row.get("lat"), lng=row.get("lng"), phone=row.get("phone"),
                 website=row.get("website"), rating=float(row["rating"]) if row.get("rating") is not None else None, review_count=row.get("review_count"))


def prospect_out(row: dict[str, Any]) -> ProspectOut:
    return ProspectOut.model_validate({**{k: row.get(k) for k in ProspectOut.model_fields if k not in ("attribution", "details_available")}, "attribution": ATTRIBUTION if row.get("source") == "google_maps" else None,
                                       "details_available": row.get("details_available", True) is not False})


def search_out(row: dict[str, Any], left: int | None = None) -> SearchOut:
    fields = {k: row.get(k) for k in SearchOut.model_fields if k not in ("attribution", "searches_left_today", "cost_is_estimate")}
    return SearchOut.model_validate({**fields, "attribution": ATTRIBUTION if row.get("provider") == "places" else None, "searches_left_today": left, "cost_is_estimate": row.get("provider") == "places"})


class LeadFinderService:
    def __init__(self, repo: LeadFinderRepository, *, mode: str = "fixture", places_key: str | None = None, places_cost_paise: int = 300,
                 places_factory: Callable[[str, int], ProspectSource] | None = None, clock: Callable[[], datetime] | None = None,
                 places_mock: bool = False, details_factory: Callable[[str], PlaceDetailsSource] | None = None, usage: UsageRecorder | None = None) -> None:
        self.repo = repo
        self._usage = usage   # the provider usage ledger (app/ops/usage.py); None: nothing is recorded
        self.mode = mode if mode in ("off", "fixture", "places") else "off"
        self._places_key = places_key or None
        self._places_cost = places_cost_paise
        self._places_factory = places_factory or (lambda key, cost: GooglePlacesSource(key, cost))
        self._clock = clock or (lambda: datetime.now(UTC))
        self._places_mock = places_mock
        self._details_factory = details_factory or (lambda key: GooglePlaceDetails(key))

    # ------------------------------------------------------------------------------------------------------------------- gates
    def data_for(self, token: str, tenant_id: uuid.UUID) -> packdata.PackLeadFinder:
        """The business type's Lead Finder data, or 403 (module off / no data) / 409 (the flag is off)."""
        if self.mode == "off":
            raise ApiError(409, "lead_finder_off", "Finding new customers is switched off right now.")
        if not self.repo.module_on(token, tenant_id):
            raise not_available()
        data = packdata.for_pack(self.repo.pack_id(token, tenant_id))
        if data is None:
            raise not_available()
        if not self.repo.entitled(token, tenant_id):
            raise not_in_plan()
        return data

    def _stock(self, token: str, tenant_id: uuid.UUID, data: packdata.PackLeadFinder) -> list[decide.StockLine]:
        """Our stock, when this business type matches prospects against it (a school sells no stock: nothing is read)."""
        return stock_lines(self.repo.stock(token, tenant_id)) if data.uses_stock else []

    def source_for(self, data: packdata.PackLeadFinder, real_data_open: bool) -> ProspectSource:
        """Google only where real data is allowed AND the flag says places AND a key exists; otherwise the synthetic fixture (a demo never reaches Google)."""
        if self.mode == "places" and real_data_open and self._places_key:
            return self._places_factory(self._places_key, self._places_cost)
        if self.mode == "places" and real_data_open and self._places_mock:
            return MockPlacesSource(data)   # invented businesses in Google's shape: route 1 can be tried end to end without a key or a cost
        return FixtureSource(data)

    def details_source(self, real_data_open: bool) -> PlaceDetailsSource | None:
        """Where a Google prospect's name, phone, address ... are fetched fresh (route 1: never saved). Only where real data is allowed and the flag says places, with a key (or the mock)."""
        if self.mode != "places" or not real_data_open:
            return None
        if self._places_key:
            return self._details_factory(self._places_key)
        return MockPlaceDetails() if self._places_mock else None

    def live(self, token: str, tenant_id: uuid.UUID, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Route 1: the rows from Google hold only the place ID and coordinates. Fetch the rest by place ID, for THIS answer only (nothing is written, nothing is kept). A row whose details cannot be
        fetched says so (`details_available: false`, name and phone empty); the screen shows "details unavailable"."""
        google = [r for r in rows if r.get("source") == "google_maps"]
        if not google:
            return rows
        ctx = self.repo.context(token, tenant_id)
        source = self.details_source(bool(ctx.get("real_data_open")))
        got: dict[str, Place] = {}
        ids = [str(r["place_id"]) for r in google]
        if source is not None and getattr(source, "billed", False) and not google_allowed(self._usage, "details_enterprise", len(ids)):
            source = None   # the free monthly cap of Place Details is used up (or cannot be checked): the details are "unavailable" until it resets; nothing is spent without the owner's OK
        if source is not None:
            try:
                got = source.fetch(ids)
            except SourceError:
                got = {}
            if getattr(source, "billed", False):   # one real request per place, recorded as it happened (a fresh id per fetch: the ledger is idempotent per reference)
                record_best_effort(self._usage, tenant_id, [UsageLine("google", "details_enterprise", len(ids), "details", f"det-{uuid.uuid4().hex}")])
        out: list[dict[str, Any]] = []
        for r in rows:
            if r.get("source") != "google_maps":
                out.append(r)
                continue
            p = got.get(str(r["place_id"]))
            if p is None:
                out.append({**r, "details_available": False})
                continue
            out.append({**r, "name": p.name, "category": p.category, "area": p.area, "phone": p.phone, "website": p.website, "rating": p.rating, "review_count": p.review_count, "details_available": True})
        return out

    def availability(self, token: str, tenant_id: uuid.UUID) -> AvailabilityOut:
        try:
            data = self.data_for(token, tenant_id)
        except ApiError as exc:
            reason = {"lead_finder_off": "switched_off", "not_in_plan": "not_in_plan"}.get(exc.code, "not_for_this_business")
            return AvailabilityOut(available=False, source=None, reason=reason, upgrade_to="ai_workforce" if reason == "not_in_plan" else None)  # type: ignore[arg-type]
        except NotForThisBusinessError:
            return AvailabilityOut(available=False, source=None, reason="not_for_this_business")
        ctx = self.repo.context(token, tenant_id)
        return AvailabilityOut(available=True, source=self.source_for(data, bool(ctx.get("real_data_open"))).provider, reason="ok", audience=data.audience)  # type: ignore[arg-type]

    # ------------------------------------------------------------------------------------------------------------------- settings
    def settings(self, token: str, tenant_id: uuid.UUID) -> SettingsOut:
        self.data_for(token, tenant_id)
        return SettingsOut.model_validate(self.repo.settings_get(token, tenant_id))

    def set_settings(self, token: str, tenant_id: uuid.UUID, body: SettingsIn) -> SettingsOut:
        self.data_for(token, tenant_id)
        changes = body.model_dump(exclude_none=True)
        if changes.get("call_from_hour") is not None and changes.get("call_to_hour") is not None and changes["call_from_hour"] >= changes["call_to_hour"]:
            raise ApiError(422, "invalid_hours", "The calling hours must start before they end.")
        # a combination the database refuses (hours that cross with the stored ones) is its InvalidValueError: the usual 422
        return SettingsOut.model_validate(self.repo.settings_set(token, tenant_id, changes))

    # ------------------------------------------------------------------------------------------------------------------- plan -> OK -> run
    def plan(self, token: str, tenant_id: uuid.UUID, body: PlanIn, *, search_id: uuid.UUID | None = None) -> SearchOut:
        """`search_id`: the chat gives the plan the id of the reply that shows it (app/turns/lead_finder.py), so a later "yes" and a replay find it again. A screen leaves it out."""
        data = self.data_for(token, tenant_id)
        if intent.names_individuals(body.text or body.query or ""):
            raise individuals_not_allowed(data)
        if body.text:
            parsed = intent.parse(body.text, data)
            if parsed is None:
                raise ApiError(422, "not_a_search", "Say what to find and where, for example: find new retailers in Jayanagar.")
            query, area, hint = parsed.query, parsed.area, parsed.category_hint
        elif body.query:
            query, area, hint = body.query, body.area, data.category_hint
        else:
            raise ApiError(422, "not_a_search", "Say what to find and where, for example: find new retailers in Jayanagar.")
        ctx = self.repo.context(token, tenant_id)
        settings = self.repo.settings_get(token, tenant_id)
        source = self.source_for(data, bool(ctx.get("real_data_open")))
        max_results = min(body.max_results or int(settings.get("results_per_search", 20)), int(settings.get("results_per_search", 20)))
        request = SearchRequest(query=query, area=area, max_results=max_results, language=body.language)
        now = self._clock()
        row = self.repo.search_plan(token, tenant_id, {
            "p_id": str(search_id or uuid.uuid4()), "p_query": query, "p_area": area, "p_category_hint": hint, "p_max_results": max_results, "p_provider": source.provider,
            "p_sku": source.sku(), "p_est_cost_paise": source.estimate_paise(request), "p_source_label": source_label(source.provider, query, area, now),
        })
        left = max(0, int(settings.get("searches_per_day", 5)) - int(ctx.get("searches_today", 0)))
        return search_out(row, left)

    def approve(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> SearchOut:
        data = self.data_for(token, tenant_id)
        row = self.repo.search_approve(token, tenant_id, search_id)
        if row.get("state") == "done":
            return search_out(row)
        ctx = self.repo.context(token, tenant_id)
        source = self.source_for(data, bool(ctx.get("real_data_open")))
        if source.provider != row.get("provider"):
            # the flag or the gate changed between the plan and the OK: never run a search on a source the Owner did not see
            return search_out(self.repo.search_finish(token, tenant_id, search_id, [], "failed", 0, {"error": 1}))
        request = SearchRequest(query=str(row["query"]), area=row.get("area"), max_results=int(row["max_results"]))
        if getattr(source, "billed", False) and not google_allowed(self._usage, "search_enterprise", 1):
            # the free monthly cap of this Google SKU is used up (or cannot be checked): stop here, spend nothing; the search says so and can be run after the cap resets
            return search_out(self.repo.search_finish(token, tenant_id, search_id, [], "failed", 0, {"error": 1, "monthly_cap": 1}))
        try:
            result = source.search(request)
        except SourceError:
            return search_out(self.repo.search_finish(token, tenant_id, search_id, [], "failed", 0, {"error": 1}))
        if source.provider == "places" and result.requests > 0 and result.cost_paise > 0:   # Google really answered and billed (the fixture and the mock make no request and cost nothing): one line, as soon as it is known, before our own database work
            record_best_effort(self._usage, tenant_id, [UsageLine("google", "search_enterprise", result.requests, "search", str(search_id))])
        known = dedupe.Known.from_context(ctx)
        fresh, dups = dedupe.split(result.places, known)
        stock = self._stock(token, tenant_id, data)
        settings = decide.Settings.from_row(self.repo.settings_get(token, tenant_id))
        situation = decide.Situation(now=self._clock(), calls_today=int(ctx.get("calls_today", 0)), ready_waiting=int(ctx.get("ready_waiting", 0)),
                                     approved_in_search=int((ctx.get("approved_by_search") or {}).get(str(search_id), 0)))
        decisions = decide.decide_all(fresh, data, stock, settings, situation)
        items = [self._item(p, d, source.provider) for p, d in zip(fresh, decisions, strict=True)]
        counts: dict[str, int] = {"found": len(result.places), "new": len(items), "duplicates": sum(dups.values())}
        for d in decisions:
            counts[d.status] = counts.get(d.status, 0) + 1
        for reason, n in dups.items():
            counts[f"duplicate_{reason}"] = n
        return search_out(self.repo.search_finish(token, tenant_id, search_id, items, "done", result.cost_paise, counts))

    @staticmethod
    def _item(p: Place, d: decide.Decision, provider: str = "fixture") -> dict[str, Any]:
        if provider == "places":   # ROUTE 1 (owner, 12 Nov 2026): from Google only the place ID and the coordinates, and OUR decision. The database drops the rest too.
            return {"place_id": p.place_id, "lat": p.lat, "lng": p.lng, "status": d.status, "decision_reason": d.reason, "fit_score": d.fit, "fit_reason": d.fit_reason, "stock_match": d.stock.as_json()}
        return {"place_id": p.place_id, "name": p.name, "name_key": dedupe.name_key(p.name), "category": p.category, "area": p.area, "lat": p.lat, "lng": p.lng, "phone": p.phone,
                "phone_key": dedupe.phone_key(p.phone), "website": p.website, "rating": p.rating, "review_count": p.review_count, "status": d.status, "decision_reason": d.reason,
                "fit_score": d.fit, "fit_reason": d.fit_reason, "stock_match": d.stock.as_json()}

    def cancel(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> SearchOut:
        self.data_for(token, tenant_id)
        return search_out(self.repo.search_cancel(token, tenant_id, search_id))

    def searches(self, token: str, tenant_id: uuid.UUID, limit: int) -> SearchListOut:
        self.data_for(token, tenant_id)
        return SearchListOut(items=[search_out(r) for r in self.repo.searches(token, tenant_id, limit)])

    def search(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> SearchOut:
        self.data_for(token, tenant_id)
        return search_out(self.repo.search_get(token, tenant_id, search_id))

    # ------------------------------------------------------------------------------------------------------------------- prospects
    def prospects(self, token: str, tenant_id: uuid.UUID, status: str | None, search_id: uuid.UUID | None, limit: int, cursor: str | None) -> ProspectListOut:
        self.data_for(token, tenant_id)
        before: tuple[int, uuid.UUID] | None = None
        if cursor:
            try:
                score, pid = cursor.split("_", 1)
                before = (int(score), uuid.UUID(pid))
            except ValueError:
                raise ApiError(422, "bad_cursor", "That page marker is not valid.") from None
        rows = self.live(token, tenant_id, self.repo.prospects(token, tenant_id, status, search_id, limit, before))
        items = [prospect_out(r) for r in rows]
        nxt = f"{items[-1].fit_score if items[-1].fit_score is not None else -1}_{items[-1].id}" if len(items) == limit else None
        return ProspectListOut(items=items, next_cursor=nxt)

    def prospect(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> ProspectOut:
        self.data_for(token, tenant_id)
        return prospect_out(self.live(token, tenant_id, [self.repo.prospect_get(token, tenant_id, prospect_id)])[0])

    def stats(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID | None) -> StatsOut:
        self.data_for(token, tenant_id)
        return StatsOut.model_validate(self.repo.stats(token, tenant_id, search_id))

    def act(self, token: str, tenant_id: uuid.UUID, body: ActionsIn) -> ActionsOut:
        self.data_for(token, tenant_id)
        results: list[ActionResultOut] = []
        for pid in dict.fromkeys(body.ids):
            try:
                row = self.repo.act(token, tenant_id, pid, body.action)
                results.append(ActionResultOut(id=pid, ok=True, status=row.get("status"), error=None))
            except RepositoryError as exc:
                code = {"ProspectStateError": "prospect_state", "NotFoundError": "not_found"}.get(type(exc).__name__)
                if code is None:
                    raise
                results.append(ActionResultOut(id=pid, ok=False, status=None, error=code))
        return ActionsOut(results=results)

    def redecide(self, token: str, tenant_id: uuid.UUID) -> RedecideOut:
        """Prospects that waited for the calling hours or the day's cap are decided again, and so are those that need the Owner only for a reason that can change (REDECIDE_NEEDS). The worker can call this;
        so can the screen."""
        data = self.data_for(token, tenant_id)
        ctx = self.repo.context(token, tenant_id)
        settings = decide.Settings.from_row(self.repo.settings_get(token, tenant_id))
        stock = self._stock(token, tenant_id, data)
        waiting = int(ctx.get("ready_waiting", 0))
        approved = ctx.get("approved_by_search") or {}
        items: list[dict[str, Any]] = []
        # the ones that waited for the hours or the cap, AND the "needs you" whose cause can change: the first ten calls of a search (the Owner has since said yes to ten), no or low stock match and a
        # middle fit (the catalogue has changed). An Owner's own "ask me later", a competitor and a very large buyer stay with the Owner.
        rows = self.repo.prospects(token, tenant_id, "researching", None, 200, None)
        rows += [r for r in self.repo.prospects(token, tenant_id, "needs_owner", None, 200, None) if r.get("decision_reason") in REDECIDE_NEEDS]
        rows = [r for r in self.live(token, tenant_id, rows) if r.get("details_available") is not False]   # a Google prospect whose details cannot be fetched now is decided again later
        for row in rows:
            d = decide.decide(place_of(row), data, stock, settings,
                              decide.Situation(now=self._clock(), calls_today=int(ctx.get("calls_today", 0)), ready_waiting=waiting, approved_in_search=int(approved.get(str(row.get("search_id")), 0))),
                              owner_approved=bool(row.get("owner_approved")))
            if d.status == "call_ready":
                waiting += 1
            if d.status != row.get("status") or d.reason != row.get("decision_reason"):
                items.append({"id": row["id"], "status": d.status, "decision_reason": d.reason, "fit_score": d.fit, "fit_reason": d.fit_reason, "stock_match": d.stock.as_json()})
        return RedecideOut(changed=self.repo.decisions_apply(token, tenant_id, items) if items else 0)

    # ------------------------------------------------------------------------------------------------------------------- the qualifying call (SIMULATED)
    def simulate_call(self, token: str, tenant_id: uuid.UUID, business: str, prospect_id: uuid.UUID, body: SimulateIn) -> SimulatedCallOut:
        data = self.data_for(token, tenant_id)
        row = self.live(token, tenant_id, [self.repo.prospect_get(token, tenant_id, prospect_id)])[0]
        if row.get("status") != "call_ready" or row.get("suppressed"):
            raise ApiError(409, "prospect_state", "Only a business marked ready to call can be called.")
        if row.get("details_available") is False:
            raise ApiError(409, "details_unavailable", "The business details could not be fetched from Google Maps right now. Try again in a minute.")
        stock = self._stock(token, tenant_id, data)
        buyer, _main = decide.buyer_type_of(place_of(row), data)
        domain = data.persona or ("materials" if data.category_hint in ("contractor", "builder") else "textile")
        result = qualify.simulate(business=business, data=data, stock=stock, language=body.language, persona=body.persona, domain=domain, likely=buyer.likely if buyer else ())
        checks = qualify.evaluate(result, stock)
        call_id = uuid.uuid4()
        final = self.repo.call_finish(token, tenant_id, prospect_id, call_id, result.outcome, result.qualification())
        return SimulatedCallOut(call_id=call_id, prospect=prospect_out(final), persona=body.persona, language=body.language, outcome=result.outcome, end_reason=result.end_reason,
                                summary=result.summary, whatsapp_ok=result.whatsapp_ok, pitched=result.pitched, quote_suggestion=result.quote_suggestion,
                                transcript=[TurnOut(who=t.who, text=t.text, t=t.t) for t in result.turns], evals={c.name: c.passed for c in checks})
