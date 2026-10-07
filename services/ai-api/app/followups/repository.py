"""Follow-up data access behind an interface (Supabase PostgREST today). Same discipline as the orders adapter: every call carries the CALLER's JWT and the public anon key, so RLS decides what is
visible (Owner, Admin and Sales read touches, drafts and policies; a Viewer reads none); failures are classified by SQLSTATE only and data-layer text is never returned, logged or chained into an
exception (a refusal's DETAIL is read only to pick a closed reason).

Touches, drafts, policies and question drafts have no client write grant: every write is a SECURITY DEFINER function (record_touch, create_followup_draft, approve_followup_draft,
discard_followup_draft, record_draft_sent, create_followup_policy_version, persist_question_drafts, decide_question_draft). The API sends nothing anywhere: these are records."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, NamedTuple, Protocol

import httpx

from app.crm.repository import classify_error
from app.followups.builder import LeadSnapshot, PolicySnapshot, Touch, parse_instant
from app.followups.errors import SM_ERRORS, refusal
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.followups.repository")

IST = timezone(
    timedelta(hours=5, minutes=30)
)  # app.quote_today() is the date in Asia/Kolkata; India has no daylight saving

POLICY_COLUMNS = (
    "id,version_no,effective_from,gap_days,max_touches,quiet_start,quiet_end,allowed_weekdays,holidays,"
    "min_gap_hours,recipient_utc_offset_minutes,created_at"
)
TOUCH_COLUMNS = (
    "id,lead_id,contact_id,direction,channel,occurred_at,draft_id,recorded_by,recorded_at"
)
DRAFT_COLUMNS = (
    "id,lead_id,contact_id,touch_number,status,channel,template_code,body,policy_version_id,engine_version,"
    "state_hash,as_of,created_by,created_at,approved_by,approved_at,discarded_by,discarded_at,discard_code"
)
QUESTION_COLUMNS = "id,requirement_id,line_no,question_code,question_text,status,created_by,created_at,decided_by,decided_at,discard_code"


class OutboundLead(NamedTuple):
    """A candidate of the due list: a lead with an outbound touch and the channel (email or whatsapp) of its latest such touch, or None when every outbound touch it has is a phone call."""

    lead_id: uuid.UUID
    channel: str | None


class FollowupsRepository(Protocol):
    # writes (definer functions only)
    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def record_touch(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def approve_draft(self, token: str, draft_id: uuid.UUID, state_hash: str) -> dict[str, Any]: ...
    def discard_draft(self, token: str, draft_id: uuid.UUID) -> dict[str, Any]: ...
    def record_sent(
        self, token: str, draft_id: uuid.UUID, touch_id: uuid.UUID, occurred_at: str | None
    ) -> dict[str, Any]: ...
    def persist_questions(
        self, token: str, requirement_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]: ...
    def decide_question(self, token: str, draft_id: uuid.UUID, decision: str) -> dict[str, Any]: ...

    # reads
    def gate(self, token: str, lead_id: uuid.UUID, channel: str) -> dict[str, Any]: ...
    def lead_snapshot(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> LeadSnapshot | None:
        """What the database recorded for the lead (None when it is not visible to the caller): the input of the request builder."""
        ...

    def list_policies(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]: ...
    def list_touches(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]: ...
    def get_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None: ...
    def list_drafts(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        lead_id: uuid.UUID | None,
        status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]: ...
    def recent_outbound(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[OutboundLead]:
        """The leads with the most recent outbound touches (distinct, newest first, at most `limit`): the candidates of the due list, each with the channel (email or whatsapp) of its latest such touch."""
        ...

    def requirement_enquiry(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> uuid.UUID | None: ...
    def list_question_drafts(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, *, active_only: bool
    ) -> list[dict[str, Any]]: ...
    def get_question_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None: ...


class PostgrestFollowupsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("followups data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in SM_ERRORS:
            detail = body.get("details") if isinstance(body, dict) else None
            error = refusal(code, detail)
            # the SERVER's log names what the database said (erased_key included); the client is only ever told error.reason
            logger.info(
                "followups data layer refused: sqlstate=%s reason=%s",
                code,
                error.internal_reason or "-",
            )
            return error
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _rows(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._send("GET", path, token, params=params)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise UpstreamError("unexpected list shape")
        return rows

    def _one(self, path: str, token: str, params: dict[str, str]) -> dict[str, Any] | None:
        rows = self._rows(path, token, {**params, "limit": "1"})
        return rows[0] if rows else None

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._send("POST", f"/rpc/{function}", token, json=args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ writes (definer functions only)
    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_followup_policy_version", args)

    def record_touch(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "record_touch", args)

    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_followup_draft", args)

    def approve_draft(self, token: str, draft_id: uuid.UUID, state_hash: str) -> dict[str, Any]:
        return self._rpc(
            token,
            "approve_followup_draft",
            {"p_draft_id": str(draft_id), "p_state_hash": state_hash},
        )

    def discard_draft(self, token: str, draft_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc(token, "discard_followup_draft", {"p_draft_id": str(draft_id)})

    def record_sent(
        self, token: str, draft_id: uuid.UUID, touch_id: uuid.UUID, occurred_at: str | None
    ) -> dict[str, Any]:
        return self._rpc(
            token,
            "record_draft_sent",
            {
                "p_draft_id": str(draft_id),
                "p_touch_id": str(touch_id),
                "p_occurred_at": occurred_at,
            },
        )

    def persist_questions(
        self, token: str, requirement_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return self._rpc(
            token,
            "persist_question_drafts",
            {"p_requirement_id": str(requirement_id), "p_items": items},
        )

    def decide_question(self, token: str, draft_id: uuid.UUID, decision: str) -> dict[str, Any]:
        return self._rpc(
            token, "decide_question_draft", {"p_draft_id": str(draft_id), "p_decision": decision}
        )

    # ------------------------------------------------------------------ reads
    def gate(self, token: str, lead_id: uuid.UUID, channel: str) -> dict[str, Any]:
        return self._rpc(token, "followup_gate", {"p_lead_id": str(lead_id), "p_channel": channel})

    def lead_snapshot(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> LeadSnapshot | None:
        tenant = f"eq.{tenant_id}"
        lead = self._one(
            "/leads",
            token,
            {"select": "id,status,contact_id", "tenant_id": tenant, "id": f"eq.{lead_id}"},
        )
        if lead is None:
            return None
        reason: str | None = None
        if lead["contact_id"] is not None:
            contact = self._one(
                "/contacts",
                token,
                {
                    "select": "suppression_reason",
                    "tenant_id": tenant,
                    "id": f"eq.{lead['contact_id']}",
                },
            )
            reason = None if contact is None else contact["suppression_reason"]
        won = self._one(
            "/opportunities",
            token,
            {
                "select": "id",
                "tenant_id": tenant,
                "lead_id": f"eq.{lead_id}",
                "status": "eq.won",
                "archived_at": "is.null",
            },
        )
        touches = self._rows(
            "/lead_touches",
            token,
            {
                "select": "id,direction,channel,occurred_at",
                "tenant_id": tenant,
                "lead_id": f"eq.{lead_id}",
                "order": "occurred_at.asc,id.asc",
                "limit": "1100",
            },
        )
        policy = self.active_policy(token, tenant_id, datetime.now(IST).date())
        return LeadSnapshot(
            lead_id=str(lead["id"]),
            status=str(lead["status"]),
            contact_suppression_reason=None if reason is None else str(reason),
            has_won_opportunity=won is not None,
            touches=tuple(
                Touch(
                    id=str(t["id"]),
                    direction=str(t["direction"]),
                    channel=str(t["channel"]),
                    occurred_at=parse_instant(t["occurred_at"]),
                )
                for t in touches
            ),
            policy=None if policy is None else _policy(policy),
        )

    def active_policy(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any] | None:
        """The policy version in force on a date: the latest `effective_from` on or before it, the higher version number winning a tie (the rule of app.followup_active_policy_version)."""
        return self._one(
            "/followup_policy_versions",
            token,
            {
                "select": POLICY_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "effective_from": f"lte.{on.isoformat()}",
                "order": "effective_from.desc,version_no.desc",
            },
        )

    def list_policies(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]:
        return self._rows(
            "/followup_policy_versions",
            token,
            {
                "select": POLICY_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "order": "effective_from.desc,version_no.desc",
                "limit": str(limit),
            },
        )

    def list_touches(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]:
        return self._rows(
            "/lead_touches",
            token,
            {
                "select": TOUCH_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"eq.{lead_id}",
                "order": "occurred_at.desc,id.desc",
                "limit": str(limit),
            },
        )

    def get_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None:
        return self._one(
            "/followup_drafts",
            token,
            {"select": DRAFT_COLUMNS, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{draft_id}"},
        )

    def list_drafts(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        lead_id: uuid.UUID | None,
        status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        params = {
            "select": DRAFT_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
        }
        if lead_id is not None:
            params["lead_id"] = (
                f"eq.{lead_id}"  # a validated UUID: the tenant filter above still applies
            )
        if (
            status is not None
        ):  # validated against the closed list by the route; `active` = draft or approved
            params["status"] = "in.(draft,approved)" if status == "active" else f"eq.{status}"
        return self._rows("/followup_drafts", token, params)

    def recent_outbound(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[OutboundLead]:
        rows = self._rows(
            "/lead_touches",
            token,
            {
                "select": "lead_id,channel",
                "tenant_id": f"eq.{tenant_id}",
                "direction": "eq.out",
                "order": "occurred_at.desc,id.desc",
                "limit": str(limit * 4),
            },
        )
        seen: dict[uuid.UUID, str | None] = {}
        for row in rows:  # newest first: the first e-mail or WhatsApp row of a lead is its latest such touch (a phone call makes a lead a candidate but is not a draft channel)
            lead = uuid.UUID(str(row["lead_id"]))
            if lead not in seen:
                if len(seen) >= limit:
                    continue  # the cap is reached: only leads already counted may still learn their channel
                seen[lead] = None
            if seen[lead] is None and row.get("channel") in ("email", "whatsapp"):
                seen[lead] = str(row["channel"])
        return [OutboundLead(lead_id=lead, channel=ch) for lead, ch in seen.items()]

    def requirement_enquiry(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> uuid.UUID | None:
        row = self._one(
            "/requirements",
            token,
            {"select": "enquiry_id", "tenant_id": f"eq.{tenant_id}", "id": f"eq.{requirement_id}"},
        )
        return None if row is None else uuid.UUID(str(row["enquiry_id"]))

    def list_question_drafts(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, *, active_only: bool
    ) -> list[dict[str, Any]]:
        params = {
            "select": QUESTION_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "requirement_id": f"eq.{requirement_id}",
            "order": "question_code.asc,line_no.asc,created_at.desc",
            "limit": "200",
        }
        if active_only:
            params["status"] = "in.(draft,approved)"
        return self._rows("/question_drafts", token, params)

    def get_question_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None:
        return self._one(
            "/question_drafts",
            token,
            {"select": QUESTION_COLUMNS, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{draft_id}"},
        )


def _policy(row: dict[str, Any]) -> PolicySnapshot:
    return PolicySnapshot(
        id=str(row["id"]),
        gap_days=tuple(row["gap_days"]),
        max_touches=row["max_touches"],
        quiet_start=str(row["quiet_start"]),
        quiet_end=str(row["quiet_end"]),
        allowed_weekdays=tuple(row["allowed_weekdays"]),
        holidays=tuple(str(h) for h in row["holidays"]),
        min_gap_hours=row["min_gap_hours"],
        recipient_utc_offset_minutes=row["recipient_utc_offset_minutes"],
    )
