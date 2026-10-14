"""In-memory fakes of the job-CP repositories (campaigns and the call list; the ledger's new calls on the dues fake), for the route tests (no database). They keep what the database would keep, only as much as a route test
needs: a campaign per id, its list, and the approval rule (only a draft, only for the samples that were shown, and only when nothing stands in the way)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime
from typing import Any

from app.campaigns.errors import CampaignNotReadyError, CampaignStaleError, CampaignStateError
from app.crm.repository import NotFoundError

NOW = "2026-10-14T09:00:00+00:00"
STEPS = [{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.error: Exception | None = None

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.error is not None:
            raise self.error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]


def campaign_row(campaign_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": campaign_id, "name": "October dues", "kind": "payment_due", "status": "draft", "language": "en", "wa_template_id": str(uuid.UUID(int=0x7E)),
        "message_text": "Dear {{name}}, payment of {{amount}} is due on {{due_date}}.", "steps": STEPS, "call_after_step": None, "call_wait_hours": 24, "audience_kind": "import",
        "audience_filter": None, "approved_by": None, "approved_at": None, "approved_recipients": None, "approved_total_paise": None, "created_at": NOW, "updated_at": NOW,
        "paused_at": None, "cancelled_at": None, "completed_at": None, "recipients": 0, "total_amount_paise": 0, **over,
    }  # fmt: skip


class FakeCampaigns(_Recorder):
    def __init__(self) -> None:
        super().__init__()
        self.rows: dict[str, dict[str, Any]] = {}
        self.people: dict[str, list[dict[str, Any]]] = {}
        self.issues: list[str] = []
        self.items: dict[str, dict[str, Any]] = {}
        self.sending_on = True

    # -------------------------------------------------------------------------------- the campaign
    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("save", token, args)
        key = args["p_campaign_id"]
        old = self.rows.get(key)
        content = ("p_language", "p_wa_template_id", "p_message_text", "p_steps", "p_call_after_step", "p_call_wait_hours")
        back = bool(old and old["status"] != "draft" and any(old[k.removeprefix("p_")] != args[k] for k in content))
        row = campaign_row(
            key, name=args["p_name"], kind=args["p_kind"], language=args["p_language"], wa_template_id=args["p_wa_template_id"], message_text=args["p_message_text"], steps=args["p_steps"],
            call_after_step=args["p_call_after_step"], call_wait_hours=args["p_call_wait_hours"], status="draft" if old is None or back else old["status"],
        )  # fmt: skip
        self.rows[key] = row
        return {"campaign": row, "created": old is None, "back_to_draft": back}

    def _row(self, campaign_id: uuid.UUID) -> dict[str, Any]:
        row = self.rows.get(str(campaign_id))
        if row is None:
            raise NotFoundError("23503")
        row["recipients"] = len(self.people.get(str(campaign_id), []))
        row["total_amount_paise"] = sum(p.get("amount_paise") or 0 for p in self.people.get(str(campaign_id), []))
        return row

    def get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self._go("get", token, campaign_id)
        return {**self._row(campaign_id), "issues": list(self.issues), "sending_on": self.sending_on}

    def list_campaigns(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, after: Any) -> list[dict[str, Any]]:
        self._go("list_campaigns", token, status, limit, after)
        return [self._row(uuid.UUID(k)) for k, r in self.rows.items() if status is None or r["status"] == status][:limit]

    # -------------------------------------------------------------------------------- the list
    def recipients_add(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self._go("recipients_add", token, campaign_id, rows)
        self._row(campaign_id)
        people = self.people.setdefault(str(campaign_id), [])
        # every 7th row of a part is refused, so the offsets of the row numbers are visible
        skipped = [{"row": i, "reason": "duplicate"} for i in range(7, len(rows) + 1, 7)]
        people.extend(r for i, r in enumerate(rows, 1) if i % 7)
        if self.rows[str(campaign_id)]["status"] != "draft":
            self.rows[str(campaign_id)]["status"] = "draft"
        return {"added": len(rows) - len(skipped), "skipped": skipped, "recipients": len(people)}

    def recipients_from_ledger(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]:
        self._go("recipients_from_ledger", token, campaign_id, filter_)
        self._row(campaign_id)
        self.people.setdefault(str(campaign_id), []).append({"amount_paise": 500000})
        return {"added": 1, "skipped": [{"row": 2, "reason": "no_contact"}], "recipients": len(self.people[str(campaign_id)])}

    def recipient_remove(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, recipient_id: uuid.UUID | None) -> dict[str, Any]:
        self._go("recipient_remove", token, campaign_id, recipient_id)
        self._row(campaign_id)
        n = len(self.people.get(str(campaign_id), []))
        self.people[str(campaign_id)] = []
        return {"removed": n}

    def list_recipients(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, limit: int, after_seq: int | None) -> list[dict[str, Any]]:
        self._go("list_recipients", token, campaign_id, limit, after_seq)
        self._row(campaign_id)
        return [
            {"id": str(uuid.UUID(int=0x100 + i)), "seq": i + 1, "contact_id": str(uuid.UUID(int=0x200 + i)), "contact_name": f"Person {i}", "due_date": "2026-11-10", "amount_paise": p.get("amount_paise"),
             "reference": None, "closed_reason": None, "promised_on": None, "steps": [{"step_no": 1, "scheduled_for": NOW, "status": "planned", "reason": None}]}
            for i, p in enumerate(self.people.get(str(campaign_id), []))
        ]  # fmt: skip

    # -------------------------------------------------------------------------------- preview, approval, state, results
    def _samples_sha(self, campaign_id: uuid.UUID) -> str:
        return sha(f"samples:{campaign_id}:{len(self.people.get(str(campaign_id), []))}")

    def preview(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self._go("preview", token, campaign_id)
        row = self._row(campaign_id)
        n = row["recipients"]
        samples = [{"recipient_id": str(uuid.UUID(int=0x100 + i)), "labels": ["first"] if i == 0 else ["random"], "body": f"Dear Person {i}, payment of ₹5,000.00 is due on 10 Nov 2026.", "amount_paise": 500000, "due_date": "2026-11-10"} for i in range(min(n, 6))]
        return {
            "campaign": row, "samples": samples, "samples_sha256": self._samples_sha(campaign_id), "content_sha256": sha(f"content:{campaign_id}:{n}"), "recipients": n,
            "total_amount_paise": row["total_amount_paise"], "first_due": "2026-11-10" if n else None, "last_due": "2026-11-20" if n else None,
            "disclosure": "This message is from the business's AI assistant.", "issues": list(self.issues), "sending_on": self.sending_on,
        }  # fmt: skip

    def approve(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, samples_sha256: str) -> dict[str, Any]:
        self._go("approve", token, campaign_id, samples_sha256)
        row = self._row(campaign_id)
        if row["status"] != "draft":
            raise CampaignStateError("SM801")
        if self.issues:
            err = CampaignNotReadyError("SM803")
            err.detail = self.issues[0]
            raise err
        if samples_sha256 != self._samples_sha(campaign_id):
            raise CampaignStaleError("SM802")
        row.update(status="approved", approved_by=str(uuid.UUID(int=0x1000)), approved_at=NOW, approved_recipients=row["recipients"], approved_total_paise=row["total_amount_paise"])
        return {"campaign": row, "planned_steps": 3 * row["recipients"], "past_steps": 0, "sending_on": self.sending_on}

    def set_state(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, action: str) -> dict[str, Any]:
        self._go("set_state", token, campaign_id, action)
        row = self._row(campaign_id)
        allowed = {"pause": ("approved", "running"), "resume": ("paused",), "cancel": ("draft", "approved", "running", "paused")}[action]
        if row["status"] not in allowed:
            raise CampaignStateError("SM801")
        row["status"] = {"pause": "paused", "resume": "approved", "cancel": "cancelled"}[action]
        return row

    def results(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self._go("results", token, campaign_id)
        row = self._row(campaign_id)
        return {
            "campaign_id": str(campaign_id), "status": row["status"], "recipients": row["recipients"], "by_state": {"sent": 5, "delivered": 2, "blocked": 1}, "by_reason": {"stopped": 1},
            "by_day": [{"day": "2026-11-07", "states": {"sent": 5}}], "delivered_total": 2, "replied": 1, "paid_after_reminder": {"recipients": 1, "amount_paise": 500000}, "closed": {"paid": 1},
            "calls": {"open": 1, "done": 0, "outcomes": {}},
        }  # fmt: skip

    # -------------------------------------------------------------------------------- the call list
    def call_list(self, token: str, tenant_id: uuid.UUID, status: str, limit: int, after: Any) -> list[dict[str, Any]]:
        self._go("call_list", token, status, limit, after)
        return [i for i in self.items.values() if i["status"] == status][:limit]

    def call_outcome(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, outcome: str, promised_on: date | None, call_after: datetime | None) -> dict[str, Any]:
        self._go("call_outcome", token, item_id, outcome, promised_on, call_after)
        item = self.items.get(str(item_id))
        if item is None:
            raise NotFoundError("23503")
        if item["status"] == "done" and item["outcome"] != outcome:
            raise CampaignStateError("SM801")
        replayed = item["status"] == "done"
        item.update(outcome=outcome, status="open" if outcome == "call_later" else "done", promised_on=promised_on.isoformat() if promised_on else None)
        return {"id": str(item_id), "status": item["status"], "outcome": outcome, "replayed": replayed}


def call_item(item_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    return {
        "id": str(item_id), "campaign_id": str(uuid.UUID(int=0xCA)), "campaign_name": "October dues", "recipient_id": str(uuid.UUID(int=0x100)), "contact_id": str(uuid.UUID(int=0x200)), "contact_name": "Person 0",
        "amount_paise": 500000, "due_date": "2026-11-10", "reference": None, "step_no": 2, "status": "open", "outcome": None, "promised_on": None, "call_after": None, "attempts": 0,
        "call_request_id": str(uuid.UUID(int=0x300)), "created_at": NOW, "sort_at": NOW, **over,
    }  # fmt: skip


# ======================================================================================================== the ledger's new calls
LEDGER_STATEMENT = {
    "account_id": str(uuid.UUID(int=0xAC)), "company_id": None, "contact_id": str(uuid.UUID(int=0x200)), "as_of": "2026-10-14", "invoiced_paise": 3050000, "paid_paise": 1400000, "payments_paise": 800000,
    "concessions_paise": 500000, "adjustments_paise": -50000, "outstanding_paise": 1650000, "credit_paise": 0, "overdue_paise": 650000,
    "ageing": {"d0_30": 1050000, "d31_60": 600000, "d61_90": 0, "d90_plus": 0}, "overdue_ageing": {"not_due": 1000000, "d1_30": 650000, "d31_60": 0, "d61_90": 0, "d90_plus": 0},
    "open_invoices": [{"invoice_id": str(uuid.UUID(int=0xE2)), "entry_id": str(uuid.UUID(int=0xE2)), "kind": "charge", "invoice_no": None, "reference": "Tuition T2", "invoice_date": "2026-09-01", "due_date": "2026-09-30",
                       "amount_paise": 1000000, "open_paise": 600000, "age_days": 43, "overdue_days": 14}],
    "credit_limit_paise": None, "over_limit": False,
}  # fmt: skip


class LedgerCalls:
    """The ledger's calls, to be mixed into a dues fake (which provides `_go`)."""

    def _go(self, name: str, *args: Any) -> None:  # replaced by the host fake
        raise NotImplementedError

    def entry_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("entry_record", token, args)
        paid = args["p_kind"] == "payment"
        return {"entry_id": args["p_entry_id"], "account_id": str(uuid.UUID(int=0xAC)), "receipt_no": "R/2026-27/000001" if paid else None, "replayed": args["p_amount_paise"] == 777}

    def entry_void(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        self._go("entry_void", token, entry_id)
        return {"entry_id": str(entry_id), "kind": "payment", "voided": True}

    def charges_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self._go("charges_import", token, batch_id, rows)
        return {"batch_id": str(batch_id), "added": len(rows) - len(rows) // 7, "skipped": [{"row": i, "reason": "party_not_found"} for i in range(7, len(rows) + 1, 7)]}

    def party_statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, as_of: date | None) -> dict[str, Any]:
        self._go("party_statement", token, company_id, contact_id, as_of)
        return {**LEDGER_STATEMENT, "company_id": str(company_id) if company_id else None, "contact_id": str(contact_id) if contact_id else None}

    def party_summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: Any, party: str | None) -> list[dict[str, Any]]:
        self._go("party_summary", token, as_of, limit, after, party)
        return [{**LEDGER_STATEMENT, "party_kind": "contact", "party_name": "Guardian worked"}]

    def entries(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, limit: int) -> dict[str, Any]:
        self._go("entries", token, company_id, contact_id, limit)
        return {
            "account_id": str(uuid.UUID(int=0xAC)),
            "entries": [{"id": str(uuid.UUID(int=0xE1)), "kind": "payment", "direction": "credit", "amount_paise": 800000, "entry_date": "2026-09-05", "due_date": None, "invoice_no": None, "reference": None,
                         "method": "bank_transfer", "reason_code": None, "receipt_no": "R/2026-27/000001", "against_entry_id": None, "order_id": None, "source": "manual", "voided": False}],
        }  # fmt: skip

    def receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        self._go("receipt", token, entry_id)
        return {
            "receipt_no": "R/2026-27/000001", "received_on": "2026-09-05", "amount_paise": 800000, "method": "bank_transfer", "voided": False, "business_name": "Tenant A", "party_name": "Guardian worked",
            "party_kind": "contact", "against": None, "balance_after_paise": 1650000, "recorded_at": NOW,
        }  # fmt: skip
