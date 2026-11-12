"""GET /v1/tenants/{tenant_id}/today/summary: the Today page body in one request (contract: docs/contracts/today-summary.md, owner approved 12 Nov 2026).

Every section is an existing route run server-side with the caller's own headers (the same authorization, the same row-level security, the same data, no new logic), in parallel, in two waves: the wave-1 reads, then the
sections that need an answer of wave 1 (`outbox_approvals`, `call_requests`, `call_briefs`, `quote_enquiries`, `lead_desk_batch_items`). One section's state is never all-or-nothing: `ok`, `not_for_you` (the role or the module may not read it),
`slow` (not finished after SOFT_DEADLINE_S: it keeps running and `?only=<name>` joins the same read) or `error`. The sub-requests carry the private per-process header (the page limiter does not count them) and go through the ONE
gate of the process (`internal_gate`, at most 16 at once, shared with bootstrap) so a Today load can never take the threads a live call needs.

Each section's read is kept per signed-in caller for CACHE_S seconds (finished or still running, so ten tabs and a retry are one read) and forgotten when that caller writes (admission.WRITE_HOOKS). Nothing is logged but counts."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict

from app.auth.deps import TenantContext, require_tenant_role
from app.bootstrap.routes import (
    INTERNAL_HEADER,
    PART_TIMEOUT_S,
    SKIPPED_HEADERS,
    STATUS_WORDS,
    internal_gate,
)
from app.hardening import admission

log = logging.getLogger("app.today_summary")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["bootstrap"])
any_member = require_tenant_role()   # any member of the workspace
AnyMember = Annotated[TenantContext, Depends(any_member)]

SOFT_DEADLINE_S = 1.5
CACHE_S = 3.0
MAX_ENTRIES = 400
MAX_NAMES = 30
MAX_BRIEFS = 10
MAX_QUOTE_LOOKUPS = 20
MAX_BATCHES = 5
SETUP_PARALLEL = 4   # setup_progress reads at most this many at once, so a 14-check request never fills the shared gate
SETUP_TTL_S = 60.0
PROPOSAL_DAYS = 61
IST = ZoneInfo("Asia/Kolkata")
NAME = re.compile(r"^[a-z_]{1,40}$")

ALL = frozenset({"owner", "admin", "sales", "viewer"})
STAFF = frozenset({"owner", "admin", "sales"})   # every role except Viewer
DECIDERS = frozenset({"owner", "admin"})


class SectionError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    status: int


class Section(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["ok", "not_for_you", "slow", "error"]
    data: Any | None = None
    error: SectionError | None = None
    retry: str | None = None


class SummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    as_of: dt.datetime
    sections: dict[str, Section]


@dataclass(frozen=True)
class Wave1:
    name: str
    roles: frozenset[str]
    path: str
    ttl: float = CACHE_S


def wave1(today: dt.date) -> list[Wave1]:
    until = today + dt.timedelta(days=PROPOSAL_DAYS)
    return [
        Wave1("today", ALL, "/today"),
        Wave1("agents_status", ALL, "/agents/status"),
        Wave1("visits_today", ALL, "/visits/today"),
        Wave1("visit_slots", ALL, f"/visits/slots?date={today.isoformat()}"),
        Wave1("visits_proposed", STAFF, f"/visits?from={today.isoformat()}&to={until.isoformat()}&status=booked"),
        Wave1("ai_usage_week", DECIDERS, "/ai-usage/week"),
        Wave1("outbox_settings", DECIDERS, "/outbox/settings"),
        Wave1("quotes", ALL, "/quotes?limit=50"),
        Wave1("lead_desk_batches", ALL, "/outreach/batches"),
        Wave1("lead_desk_handoffs", STAFF, "/outreach/handoffs?open=true"),
        Wave1("lead_desk_rules", DECIDERS, "/outreach/rules"),
        Wave1("lead_desk_tasks", DECIDERS, "/tasks?limit=100"),
        Wave1("lead_desk_leads", DECIDERS, "/leads?limit=25"),
        Wave1("lead_finder_prospects", ALL, "/prospects?status=needs_owner&limit=5"),
        Wave1("lead_finder_stats", ALL, "/prospects/stats"),
    ]


def opt_in(today: dt.date) -> list[Wave1]:
    """Sections a caller asks for with `include=` (the first paint of the pack cards): a plain read each, nothing here runs unless it is named. Role: the route itself says 403 -> not_for_you."""
    d = today.isoformat()
    return [
        Wave1("pack_report_today", ALL, f"/reports/run/education.today?from={d}&to={d}"),
        Wave1("campaigns", ALL, "/campaigns?limit=50"),
        Wave1("institution_admissions", ALL, "/institution/admissions?limit=100"),
        Wave1("trips_today", ALL, f"/trips?date={d}"),
        Wave1("material_quotes", ALL, "/materials/quotes?limit=50"),
        Wave1("ledger_summary", ALL, "/ledger/summary?limit=100&party=company"),
        Wave1("example_data", ALL, "/example-data", ttl=30.0),
        Wave1("outcomes_totals", ALL, "/outcomes/totals"),
    ]


SETUP = "setup_progress"
OPT_IN_NAMES = frozenset(w.name for w in opt_in(dt.date(2026, 1, 1))) | {SETUP}
CHECKS = (
    "business_profile", "institution_set", "students_imported", "fee_plan_set", "first_campaign_approved", "lead_source_added", "call_rule_approved",
    "ask_assistant_tried", "delivery_rule_set", "second_factor_set", "catalogue_has_items", "quote_rules_set", "whatsapp_connected", "first_quote_sent",
)

WAVE2 = ("outbox_approvals", "call_requests", "call_briefs", "quote_enquiries", "lead_desk_batch_items")
ORDER = [w.name for w in wave1(dt.date(2026, 1, 1))] + list(WAVE2)


# ---------------------------------------------------------------------------------------------------------------------------- reading
def _failed(status: int, body: Any = None) -> Section:
    code = ""
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        raw = str(body["error"].get("code") or "")
        code = raw if raw.replace("_", "").isalnum() and len(raw) <= 40 else ""
    return Section(state="error", error=SectionError(code=code or STATUS_WORDS.get(status, "error"), status=status))


def _section_of(status: int, body: Any) -> Section:
    if status == 200 and body is not None:
        return Section(state="ok", data=body)
    if status in (403, 404):   # the role may not read it, or the module is not on for this workspace
        return Section(state="not_for_you")
    return _failed(status, body)


@dataclass
class Run:
    """What one request knows: how to read, who is asking and which sections the caller left out."""

    client: httpx.AsyncClient
    gate: asyncio.Semaphore
    headers: dict[str, str]
    base: str
    role: str
    caller: str
    tenant: str
    today: dt.date
    skipped: frozenset[str]
    lane: asyncio.Semaphore | None = None   # a section that must not take many reads at once (setup_progress) reads through its own narrower lane
    memo: dict[tuple[str, bool], asyncio.Task[tuple[int, Any]]] = field(default_factory=dict)   # this request only: the same path is read once, whichever section asks

    async def read(self, path: str, absolute: bool = False) -> tuple[int, Any]:
        """`absolute`: the path is complete, outside the workspace prefix (/v1/account/security)."""
        key = (path, absolute)
        task = self.memo.get(key)
        if task is None:
            task = self.memo[key] = asyncio.get_running_loop().create_task(self._fetch(path, absolute))
        return await asyncio.shield(task)

    async def _fetch(self, path: str, absolute: bool) -> tuple[int, Any]:
        try:
            async with self.lane or contextlib.nullcontext():   # waiting for the lane is not part of the read's own deadline
                async with asyncio.timeout(PART_TIMEOUT_S):
                    async with self.gate:
                        response = await self.client.get(path if absolute else self.base + path, headers=self.headers)
        except TimeoutError:
            return 503, None
        except Exception:   # noqa: BLE001 - one read never fails the others
            return 500, None
        try:
            body = response.json()
        except ValueError:
            body = None
        return response.status_code, body


# ---------------------------------------------------------------------------------------------------------------------------- per-section memory
@dataclass
class Entry:
    task: asyncio.Task[Section | None]
    loop: asyncio.AbstractEventLoop
    done_at: float | None = None
    ttl: float = CACHE_S


_SECTIONS: OrderedDict[tuple[str, str, str], Entry] = OrderedDict()


def reset_sections() -> None:
    _SECTIONS.clear()


def _forget_caller(caller: str) -> None:
    for key in [k for k in _SECTIONS if k[0] == caller]:
        del _SECTIONS[key]


admission.WRITE_HOOKS.append(_forget_caller)


def _reusable(entry: Entry, loop: asyncio.AbstractEventLoop) -> bool:
    if entry.loop is not loop or entry.task.cancelled():
        return False
    if not entry.task.done():
        return True   # still running: join it, no second read
    result = entry.task.result()
    if result is not None and result.state == "error":
        return False
    return (time.monotonic() - (entry.done_at or time.monotonic())) <= entry.ttl


def _task(run: Run, name: str, factory: Callable[[], Awaitable[Section | None]], ttl: float = CACHE_S) -> asyncio.Task[Section | None]:
    loop = asyncio.get_running_loop()
    key = (run.caller, run.tenant, name)
    entry = _SECTIONS.get(key)
    if entry is not None and _reusable(entry, loop):
        _SECTIONS.move_to_end(key)
        return entry.task

    async def guarded() -> Section | None:
        try:
            return await factory()
        except asyncio.CancelledError:
            raise
        except Exception:   # noqa: BLE001 - a crashing section is an error section, never a failed page
            log.error("today_summary section failed: %s", name)
            return _failed(500)

    fresh = Entry(task=loop.create_task(guarded()), loop=loop, ttl=ttl)
    fresh.task.add_done_callback(lambda _t: setattr(fresh, "done_at", time.monotonic()))
    _SECTIONS[key] = fresh
    _SECTIONS.move_to_end(key)
    while len(_SECTIONS) > MAX_ENTRIES:
        _SECTIONS.popitem(last=False)
    return fresh.task


# ---------------------------------------------------------------------------------------------------------------------------- the sections
def _valid_id(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def _needs(today: Section | None) -> list[dict[str, Any]] | None:
    """The needs_you items of an ok `today` answer; None when it is not there to read (then no wave-2 section can be decided)."""
    if today is None or today.state != "ok" or not isinstance(today.data, dict):
        return None
    items = today.data.get("needs_you")
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def _factory_wave1(run: Run, spec: Wave1) -> Callable[[], Awaitable[Section | None]]:
    async def go() -> Section | None:
        if run.role not in spec.roles:
            return Section(state="not_for_you")   # not read at all: the route would only say 403
        return _section_of(*await run.read(spec.path))

    return go


def _factory_wave2(run: Run, name: str, get: Callable[[str], Awaitable[Section | None]]) -> Callable[[], Awaitable[Section | None]]:
    async def read_when(kind: str, path: str) -> Section | None:
        items = _needs(await get("today"))
        if not items or not any(i.get("kind") == kind for i in items):
            return None
        return _section_of(*await run.read(path))

    async def call_briefs() -> Section | None:
        items = _needs(await get("today"))
        ids = [i for i in (_valid_id((it.get("target") or {}).get("id")) for it in (items or []) if it.get("kind") in ("person_requested", "visit_requested")) if i][:MAX_BRIEFS]
        if not ids:
            return None
        if run.role not in STAFF:
            return Section(state="not_for_you")
        out: dict[str, Any] = {}
        for call_id, (status, body) in zip(ids, await asyncio.gather(*(run.read(f"/calls/{i}") for i in ids)), strict=True):
            if status == 200 and isinstance(body, dict):   # a call that could not be read is left out: the section stays ok
                captured = body.get("captured")
                out[call_id] = {"lead_id": body.get("lead_id"), "summary_short": body.get("summary_short"), "visit_at": captured.get("visit_at") if isinstance(captured, dict) else None}
        return Section(state="ok", data=out)

    async def quote_enquiries() -> Section | None:
        today, quotes = await get("today"), await get("quotes")
        items = _needs(today)
        if items is None or quotes is None:
            return None
        recent = today.data.get("recent") if today is not None and isinstance(today.data, dict) else []
        listed = {str(q.get("id")) for q in (quotes.data if quotes.state == "ok" and isinstance(quotes.data, list) else []) if isinstance(q, dict)}
        wanted: list[str] = []
        for it in [*items, *(r for r in (recent if isinstance(recent, list) else []) if isinstance(r, dict))]:
            target = it.get("target") or {}
            qid = _valid_id(target.get("id")) if target.get("type") == "quote" else None
            if qid and qid not in listed and qid not in wanted:
                wanted.append(qid)
        wanted = wanted[:MAX_QUOTE_LOOKUPS]
        if not wanted:
            return None
        out: dict[str, Any] = {}
        for qid, (status, body) in zip(wanted, await asyncio.gather(*(run.read(f"/quotes/{q}") for q in wanted)), strict=True):
            if status == 200 and isinstance(body, dict) and _valid_id(body.get("enquiry_id")):
                out[qid] = str(body["enquiry_id"])
        return Section(state="ok", data=out)

    async def batch_items() -> Section | None:
        batches = await get("lead_desk_batches")
        if batches is None or batches.state != "ok" or not isinstance(batches.data, list):
            return None
        ids = [i for i in (_valid_id((b.get("batch") or {}).get("id")) for b in batches.data if isinstance(b, dict) and (b.get("batch") or {}).get("status") == "running") if i][:MAX_BATCHES]
        if not ids:
            return None
        if run.role not in DECIDERS:
            return Section(state="not_for_you")
        out: dict[str, Any] = {}
        for batch_id, (status, body) in zip(ids, await asyncio.gather(*(run.read(f"/outreach/batches/{i}/items") for i in ids)), strict=True):
            if status == 200 and body is not None:
                out[batch_id] = body
        return Section(state="ok", data=out)

    async def outbox_approvals() -> Section | None:
        return await read_when("outbox_approval", "/outbox/approvals?limit=100")

    async def call_requests() -> Section | None:
        return await read_when("call_approval", "/call-requests?status=requested&limit=100")

    return {"outbox_approvals": outbox_approvals, "call_requests": call_requests, "call_briefs": call_briefs, "quote_enquiries": quote_enquiries, "lead_desk_batch_items": batch_items}[name]


# ---------------------------------------------------------------------------------------------------------------------------- setup_progress
def _rows(body: Any) -> list[Any] | None:
    """The list of a list-route answer: a bare list or {items: [...]}; None when it is neither."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        items = body.get("items")
        if isinstance(items, list):
            return list(items)
    return None


