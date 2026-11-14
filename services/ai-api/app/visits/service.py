"""The visits' rules that are not the database's: shaping rows into the API's answers, the short name the Today page shows, the opening hours in and out, and the stable ids of the messages a
visit makes (so a retry replays instead of sending twice).

The database decides everything about a visit (slots, capacity, the steps, the order, the policy of a message). This module only words and shapes."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import Any, Literal

from app.display_name import real_name
from app.errors import not_found
from app.tenancy.repository import UpstreamError
from app.visits.models import (
    WEEKDAYS,
    DayHours,
    SlotOut,
    SlotsOut,
    StaffIn,
    StaffListOut,
    StaffOut,
    StoreSettingsIn,
    StoreSettingsOut,
    TodayVisitOut,
    TodayVisitsOut,
    VisitListOut,
    VisitOut,
)

logger = logging.getLogger("app.visits.service")

UNKNOWN_CUSTOMER = "A customer"


def short_name(full_name: Any) -> str | None:
    """ "Priya Sharma" -> "Priya S."; one word stays as it is; an erased record (the tombstone "erased:...") or an empty name is None."""
    if not isinstance(full_name, str):
        return None
    name = " ".join(full_name.split())
    if not name or name.startswith("erased:"):
        return None
    parts = name.split(" ")
    if len(parts) == 1:
        return parts[0][:40]
    return f"{parts[0][:30]} {parts[-1][0]}."


def _clean(value: Any) -> str | None:
    if isinstance(value, str) and value and not value.startswith("erased:"):
        return value
    return None


def visit_out(row: dict[str, Any]) -> VisitOut:
    contact = short_name(row.get("contact_name"))
    company = real_name(_clean(row.get("company_name")))
    try:
        return VisitOut(
            id=row["id"],
            lead_id=row["lead_id"],
            contact_id=row.get("contact_id"),
            customer=company,
            contact_name=contact,
            who=contact or company or UNKNOWN_CUSTOMER,
            city=_clean(row.get("city")),
            date=row["visit_date"],
            starts_at=row["starts_at"],
            ends_at=row["ends_at"],
            party_size=row["party_size"],
            purpose=_clean(row.get("purpose")),
            note=_clean(row.get("note")),
            status=row["status"],
            source=row["source"],
            outcome=row.get("outcome"),
            order_id=row.get("order_id"),
            advance_requested=row["advance_requested"],
            advance_paise=row.get("advance_paise"),
            confirmation_message_id=row.get("confirmation_message_id"),
            reminder_message_id=row.get("reminder_message_id"),
            confirmation_sent=bool(row.get("confirmation_sent")),
            reminder_sent=bool(row.get("reminder_sent")),
            cancel_reason=_clean(row.get("cancel_reason")),
            created_at=row["created_at"],
            confirmed_at=row.get("confirmed_at"),
            arrived_at=row.get("arrived_at"),
            closed_at=row.get("closed_at"),
            staff_id=row.get("staff_id"),
            staff_name=_clean(row.get("staff_name")),
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected visit row") from None


def list_out(raw: dict[str, Any]) -> VisitListOut:
    try:
        return VisitListOut(
            **{"from": raw["from"]}, to=raw["to"], items=[visit_out(r) for r in raw["items"]]
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected visit list") from None


def first(raw: dict[str, Any]) -> dict[str, Any] | None:
    items = raw.get("items") if isinstance(raw, dict) else None
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        return None
    return items[0]


def today_out(raw: dict[str, Any]) -> TodayVisitsOut:
    """The Today page's list: the visits of the India date that are still to come or here now, time order. `status` is the three words the page draws."""
    items: list[TodayVisitOut] = []
    try:
        for row in raw["items"]:
            visit = visit_out(row)
            if visit.status not in ("booked", "confirmed", "arrived"):
                continue
            status: Literal["confirmed", "reminder_sent", "requested"]
            if visit.status == "booked":
                status = "requested"
            elif visit.status == "confirmed" and visit.reminder_sent:
                status = "reminder_sent"
            else:
                status = "confirmed"
            items.append(
                TodayVisitOut(
                    id=visit.id,
                    lead_id=visit.lead_id,
                    starts_at=visit.starts_at,
                    who=visit.who,
                    extra=max(visit.party_size - 1, 0),
                    topic=visit.purpose,
                    status=status,
                    visit_status=visit.status,
                )
            )
        return TodayVisitsOut(date=raw["from"], items=items)
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected visit list") from None


