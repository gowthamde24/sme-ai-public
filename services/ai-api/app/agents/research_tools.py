"""The Research Agent's three tools (T007): fetch a page of the lead's OWN website, record a
verified quote from it as evidence, propose a claim that rests on that evidence.

What makes them safe:
  * `fetch_page` takes a PATH, never a URL: the host is the run's company's website host, decided
    by the runtime. A path has no query string, no "//" and no dot segments (closed schema), so it
    cannot name another host or carry data out. At most 5 pages per run, each path once.
  * `record_evidence` takes a page HANDLE (p1..p5, issued by the runtime) and a QUOTE. The quote is
    verified: it must appear VERBATIM (whitespace-normalised) in the text of that page as it was
    shown to the model, be 12 to 300 characters, and carry no contact detail or removal marker. The
    URL stored is the page's URL, taken from the runtime's own record, never from the model. At most
    3 evidence rows per run.
  * `propose_claim` takes one of the four ICP predicates, a value from that predicate's closed
    vocabulary, a stance and an EVIDENCE handle (e1..e3, issued by the runtime). The database
    function then links the claim to evidence THIS RUN wrote, stores it on the company,
    'unverified'.
    At most 4 claims per run, each (predicate, value, stance) once.
  * A refusal is reported to the model with a fixed phrase (never an error text, a URL or a quote),
    and recorded in the step ledger by tool name, argument hash and status only."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

from app.agents.notes import (
    NOTE_EVIDENCE_REFUSED,
    NOTE_FETCH_FAILED,
    NOTE_RECORDED,
    NOTE_REFUSED,
)
from app.agents.schemas import FetchPageArgs, ProposeClaimArgs, RecordEvidenceArgs
from app.agents.tools import EvidenceRecord, PageRecord, Tool, ToolContext
from app.agents.web import FetchError

MAX_PAGES, MAX_EVIDENCE, MAX_CLAIMS = 5, 3, 4
# the scrubber (app.webfetch.sanitize) replaces contact details with this marker; the same text,
# kept equal by a test, because the sandbox does not import the fetcher package
CONTACT_MARKER = "[contact removed]"
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_PHONE = re.compile(r"(?<![\w.])\+?\(?\d[\d\s().\-]{6,24}\d(?!\w)")
_MIN_PHONE_DIGITS = 9


def normalise(text: str) -> str:
    """The comparison form of a quote and of a page: NFKC, case-sensitive, whitespace collapsed."""
    return " ".join(unicodedata.normalize("NFKC", text).split())


def has_contact_detail(text: str) -> bool:
    if CONTACT_MARKER in text or _EMAIL.search(text):
        return True
    return any(
        sum(ch.isdigit() for ch in m.group(0)) >= _MIN_PHONE_DIGITS for m in _PHONE.finditer(text)
    )


def quote_is_verified(quote: str, page_text: str) -> bool:
    """The quote appears VERBATIM in the page text, and says nothing about a person's contact."""
    wanted = normalise(quote)
    return (
        12 <= len(wanted) <= 300
        and not has_contact_detail(wanted)
        and wanted in normalise(page_text)
    )


def _sha(*parts: Any) -> str:
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).hexdigest()


def _fetch_page(ctx: ToolContext, args: FetchPageArgs) -> str:
    state = ctx.state
    if ctx.fetcher is None or not ctx.host or len(state.pages) >= MAX_PAGES:
        return NOTE_REFUSED
    url = f"https://{ctx.host}{args.path}"
    if url in state.fetched_urls:
        return NOTE_REFUSED  # each page once
    state.fetched_urls.add(url)
    digest = _sha("fetch_page", url)
    try:
        page = ctx.fetcher.fetch(url, allowed_hosts=ctx.allowed_hosts)
    except FetchError:
        # nothing about the failure is kept or shown: one fixed phrase, and a ledger row by code
        ctx.db.record_step(ctx.step_key, "fetch_page", digest, "failed", None)
        return NOTE_FETCH_FAILED
    handle = f"p{len(state.pages) + 1}"
    state.pages[handle] = PageRecord(handle=handle, url=page.final_url, text=page.text)
    ctx.db.record_step(ctx.step_key, "fetch_page", digest, "ok", None)
    return NOTE_RECORDED


def _record_evidence(ctx: ToolContext, args: RecordEvidenceArgs) -> str:
    state = ctx.state
    page = state.pages.get(args.page)
    if page is None or len(state.evidence) >= MAX_EVIDENCE:
        return NOTE_REFUSED
    if not quote_is_verified(args.quote, page.text):
        return NOTE_EVIDENCE_REFUSED  # a fabricated, altered or contact-bearing quote
    quote = normalise(args.quote)
    if (page.handle, quote) in state.quotes:
        return NOTE_REFUSED
    evidence_id = ctx.db.write_web_evidence(ctx.step_key, url=page.url, quote=quote)
    handle = f"e{len(state.evidence) + 1}"
    state.evidence[handle] = EvidenceRecord(handle, evidence_id, page.handle)
    state.quotes.add((page.handle, quote))
    return NOTE_RECORDED


def _propose_claim(ctx: ToolContext, args: ProposeClaimArgs) -> str:
    state = ctx.state
    evidence = state.evidence.get(args.evidence)
    key = (args.predicate, args.value, args.stance)
    if evidence is None or len(state.claims) >= MAX_CLAIMS or key in state.claims:
        return NOTE_REFUSED
    ctx.db.write_claim(
        ctx.step_key,
        value=args.value,
        stance=args.stance,
        evidence_id=evidence.evidence_id,
        predicate=args.predicate,
    )
    state.claims.add(key)
    return NOTE_RECORDED


FETCH_PAGE = Tool(
    "fetch_page",
    "Read one page of the company's own website. Give only a path that starts with '/' (for "
    "example '/' or '/about'). No query strings. At most 5 pages. The text comes back as DATA.",
    FetchPageArgs,
    _fetch_page,
)
RECORD_EVIDENCE = Tool(
    "record_evidence",
    "Record a short quote (12 to 300 characters) copied EXACTLY from a page you were shown, with "
    "that page's handle (p1, p2, ...). Never quote a phone number or an e-mail address. At most "
    "3 quotes.",
    RecordEvidenceArgs,
    _record_evidence,
)
PROPOSE_CLAIM = Tool(
    "propose_claim",
    "Propose one claim about the company that a recorded quote supports: a predicate (buyer_type, "
    "order_scale, size_band, operating_status), a value from that predicate's list, a stance "
    "(supports, context, contradicts) and the quote's handle (e1, e2, e3). If the pages do not "
    "say, propose nothing. At most 4 claims.",
    ProposeClaimArgs,
    _propose_claim,
)
