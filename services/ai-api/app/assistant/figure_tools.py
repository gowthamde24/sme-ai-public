"""The Main agent's figure tool (job DG): the business's own TOTALS and COUNTS for the two business types that keep a ledger or run trips, read from the reports of every pack (job CV, `report_run`).

  * `get_figures("school_fees", period)`: a school's fees: collected in the period, pending now, due to date, the collection percentage and how many families still owe, then the pending amount and family count per class
    (the programme names are the school's own words);
  * `get_figures("site_dues_and_trips")`: a construction business's money owed (outstanding, overdue, how many customers owe) and today's deliveries (trips, delivered, problems).

What makes it safe, in the order a call meets it:
  * it reads only through `report_run`, the one door of the reports (the caller's own token, the database checks the role and that the module is on for this business: otherwise a closed note "not available");
  * a report holds counts and sums, never a person: no child, no guardian, no customer is named by anything this tool can read, and no code here reads one (tests/test_dg_figure_tools.py runs it over a report that is full of
    canaries and proves not one reaches the output; the structural rule of tests/test_cr_child_fields.py, that no assistant module names a child column or the education repository, still holds: this file does not);
  * what comes back is DATA like any record, bounded (at most six classes), and every rupee figure is added to the amounts an answer may repeat, so the answer check passes exactly those numbers and no other;
  * it is a read tool: it approves, sends, prices and changes nothing."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from app.assistant.tools import Ctx, Item, Output, Tool, _Args, _derived
from app.errors import ApiError
from app.packs.errors import ModuleOffError
from app.tenancy.repository import RepositoryError
from app.today.service import format_rupees

IST = timezone(timedelta(hours=5, minutes=30))
MAX_CLASSES = 6
_PERIOD_WORDS = {"today": "today", "this_week": "this week", "this_month": "this month"}


class FigureArgs(_Args):
    topic: Literal["school_fees", "site_dues_and_trips"]
    period: Literal["today", "this_week", "this_month"] = "this_month"


def _kpis(report: dict[str, Any]) -> dict[str, int | float]:
    """The report's headline figures by key: only numbers."""
    out: dict[str, int | float] = {}
    for entry in report.get("kpis") or []:
        value = entry.get("value")
        if isinstance(entry.get("key"), str) and isinstance(value, (int, float)) and not isinstance(value, bool):
            out[entry["key"]] = value
    return out


def _rows(report: dict[str, Any], table: str) -> list[list[Any]]:
    for t in report.get("tables") or []:
        if t.get("key") == table:
            return [r for r in (t.get("rows") or []) if isinstance(r, list)]
    return []


def _count_key(kpis: dict[str, int | float], exclude: frozenset[str]) -> int:
    """The one count in a report's headline figures (its unit is declared by the report, so no field is named here)."""
    return int(next((v for k, v in kpis.items() if k not in exclude and not k.endswith("_paise") and not k.endswith("_pct")), 0))


def _period_start(today: date, period: str) -> date:
    if period == "today":
        return today
    if period == "this_week":
        return today - timedelta(days=today.weekday())  # India's week starts on Monday
    return today.replace(day=1)


def _school_fees(ctx: Ctx, period: str, today: date) -> Output:
    reports = ctx.runtime.reports
    if reports is None:
        return Output(note="unavailable")
    start = _period_start(today, period)
    try:
        collection = reports.run(ctx.token, ctx.tenant, "education.collection", start, today)
        pending = reports.run(ctx.token, ctx.tenant, "education.pending", None, today)
    except ModuleOffError:
        return Output(note="not_available")
    except (RepositoryError, ApiError):
        return Output(note="unavailable")
    k = _kpis(collection)
    p = _kpis(pending)
    collected, due, owed = int(k.get("collected_paise", 0)), int(k.get("due_paise", 0)), int(p.get("pending_paise", k.get("pending_paise", 0)))
    families = _count_key(p, frozenset()) or _count_key(k, frozenset({"collection_pct"}))
    summary = ctx.state.add(
        "report",
        _derived("school_fees", ctx.tenant, period, today),
        f"School fees, {_PERIOD_WORDS[period]}",
        {
            "collected_in_period": format_rupees(collected),
            "fees_pending_now": format_rupees(owed),
            "fees_due_to_date": format_rupees(due),
            "collected_percent": f"{k.get('collection_pct', 0)}%",
            "families_with_fees_pending": families,
            "as_of": today.isoformat(),
            "period_from": start.isoformat(),
        },
        money=(collected, owed, due),
    )
    items: list[Item] = [summary]
    for row in _rows(pending, "by_programme")[:MAX_CLASSES]:
        if len(row) >= 3 and isinstance(row[0], str) and isinstance(row[1], int) and isinstance(row[2], int):
            items.append(
                ctx.state.add(
                    "report",
                    _derived("school_fees_class", ctx.tenant, row[0], today),
                    f"Pending in {row[0]}"[:80],
                    {"fees_pending": format_rupees(row[2]), "families_pending": row[1]},
                    money=(row[2],),
                )
            )
    return Output(items=tuple(items))


def _site_dues_and_trips(ctx: Ctx, today: date) -> Output:
    reports = ctx.runtime.reports
    if reports is None:
        return Output(note="unavailable")
    try:
        dues = reports.run(ctx.token, ctx.tenant, "construction.dues_ageing", None, today)
        trips = reports.run(ctx.token, ctx.tenant, "construction.trips_per_day", today, today)
    except ModuleOffError:
        return Output(note="not_available")
    except (RepositoryError, ApiError):
        return Output(note="unavailable")
    d, t = _kpis(dues), _kpis(trips)
    outstanding, overdue = int(d.get("outstanding_paise", 0)), int(d.get("overdue_paise", 0))
    owed_by = ctx.state.add(
        "report",
        _derived("site_dues", ctx.tenant, today),
        "Money owed to the business",
        {
            "outstanding": format_rupees(outstanding),
            "overdue": format_rupees(overdue),
            "customers_owing": int(d.get("customers_owing", 0)),
            "as_of": today.isoformat(),
        },
        money=(outstanding, overdue),
    )
    deliveries = ctx.state.add(
        "report",
        _derived("site_trips", ctx.tenant, today),
        "Deliveries today",
        {
            "trips_planned_today": int(t.get("trips", 0)),
            "delivered": int(t.get("delivered", 0)),
            "with_a_problem": int(t.get("problems", 0)),
            "cancelled": int(t.get("cancelled", 0)),
            "date": today.isoformat(),
        },
    )
    return Output(items=(owed_by, deliveries))


def get_figures(ctx: Ctx, args: FigureArgs) -> Output:
    today = datetime.now(IST).date()
    if args.topic == "school_fees":
        return _school_fees(ctx, args.period, today)
    return _site_dues_and_trips(ctx, today)


FIGURE_TOOLS: tuple[Tool, ...] = (
    Tool(
        "get_figures",
        "Totals and counts only, never a person's name: topic school_fees = a school's fees (collected in the period, pending now, how many families still owe, pending per class); "
        "topic site_dues_and_trips = a construction business's money owed (outstanding, overdue, customers owing) and today's deliveries. For a question about fees, dues, collections or trips.",
        FigureArgs,
        get_figures,
    ),
)
FIGURE_TOOL_NAMES: frozenset[str] = frozenset(t.name for t in FIGURE_TOOLS)