# ------------------------------------------------------------------------------------------------ hours
def settings_args(body: StoreSettingsIn) -> dict[str, Any]:
    week = {
        day: ({"open": hours.open, "close": hours.close} if hours is not None else None)
        for day, hours in ((d, body.weekly_hours[d]) for d in WEEKDAYS)  # type: ignore[index]
    }
    return {
        "p_weekly_hours": week,
        "p_closed_dates": sorted({d.isoformat() for d in body.closed_dates}),
        "p_slot_minutes": body.slot_minutes,
        "p_max_parallel": body.max_parallel,
        "p_buffer_minutes": body.buffer_minutes,
    }


def settings_out(raw: dict[str, Any]) -> StoreSettingsOut:
    try:
        return StoreSettingsOut(
            weekly_hours={
                day: (DayHours(**hours) if hours is not None else None)
                for day, hours in raw["weekly_hours"].items()
            },
            closed_dates=[date.fromisoformat(d) for d in raw["closed_dates"]],
            slot_minutes=raw["slot_minutes"],
            max_parallel=raw["max_parallel"],
            buffer_minutes=raw.get("buffer_minutes") or 0,
            staff_count=raw.get("staff_count") or 0,
            is_default=bool(raw["is_default"]),
        )
    except (KeyError, ValueError, TypeError, AttributeError):
        raise UpstreamError("unexpected store settings") from None


def slots_out(raw: dict[str, Any]) -> SlotsOut:
    try:
        return SlotsOut(
            date=raw["date"],
            open=bool(raw["open"]),
            reason=raw.get("reason"),
            slot_minutes=raw["slot_minutes"],
            max_parallel=raw["max_parallel"],
            buffer_minutes=raw.get("buffer_minutes") or 0,
            staff_count=raw.get("staff_count") or 0,
            slots=[SlotOut(**s) for s in raw["slots"]],
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected slots") from None


# ------------------------------------------------------------------------------------------------ stable ids
def message_id(
    visit_id: uuid.UUID,
    kind: str,
    starts_at: datetime,
    language: str,
    advance_paise: int | None,
) -> uuid.UUID:
    """The same confirmation of the same slot in the same language with the same advance is the same message (a retry replays); a visit that moved or changed its advance makes a new one."""
    return uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"sme-ai-visit-message:{visit_id}:{kind}:{starts_at.isoformat()}:{language}:{advance_paise or 0}",
    )


def offer_message_id(request_id: uuid.UUID, language: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"sme-ai-visit-offer:{request_id}:{language}")


def require_visit(raw: dict[str, Any]) -> dict[str, Any]:
    row = first(raw)
    if row is None:
        raise not_found()
    return row


def staff_out(raw: dict[str, Any]) -> StaffOut:
    try:
        week = raw.get("weekly_hours")
        return StaffOut(
            id=raw["id"],
            name=raw["name"],
            weekly_hours=(
                {day: (DayHours(**h) if h is not None else None) for day, h in week.items()}
                if week is not None
                else None
            ),
            active=bool(raw["active"]),
        )
    except (KeyError, ValueError, TypeError, AttributeError):
        raise UpstreamError("unexpected staff member") from None


def staff_list_out(raw: dict[str, Any]) -> StaffListOut:
    try:
        return StaffListOut(items=[staff_out(x) for x in raw["items"]])
    except (KeyError, TypeError):
        raise UpstreamError("unexpected staff list") from None


def staff_week_arg(body: StaffIn) -> dict[str, Any] | None:
    if body.weekly_hours is None:
        return None
    return {
        day: ({"open": h.open, "close": h.close} if h is not None else None)
        for day, h in ((d, body.weekly_hours[d]) for d in WEEKDAYS)  # type: ignore[index]
    }
