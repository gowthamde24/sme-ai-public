"""The runtime's one door to the database: PostgREST, with the STARTING USER's token (ADR 0013,
option A).

It calls exactly the definer functions of the agent write path (every one takes a RUN id,
never a tenant) plus read-only reads of the run's own row and of its target company's four
allowlisted columns. Nothing here builds SQL, names a tenant or lets a caller choose a table.
The token lives in this object only: it is not in `repr`, not in a log line and not handed to
a tool (a tool gets the object's methods, through the `AgentDbPort` interface).

Errors are classified by SQLSTATE alone. A database message, detail or hint is never read into
an exception, a log line or a stored value (PostgreSQL puts the failing row in some of them)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any

import httpx

from app.agents.errors import (
    BY_SQLSTATE,
    AgentDbError,
    CostCapReached,
    DataLayerUnavailable,
    ReferenceRefused,
    RunDenied,
    RunExpired,
)
from app.agents.llm.interface import Usage
from app.agents.ports import RunView

logger = logging.getLogger("app.agents.db")

RUN_COLUMNS = (
    "id,agent_name,status,expires_at,cancel_requested_at,input_sha256,company_id,lead_id,enquiry_id"
)
ENQUIRY_COLUMNS = "channel,received_at,subject,body"  # the enquiry model-input allowlist, no others
ENQUIRY_KEYS = tuple(ENQUIRY_COLUMNS.split(","))
TARGET_COLUMNS = "name,city,region,website"  # the model-input allowlist's source columns, no others
TARGET_KEYS = tuple(TARGET_COLUMNS.split(","))
_SQLSTATE = re.compile(r"^[0-9A-Z]{5}$")


class AgentDb:
    def __init__(
        self,
        rest_url: str,
        anon_key: str,
        token: str,
        run_id: uuid.UUID,
        *,
        claim_predicate: str = "selftest.observation",
        client: httpx.Client | None = None,
    ) -> None:
        self._anon_key = anon_key
        self._token = token
        self._run = run_id
        self._predicate = claim_predicate
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def __repr__(self) -> str:
        return f"AgentDb(run={self._run})"

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ transport
    def _call(
        self,
        what: str,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=body, headers=headers)
        except httpx.HTTPError as exc:
            # the text of a transport error can contain the URL and the headers: log the class
            # only
            logger.warning("agent db unreachable: op=%s error=%s", what, exc.__class__.__name__)
            raise DataLayerUnavailable from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise DataLayerUnavailable from None
        raise self._classify(what, response)

    @staticmethod
    def _classify(what: str, response: httpx.Response) -> AgentDbError:
        code = ""
        try:
            parsed = response.json()
            raw = parsed.get("code") if isinstance(parsed, dict) else None
            code = raw if isinstance(raw, str) and _SQLSTATE.fullmatch(raw) else ""
        except ValueError:
            pass
        logger.info(
            "agent db refused: op=%s http=%s sqlstate=%s", what, response.status_code, code or "-"
        )
        if response.status_code == 401:
            return RunExpired()  # the starter's token no longer works: the run cannot go on
        cls = BY_SQLSTATE.get(code)
        return cls() if cls is not None else DataLayerUnavailable()

    def _rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._call(what, "GET", path, params={**params, "limit": "1"})
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise DataLayerUnavailable
        return rows

    def _rpc(self, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._call(function, "POST", f"/rpc/{function}", body=args)
        if not isinstance(result, dict):
            raise DataLayerUnavailable
        return result

    @staticmethod
    def _uuid(value: Any) -> uuid.UUID:
        try:
            return uuid.UUID(str(value))
        except ValueError:
            raise DataLayerUnavailable from None

    # ------------------------------------------------------------------ reads
    def read_run(self) -> RunView:
        rows = self._rows(
            "read_run", "/agent_runs", {"select": RUN_COLUMNS, "id": f"eq.{self._run}"}
        )
        if not rows:
            raise RunDenied  # not visible to this user: unknown, someone else's, or access lost
        row = rows[0]
        try:
            expires = datetime.fromisoformat(str(row["expires_at"]))
            cancelled = row["cancel_requested_at"]
            return RunView(
                id=self._uuid(row["id"]),
                agent_name=str(row["agent_name"]),
                status=str(row["status"]),
                expires_at=expires,
                cancel_requested_at=datetime.fromisoformat(str(cancelled)) if cancelled else None,
                input_sha256=str(row["input_sha256"]),
                company_id=self._uuid(row["company_id"]) if row["company_id"] else None,
                lead_id=self._uuid(row["lead_id"]) if row["lead_id"] else None,
                enquiry_id=self._uuid(row["enquiry_id"]) if row.get("enquiry_id") else None,
            )
        except (KeyError, ValueError, TypeError):
            raise DataLayerUnavailable from None

    def read_target(self, run: RunView) -> dict[str, Any]:
        company = run.company_id
        if company is None and run.lead_id is not None:
            leads = self._rows(
                "read_lead", "/leads", {"select": "company_id", "id": f"eq.{run.lead_id}"}
            )
            company = (
                self._uuid(leads[0]["company_id"]) if leads and leads[0].get("company_id") else None
            )
        if company is None:
            return {}
        rows = self._rows(
            "read_company", "/companies", {"select": TARGET_COLUMNS, "id": f"eq.{company}"}
        )
        if not rows:
            raise ReferenceRefused
        return {key: rows[0].get(key) for key in TARGET_KEYS}

    def read_enquiry(self, run: RunView) -> dict[str, Any]:
        if run.enquiry_id is None:
            return {}
        rows = self._rows(
            "read_enquiry", "/enquiries", {"select": ENQUIRY_COLUMNS, "id": f"eq.{run.enquiry_id}"}
        )
        if not rows:
            raise ReferenceRefused
        return {key: rows[0].get(key) for key in ENQUIRY_KEYS}

    # ------------------------------------------------------------------ writes (all through
    # the definer functions)
    def reserve_cost(
        self, step_key: str, *, model: str, max_input_tokens: int, max_output_tokens: int
    ) -> None:
        result = self._rpc(
            "agent_reserve_cost",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_model": model,
                "p_max_input_tokens": max_input_tokens,
                "p_max_output_tokens": max_output_tokens,
            },
        )
        # a refusal is RETURNED (not raised) so the database keeps its audit event; anything
        # but an explicit grant is a refusal
        if result.get("granted") is not True:
            raise CostCapReached

    def ai_mode(self, light_model: str) -> str:
        result = self._rpc(
            "agent_ai_mode", {"p_run_id": str(self._run), "p_light_model": light_model}
        )
        mode = result.get("mode")
        return mode if isinstance(mode, str) else "normal"

    def release_cost(self, step_key: str, *, reason: str) -> None:
        self._rpc(
            "agent_release_cost",
            {"p_run_id": str(self._run), "p_step_key": step_key, "p_reason": reason},
        )

    def record_usage(self, step_key: str, usage: Usage) -> None:
        self._rpc(
            "agent_record_usage",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_tokens_in": usage.input_tokens,
                "p_tokens_out": usage.output_tokens,
                "p_cost_micros": usage.cost_micros,
            },
        )

    def record_step(
        self,
        step_key: str,
        tool_name: str,
        args_sha256: str,
        status: str,
        result_ref: dict[str, Any] | None,
    ) -> None:
        self._rpc(
            "agent_record_step",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_tool_name": tool_name,
                "p_args_sha256": args_sha256,
                "p_status": status,
                "p_result_ref": result_ref,
            },
        )

    def write_evidence(self, step_key: str, *, text: str) -> uuid.UUID:
        result = self._rpc(
            "agent_write_evidence",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_kind": "note",
                "p_snippet": text,
            },
        )
        return self._uuid(result.get("evidence_id"))

    def write_web_evidence(self, step_key: str, *, url: str, quote: str) -> uuid.UUID:
        result = self._rpc(
            "agent_write_evidence",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_kind": "web_page",
                "p_url": url,
                "p_snippet": quote,
            },
        )
        return self._uuid(result.get("evidence_id"))

    def write_claim(
        self,
        step_key: str,
        *,
        value: str,
        stance: str,
        evidence_id: uuid.UUID,
        predicate: str | None = None,
    ) -> uuid.UUID:
        result = self._rpc(
            "agent_write_claim",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_predicate": predicate or self._predicate,
                "p_value": value,
                "p_evidence_ids": [str(evidence_id)],
                "p_stance": stance,
            },
        )
        return self._uuid(result.get("claim_id"))

    def write_requirement_field(
        self,
        step_key: str,
        *,
        line: int | None,
        key: str,
        value_code: str | None,
        value_int: int | None,
        value_date: str | None,
        value_text: str | None,
        basis: str | None,
        certainty: str,
        quote: str,
        start: int,
        end: int,
        conflict: bool,
    ) -> uuid.UUID:
        result = self._rpc(
            "agent_write_requirement_field",
            {
                "p_run_id": str(self._run),
                "p_step_key": step_key,
                "p_line": line,
                "p_key": key,
                "p_value_code": value_code,
                "p_value_int": value_int,
                "p_value_date": value_date,
                "p_value_text": value_text,
                "p_basis": basis,
                "p_certainty": certainty,
                "p_quote": quote,
                "p_start": start,
                "p_end": end,
                "p_conflict": conflict,
            },
        )
        return self._uuid(result.get("field_id"))

    def finish(self, status: str, error_code: str | None) -> None:
        self._rpc(
            "finish_agent_run",
            {"p_run_id": str(self._run), "p_status": status, "p_error_code": error_code},
        )
