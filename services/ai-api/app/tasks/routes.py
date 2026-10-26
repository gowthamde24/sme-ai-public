"""Tasks under /v1/tenants/{tenant_id}/tasks (job DR B1). The contract is packages/contracts/tasks.* and docs/contracts/tasks.md.

  GET  /tasks/templates                          the seven ready-made templates (a school does not see the payment reminder)
  POST /tasks/plan                               Owner, Admin, Sales: an instruction (and an optional list) -> a Task: a plan, or ONE clarifying question
  POST /tasks/{id}/answer                        the answer to that question -> the planned Task
  GET  /tasks, GET /tasks/{id}                   the Task and its live progress (any member)
  GET  /tasks/{id}/contacts                      the people, paged
  POST /tasks/{id}/contacts/exclude              take people out (or back in) before approving
  POST /tasks/{id}/approve                       Owner + second factor: ONE approval for everyone who is not excluded; the run starts
  POST /tasks/{id}/run | pause | resume | cancel Owner, Admin
  POST /tasks/{id}/cap                           Owner + second factor: change the spending cap
  GET  /tasks/{id}/report                        the short answer first, then a row per person

Everything is simulated today: nothing is dialled and WhatsApp goes through the outbox with its own rules.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tasks.models import (
    AnswerIn,
    ApproveIn,
    CapIn,
    ExcludeIn,
    PlanIn,
    ReportOut,
    TaskContactsOut,
    TaskOut,
    TemplatesOut,
)
from app.tasks.service import TasksService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/tasks", tags=["tasks"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
Planner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
TaskStatus = Literal["needs_answer", "planned", "approved", "running", "paused", "done", "cancelled"]


def _service(runtime: Runtime) -> TasksService:
    if runtime.tasks is None:
        raise ApiError(503, "tasks_unavailable", "Tasks are not available right now.")
    return runtime.tasks


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _refusal(runtime: Runtime, ctx: TenantContext) -> Callable[[Any], Exception]:
    from app.assistant.routes import _refusal as assistant_refusal

    return lambda exc: assistant_refusal(exc, runtime.today, ctx.principal.token, ctx.tenant.id)


@router.get("/templates", response_model=TemplatesOut)
def templates(ctx: AnyMember, runtime: RuntimeDep) -> TemplatesOut:
    service = _service(runtime)
    return service.templates(service._school(runtime, ctx.principal.token, ctx.tenant.id))


@router.post("/plan", response_model=TaskOut, status_code=201)
def plan(body: PlanIn, ctx: Planner, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).plan(runtime, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, body, _refusal(runtime, ctx))


@router.get("", response_model=list[TaskOut])
def list_tasks(ctx: AnyMember, runtime: RuntimeDep, status: Annotated[TaskStatus | None, Query()] = None, limit: Annotated[int, Query(ge=1, le=100)] = 30, before: Annotated[datetime | None, Query()] = None) -> list[TaskOut]:
    return _service(runtime).list_tasks(ctx.principal.token, ctx.tenant.id, status, limit, before)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: str, ctx: AnyMember, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id, _id(task_id))


@router.post("/{task_id}/answer", response_model=TaskOut)
def answer(task_id: str, body: AnswerIn, ctx: Planner, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).answer(runtime, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, _id(task_id), body, _refusal(runtime, ctx))


@router.get("/{task_id}/contacts", response_model=TaskContactsOut)
def contacts(task_id: str, ctx: AnyMember, runtime: RuntimeDep, status: Annotated[Literal["waiting", "excluded", "in_progress", "done", "failed", "skipped"] | None, Query()] = None, limit: Annotated[int, Query(ge=1, le=200)] = 50, cursor: Annotated[str | None, Query()] = None) -> TaskContactsOut:
    after = int(cursor) if cursor and cursor.isdigit() else None
    return _service(runtime).contacts(ctx.principal.token, ctx.tenant.id, _id(task_id), status, limit, after)


@router.post("/{task_id}/contacts/exclude", response_model=TaskOut)
def exclude(task_id: str, body: ExcludeIn, ctx: Planner, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).exclude(ctx.principal.token, ctx.tenant.id, _id(task_id), [uuid.UUID(str(c)) for c in body.contact_ids], body.excluded)


@router.post("/{task_id}/approve", response_model=TaskOut)
def approve(task_id: str, body: ApproveIn, background: BackgroundTasks, ctx: OwnerStrong, runtime: RuntimeDep) -> TaskOut:
    service = _service(runtime)
    out = service.approve(ctx.principal.token, ctx.tenant.id, _id(task_id), body.plan_sha256, body.cap_paise)
    background.add_task(service.run, runtime, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, out.id)
    return out


@router.post("/{task_id}/run", response_model=TaskOut)
def run(task_id: str, background: BackgroundTasks, ctx: OwnerAdmin, runtime: RuntimeDep) -> TaskOut:
    service = _service(runtime)
    out = service.get(ctx.principal.token, ctx.tenant.id, _id(task_id))
    if out.status not in ("approved", "running"):
        raise ApiError(409, "task_state", "That task is not waiting to run.")
    background.add_task(service.run, runtime, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, out.id)
    return out


@router.post("/{task_id}/pause", response_model=TaskOut)
def pause(task_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).set_state(ctx.principal.token, ctx.tenant.id, _id(task_id), "pause")


@router.post("/{task_id}/resume", response_model=TaskOut)
def resume(task_id: str, background: BackgroundTasks, ctx: OwnerAdmin, runtime: RuntimeDep) -> TaskOut:
    service = _service(runtime)
    out = service.set_state(ctx.principal.token, ctx.tenant.id, _id(task_id), "resume")
    background.add_task(service.run, runtime, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, out.id)
    return out


@router.post("/{task_id}/cancel", response_model=TaskOut)
def cancel(task_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).set_state(ctx.principal.token, ctx.tenant.id, _id(task_id), "cancel")


@router.post("/{task_id}/cap", response_model=TaskOut)
def set_cap(task_id: str, body: CapIn, ctx: OwnerStrong, runtime: RuntimeDep) -> TaskOut:
    return _service(runtime).set_cap(ctx.principal.token, ctx.tenant.id, _id(task_id), body.cap_paise)


@router.get("/{task_id}/report", response_model=ReportOut)
def report(task_id: str, ctx: AnyMember, runtime: RuntimeDep) -> ReportOut:
    return _service(runtime).report(ctx.principal.token, ctx.tenant.id, _id(task_id))