async def _got(run: Run, path: str, absolute: bool = False) -> Any:
    status, body = await run.read(path, absolute)
    return body if status == 200 else None


async def _has_rows(run: Run, path: str, test: Callable[[Any], bool] | None = None) -> bool | None:
    rows = _rows(await _got(run, path))
    if rows is None:
        return None
    return any(test(r) for r in rows) if test else len(rows) > 0


async def _materials_on(run: Run) -> bool:
    body = await _got(run, "/modules")
    mods = body.get("modules") if isinstance(body, dict) else None
    return any(isinstance(m, dict) and m.get("module") == "materials" and m.get("enabled") for m in (mods or []))


async def _either(*reads: Awaitable[bool | None]) -> bool | None:
    """True when any read says yes; False when all say no; None when none could be read (a fact that cannot be read is neither)."""
    got = await asyncio.gather(*reads)
    if any(g is True for g in got):
        return True
    return False if any(g is False for g in got) else None


def _fact(run: Run, check: str) -> Awaitable[bool | None]:
    """One 'is this set up' fact, from existing routes only: the same facts the web reads (apps/web/lib/packs/activation-facts.ts). True / False; None = the read failed."""

    async def profile() -> bool | None:
        body = await _got(run, "/profile")
        return body.get("town") is not None if isinstance(body, dict) else None

    async def institution() -> bool | None:
        body = await _got(run, "/institution/profile")
        return bool(body.get("configured")) if isinstance(body, dict) else None

    async def delivery() -> bool | None:
        body = await _got(run, "/materials/policy")
        return body.get("current") is not None if isinstance(body, dict) else None

    async def second_factor() -> bool | None:
        body = await _got(run, "/v1/account/security", absolute=True)
        return (body.get("second_factor_on") is True or body.get("session_level") == "aal2") if isinstance(body, dict) else None

    async def catalogue() -> bool | None:
        mat = _has_rows(run, "/materials/items?limit=1&include_inactive=true") if await _materials_on(run) else asyncio.sleep(0, None)
        return await _either(mat, _has_rows(run, "/catalogue/items?limit=1&include_inactive=true"))

    async def whatsapp() -> bool | None:
        body = await _got(run, "/whatsapp/account")
        return (bool(body.get("configured")) and body.get("status") == "active") if isinstance(body, dict) else None

    async def first_quote() -> bool | None:
        mat = _has_rows(run, "/materials/quotes?limit=50", lambda q: isinstance(q, dict) and q.get("status") == "approved") if await _materials_on(run) else asyncio.sleep(0, None)
        return await _either(mat, _has_rows(run, "/quotes?limit=50", lambda q: isinstance(q, dict) and q.get("outcome") == "approved"))

    async def lead_source() -> bool | None:
        return await _either(_has_rows(run, "/lead-sources"), _has_rows(run, "/lead-imports?limit=1"))

    table: dict[str, Callable[[], Awaitable[bool | None]]] = {
        "business_profile": profile,
        "institution_set": institution,
        "students_imported": lambda: _has_rows(run, "/institution/students?limit=1"),
        "fee_plan_set": lambda: _has_rows(run, "/institution/fee-plans?include_inactive=true"),
        "first_campaign_approved": lambda: _has_rows(run, "/campaigns?limit=50", lambda c: isinstance(c, dict) and c.get("status") != "draft"),
        "lead_source_added": lead_source,
        "call_rule_approved": lambda: _has_rows(run, "/outreach/rules"),
        "ask_assistant_tried": lambda: _has_rows(run, "/tasks?limit=1"),
        "delivery_rule_set": delivery,
        "second_factor_set": second_factor,
        "catalogue_has_items": catalogue,
        "quote_rules_set": lambda: _has_rows(run, "/quote-policy-versions"),
        "whatsapp_connected": whatsapp,
        "first_quote_sent": first_quote,
    }
    return table[check]()


