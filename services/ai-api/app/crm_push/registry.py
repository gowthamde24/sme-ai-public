"""The connector types: one adapter each, and how each is described to the Connectors page (plain words, the fields to type, the mapping choices). 'Send results to a web address' is not an adapter here: it is the outbound
webhook path (app/webhooks_out), shown on the same page."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.config import Settings
from app.crm_push.adapters.airtable import Airtable
from app.crm_push.adapters.base import Adapter
from app.crm_push.adapters.bitrix24 import Bitrix24
from app.crm_push.adapters.freshsales import Freshsales
from app.crm_push.adapters.hubspot import HubSpot
from app.crm_push.adapters.kylas import Kylas
from app.crm_push.adapters.leadsquared import LeadSquared
from app.crm_push.adapters.notion import Notion
from app.crm_push.adapters.oauth import Salesforce, ZohoCrm
from app.crm_push.adapters.pipedrive import Pipedrive
from app.crm_push.adapters.selldo import SellDo
from app.crm_push.adapters.sheets import GoogleSheets
from app.crm_push.fields import EVENTS, NOTE, OUR_FIELDS

ORDER = ("hubspot", "zoho_crm", "leadsquared", "selldo", "pipedrive", "freshsales", "kylas", "bitrix24", "salesforce", "google_sheets", "airtable", "notion")
EVENT_WORDS = {
    "call.completed": "A call was answered and ended",
    "call.missed": "A call was not answered",
    "lead.created": "A new lead came in",
    "lead.updated": "A lead changed",
    "job.outcome": "A result was recorded for a call or follow-up",
}
FIELD_WORDS = {
    "name": "Name", "phone": "Phone number", "email": "Email", "source": "Where the lead came from", "outcome": "What came of the call", "summary": "Summary of the call",
    "captured": "Details the assistant took down", "duration": "Call length", "call_id": "Call reference", "event": "What happened", "ref": "Reference (stops the same event being written twice)",
}


def build_registry(settings: Settings | None = None) -> dict[str, Adapter]:
    def secret(v: Any) -> str | None:
        return v.get_secret_value() if v is not None else None

    zoho_id = getattr(settings, "crm_push_zoho_client_id", None) if settings else None
    zoho_secret = secret(getattr(settings, "crm_push_zoho_client_secret", None)) if settings else None
    sf_id = getattr(settings, "crm_push_salesforce_client_id", None) if settings else None
    sf_secret = secret(getattr(settings, "crm_push_salesforce_client_secret", None)) if settings else None
    adapters: list[Adapter] = [HubSpot(), ZohoCrm(zoho_id, zoho_secret), LeadSquared(), SellDo(), Pipedrive(), Freshsales(), Kylas(), Bitrix24(), Salesforce(sf_id, sf_secret), GoogleSheets(), Airtable(), Notion()]
    return {a.spec.key: a for a in adapters}


def describe(adapter: Adapter, connection: dict[str, Any] | None) -> dict[str, Any]:
    """One card of the Connectors page. A connection's keys are never part of it."""
    spec = adapter.spec
    state = "needs_setup" if spec.needs_setup else ("connected" if connection is not None else "not_connected")
    out: dict[str, Any] = {
        "type": spec.key, "label": spec.label, "state": state, "needs_setup": spec.needs_setup or None,
        "credentials": [{"key": s.key, "label": s.label, "help": s.help, "example": s.example} for s in spec.credentials],
        "settings": [{"key": s.key, "label": s.label, "help": s.help, "example": s.example} for s in spec.settings],
        "targets": [{"field": f, "label": label} for f, label in spec.targets],
        "our_fields": [{"key": k, "label": FIELD_WORDS[k]} for k in spec.our_fields],
        "default_mapping": spec.default_mapping, "uses_notes": spec.notes, "note_value": NOTE, "setup_steps": list(spec.setup_steps),
        "connection": connection,
    }
    script = getattr(adapter, "script", None)
    if script:
        out["script"] = script
    return out


_ = (EVENTS, OUR_FIELDS)
