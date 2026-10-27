"""IndiaMART's pull through the new pipeline (job DR / A2): the same window and key as the existing connector (POST /connectors/indiamart/pull keeps working), but every buyer goes through
the de-duplication, the Do-Not-Disturb mark and the consent of the lead sources, with the tag `indiamart`."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.connectors.errors import ProviderError
from app.connectors.repository import tenant_args
from app.connectors.service import connectors_for
from app.errors import ApiError

if TYPE_CHECKING:
    from app.auth.deps import Runtime, TenantContext
    from app.lead_sources.service import LeadSourcesService
_NS = uuid.UUID("2b7d3a18-60f5-4a5e-8f31-c9a4d5e1b7f2")


def row_of(lead: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"external_id": lead.external_id, "name": lead.name}
    if lead.phone:
        row["phone"] = lead.phone
    if lead.email:
        row["email"] = lead.email
    if lead.message:
        row["message"] = lead.message
    if lead.received_at:
        row["received_at"] = lead.received_at.astimezone(UTC).isoformat()
    return row


def pull(runtime: Runtime, service: LeadSourcesService, ctx: TenantContext) -> dict[str, Any]:
    c = connectors_for(runtime, ctx.tenant.id, "indiamart")
    token, tenant = ctx.principal.token, ctx.tenant.id
    window = c.repo.call(token, "indiamart_pull_begin", tenant_args(tenant))   # refuses a second call within five minutes
    start, end = (datetime.fromisoformat(str(window[k])) for k in ("start", "end"))
    assert c.leads is not None  # noqa: S101 - connectors_for checked it
    try:
        leads = c.leads.pull(start, end)
    except ProviderError as exc:
        raise ApiError(502, f"indiamart_{exc.code}", "IndiaMART could not be reached or refused the request.") from None
    # the consent the owner confirmed when registering the IndiaMART source, if any
    consent_id: uuid.UUID | None = None
    for source in service.repo.sources(token, tenant):
        if source.get("kind") == "indiamart" and source.get("status") == "active" and source.get("consent_id"):
            consent_id = uuid.UUID(str(source["consent_id"]))
    prepared = service.prepare([row_of(lead) for lead in leads])
    import_id = uuid.uuid5(_NS, f"{tenant}:{end.isoformat()}")
    totals, _problems, _replayed = service._apply(token, tenant, import_id, "indiamart", "indiamart", consent_id, prepared, None, False, False)  # noqa: SLF001
    if totals.get("blocked", 0) == 0 and totals.get("invalid", 0) == 0:   # a window with a lead that was not taken is asked for again
        c.repo.call(token, "indiamart_pull_finish", tenant_args(tenant, end=end.isoformat(), count=len(leads)))
    return {
        "fetched": len(leads),
        "created": totals.get("ready", 0),
        "merged": totals.get("duplicates_merged", 0),
        "invalid": totals.get("invalid", 0),
        "existing": totals.get("already_imported", 0) + prepared.in_file,
        "window_start": start,
        "window_end": end,
    }
