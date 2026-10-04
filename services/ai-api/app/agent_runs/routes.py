"""Agent-run endpoints under /v1/tenants/{tenant_id}/...

Authorization, in order, for every endpoint (as for the CRM and evidence routes):
  1. a valid JWT (401);
  2. membership of the tenant in the PATH (a tenant the caller does not belong to is a 404);
  3. a role that may perform the action (403);
  4. the target / run / claim in the path must exist FOR THIS CALLER (404 otherwise:
     unknown, malformed and
     foreign ids look the same);
  5. the database: RLS, the definer functions and their switches decide again.
There is no endpoint for the platform switch (the operator uses SQL), none to write evidence
or claims (only a run does,
through the database functions), and none that takes a tenant, an origin or a confidence from
the body.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py
(request models are attached to the endpoint signatures at registration time)."""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.agent_runs.executor import ExecutorBusy, RunTask
from app.agent_runs.models import (
    AgentSettingsIn,
    AgentSettingsOut,
    CancelOut,
    ClaimSuggestionOut,
    ReviewIn,
    ReviewOut,
    RunOut,
    RunStart,
)
from app.agent_runs.wiring import AgentsRuntime
from app.agents.inputs import input_sha256, model_input_from_company
from app.agents.registry import AGENTS
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CursorError, Page, decode_cursor, parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role

logger = logging.getLogger("app.agent_runs.routes")

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
ADMIN_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN)

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(*ADMIN_PLUS))]

TARGET_ENTITY = {"company": "companies", "lead": "leads"}


def _agents(runtime: Runtime) -> AgentsRuntime:
    if runtime.agents is None:
        raise ApiError(503, "agents_unavailable", "Agents are not available right now.")
    return runtime.agents


def _row_id(raw: str) -> uuid.UUID:
    """A malformed id is simply a row that does not exist."""
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _target_company(
    runtime: Runtime, ctx: TenantContext, body: RunStart
) -> tuple[dict[str, Any], dict[str, Any]]:
    """(the company row's fields, the typed refs of the run) for a target the CALLER can see."""
    token, tenant = ctx.principal.token, ctx.tenant.id
    target = runtime.crm.get_row(token, TARGET_ENTITY[body.target_kind], tenant, body.target_id)
    if target is None:
        raise not_found()
    if target.archived_at is not None:
        raise ApiError(409, "archived", "This record is archived; an admin must restore it first.")
    if body.target_kind == "company":
        return target.model_dump(), {"company_id": str(body.target_id)}
    refs: dict[str, Any] = {"lead_id": str(body.target_id)}
    if target.company_id is None:
        return {}, refs
    company = runtime.crm.get_row(token, "companies", tenant, target.company_id)
    if company is None:
        return {}, refs
    refs["company_id"] = str(target.company_id)
    return company.model_dump(), refs


@router.post("/agent-runs", response_model=RunOut, status_code=202)
def start_run(body: RunStart, ctx: SalesPlus, runtime: RuntimeDep, response: Response) -> RunOut:
    agents = _agents(runtime)
    if agents.unavailable is not None or agents.executor is None:
        raise ApiError(503, "agents_unavailable", "Agents are not available right now.")
    if not agents.executor.has_capacity():
        raise ApiError(503, "agents_busy", "Agents are busy. Try again shortly.")
    spec = AGENTS[body.agent]
    company, refs = _target_company(runtime, ctx, body)
    started = agents.repository.start_run(
        ctx.principal.token,
        ctx.tenant.id,
        run_id=body.id,
        agent_name=spec.name,
        agent_version=spec.version,
        target_kind=body.target_kind,
        target_id=body.target_id,
        input_sha256=input_sha256(model_input_from_company(company)),
        input_refs=refs,
    )
    if not started.replayed:
        try:
            agents.executor.submit(RunTask(run_id=started.run_id, token=ctx.principal.token))
        except ExecutorBusy:
            logger.warning("agent run %s could not be queued; cancelling it", started.run_id)
            try:
                agents.repository.cancel_run(ctx.principal.token, started.run_id)
            except Exception as exc:  # best effort: the run expires on its own
                logger.warning("cancel after a refused queue failed: %s", exc.__class__.__name__)
            raise ApiError(503, "agents_busy", "Agents are busy. Try again shortly.") from None
    run = agents.repository.get_run(ctx.principal.token, ctx.tenant.id, started.run_id)
    if run is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    response.status_code = 200 if started.replayed else 202
    return run


