"""An in-memory VisitsRepository for the HTTP tests (job AS). It records every call with the caller's token and answers from rows the test planted; it decides NOTHING (slots, capacity, the
steps and the order are the database's, tested in pgTAP 77 and tests/integration/test_visits_api.py)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from tests.outbox_fakes import FakeOutbox, message_row

T1 = "2026-10-05T08:30:00+00:00"
LEAD = "33333333-3333-4333-8333-333333333333"


def visit_row(visit_id: uuid.UUID | str, **over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(visit_id),
        "lead_id": LEAD,
        "contact_id": "44444444-4444-4444-8444-444444444444",
        "visit_date": "2026-10-05",
        "starts_at": "2026-10-05T05:30:00+00:00",  # 11:00 India time
        "ends_at": "2026-10-05T06:00:00+00:00",
        "party_size": 3,
        "purpose": "Bridal sarees",
        "note": None,
        "status": "booked",
        "source": "staff",
        "outcome": None,
        "order_id": None,
        "advance_requested": False,
        "advance_paise": None,
        "confirmation_message_id": None,
        "reminder_message_id": None,
        "cancel_reason": None,
        "created_at": T1,
        "confirmed_at": None,
        "arrived_at": None,
        "closed_at": None,
        "contact_name": "Priya Sharma",
        "company_name": "Synthetic Silks",
        "city": "Hyderabad",
        "confirmation_sent": False,
        "reminder_sent": False,
    }
    row.update(over)
    return row


def default_settings() -> dict[str, Any]:
    day = {"open": "10:00", "close": "20:30"}
    return {
        "weekly_hours": {d: dict(day) for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")},
        "closed_dates": [],
        "slot_minutes": 30,
        "max_parallel": 2,
        "is_default": True,
    }


class FakeVisits:
    def __init__(self, outbox: FakeOutbox | None = None) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []  # (function, token, args)
        self.rows: dict[str, dict[str, Any]] = {}
        self.raise_next: Exception | None = None
        self.settings: dict[str, Any] = default_settings()
        self.slots_answer: dict[str, Any] = {
            "date": "2026-10-05",
            "open": True,
            "reason": None,
            "slot_minutes": 30,
            "max_parallel": 2,
            "slots": [
                {
                    "start": "10:00",
                    "starts_at": "2026-10-05T04:30:00+00:00",
                    "ends_at": "2026-10-05T05:00:00+00:00",
                    "capacity": 2,
                    "free": 1,
                    "past": False,
                }
            ],
        }
        self.from_to = ("2026-10-05", "2026-10-05")
        self.send_answer: dict[str, Any] = {"replayed": False}
        self.offer_answer: dict[str, Any] = {"status": "rejected", "message": {"replayed": False}}
        self.outbox = outbox

    def _log(self, name: str, token: str, args: dict[str, Any]) -> None:
        self.calls.append((name, token, args))
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def last(self, name: str) -> dict[str, Any]:
        return [c for c in self.calls if c[0] == name][-1][2]

    # reads
    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._log("visit_settings_get", token, {})
        return dict(self.settings)

    def slots(self, token: str, tenant_id: uuid.UUID, day: str) -> dict[str, Any]:
        self._log("visit_slots", token, {"day": day})
        return dict(self.slots_answer)

    def list_visits(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        date_from: str | None,
        date_to: str | None,
        open_only: bool,
        status: str | None,
        lead_id: uuid.UUID | None,
        visit_id: uuid.UUID | None,
    ) -> dict[str, Any]:
        self._log(
            "visit_list",
            token,
            {
                "from": date_from,
                "to": date_to,
                "open_only": open_only,
                "status": status,
                "lead_id": str(lead_id) if lead_id else None,
                "visit_id": str(visit_id) if visit_id else None,
            },
        )
        rows = list(self.rows.values())
        if visit_id is not None:
            rows = [r for r in rows if r["id"] == str(visit_id)]
        else:
            if open_only:
                rows = [r for r in rows if r["status"] in ("booked", "confirmed", "arrived")]
            if status is not None:
                rows = [r for r in rows if r["status"] == status]
            if lead_id is not None:
                rows = [r for r in rows if r["lead_id"] == str(lead_id)]
        return {
            "from": date_from or self.from_to[0],
            "to": date_to or self.from_to[1],
            "items": rows,
        }

    # writes
    def settings_set(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]:
        self._log("visit_settings_set", token, args)
        self.settings = {
            "weekly_hours": args["p_weekly_hours"],
            "closed_dates": args["p_closed_dates"],
            "slot_minutes": args["p_slot_minutes"],
            "max_parallel": args["p_max_parallel"],
            "is_default": False,
        }
        return dict(self.settings)

    def book(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("visit_book", token, args)
        vid = args["p_visit_id"]
        self.rows.setdefault(
            vid,
            visit_row(
                vid,
                lead_id=args["p_lead_id"],
                party_size=args["p_party_size"],
                purpose=args["p_purpose"],
                note=args["p_note"],
                advance_requested=args["p_advance_paise"] is not None,
                advance_paise=args["p_advance_paise"],
            ),
        )
        return {"id": vid, "status": "booked", "replayed": False}

    def change(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("visit_change", token, args)
        return {"id": args["p_visit_id"], "status": "booked", "moved": args["p_date"] is not None}

    def step(
        self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, action: str, reason: str | None
    ) -> dict[str, Any]:
        self._log("visit_step", token, {"id": str(visit_id), "action": action, "reason": reason})
        target = {
            "confirm": "confirmed",
            "arrive": "arrived",
            "no_show": "no_show",
            "cancel": "cancelled",
        }[action]
        self.rows[str(visit_id)]["status"] = target
        return {"id": str(visit_id), "status": target, "replayed": False}

    def complete(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("visit_complete", token, args)
        row = self.rows[args["p_visit_id"]]
        row["status"], row["outcome"], row["order_id"] = (
            "completed",
            args["p_outcome"],
            args["p_order_id"],
        )
        return {"id": args["p_visit_id"], "status": "completed", "replayed": False}

    def send_message(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("visit_send_message", token, args)
        if self.outbox is not None:
            self.outbox.messages.setdefault(
                args["p_message_id"],
                message_row(
                    args["p_message_id"],
                    body=args["p_body"],
                    language=args["p_language"],
                    category="visit",
                    source="system",
                    lead_id=self.rows[args["p_visit_id"]]["lead_id"],
                    uncertain=args["p_uncertain"],
                ),
            )
        return self.send_answer

    def offer_visit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("call_request_offer_visit", token, args)
        if self.outbox is not None:
            self.outbox.messages.setdefault(
                args["p_message_id"],
                message_row(
                    args["p_message_id"],
                    body=args["p_body"],
                    language=args["p_language"],
                    category="visit",
                    source="owner",
                    uncertain=args["p_uncertain"],
                ),
            )
            call = self.outbox.calls_rows.get(args["p_request_id"])
            if call is not None:
                call["status"], call["decision_note"] = "rejected", "offer_store_visit"
        return self.offer_answer
