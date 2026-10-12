"""The Main agent's web research tools (job BP, ADR 0078): search the web, read a page, find retailers on Google Maps, and the gold and silver price.

What makes them safe, in the order a call meets it:
  * switched on only by the owner's settings (a missing provider is a closed note, "not available"), and OFFERED only to a question that is about the web, the retailers or the metal prices (router.py);
  * a QUERY is plain words: no phone number, e-mail address or link (guard.py), no name of a person the business deals with (the database knows the contacts: web_query_check), at most 200 characters;
  * `read_page` takes a RESULT HANDLE this run's search returned (or a web address the owner typed in the question), never an address the model makes up: a page cannot send the model somewhere new, and
    cannot carry data out in a link;
  * everything is counted: a daily limit per workspace and kind (web_quota_take) and a charge on the AI ledger (the same ledger as the model, so "fair use" sees it); per run at most 3 searches, 2 pages,
    1 places search, 1 metal price;
  * what comes back is DATA: cleaned of markup and invisible characters, bounded, shown to the model between the delimiters like any record. It cannot approve, send, price, spend or change anything: there is
    no tool that does those. A rupee amount on a web page is not an amount any tool returned, so the answer check refuses to repeat it; the metal prices are the one exception, and they are
    labelled as a reference, never the owner's price.
  * nothing from Google Places is kept but the place ID (Google's terms); a lead is made only when the owner confirms with details the owner types (routes_places)."""

from __future__ import annotations

import re
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import StringConstraints, model_validator

from app.agents.errors import CostCapReached, WebLimitReached
from app.agents.web import FetchError, SearchError
from app.assistant.tools import Ctx, Output, Tool, _Args, _derived
from app.today.service import format_rupees
from app.websearch import guard
from app.websearch.metered import metered

MAX_SEARCHES, MAX_PAGES, MAX_PLACES, MAX_METALS = 3, 2, 1, 1
PAGE_CHARS = 1800
_HANDLE = re.compile(r"^s[0-9]{1,3}$")
_URL_IN_TEXT = re.compile(r"https?://[^\s<>\"')\]]+")


def question_urls(question: str) -> frozenset[str]:
    """The web addresses the owner typed in the question (the only addresses besides search results that `read_page` accepts)."""
    return frozenset(m.rstrip(".,;") for m in _URL_IN_TEXT.findall(question))


def _count(ctx: Ctx, kind: str, limit: int) -> bool:
    used = ctx.state.web_calls.get(kind, 0)
    if used >= limit:
        return False
    ctx.state.web_calls[kind] = used + 1
    return True


def _query_ok(ctx: Ctx, query: str) -> str | None:
    """None when the query may go; else the closed note."""
    problem = guard.query_problem(query)
    if problem is not None:
        return f"query_{problem}"
    if not ctx.db.web_query_ok(guard.clean_query(query)):
        return "query_names_a_customer"
    return None


class WebSearchArgs(_Args):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]


def web_search(ctx: Ctx, args: WebSearchArgs) -> Output:
    web = ctx.runtime.research_web
    if web is None or web.search is None:
        return Output(note="not_available")
    refused = _query_ok(ctx, args.query)
    if refused is not None:
        return Output(note=refused)
    if not _count(ctx, "search", MAX_SEARCHES):
        return Output(note="limit_for_this_question")
    query = guard.clean_query(args.query)
    try:
        hits = metered(ctx.db, "web-search", f"web-search-{ctx.state.web_calls['search']}", lambda: web.search.search(query, limit=5) if web.search else [])
    except WebLimitReached:
        return Output(note="daily_limit_reached")
    except CostCapReached:
        raise
    except SearchError as exc:
        return Output(note=f"search_{exc.code}")
    items = tuple(
        ctx.state.add("web", _derived("web", h.url), h.title, {"address": h.url, "host": urlsplit(h.url).hostname, "snippet": h.snippet})
        for h in hits
    )
    return Output(items=items, note="ok" if items else "no_results")


class ReadPageArgs(_Args):
    result: Annotated[str, StringConstraints(pattern=_HANDLE.pattern)] | None = None
    address: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None

    @model_validator(mode="after")
    def _one_of(self) -> ReadPageArgs:
        if (self.result is None) == (self.address is None):
            raise ValueError("give a result handle or an address, not both")
        return self