def _factory_setup(run: Run, checks: tuple[str, ...]) -> Callable[[], Awaitable[Section | None]]:
    async def go() -> Section | None:
        if run.role not in DECIDERS:
            return Section(state="not_for_you")   # a setup list is for the people who set the workspace up
        narrow = replace(run, lane=asyncio.Semaphore(SETUP_PARALLEL))   # same memo and gate, at most SETUP_PARALLEL of its reads at once

        values = await asyncio.gather(*(_fact(narrow, c) for c in checks))
        return Section(state="ok", data=dict(zip(checks, values, strict=True)))

    return go


def _names(raw: str) -> frozenset[str]:
    return frozenset(n for n in raw.split(",")[:MAX_NAMES] if NAME.match(n))


def _client(request: Request) -> httpx.AsyncClient:
    state = request.app.state
    client: httpx.AsyncClient | None = getattr(state, "summary_client", None)
    if client is None:
        # long-lived: a section that is still running after the answer went out must not lose its client
        client = state.summary_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app), base_url="http://internal", headers={"accept": "application/json"})
    return client


@router.get("/today/summary", response_model=SummaryOut)
async def today_summary(request: Request, ctx: AnyMember, response: Response, skip: str = "", only: str = "", include: str = "", checks: str = "") -> SummaryOut:
    """The Today page body: every section is an existing route, run as the caller. `skip=a,b` leaves sections out (not run, absent); `only=a` runs just those and waits for them (the retry of a `slow` section)."""
    response.headers["Cache-Control"] = "no-store"
    started = time.monotonic()
    state = request.app.state
    skipped, only_set = _names(skip), _names(only)
    today = dt.datetime.now(IST).date()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in SKIPPED_HEADERS}
    headers[INTERNAL_HEADER] = str(getattr(state, "internal_token", ""))
    run = Run(
        client=_client(request), gate=internal_gate(state), headers=headers, base=f"/v1/tenants/{ctx.tenant.id}", role=str(getattr(ctx.role, "value", ctx.role)),
        caller=admission.caller_key(request.headers.get("authorization", "").encode()), tenant=str(ctx.tenant.id), today=today, skipped=skipped,
    )
    specs = {w.name: w for w in [*wave1(today), *opt_in(today)]}
    asked = _names(include) | (only_set & OPT_IN_NAMES)   # opt-in sections run only when named (a retry by `only=` names it)
    wanted_checks = tuple(c for c in CHECKS if c in _names(checks))

    async def get(name: str) -> Section | None:
        """A section another one needs: its own read (shared, not run twice); None when the caller skipped it."""
        if name in skipped:
            return None
        return await _task(run, name, _factory_wave1(run, specs[name]))

    wanted = [n for n in [*ORDER, *(w.name for w in opt_in(today)), SETUP] if n not in skipped and (not only_set or n in only_set) and (n not in OPT_IN_NAMES or n in asked)]
    if SETUP in wanted and not wanted_checks:
        wanted.remove(SETUP)   # nothing asked for: absent
    tasks = {}
    for n in wanted:
        if n == SETUP:   # one memory entry per set of checks
            tasks[n] = _task(run, f"{SETUP}|{','.join(wanted_checks)}", _factory_setup(run, wanted_checks), SETUP_TTL_S)
        elif n in specs:
            tasks[n] = _task(run, n, _factory_wave1(run, specs[n]), specs[n].ttl)
        else:
            tasks[n] = _task(run, n, _factory_wave2(run, n, get))
    if tasks:
        if only_set:
            await asyncio.wait(tasks.values())   # the retry waits (each read has its own hard deadline)
        else:
            await asyncio.wait(tasks.values(), timeout=SOFT_DEADLINE_S)
    sections: dict[str, Section] = {}
    for name, task in tasks.items():
        if not task.done():
            sections[name] = Section(state="slow", retry=f"/today/summary?only={name}" + (f"&checks={','.join(wanted_checks)}" if name == SETUP else ""))
        elif task.cancelled():
            sections[name] = _failed(503)
        else:
            result = task.result()
            if result is not None:   # None = a wave-2 section with nothing to say: absent
                sections[name] = result
    counts = {s: sum(1 for x in sections.values() if x.state == s) for s in ("ok", "not_for_you", "slow", "error")}
    log.info("today_summary ok=%d slow=%d error=%d not_for_you=%d ms=%d", counts["ok"], counts["slow"], counts["error"], counts["not_for_you"], int((time.monotonic() - started) * 1000))
    return SummaryOut(as_of=dt.datetime.now(dt.UTC), sections=sections)
