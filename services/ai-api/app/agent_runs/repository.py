"""Agent-run data access behind an interface (PostgREST today). Every call carries the CALLER's
JWT, so RLS decides what is visible and the definer functions re-check what is written. Errors
are classified by SQLSTATE alone: the data layer's own text (message, details, hint) is never
read into an exception, a log line or a response, because PostgreSQL puts the failing row in
some of it. Any SQLSTATE nobody planned for becomes ONE fixed upstream error."""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.agent_runs.models import (
    AgentCostOut,
    AgentSettingsOut,
    CancelOut,
    ClaimEvidenceOut,
    ClaimSuggestionOut,
    ReviewOut,
    RunOut,
)
from app.crm.models import Page, encode_cursor
from app.crm.repository import ConflictError, InvalidValueError, NotFoundError
from app.tenancy.repository import (
    Forbidden,
    MfaRequired,
    RepositoryError,
    TokenRejected,
    UpstreamError,
)

logger = logging.getLogger("app.agent_runs.repository")

RUN_SELECT = (
    "id,agent_name,agent_version,status,started_by,company_id,lead_id,enquiry_id,created_at,expires_at,"
    "finished_at,error_code,cancel_requested_at,max_writes,writes_used,max_tool_calls,"
    "tool_calls_used,max_input_tokens,input_tokens_used,max_output_tokens,output_tokens_used,"
    "max_cost_micros,cost_micros_used"
)
CLAIM_SELECT = (
    "id,company_id,lead_id,predicate,value,confidence,claim_confidence,created_via,agent_run_id,"
    "created_by,created_at,review_state,review_confidence,reviewed_by,reviewed_at,home_company_id"
)
CLAIMS_EFFECTIVE = "claims_effective"
_SQLSTATE = re.compile(r"^(?:[0-9A-Z]{5}|PGRST\d{3})$")


class AgentsDisabledError(RepositoryError):
    """SM204"""


class RunLimitError(RepositoryError):
    """SM206"""


class CostCapError(RepositoryError):
    """SM207: today's spending cap for this workspace's agents is used up."""


class TokenExpiringError(RepositoryError):
    """SM202 at start: the caller's session is about to end, so no run could finish."""


class RunNotRunningError(RepositoryError):
    """SM201"""


class RequirementConfirmedError(RepositoryError):
    """SM208: the enquiry already has a confirmed requirement; a human discards it first."""


class DraftHasWorkError(RepositoryError):
    """SM211: the active draft holds a person's work (a decided or manually added field).

    A person discards it before a re-run."""


@dataclass(frozen=True)
class StartResult:
    run_id: uuid.UUID
    status: str
    expires_at: datetime
    replayed: bool


