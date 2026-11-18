"""Meta Lead Ads behind an interface (job DR / A2). Meta calls our webhook with a lead's id only; the lead itself is fetched from the Graph API with the page token. Written from Meta's public
documentation of the Lead Ads webhook ("leadgen" field of a Page) and the Graph API lead object (`field_data`); NOT run against Meta: that needs Meta's app verification and a page token, which are
the owner's to obtain. Until then `META_LEAD_PROVIDER` is off and the routes answer 503; `fake` creates canned leads for development and tests."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

logger = logging.getLogger("app.lead_sources.meta")
logging.getLogger("httpx").setLevel(logging.WARNING)   # its INFO line would carry the address, and the address carries the token
GRAPH = "https://graph.facebook.com/v21.0"
FORM_TTL_SECONDS = 3600.0   # how long a form's wording is kept
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="meta-form")   # the form-wording read that runs beside the lead read


class MetaError(Exception):
    """`reason` is a closed word and `detail` holds numbers only (the HTTP status and Meta's own error code and subcode): never what Meta wrote, never a lead's answers."""

    def __init__(self, reason: str = "failed", detail: str = "") -> None:
        super().__init__(reason)
        self.reason, self.detail = reason, detail


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
    placeholder = False
    data = graph_lead.get("field_data") if isinstance(graph_lead, dict) else None
    for item in data[:60] if isinstance(data, list) else []:
        if isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("values"), list) and item["values"]:
            value = str(item["values"][0])
            if value.lstrip().lower().startswith("<test lead"):   # Meta's Testing Tool fills a form with "<test lead: dummy data for full_name>": that is not a person's answer
                placeholder = True
                continue
            fields[item["name"].lower()] = value
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
    if is_test_lead(row, placeholder):
        row["is_test"] = True   # kept out of the reports and the counts (public.leads.is_test); the database marks it
    return row


TEST_EMAILS = frozenset({"test@meta.com", "test@fb.com", "test@facebook.com"})


def is_test_lead(row: dict[str, Any], placeholder: bool = False) -> bool:
    """A lead Meta's Testing Tool or test_leads made, or one with one of our own test numbers (+00 ...): never counted in a report."""
    phone = re.sub(r"\s", "", str(row.get("phone") or ""))
    return placeholder or phone.startswith("+00") or str(row.get("email") or "").strip().lower() in TEST_EMAILS


def consent_of(graph_lead: object) -> dict[str, Any] | None:
    """The answer to the form's consent checkbox, if the form has one: `{checkbox_key, ticked}` (Meta: `custom_disclaimer_responses: [{"checkbox_key": "...", "is_checked": "1"}]`). None: no checkbox on the form."""
    answers = graph_lead.get("custom_disclaimer_responses") if isinstance(graph_lead, dict) else None
    if not isinstance(answers, list) or not answers:
        return None
    ticks = [(str(a.get("checkbox_key") or "")[:60], str(a.get("is_checked")).strip().lower() in ("1", "true")) for a in answers[:10] if isinstance(a, dict)]
    if not ticks:
        return None
    # one required consent box is the rule of the form; with several, the person must have ticked ALL of them
    return {"checkbox_key": ticks[0][0], "ticked": all(t for _, t in ticks)}


def disclaimer_text_of(form: object) -> str | None:
    """The wording a form showed, from `legal_content.custom_disclaimer` (title, text, each checkbox's label), at most 800 characters; never a person's answer."""
    legal = form.get("legal_content") if isinstance(form, dict) else None
    disclaimer = legal.get("custom_disclaimer") if isinstance(legal, dict) else None
    if not isinstance(disclaimer, dict):
        return None
    parts: list[str] = []
    if isinstance(disclaimer.get("title"), str):
        parts.append(disclaimer["title"])
    body = disclaimer.get("body")
    if isinstance(body, dict) and isinstance(body.get("text"), str):
        parts.append(body["text"])
    for box in disclaimer.get("checkboxes", [])[:10] if isinstance(disclaimer.get("checkboxes"), list) else []:
        if isinstance(box, dict) and isinstance(box.get("text"), str):
            parts.append(box["text"])
    text = " ".join(" ".join(parts).split())[:800]
    return text or None


class GraphLeadFetcher:
    def __init__(self, page_token: str, *, client: httpx.Client | None = None, base_url: str = GRAPH) -> None:
        self._token = page_token
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
        self._forms: dict[str, tuple[float, str | None]] = {}   # form id -> (when it was read, its wording)
        self._lock = threading.Lock()

    def __repr__(self) -> str:
        return "GraphLeadFetcher(<token hidden>)"

    def fetch(self, ref: LeadgenRef) -> dict[str, Any]:
        # speed to lead (planner, 18 Nov 2026): the webhook already names the form, so the form's wording is asked AT THE SAME TIME as the lead (only when it is not kept yet), not after it
        hint = ref.form_id if ref.form_id and re.fullmatch(r"[0-9]{1,30}", ref.form_id) else None
        early = _POOL.submit(self._disclaimer, hint) if hint and not self._kept(hint) else None
        try:
            response = self._client.get(f"{self._base}/{ref.leadgen_id}", params={"access_token": self._token, "fields": "id,created_time,form_id,field_data,custom_disclaimer_responses"})
            body = response.json()
        except (httpx.HTTPError, ValueError):
            raise MetaError("unreachable") from None
        if response.status_code != 200 or not isinstance(body, dict):
            err: dict[str, Any] = {}
            if isinstance(body, dict) and isinstance(body.get("error"), dict):
                err = body["error"]
            numbers = " ".join(f"{k}={err[k]}" for k in ("code", "error_subcode") if isinstance(err.get(k), int))
            logger.warning("meta refused a lead fetch: http=%s %s", response.status_code, numbers)
            raise MetaError("refused", f"http={response.status_code} {numbers}".strip())
        row = lead_of(body)
        if not row.get("phone") and not row.get("email"):
            raise MetaError("no_contact")
        form_id = str(body.get("form_id") or ref.form_id or "")
        if re.fullmatch(r"[0-9]{1,30}", form_id):
            answer = consent_of(body)
            row["_consent"] = {"leadgen_id": str(body.get("id") or ref.leadgen_id)[:30], "form_id": form_id, "checkbox_key": answer["checkbox_key"] if answer else None,
                               "ticked": answer["ticked"] if answer else None, "disclaimer": (early.result() if early is not None and form_id == hint else self._disclaimer(form_id)) if answer else None}
        return row

    def _kept(self, form_id: str) -> bool:
        with self._lock:
            kept = self._forms.get(form_id)
        return kept is not None and time.monotonic() - kept[0] < FORM_TTL_SECONDS

    def _disclaimer(self, form_id: str) -> str | None:
        """The form's wording, asked once per form and kept for an hour (a form's wording is the business's own: it does not change per lead, and an edit shows within the hour)."""
        with self._lock:
            kept = self._forms.get(form_id)
        if kept is not None and time.monotonic() - kept[0] < FORM_TTL_SECONDS:
            return kept[1]
        text: str | None = None
        try:
            response = self._client.get(f"{self._base}/{form_id}", params={"access_token": self._token, "fields": "legal_content"})
            if response.status_code == 200:
                text = disclaimer_text_of(response.json())
        except (httpx.HTTPError, ValueError):
            logger.warning("meta: the wording of a lead form could not be read")
            return None   # not kept: the next lead asks again
        with self._lock:
            if len(self._forms) < 100 or form_id in self._forms:
                self._forms[form_id] = (time.monotonic(), text)
        return text


class FakeMetaFetcher:
    """Development and tests: lead id -> row (any other id gets a canned invented lead)."""

    def __init__(self, leads: dict[str, dict[str, Any]] | None = None) -> None:
        self.leads = dict(leads or {})
        self.fetched: list[str] = []

    def fetch(self, ref: LeadgenRef) -> dict[str, Any]:
        self.fetched.append(ref.leadgen_id)
        return dict(self.leads.get(ref.leadgen_id) or {"name": "Invented Meta Lead", "phone": "+00 90000 07777", "external_id": ref.leadgen_id})
