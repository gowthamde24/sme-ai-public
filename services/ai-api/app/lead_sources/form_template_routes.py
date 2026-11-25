"""The lead-form templates (docs/contracts/commerce-notify.md section A). Off unless LEAD_FORM_TEMPLATES=on: every route here answers 404.

  GET  /v1/tenants/{t}/lead-sources/form-templates            Owner, Admin   the cards: id, name, group, channel
  GET  /v1/tenants/{t}/lead-sources/form-templates/{id}       Owner, Admin   one card: steps, the sample body, the field mapping, how consent is sent, what to verify, the address written in
  POST /v1/lead-intake/{token}/jotform                        NO sign-in: Jotform's webhook posts a multipart form whose `rawRequest` part holds the answers as JSON; the secret address is the credential

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.errors import ApiError, not_found
from app.lead_sources import form_templates
from app.lead_sources.models import ReceivedOut
from app.lead_sources.routes import _TOKEN_SHAPE, Manager, RuntimeDep, _body, _no_replay, _service

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["lead-sources"])
public_router = APIRouter(prefix="/v1/lead-intake", tags=["lead-intake"])


def _on() -> None:
    if not form_templates.ENABLED:
        raise not_found()


@router.get("/lead-sources/form-templates")
def form_template_list(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    _on()
    return {"templates": form_templates.listing(), "note": form_templates.note()}


@router.get("/lead-sources/form-templates/{template_id}")
def form_template_one(template_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    _on()
    base = (_service(runtime).base or "").rstrip("/")
    found = form_templates.template(template_id, f"{base}/v1/lead-intake/YOUR-ADDRESS" if base else "/v1/lead-intake/YOUR-ADDRESS")
    if found is None:
        raise not_found()
    return found


@public_router.post("/{token}/jotform", status_code=202)
async def intake_jotform(token: str, request: Request, runtime: RuntimeDep) -> JSONResponse:
    _on()
    if not _TOKEN_SHAPE.fullmatch(token):
        raise not_found()
    _no_replay(request)
    parts = form_templates.parse_multipart(request.headers.get("content-type", ""), await _body(request))
    if parts is None or "rawRequest" not in parts:
        raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]})
    _service(runtime).receive_form(token, parts)
    return JSONResponse(ReceivedOut().model_dump(), status_code=202, headers={"Cache-Control": "no-store"})