class AgentRunsRepository(Protocol):
    def start_run(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        run_id: uuid.UUID,
        agent_name: str,
        agent_version: str,
        target_kind: str,
        target_id: uuid.UUID,
        input_sha256: str,
        input_refs: dict[str, Any],
    ) -> StartResult: ...

    def list_runs(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[RunOut]: ...

    def get_run(self, token: str, tenant_id: uuid.UUID, run_id: uuid.UUID) -> RunOut | None: ...

    def cancel_run(self, token: str, run_id: uuid.UUID) -> CancelOut: ...

    def get_enabled(self, token: str, tenant_id: uuid.UUID) -> AgentSettingsOut: ...

    def cost_summary(self, token: str, tenant_id: uuid.UUID) -> AgentCostOut: ...

    def set_enabled(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> AgentSettingsOut: ...

    def list_claims(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        target_kind: str,
        target_id: uuid.UUID,
        limit: int,
    ) -> list[ClaimSuggestionOut]: ...

    def list_agent_claims(
        self, token: str, tenant_id: uuid.UUID, *, state: str, limit: int
    ) -> list[ClaimSuggestionOut]: ...

    def get_claim(
        self, token: str, tenant_id: uuid.UUID, claim_id: uuid.UUID
    ) -> ClaimSuggestionOut | None: ...

    def review_claim(
        self,
        token: str,
        *,
        review_id: uuid.UUID,
        claim_id: uuid.UUID,
        decision: str,
        confidence: str | None,
        reason_code: str | None,
    ) -> ReviewOut: ...


# ----------------------------------------------------------------------------- classification
def classify_error(status: int, body: Any, *, hide_denial: bool) -> RepositoryError:
    """SQLSTATE -> one of our exceptions. `hide_denial`: a generic 42501 means "not found" (no
    existence oracle)."""
    code = ""
    if isinstance(body, dict):
        raw = body.get("code")
        code = raw if isinstance(raw, str) and _SQLSTATE.fullmatch(raw) else ""
    logger.info("agent runs data layer refused: http=%s sqlstate=%s", status, code or "-")
    if status == 401 or code.startswith("PGRST30"):
        return TokenRejected(code or "401")
    if code == "42501":
        return NotFoundError(code) if hide_denial else Forbidden(code)
    mapped: dict[str, type[RepositoryError]] = {
        "SM201": RunNotRunningError,
        "SM202": TokenExpiringError,
        "SM204": AgentsDisabledError,
        "SM206": RunLimitError,
        "SM207": CostCapError,
        "SM208": RequirementConfirmedError,
        "SM211": DraftHasWorkError,
        "SM306": MfaRequired,
        "23505": ConflictError,
        "23503": NotFoundError,
        "23514": InvalidValueError,
        "22023": InvalidValueError,
    }
    if code in mapped:
        return mapped[code](code)
    logger.warning(
        "agent runs data layer returned an unexpected error: http=%s sqlstate=%s",
        status,
        code or "-",
    )
    return UpstreamError(f"unexpected data-layer response ({status})")


def parse_run(row: Any, *, now: datetime | None = None) -> RunOut:
    """A run row as the API shows it. Expiry is LAZY: a run still marked running past its expiry
    reads as expired."""
    try:
        data = dict(row)
        cancelled = data.pop("cancel_requested_at", None)
        data["cancel_requested"] = cancelled is not None
        run = RunOut.model_validate(data)
    except (ValidationError, TypeError, ValueError):
        logger.error("agent runs data layer returned a run that does not match RunOut")
        raise UpstreamError("unexpected row shape") from None
    if run.status == "running" and run.expires_at <= (now or datetime.now(UTC)):
        return run.model_copy(update={"status": "expired"})
    return run


def _evidence_out(item: dict[str, Any], link: dict[str, Any]) -> ClaimEvidenceOut:
    """One cited piece of evidence as a reviewer sees it: a host and a path (never a link) and the
    quote as stored."""
    host: str | None = None
    path: str | None = None
    url = item.get("url")
    if isinstance(url, str):
        try:
            parts = urlsplit(url)
            host, path = parts.hostname, parts.path or "/"
        except ValueError:
            host = path = None
    snippet = item.get("snippet")
    try:
        return ClaimEvidenceOut(
            kind=str(item["kind"]),
            stance=link["stance"],
            provider=str(item["provider"]),
            host=host,
            path=path,
            quote=snippet if isinstance(snippet, str) else None,
        )
    except (ValidationError, KeyError):
        logger.error("agent runs data layer returned evidence that does not match ClaimEvidenceOut")
        raise UpstreamError("unexpected row shape") from None


def _parse_claim(row: Any) -> ClaimSuggestionOut:
    try:
        data = dict(row)
        data.pop(
            "home_company_id", None
        )  # used to look up the company's name, not part of the answer
        return ClaimSuggestionOut.model_validate(data)
    except (ValidationError, TypeError, ValueError):
        logger.error(
            "agent runs data layer returned a claim that does not match ClaimSuggestionOut"
        )
        raise UpstreamError("unexpected row shape") from None


# ----------------------------------------------------------------------------- implementation
class PostgrestAgentRunsRepository:
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
        hide_denial: bool = False,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("agent runs data layer unreachable: %s", exc.__class__.__name__)
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
        raise classify_error(response.status_code, body, hide_denial=hide_denial)

    def _rpc(
        self, token: str, name: str, args: dict[str, Any], *, hide_denial: bool = False
    ) -> dict[str, Any]:
        result = self._send("POST", f"/rpc/{name}", token, json=args, hide_denial=hide_denial)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def _rows(self, path: str, token: str, params: dict[str, str]) -> list[Any]:
        rows = self._send("GET", path, token, params=params)
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        return rows

    # ------------------------------------------------------------------ runs
    def start_run(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        run_id: uuid.UUID,
        agent_name: str,
        agent_version: str,
        target_kind: str,
        target_id: uuid.UUID,
        input_sha256: str,
        input_refs: dict[str, Any],
    ) -> StartResult:
        result = self._rpc(
            token,
            "start_agent_run",
            {
                "p_run_id": str(run_id),
                "p_tenant_id": str(tenant_id),
                "p_agent_name": agent_name,
                "p_agent_version": agent_version,
                "p_target_kind": target_kind,
                "p_target_id": str(target_id),
                "p_input_sha256": input_sha256,
                "p_input_refs": input_refs,
            },
        )
        try:
            return StartResult(
                run_id=uuid.UUID(str(result["run_id"])),
                status=str(result["status"]),
                expires_at=datetime.fromisoformat(str(result["expires_at"])),
                replayed=bool(result["replayed"]),
            )
        except (KeyError, ValueError):
            raise UpstreamError("unexpected start result") from None

    def list_runs(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[RunOut]:
        params = {
            "select": RUN_SELECT,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
        }
        if cursor is not None:
            created_at, row_id = cursor  # validated by decode_cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id}))"
            )
        rows = self._rows("/agent_runs", token, params)
        items = [parse_run(row) for row in rows[:limit]]
        # the cursor is keyed on the stored created_at, so it is rebuilt from the raw row
        nxt = None
        if len(rows) > limit:
            last = rows[limit - 1]
            nxt = encode_cursor(
                datetime.fromisoformat(str(last["created_at"])), uuid.UUID(str(last["id"]))
            )
        return Page[RunOut](items=items, next_cursor=nxt)

    def get_run(self, token: str, tenant_id: uuid.UUID, run_id: uuid.UUID) -> RunOut | None:
        rows = self._rows(
            "/agent_runs",
            token,
            {
                "select": RUN_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{run_id}",
                "limit": "1",
            },
        )
        return parse_run(rows[0]) if rows else None

    def cancel_run(self, token: str, run_id: uuid.UUID) -> CancelOut:
        result = self._rpc(token, "cancel_agent_run", {"p_run_id": str(run_id)})
        try:
            return CancelOut.model_validate(result)
        except ValidationError:
            raise UpstreamError("unexpected cancel result") from None

    # ------------------------------------------------------------------ the tenant switch
    def get_enabled(self, token: str, tenant_id: uuid.UUID) -> AgentSettingsOut:
        rows = self._rows(
            "/tenant_agent_settings",
            token,
            {"select": "enabled", "tenant_id": f"eq.{tenant_id}", "limit": "1"},
        )
        return AgentSettingsOut(enabled=bool(rows[0].get("enabled")) if rows else False)

    def cost_summary(self, token: str, tenant_id: uuid.UUID) -> AgentCostOut:
        result = self._rpc(
            token, "agent_cost_summary", {"p_tenant_id": str(tenant_id)}, hide_denial=True
        )
        try:
            return AgentCostOut.model_validate(result)
        except ValidationError:
            logger.error("agent runs data layer returned a cost summary that does not match")
            raise UpstreamError("unexpected row shape") from None

    def set_enabled(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> AgentSettingsOut:
        result = self._rpc(
            token,
            "set_tenant_agents_enabled",
            {"p_tenant_id": str(tenant_id), "p_enabled": enabled},
        )
        return AgentSettingsOut(enabled=bool(result.get("enabled")))

    # ------------------------------------------------------------------ claims and reviews
    def list_claims(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        target_kind: str,
        target_id: uuid.UUID,
        limit: int,
    ) -> list[ClaimSuggestionOut]:
        # T007: a claim about a lead lives on the lead's company; the lead is its provenance. The
        # view derives both (and reads claims stored the old way): home_company_id, about_lead_id.
        column = "home_company_id" if target_kind == "company" else "about_lead_id"
        rows = self._rows(
            f"/{CLAIMS_EFFECTIVE}",
            token,
            {
                "select": CLAIM_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                column: f"eq.{target_id}",
                "archived_at": "is.null",
                "order": "created_at.desc,id.desc",
                "limit": str(limit),
            },
        )
        return self._with_context(token, tenant_id, rows)

    def list_agent_claims(
        self, token: str, tenant_id: uuid.UUID, *, state: str, limit: int
    ) -> list[ClaimSuggestionOut]:
        """Agent claims of the whole workspace, newest first: `state` is 'unreviewed' or 'all'.
        What the caller may see is decided by RLS (their own JWT)."""
        params = {
            "select": CLAIM_SELECT,
            "tenant_id": f"eq.{tenant_id}",
            "created_via": "eq.agent",
            "archived_at": "is.null",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
        }
        if state == "unreviewed":
            params["review_state"] = "eq.unreviewed"
        return self._with_context(
            token, tenant_id, self._rows(f"/{CLAIMS_EFFECTIVE}", token, params)
        )

    def _with_context(
        self, token: str, tenant_id: uuid.UUID, rows: list[Any]
    ) -> list[ClaimSuggestionOut]:
        """The claims, each with its company's name and the evidence it cites (live links only)."""
        claims = [_parse_claim(row) for row in rows]
        if not claims:
            return claims
        ids = ",".join(str(c.id) for c in claims)
        links = self._rows(
            "/evidence_links",
            token,
            {
                "select": "claim_id,evidence_id,stance",
                "tenant_id": f"eq.{tenant_id}",
                "claim_id": f"in.({ids})",
                "archived_at": "is.null",
                "limit": "1000",
            },
        )
        evidence_ids = sorted({str(link["evidence_id"]) for link in links})
        found: dict[str, dict[str, Any]] = {}
        if evidence_ids:
            for item in self._rows(
                "/evidence",
                token,
                {
                    "select": "id,kind,provider,url,snippet",
                    "tenant_id": f"eq.{tenant_id}",
                    "id": f"in.({','.join(evidence_ids)})",
                    "limit": "1000",
                },
            ):
                found[str(item["id"])] = item
        company_ids = sorted(
            {
                str(r["home_company_id"])
                for r in rows
                if isinstance(r, dict) and r.get("home_company_id")
            }
        )
        names: dict[str, str] = {}
        if company_ids:
            for item in self._rows(
                "/companies",
                token,
                {
                    "select": "id,name",
                    "tenant_id": f"eq.{tenant_id}",
                    "id": f"in.({','.join(company_ids)})",
                    "limit": "1000",
                },
            ):
                names[str(item["id"])] = str(item["name"])
        by_claim: dict[str, list[ClaimEvidenceOut]] = {}
        for link in links:
            item = found.get(str(link["evidence_id"]))
            if item is not None:
                by_claim.setdefault(str(link["claim_id"]), []).append(_evidence_out(item, link))
        out: list[ClaimSuggestionOut] = []
        for claim, row in zip(claims, rows, strict=True):
            home = row.get("home_company_id") if isinstance(row, dict) else None
            out.append(
                claim.model_copy(
                    update={
                        "company_name": names.get(str(home)) if home else None,
                        "evidence": by_claim.get(str(claim.id), []),
                    }
                )
            )
        return out

    def get_claim(
        self, token: str, tenant_id: uuid.UUID, claim_id: uuid.UUID
    ) -> ClaimSuggestionOut | None:
        rows = self._rows(
            f"/{CLAIMS_EFFECTIVE}",
            token,
            {
                "select": CLAIM_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{claim_id}",
                "limit": "1",
            },
        )
        return _parse_claim(rows[0]) if rows else None

    def review_claim(
        self,
        token: str,
        *,
        review_id: uuid.UUID,
        claim_id: uuid.UUID,
        decision: str,
        confidence: str | None,
        reason_code: str | None,
    ) -> ReviewOut:
        result = self._rpc(
            token,
            "review_claim",
            {
                "p_review_id": str(review_id),
                "p_claim_id": str(claim_id),
                "p_decision": decision,
                "p_confidence": confidence,
                "p_reason_code": reason_code,
            },
            hide_denial=True,
        )
        try:
            return ReviewOut.model_validate(result)
        except ValidationError:
            raise UpstreamError("unexpected review result") from None
