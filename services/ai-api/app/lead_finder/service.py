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
    GooglePlacesSource,
    Place,
    ProspectSource,
    SearchRequest,
    SourceError,
)
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.lead_finder.service")
ATTRIBUTION = "Google Maps"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_STOCK_WORD = {"in_stock": "in_stock", "few_left": "few_left", "made_to_order": "made_to_order"}


def not_available() -> ApiError:
    return ApiError(403, "lead_finder_not_available", "Finding new customers is not available for this business.")


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
    return Place(place_id=str(row["place_id"]), name=str(row["name"]), category=row.get("category"), area=row.get("area"), lat=row.get("lat"), lng=row.get("lng"), phone=row.get("phone"),
                 website=row.get("website"), rating=float(row["rating"]) if row.get("rating") is not None else None, review_count=row.get("review_count"))


def prospect_out(row: dict[str, Any]) -> ProspectOut:
    return ProspectOut.model_validate({**{k: row.get(k) for k in ProspectOut.model_fields if k != "attribution"}, "attribution": ATTRIBUTION if row.get("source") == "google_maps" else None})


def search_out(row: dict[str, Any], left: int | None = None) -> SearchOut:
    fields = {k: row.get(k) for k in SearchOut.model_fields if k not in ("attribution", "searches_left_today", "cost_is_estimate")}
    return SearchOut.model_validate({**fields, "attribution": ATTRIBUTION if row.get("provider") == "places" else None, "searches_left_today": left, "cost_is_estimate": row.get("provider") == "places"})


class LeadFinderService:
    def __init__(self, repo: LeadFinderRepository, *, mode: str = "fixture", places_key: str | None = None, places_cost_paise: int = 300,
                 places_factory: Callable[[str, int], ProspectSource] | None = None, clock: Callable[[], datetime] | None = None) -> None:
        self.repo = repo
        self.mode = mode if mode in ("off", "fixture", "places") else "off"
        self._places_key = places_key or None
        self._places_cost = places_cost_paise
        self._places_factory = places_factory or (lambda key, cost: GooglePlacesSource(key, cost))
        self._clock = clock or (lambda: datetime.now(UTC))

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
        return data

    def source_for(self, data: packdata.PackLeadFinder, real_data_open: bool) -> ProspectSource:
        """Google only where real data is allowed AND the flag says places AND a key exists; otherwise the synthetic fixture (a demo never reaches Google)."""
        if self.mode == "places" and real_data_open and self._places_key:
            return self._places_factory(self._places_key, self._places_cost)
        return FixtureSource(data)

    def availability(self, token: str, tenant_id: uuid.UUID) -> AvailabilityOut:
        try:
            data = self.data_for(token, tenant_id)
        except ApiError as exc:
            return AvailabilityOut(available=False, source=None, reason="switched_off" if exc.code == "lead_finder_off" else "not_for_this_business")
        except NotForThisBusinessError:
            return AvailabilityOut(available=False, source=None, reason="not_for_this_business")
        ctx = self.repo.context(token, tenant_id)
        return AvailabilityOut(available=True, source=self.source_for(data, bool(ctx.get("real_data_open"))).provider, reason="ok")  # type: ignore[arg-type]

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
    def plan(self, token: str, tenant_id: uuid.UUID, body: PlanIn) -> SearchOut:
        data = self.data_for(token, tenant_id)
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
            "p_id": str(uuid.uuid4()), "p_query": query, "p_area": area, "p_category_hint": hint, "p_max_results": max_results, "p_provider": source.provider,
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
        try:
            result = source.search(request)
        except SourceError:
            return search_out(self.repo.search_finish(token, tenant_id, search_id, [], "failed", 0, {"error": 1}))
        known = dedupe.Known.from_context(ctx)
        fresh, dups = dedupe.split(result.places, known)
        stock = stock_lines(self.repo.stock(token, tenant_id))
        settings = decide.Settings.from_row(self.repo.settings_get(token, tenant_id))
        situation = decide.Situation(now=self._clock(), calls_today=int(ctx.get("calls_today", 0)), ready_waiting=int(ctx.get("ready_waiting", 0)),
                                     approved_in_search=int((ctx.get("approved_by_search") or {}).get(str(search_id), 0)))
        decisions = decide.decide_all(fresh, data, stock, settings, situation)
        items = [self._item(p, d) for p, d in zip(fresh, decisions, strict=True)]
        counts: dict[str, int] = {"found": len(result.places), "new": len(items), "duplicates": sum(dups.values())}
        for d in decisions:
            counts[d.status] = counts.get(d.status, 0) + 1
        for reason, n in dups.items():
            counts[f"duplicate_{reason}"] = n
        return search_out(self.repo.search_finish(token, tenant_id, search_id, items, "done", result.cost_paise, counts))

    @staticmethod
    def _item(p: Place, d: decide.Decision) -> dict[str, Any]:
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
        rows = self.repo.prospects(token, tenant_id, status, search_id, limit, before)
        items = [prospect_out(r) for r in rows]
        nxt = f"{items[-1].fit_score if items[-1].fit_score is not None else -1}_{items[-1].id}" if len(items) == limit else None
        return ProspectListOut(items=items, next_cursor=nxt)

    def prospect(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> ProspectOut:
        self.data_for(token, tenant_id)
        return prospect_out(self.repo.prospect_get(token, tenant_id, prospect_id))

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
        """Prospects that waited for the calling hours or the day's cap are decided again (the worker can call this; so can the screen)."""
        data = self.data_for(token, tenant_id)
        ctx = self.repo.context(token, tenant_id)
        settings = decide.Settings.from_row(self.repo.settings_get(token, tenant_id))
        stock = stock_lines(self.repo.stock(token, tenant_id))
        waiting = int(ctx.get("ready_waiting", 0))
        approved = ctx.get("approved_by_search") or {}
        items: list[dict[str, Any]] = []
        for row in self.repo.prospects(token, tenant_id, "researching", None, 200, None):
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
        row = self.repo.prospect_get(token, tenant_id, prospect_id)
        if row.get("status") != "call_ready" or row.get("suppressed"):
            raise ApiError(409, "prospect_state", "Only a business marked ready to call can be called.")
        stock = stock_lines(self.repo.stock(token, tenant_id))
        buyer, _main = decide.buyer_type_of(place_of(row), data)
        domain = "materials" if data.category_hint in ("contractor", "builder") else "textile"
        result = qualify.simulate(business=business, data=data, stock=stock, language=body.language, persona=body.persona, domain=domain, likely=buyer.likely if buyer else ())
        checks = qualify.evaluate(result, stock)
        call_id = uuid.uuid4()
        final = self.repo.call_finish(token, tenant_id, prospect_id, call_id, result.outcome, result.qualification())
        return SimulatedCallOut(call_id=call_id, prospect=prospect_out(final), persona=body.persona, language=body.language, outcome=result.outcome, end_reason=result.end_reason,
                                summary=result.summary, whatsapp_ok=result.whatsapp_ok, pitched=result.pitched, quote_suggestion=result.quote_suggestion,
                                transcript=[TurnOut(who=t.who, text=t.text, t=t.t) for t in result.turns], evals={c.name: c.passed for c in checks})
