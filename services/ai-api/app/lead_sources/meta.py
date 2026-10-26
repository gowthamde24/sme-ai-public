"""Meta Lead Ads behind an interface (job DR / A2). Meta calls our webhook with a lead's id only; the lead itself is fetched from the Graph API with the page token. Written from Meta's public
documentation of the Lead Ads webhook ("leadgen" field of a Page) and the Graph API lead object (`field_data`); NOT run against Meta: that needs Meta's app verification and a page token, which are
the owner's to obtain. Until then `META_LEAD_PROVIDER` is off and the routes answer 503; `fake` creates canned leads for development and tests."""

from __future__ import annotations

import hashlib
import hmac
import logging
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

logger = logging.getLogger("app.lead_sources.meta")
logging.getLogger("httpx").setLevel(logging.WARNING)   # its INFO line would carry the address, and the address carries the token
GRAPH = "https://graph.facebook.com/v21.0"


class MetaError(Exception):
    pass


@dataclass(frozen=True)
class LeadgenRef:
    leadgen_id: str
    page_id: str | None = None
    form_id: str | None = None


class MetaLeadFetcher(Protocol):
    def fetch(self, ref: LeadgenRef) -> dict[str, Any]:
        """The lead as {name, phone, email, city, message, external_id}; raises MetaError."""
        ...


def signature_ok(app_secret: str, body: bytes, header: str | None) -> bool:
    """Meta signs the raw body: `X-Hub-Signature-256: sha256=<hex hmac>`."""
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):])


def refs_of(payload: object) -> list[LeadgenRef]:
    """The lead ids in a webhook payload ({"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": ...}}]}]})."""
    out: list[LeadgenRef] = []
    if not isinstance(payload, dict):
        return out
    for entry in payload.get("entry", [])[:50] if isinstance(payload.get("entry"), list) else []:
        for change in entry.get("changes", [])[:50] if isinstance(entry, dict) and isinstance(entry.get("changes"), list) else []:
            value = change.get("value") if isinstance(change, dict) and change.get("field") == "leadgen" else None
            if isinstance(value, dict) and isinstance(value.get("leadgen_id"), (str, int)) and not isinstance(value.get("leadgen_id"), bool):
                out.append(LeadgenRef(str(value["leadgen_id"])[:40], str(value.get("page_id") or "")[:40] or None, str(value.get("form_id") or "")[:40] or None))
    return out


def lead_of(graph_lead: object) -> dict[str, Any]:
    """A Graph lead object ({"id", "field_data": [{"name": "full_name", "values": ["..."]}]}) as a lead row."""
    fields: dict[str, str] = {}
    data = graph_lead.get("field_data") if isinstance(graph_lead, dict) else None
    for item in data[:60] if isinstance(data, list) else []:
        if isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("values"), list) and item["values"]:
            fields[item["name"].lower()] = str(item["values"][0])
    name = fields.get("full_name") or " ".join(p for p in (fields.get("first_name"), fields.get("last_name")) if p)
    row: dict[str, Any] = {}
    if name:
        row["name"] = name[:200]
    if fields.get("phone_number") or fields.get("phone"):
        row["phone"] = (fields.get("phone_number") or fields.get("phone", ""))[:32]
    if fields.get("email"):
        row["email"] = fields["email"][:254]
    if fields.get("city"):
        row["city"] = fields["city"][:100]
    if isinstance(graph_lead, dict) and isinstance(graph_lead.get("id"), (str, int)):
        row["external_id"] = str(graph_lead["id"])[:100]
    return row


class GraphLeadFetcher:
    def __init__(self, page_token: str, *, client: httpx.Client | None = None, base_url: str = GRAPH) -> None:
        self._token = page_token
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "GraphLeadFetcher(<token hidden>)"

    def fetch(self, ref: LeadgenRef) -> dict[str, Any]:
        try:
            response = self._client.get(f"{self._base}/{ref.leadgen_id}", params={"access_token": self._token})
            body = response.json()
        except (httpx.HTTPError, ValueError):
            raise MetaError("unreachable") from None
        if response.status_code != 200 or not isinstance(body, dict):
            logger.warning("meta refused a lead fetch: http=%s", response.status_code)
            raise MetaError("refused")
        row = lead_of(body)
        if not row.get("phone") and not row.get("email"):
            raise MetaError("no_contact")
        return row


class FakeMetaFetcher:
    """Development and tests: lead id -> row (any other id gets a canned invented lead)."""

    def __init__(self, leads: dict[str, dict[str, Any]] | None = None) -> None:
        self.leads = dict(leads or {})
        self.fetched: list[str] = []

    def fetch(self, ref: LeadgenRef) -> dict[str, Any]:
        self.fetched.append(ref.leadgen_id)
        return dict(self.leads.get(ref.leadgen_id) or {"name": "Invented Meta Lead", "phone": "+00 90000 07777", "external_id": ref.leadgen_id})
