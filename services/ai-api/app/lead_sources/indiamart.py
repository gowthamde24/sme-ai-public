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


def _source(runtime: Runtime, token: str, tenant: uuid.UUID) -> tuple[Any, Any]:
    """The workspace's OWN key when it saved one (Secret Manager, owner decision 5 Nov 2026), else the installation's key for its one workspace, as before."""
    from app.workspace_secrets import SecretStoreError

    secrets = getattr(runtime, "workspace_secrets", None)
    if secrets is not None:
        try:
            own = secrets.key(token, tenant, "indiamart_key")
        except SecretStoreError:
            raise ApiError(503, "indiamart_key_unreadable", "Your IndiaMART key could not be read right now. Try again in a minute.") from None
        if own:
            from app.connectors.indiamart import IndiaMartPull

            return secrets.connectors, IndiaMartPull(own)
    c = connectors_for(runtime, tenant, "indiamart")
    return c.repo, c.leads


def pull(runtime: Runtime, service: LeadSourcesService, ctx: TenantContext) -> dict[str, Any]:
    token, tenant = ctx.principal.token, ctx.tenant.id
    repo, source = _source(runtime, token, tenant)
    window = repo.call(token, "indiamart_pull_begin", tenant_args(tenant))   # refuses a second call within five minutes
    start, end = (datetime.fromisoformat(str(window[k])) for k in ("start", "end"))
    assert source is not None  # noqa: S101 - connectors_for checked it
    try:
        leads = source.pull(start, end)
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
        repo.call(token, "indiamart_pull_finish", tenant_args(tenant, end=end.isoformat(), count=len(leads)))
    return {
        "fetched": len(leads),
        "created": totals.get("ready", 0),
        "merged": totals.get("duplicates_merged", 0),
        "invalid": totals.get("invalid", 0),
        "existing": totals.get("already_imported", 0) + prepared.in_file,
        "window_start": start,
        "window_end": end,
    }


def check(runtime: Runtime, service: LeadSourcesService, ctx: TenantContext) -> dict[str, Any]:
    """The setup card's "Pull now" (owner, 5 Nov 2026). With the workspace's OWN key only. While the workspace takes synthetic data only (the real-data gate is closed, or cannot be read: closed),
    the key is CHECKED with one read of the last day and NOTHING is imported; with the gate open, the ordinary pull runs. Answers the setup test's shape {ok, reason, detail} (no key, no lead)."""
    from datetime import timedelta

    from app.workspace_secrets import SecretStoreError

    token, tenant = ctx.principal.token, ctx.tenant.id
    secrets = getattr(runtime, "workspace_secrets", None)
    if secrets is None:
        return {"ok": False, "reason": "no_key", "detail": "Your own IndiaMART key can't be saved here yet."}
    try:
        own = secrets.key(token, tenant, "indiamart_key")
    except SecretStoreError:
        return {"ok": False, "reason": "not_reachable", "detail": "Your key could not be read right now. Try again in a minute."}
    if not own:
        return {"ok": False, "reason": "no_key", "detail": "Paste your IndiaMART CRM key first."}
    gate_open = False
    erasure = getattr(runtime, "erasure", None)
    if erasure is not None:
        try:
            gate_open = bool(erasure.data_policy(token, tenant).real_data_allowed)
        except Exception:   # noqa: BLE001 - unreadable = closed
            gate_open = False
    if gate_open:
        try:
            out = pull(runtime, service, ctx)
        except ApiError as exc:
            return {"ok": False, "reason": "key_rejected" if exc.code == "indiamart_unauthorized" else "not_reachable", "detail": "IndiaMART did not accept the pull right now."}
        return {"ok": True, "reason": None, "detail": f"It works: {out['fetched']} enquiries read, {out['created']} new leads added."}
    from app.connectors.indiamart import IndiaMartPull

    end = datetime.now(UTC)
    try:
        leads = IndiaMartPull(own).pull(end - timedelta(days=1), end)
    except ProviderError as exc:
        reason = "key_rejected" if exc.code == "unauthorized" else "timeout" if exc.code == "timeout" else "not_reachable"
        return {"ok": False, "reason": reason, "detail": "IndiaMART did not accept this key." if reason == "key_rejected" else "IndiaMART could not be reached right now. Try again later."}
    return {"ok": True, "reason": None, "detail": f"Your key works: IndiaMART has {len(leads)} enquiries from the last day. Nothing was imported: this workspace takes example data only."}