@router.get("/agent-runs", response_model=Page[RunOut])
def list_runs(
    ctx: AnyMember,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=300)] = None,
) -> Page[RunOut]:
    decoded = None
    if cursor is not None:
        try:
            decoded = decode_cursor(cursor)
        except CursorError:
            raise ApiError(422, "validation_error", "Invalid input: cursor.") from None
    return _agents(runtime).repository.list_runs(
        ctx.principal.token, ctx.tenant.id, limit=limit, cursor=decoded
    )


def _visible_run(runtime: Runtime, ctx: TenantContext, raw_id: str) -> RunOut:
    run = _agents(runtime).repository.get_run(ctx.principal.token, ctx.tenant.id, _row_id(raw_id))
    if run is None:
        raise not_found()
    return run


@router.get("/agent-runs/{run_id}", response_model=RunOut)
def get_run(run_id: str, ctx: AnyMember, runtime: RuntimeDep) -> RunOut:
    return _visible_run(runtime, ctx, run_id)


@router.post("/agent-runs/{run_id}/cancel", response_model=CancelOut)
def cancel_run(run_id: str, ctx: AnyMember, runtime: RuntimeDep) -> CancelOut:
    run = _visible_run(runtime, ctx, run_id)  # a run the caller cannot see does not exist for them
    return _agents(runtime).repository.cancel_run(ctx.principal.token, run.id)


@router.get("/agent-settings", response_model=AgentSettingsOut)
def get_settings(ctx: AnyMember, runtime: RuntimeDep) -> AgentSettingsOut:
    return _agents(runtime).repository.get_enabled(ctx.principal.token, ctx.tenant.id)


@router.put("/agent-settings", response_model=AgentSettingsOut)
def put_settings(body: AgentSettingsIn, ctx: AdminPlus, runtime: RuntimeDep) -> AgentSettingsOut:
    return _agents(runtime).repository.set_enabled(ctx.principal.token, ctx.tenant.id, body.enabled)


def _register_claims(segment: str, kind: str) -> None:
    def list_claims(
        target_id: str,
        ctx: AnyMember,
        runtime: RuntimeDep,
        limit: Annotated[int, Query(ge=1, le=100)] = 100,
    ) -> list[ClaimSuggestionOut]:
        tid = _row_id(target_id)
        if (
            runtime.crm.get_row(ctx.principal.token, TARGET_ENTITY[kind], ctx.tenant.id, tid)
            is None
        ):
            raise not_found()
        return _agents(runtime).repository.list_claims(
            ctx.principal.token, ctx.tenant.id, target_kind=kind, target_id=tid, limit=limit
        )

    router.add_api_route(
        f"/{segment}/{{target_id}}/claims",
        list_claims,
        methods=["GET"],
        response_model=list[ClaimSuggestionOut],
        name=f"list_{segment}_claims",
    )


_register_claims("companies", "company")
_register_claims("leads", "lead")


@router.post("/claims/{claim_id}/reviews", response_model=ReviewOut, status_code=201)
def review_claim(
    claim_id: str, body: ReviewIn, ctx: AdminPlus, runtime: RuntimeDep, response: Response
) -> ReviewOut:
    agents = _agents(runtime)
    cid = _row_id(claim_id)
    # the claim must be visible in THIS tenant (the database derives the tenant from the claim
    # itself)
    if agents.repository.get_claim(ctx.principal.token, ctx.tenant.id, cid) is None:
        raise not_found()
    out = agents.repository.review_claim(
        ctx.principal.token,
        review_id=body.id,
        claim_id=cid,
        decision=body.decision,
        confidence=body.confidence,
        reason_code=body.reason_code,
    )
    response.status_code = 200 if out.replayed else 201
    return out