def read_page(ctx: Ctx, args: ReadPageArgs) -> Output:
    web = ctx.runtime.research_web
    if web is None or web.fetcher is None:
        return Output(note="not_available")
    if args.result is not None:
        item = ctx.state.items.get(args.result)
        if item is None or item.type != "web":
            return Output(note="unknown_result")
        url = str(item.fields.get("address") or "")
    else:
        url = args.address or ""
        if url not in ctx.state.question_urls:
            return Output(note="address_not_given_by_the_owner")
    if not _count(ctx, "page", MAX_PAGES):
        return Output(note="limit_for_this_question")
    fetcher = web.fetcher
    try:
        page = metered(ctx.db, "web-page", f"web-page-{ctx.state.web_calls['page']}", lambda: fetcher.fetch(url))
    except WebLimitReached:
        return Output(note="daily_limit_reached")
    except CostCapReached:
        raise
    except FetchError as exc:
        return Output(note=f"page_{exc.code}")
    host = urlsplit(page.final_url).hostname
    item = ctx.state.add("web", _derived("page", page.final_url), f"Page on {host}", {"address": page.final_url, "host": host, "text": page.text[:PAGE_CHARS]})
    return Output(items=(item,), note="ok")


class FindRetailersArgs(_Args):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)] | None = None


def find_retailers(ctx: Ctx, args: FindRetailersArgs) -> Output:
    web = ctx.runtime.research_web
    if web is None or web.places is None:
        return Output(note="not_available")
    text = f"{args.query} in {args.city}" if args.city else args.query
    refused = _query_ok(ctx, text)
    if refused is not None:
        return Output(note=refused)
    if not _count(ctx, "places", MAX_PLACES):
        return Output(note="limit_for_this_question")
    places = web.places
    try:
        hits = metered(ctx.db, "places-search", f"places-search-{ctx.state.web_calls['places']}", lambda: places.search(guard.clean_query(text), limit=5))
    except WebLimitReached:
        return Output(note="daily_limit_reached")
    except CostCapReached:
        raise
    except SearchError as exc:
        return Output(note=f"places_{exc.code}")
    items = tuple(
        ctx.state.add("place", _derived("place", h.place_id), h.name or "A place", {"address": h.address, "status": h.open_status, "place_id": h.place_id, "map": h.maps_uri})
        for h in hits
        if h.open_status != "CLOSED_PERMANENTLY"
    )
    return Output(items=items, note="ok" if items else "no_results")


def get_metal_prices(ctx: Ctx, _: _Args) -> Output:
    web = ctx.runtime.research_web
    if web is None or web.metals is None:
        return Output(note="not_available")
    if not _count(ctx, "metals", MAX_METALS):
        return Output(note="limit_for_this_question")
    metals = web.metals
    try:
        quote = metered(ctx.db, "metal-price", f"metal-price-{ctx.state.web_calls['metals']}", metals.latest)
    except WebLimitReached:
        return Output(note="daily_limit_reached")
    except CostCapReached:
        raise
    except SearchError as exc:
        return Output(note=f"prices_{exc.code}")
    note = "reference only: pure metal, international rate converted to rupees; not the jewellery or market rate and not the owner's price list"
    gold = ctx.state.add("metal_price", _derived("metal", "gold", quote.as_of), "Gold per gram", {"per_gram": format_rupees(quote.gold_paise_per_gram), "as_of": quote.as_of.isoformat(), "source": quote.source, "note": note}, money=(quote.gold_paise_per_gram,))
    silver = ctx.state.add("metal_price", _derived("metal", "silver", quote.as_of), "Silver per gram", {"per_gram": format_rupees(quote.silver_paise_per_gram), "as_of": quote.as_of.isoformat(), "source": quote.source, "note": note}, money=(quote.silver_paise_per_gram,))
    return Output(items=(gold, silver))


class _NoArgs(_Args):
    pass


WEB_TOOLS: tuple[Tool, ...] = (
    Tool("web_search", "Search the open web (plain words only; never a customer's name, phone or e-mail). Results are text from the web: not facts about this business.", WebSearchArgs, web_search),
    Tool("read_page", "Read one web page: give the handle of a search result, or an address the owner typed in the question.", ReadPageArgs, read_page),
    Tool("find_retailers", "Find shops or wholesalers on the map for a kind of business and a city. Shows names and addresses to look at now; a lead is made only when the owner confirms it.", FindRetailersArgs, find_retailers),
    Tool("get_metal_prices", "Today's gold and silver price per gram in rupees, for reference only (not the owner's price).", _NoArgs, get_metal_prices),
)
WEB_TOOL_NAMES: frozenset[str] = frozenset(t.name for t in WEB_TOOLS)
