"""The lead templates and the lead playbook (job DR / A1). The contract is docs/contracts/leads-pack.md.

  GET  /v1/lead-templates                          no sign-in: the nine business types for the template picker
  GET  /v1/lead-templates/{pack_id}                no sign-in: one full template (404 for a pack without one)
  GET  /v1/tenants/{t}/lead-playbook               any member: the playbook in force (the saved one, else the template), the defaults, the safety rules
  PUT  /v1/tenants/{t}/lead-playbook               Owner + second factor: save the Owner's edited version (422 playbook_invalid with a closed `reason`)
  POST /v1/tenants/{t}/lead-playbook/reset         Owner + second factor: back to the template (the API has no DELETE verb)

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.leadspack.models import PlaybookBody, PlaybookOut, TemplateOut, TemplatesOut
from app.leadspack.service import LeadPlaybookService, NoTemplate, PlaybookInvalid, reason_of
from app.leadspack.templates import default_templates
from app.tenancy.models import Role

public_router = APIRouter(prefix="/v1", tags=["lead-templates"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/lead-playbook", tags=["lead-playbook"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> LeadPlaybookService:
    if runtime.lead_playbook is None:
        raise ApiError(503, "lead_playbook_unavailable", "This is not available right now.")
    return runtime.lead_playbook


@public_router.get("/lead-templates", response_model=TemplatesOut)
def list_templates() -> JSONResponse:
    return JSONResponse(default_templates().summaries().model_dump(mode="json"), headers={"Cache-Control": "public, max-age=300"})


@public_router.get("/lead-templates/{pack_id}", response_model=TemplateOut)
def get_template(pack_id: str) -> JSONResponse:
    template = default_templates().get(pack_id)
    if template is None:
        raise not_found()
    return JSONResponse(template.model_dump(mode="json"), headers={"Cache-Control": "public, max-age=300"})


@router.get("", response_model=PlaybookOut)
def get_playbook(ctx: AnyMember, runtime: RuntimeDep) -> PlaybookOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


async def _body(request: Request) -> PlaybookBody:
    """Parsed here (not by FastAPI) so a refused edit can say WHY with a closed word. A body that is not a JSON object is the usual validation error."""
    try:
        raw: Any = json.loads(await request.body() or b"null")
    except ValueError:
        raw = None
    if not isinstance(raw, dict):
        raise RequestValidationError([{"type": "model_attributes_type", "loc": ("body",), "msg": "Input should be a valid dictionary or object", "input": None}])
    try:
        return PlaybookBody.model_validate(raw)
    except ValidationError as exc:
        raise ApiError(422, "playbook_invalid", "That playbook cannot be saved.", extra={"reason": reason_of(exc)}) from None


@router.put("", response_model=PlaybookOut)
async def put_playbook(request: Request, ctx: OwnerStrong, runtime: RuntimeDep) -> PlaybookOut:
    body = await _body(request)
    try:
        return _service(runtime).save(ctx.principal.token, ctx.tenant.id, body)
    except PlaybookInvalid as exc:
        raise ApiError(422, "playbook_invalid", "That playbook cannot be saved.", extra={"reason": exc.reason}) from None
    except NoTemplate:
        raise ApiError(409, "no_template", "This business type has no lead playbook.") from None


@router.post("/reset", response_model=PlaybookOut)
def reset_playbook(ctx: OwnerStrong, runtime: RuntimeDep) -> PlaybookOut:
    try:
        return _service(runtime).reset(ctx.principal.token, ctx.tenant.id)
    except NoTemplate:
        raise ApiError(409, "no_template", "This business type has no lead playbook.") from None
