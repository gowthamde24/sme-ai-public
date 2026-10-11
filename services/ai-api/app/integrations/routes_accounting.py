"""POST /v1/tenants/{tenant_id}/exports/accounting (job BI, ADR 0073): the sales and payments of a date range as a Tally Prime, Vyapar, CSV or XLSX file.

  body:    {export_id (a uuid the client makes), format, from_date, to_date}   (India dates, at most 366 days)
  answer:  the file itself (Content-Disposition: attachment). Headers: X-Export-Id, X-Export-Sales, X-Export-Payments, X-Content-SHA256.
  who:     an Owner or an Admin with a second factor (aal2). Everything is read for THIS business only, by the database, with the caller's own token.
  audit:   the database writes the audit event (`export.create`: format, window, counts; no customer data) in the same transaction as the read, so no export exists without a record.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import ApiUuid, _Strict
from app.errors import ApiError
from app.integrations.export_service import DESCRIPTIONS, FORMATS, build_export
from app.integrations.repository import IntegrationsRepository
from app.tenancy.models import Role

logger = logging.getLogger("app.integrations.audit")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/exports", tags=["exports"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
Format = Literal["tally_zip", "tally_masters_xml", "tally_vouchers_xml", "vyapar_xlsx", "csv", "xlsx"]


class AccountingExportIn(_Strict):
    export_id: ApiUuid
    format: Format
    from_date: date
    to_date: date


def _integrations(runtime: Runtime) -> IntegrationsRepository:
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "Exports are not available on this system.")
    return runtime.integrations


@router.get("/accounting/formats")
def list_formats(ctx: AdminStrong) -> dict[str, list[dict[str, str]]]:
    """The formats an export can be made in, with a sentence each (for the format picker)."""
    return {"formats": [{"format": f, "description": DESCRIPTIONS[f]} for f in FORMATS]}


@router.post("/accounting")
def export_accounting(body: AccountingExportIn, ctx: AdminStrong, runtime: RuntimeDep) -> Response:
    if body.to_date < body.from_date or (body.to_date - body.from_date).days > 365:
        raise ApiError(422, "validation_error", "Choose dates in order, at most 366 days apart.")
    data = _integrations(runtime).export_data(
        ctx.principal.token, ctx.tenant.id, uuid.UUID(str(body.export_id)), body.format, body.from_date.isoformat(), body.to_date.isoformat()
    )
    file = build_export(body.format, data)
    # no customer data in this line: who, which business, which export, what shape, the file's hash
    logger.info(
        "export tenant=%s user=%s export=%s format=%s sales=%d payments=%d bytes=%d sha256=%s",
        ctx.tenant.id, ctx.principal.user_id, body.export_id, body.format, file.sales, file.payments, len(file.content), file.sha256,
    )  # fmt: skip
    return Response(
        content=file.content,
        media_type=file.media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{file.filename}"',
            "Cache-Control": "no-store",
            "X-Export-Id": str(body.export_id),
            "X-Export-Sales": str(file.sales),
            "X-Export-Payments": str(file.payments),
            "X-Content-SHA256": file.sha256,
        },
    )
