"""This week on the Jobs list (planner, 25 Nov 2026; docs/contracts/jobs-week.md): per job the last seven days in whole numbers, so a row can say "last week 12 calls, 3 visits".

It is the job page's `results.numbers` (the same readers, the same closed keys) plus the one job that had none: `answer_calls` counts the calls the assistant answered, from the same call list the Calls screen reads. `calls` and `visits` are
the two numbers every row may show; they are null when the job has no such thing (a follow-up job makes no call). `cost` is null on purpose: money is only metered for the whole month, never per job, and a made-up number would be worse than none.
A job that cannot be read gives null numbers; the list never fails for them."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from app.jobs import catalogue, listing, results

logger = logging.getLogger("app.jobs")
DAYS = results.DAYS


def _answer_calls(env: Any, now: datetime) -> dict[str, int]:
    service = env.runtime.calls
    if service is None:
        return {}
    since = now - timedelta(days=DAYS)
    seen = service.list(env.token, env.tenant_id, "all", 100, None).items
    mine = [c for c in seen if c.direction == "inbound" and c.answered_at is not None and c.created_at >= since and not c.simulated]
    return {"answered": len(mine), "minutes": -(-sum(int(c.duration_s or 0) for c in mine) // 60)}


def _calls_visits(kind: str, numbers: dict[str, int]) -> tuple[int | None, int | None]:
    if kind == "speed_to_lead":
        return numbers.get("called"), numbers.get("visits")
    if kind == "answer_calls":
        return numbers.get("answered"), None
    if kind == "store_visits":
        return None, numbers.get("booked")
    return None, None


def week_of(env: Any, kind: str, now: datetime | None = None) -> dict[str, Any]:
    moment = now or datetime.now(UTC)
    numbers: dict[str, int] = {}
    try:
        numbers = _answer_calls(env, moment) if kind == "answer_calls" else dict(results.results_of(env, kind, moment).get("numbers") or {})
    except Exception as err:   # noqa: BLE001 - a nicety: the list opens without it
        logger.info("jobs week: %s not readable (%s)", kind, type(err).__name__)
    calls, visits = _calls_visits(kind, numbers)
    return {"calls": calls, "visits": visits, "cost": None, "numbers": numbers}


def _kinds(runtime: Any, token: str, tenant_id: Any) -> list[str]:
    """The kinds this business has, in the contract's order. Only the researcher can be missing (a school never has it): one cheap question, not the whole job list (which also reads Today)."""
    out = [k for k in listing.KINDS if k != "researcher"]
    try:
        seen = runtime.lead_finder.availability(token, tenant_id) if runtime.lead_finder is not None else None
    except Exception:   # noqa: BLE001 - not readable: leave the job out, like a business that never has it
        seen = None
    if seen is not None and seen.reason != "not_for_this_business":
        out.append("researcher")
    return out


def week_all(runtime: Any, ctx: Any, now: datetime | None = None) -> dict[str, Any]:
    """One row per job. The jobs are read side by side (each one is a few calls to its own subsystem): the page takes as long as the slowest, not the sum (staging 25 Nov: 1.3 s p95 one after another)."""
    env0 = catalogue.Env(runtime=runtime, ctx=ctx)
    kinds = _kinds(runtime, env0.token, env0.tenant_id)
    with ThreadPoolExecutor(max_workers=len(kinds)) as pool:
        rows = list(pool.map(lambda k: week_of(catalogue.Env(runtime=runtime, ctx=ctx), k, now), kinds))
    return {"days": DAYS, "items": [{"id": str(listing.job_id(env0.tenant_id, k)), "kind": k, **row} for k, row in zip(kinds, rows, strict=True)]}
