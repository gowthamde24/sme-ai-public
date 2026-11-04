"""Speed to lead and "approve once" under /v1/tenants/{tenant_id}/outreach (job DR A3). The contract is packages/contracts/outreach.*

  GET  /policy                          Owner, Admin        the calling policy and the hours in force
  PUT  /policy                          Owner + 2nd factor  change any of it
  POST /batches                         Owner, Admin, Sales build a draft plan (the client chooses the id; the same id again re-plans while still a draft)
  GET  /batches[?status=]               Owner, Admin, Sales
  GET  /batches/{id}                    Owner, Admin, Sales the batch, its plan, its progress
  GET  /batches/{id}/items[?cursor=]    Owner, Admin, Sales one row per contact
  POST /batches/{id}/exclude            Owner, Admin        take people out (changes the plan hash while it is a draft)
  POST /batches/{id}/approve            Owner + 2nd factor  approve all; the plan hash binds it to what was shown (409 plan_changed otherwise)
  POST /batches/{id}/(pause|resume)     Owner, Admin
  POST /batches/{id}/cancel             Owner
  PUT  /batches/{id}/caps               Owner + 2nd factor  raise or lower the caps (a batch paused by them can then resume)
  GET  /rules   POST /rules             Owner, Admin read; Owner + 2nd factor approves a standing rule per lead source
  POST /rules/{id}/(pause|resume)       Owner, Admin
  PUT  /rules/{id}/caps                 Owner + 2nd factor
  POST /items/{id}/result               Owner, Admin, Sales what happened on one call
  GET  /handoffs[?open=true]            Owner, Admin, Sales; POST /handoffs/{id}/acted
  GET  /reports?from=&to=               every member
  GET/PUT /source-costs                 Owner, Admin read; Owner sets

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.outreach import models as m
from app.outreach.service import OutreachService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/outreach", tags=["outreach"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Staff = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Deciders = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> OutreachService:
    if runtime.outreach is None:
        raise ApiError(503, "outreach_unavailable", "This is not available right now.")
    return runtime.outreach


@router.get("/policy", response_model=m.PolicyOut)
def get_policy(ctx: Deciders, runtime: RuntimeDep) -> m.PolicyOut:
    return _service(runtime).policy(ctx.principal.token, ctx.tenant.id)


@router.put("/policy", response_model=m.PolicyOut)
def put_policy(body: m.PolicyIn, ctx: OwnerStrong, runtime: RuntimeDep) -> m.PolicyOut:
    return _service(runtime).policy_save(ctx.principal.token, ctx.tenant.id, body)


@router.post("/batches", response_model=m.BatchAnswer, status_code=201)
def plan_batch(body: m.BatchIn, ctx: Staff, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).plan(ctx.principal.token, ctx.tenant.id, body)


@router.get("/batches", response_model=list[m.BatchAnswer])
def list_batches(ctx: Staff, runtime: RuntimeDep, status: Literal["planned", "running", "paused", "done", "cancelled"] | None = None) -> list[m.BatchAnswer]:
    return _service(runtime).batches(ctx.principal.token, ctx.tenant.id, status)


@router.get("/batches/{batch_id}", response_model=m.BatchAnswer)
def get_batch(batch_id: uuid.UUID, ctx: Staff, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).batch(ctx.principal.token, ctx.tenant.id, batch_id)


@router.get("/batches/{batch_id}/items", response_model=m.ItemsOut)
def batch_items(batch_id: uuid.UUID, ctx: Staff, runtime: RuntimeDep, cursor: Annotated[str | None, Query(max_length=200)] = None) -> m.ItemsOut:
    return _service(runtime).items(ctx.principal.token, ctx.tenant.id, batch_id, cursor)


@router.post("/batches/{batch_id}/exclude", response_model=m.BatchAnswer)
def exclude(batch_id: uuid.UUID, body: m.ExcludeIn, ctx: Deciders, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).exclude(ctx.principal.token, ctx.tenant.id, batch_id, body)


@router.post("/batches/{batch_id}/approve", response_model=m.BatchAnswer)
def approve(batch_id: uuid.UUID, body: m.ApproveIn, ctx: OwnerStrong, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).approve(ctx.principal.token, ctx.tenant.id, batch_id, body)


@router.post("/batches/{batch_id}/pause", response_model=m.BatchAnswer)
def pause(batch_id: uuid.UUID, ctx: Deciders, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).batch_state(ctx.principal.token, ctx.tenant.id, batch_id, "pause")


@router.post("/batches/{batch_id}/resume", response_model=m.BatchAnswer)
def resume(batch_id: uuid.UUID, ctx: Deciders, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).batch_state(ctx.principal.token, ctx.tenant.id, batch_id, "resume")


@router.post("/batches/{batch_id}/cancel", response_model=m.BatchAnswer)
def cancel(batch_id: uuid.UUID, ctx: OwnerOnly, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).batch_state(ctx.principal.token, ctx.tenant.id, batch_id, "cancel")


@router.put("/batches/{batch_id}/caps", response_model=m.BatchAnswer)
def batch_caps(batch_id: uuid.UUID, body: m.CapsIn, ctx: OwnerStrong, runtime: RuntimeDep) -> m.BatchAnswer:
    return _service(runtime).batch_caps(ctx.principal.token, ctx.tenant.id, batch_id, body)


@router.get("/rules", response_model=list[m.RuleOut])
def list_rules(ctx: Deciders, runtime: RuntimeDep) -> list[m.RuleOut]:
    return _service(runtime).rules(ctx.principal.token, ctx.tenant.id)


@router.post("/rules", response_model=m.RuleOut, status_code=201)
def save_rule(body: m.RuleIn, ctx: OwnerStrong, runtime: RuntimeDep) -> m.RuleOut:
    return _service(runtime).rule_save(ctx.principal.token, ctx.tenant.id, body)


@router.post("/rules/{rule_id}/pause", response_model=m.RuleOut)
def pause_rule(rule_id: uuid.UUID, ctx: Deciders, runtime: RuntimeDep) -> m.RuleOut:
    return _service(runtime).rule_state(ctx.principal.token, ctx.tenant.id, rule_id, "pause")


@router.post("/rules/{rule_id}/resume", response_model=m.RuleOut)
def resume_rule(rule_id: uuid.UUID, ctx: Deciders, runtime: RuntimeDep) -> m.RuleOut:
    return _service(runtime).rule_state(ctx.principal.token, ctx.tenant.id, rule_id, "resume")


@router.put("/rules/{rule_id}/caps", response_model=m.RuleOut)
def rule_caps(rule_id: uuid.UUID, body: m.CapsIn, ctx: OwnerStrong, runtime: RuntimeDep) -> m.RuleOut:
    return _service(runtime).rule_caps(ctx.principal.token, ctx.tenant.id, rule_id, body)


@router.post("/items/{item_id}/result", response_model=m.ResultOut)
def item_result(item_id: uuid.UUID, body: m.ResultIn, ctx: Staff, runtime: RuntimeDep) -> m.ResultOut:
    return _service(runtime).result(ctx.principal.token, ctx.tenant.id, item_id, body)


@router.get("/handoffs", response_model=list[m.HandoffOut])
def list_handoffs(ctx: Staff, runtime: RuntimeDep, open: bool = True) -> list[m.HandoffOut]:  # noqa: A002 (the query word of the contract)
    return _service(runtime).handoffs(ctx.principal.token, ctx.tenant.id, open)


@router.post("/handoffs/{handoff_id}/acted", response_model=m.HandoffOut)
def handoff_acted(handoff_id: uuid.UUID, ctx: Staff, runtime: RuntimeDep) -> m.HandoffOut:
    return _service(runtime).handoff_acted(ctx.principal.token, ctx.tenant.id, handoff_id)


@router.get("/reports", response_model=m.ReportOut)
def reports(ctx: AnyMember, runtime: RuntimeDep, from_: Annotated[date | None, Query(alias="from")] = None, to: date | None = None) -> m.ReportOut:
    return _service(runtime).report(ctx.principal.token, ctx.tenant.id, from_, to)


@router.get("/source-costs", response_model=list[m.SourceCostOut])
def get_source_costs(ctx: Deciders, runtime: RuntimeDep) -> list[m.SourceCostOut]:
    return _service(runtime).source_costs(ctx.principal.token, ctx.tenant.id)


@router.put("/source-costs", response_model=list[m.SourceCostOut])
def put_source_costs(body: m.SourceCostsIn, ctx: OwnerOnly, runtime: RuntimeDep) -> list[m.SourceCostOut]:
    return _service(runtime).source_costs_save(ctx.principal.token, ctx.tenant.id, body)
