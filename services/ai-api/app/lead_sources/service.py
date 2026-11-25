"""What the lead sources do between a file, a form or a portal and the database (job DR / A2). The API reads and cleans; the DATABASE de-duplicates, flags, records consent and writes
(app.lead_intake_core), so a file, a form and a sheet all end up the same way. Nothing from a file or a message is logged; no secret address is stored (only its hash)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import html
import logging
import re
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.errors import ApiError, not_found
from app.integrations.sheet import MAX_UPLOAD_BYTES, Grid, SheetRefused, load_grid
from app.lead_sources import cards as cards_mod
from app.lead_sources import consent_tick, form_templates, indiamart_push, portals, reading
from app.lead_sources import mapping as mp
from app.lead_sources.dnd import DndLookup
from app.lead_sources.meta import LeadgenRef, MetaError, MetaLeadFetcher, refs_of, signature_ok
from app.lead_sources.phones import check_phone
from app.lead_sources.repository import LeadSourcesRepository
from app.lead_sources.resend_inbound import ResendError, ResendInbound, email_id_of
from app.lead_sources.resend_inbound import signature_ok as resend_signature_ok
from app.lead_sources.sheets import SheetError, SheetFetcher, SheetRef, parse_sheet_url
from app.suppression.keys import KeyRing

logger = logging.getLogger("app.lead_sources")


class TokenSource(Protocol):
    """The registered worker account's sign-in (app.scheduler.session.PrincipalSession): a token that is good now."""

    def token(self) -> str: ...

PART_ROWS = 500
AVG_CALL_MINUTES = 3
_NS = uuid.UUID("5c1f2f55-0d0b-4b8e-9a3b-6a1d5f0c7e21")
_FORM_ALIASES = {
    "name": ("name", "full_name", "fullname", "your_name", "customer_name", "first_name"),
    "phone": ("phone", "your_phone", "your_mobile", "mobile", "whatsapp", "contact_number", "phone_number", "mobile_number", "contact", "tel", "from", "callfrom", "call_from", "caller", "caller_id", "callerid", "cli", "calling_number", "from_number"),
    "email": ("email", "e-mail", "e_mail", "your_email", "email_address", "mail"),
    "message": ("message", "your_message", "requirement", "enquiry", "inquiry", "comments", "comment", "query", "note", "notes"),
    "city": ("city", "location", "town"),
    "external_id": ("external_id", "lead_id", "id", "callsid", "call_sid", "calluuid", "call_uuid"),
}
# The consent checkbox of the website form (hosted page and snippet), the same wording pattern as Meta's lead form. The wording STORED with a lead is always this one, filled in by the server: never the sender's.
CONSENT_WORDING = "I agree that {business} may call or WhatsApp me about my enquiry"
_CONSENT_YES = frozenset({"1", "true", "yes", "on", "y"})


def consent_text(business: str | None) -> str:
    return CONSENT_WORDING.format(business=" ".join((business or "this business").split())[:100] or "this business")


# Google Ads lead form webhook: {"lead_id": ..., "user_column_data": [{"column_id": "FULL_NAME", "string_value": "..."}, ...]}
_GOOGLE_COLUMNS = {"FULL_NAME": "name", "FIRST_NAME": "name", "PHONE_NUMBER": "phone", "EMAIL": "email", "CITY": "city", "POSTAL_CODE": "city"}

WEBHOOK_SOURCE_KIND = {"website": "website_form"}
MAIL_STEPS = (
    "In your portal's account settings (JustDial, Sulekha, TradeIndia, 99acres, MagicBricks, Housing ...), set the e-mail address that receives your leads to the address below. Nothing to send on by hand: each lead mail arrives here by itself.",
    "If your portal can only mail your own Gmail, make the Gmail rule once (the steps are on this page). After that it runs by itself too.",
    "The address is shown only now; make a new one any time. Press Test: a sample portal e-mail goes through the same reader as your real ones.",
)
WEBHOOK_KINDS = {
    "missed_calls": ("Missed calls", "Missed calls", ("In your phone company's settings for your business number, find the missed-call (or hang-up) callback.", "Paste this address there. It is shown only now; make a new one any time.", "Press Test: a test lead appears in your Leads.")),
    "google_ads": ("Google Ads lead form", "Google Ads lead form", ("In Google Ads, open your lead form and choose the webhook delivery.", "Paste this address as the webhook URL. It is shown only now; make a new one any time.", "Press Test: a test lead appears in your Leads.")),
}
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{24,64}$")
_MAIL_TO = re.compile(r"leads\+([A-Za-z0-9_-]{24,64})@", re.I)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


GMAIL_GUIDE = (
    "Only if your portal can mail only your own Gmail (you do this once): open Gmail on a computer and open one lead e-mail from the portal.",
    "Click the three dots at the top, then 'Filter messages like this', then 'Create filter'.",
    "Tick 'Forward it to'. Click 'Add forwarding address' and paste the address above.",
    "Gmail sends a confirmation to that address. The code appears on this page within a minute: type it into Gmail.",
    "Back in the filter, choose the address you added, and click 'Create filter'. From now on every mail like that one comes here by itself.",
)
_GMAIL_CODE = re.compile(r"(?:#|code[:\s]+)(\d{6,12})", re.I)


def tag_of(kind: str, portal: str | None) -> str:
    return {"website_form": "website_form", "webhook": "webhook", "meta_lead_ads": "meta_lead_ads", "indiamart": "indiamart"}.get(kind) or (portal or ("email_forward" if kind == "email_forward" else "webhook"))


@dataclass
class Loaded:
    kind: str
    grid: Grid | None
    rows: list[dict[str, Any]] | None
    warnings: list[str]


@dataclass
class Prepared:
    rows: list[dict[str, Any]]    # what goes to the database
    lines: list[int]              # the file line of each row sent
    in_file: int                  # rows left out because the same phone came twice in the file
    problems: list[dict[str, Any]]
    dnd_lookup: str


def _find_number(data: object, key: str) -> int | None:
    if isinstance(data, dict):
        if isinstance(data.get(key), int) and not isinstance(data.get(key), bool):
            return int(data[key])
        for v in data.values():
            found = _find_number(v, key)
            if found is not None:
                return found
    elif isinstance(data, list):
        for v in data:
            found = _find_number(v, key)
            if found is not None:
                return found
    return None


class _ReceivedAsMail:
    """A mail fetched from Resend in the shape `receive_mail` reads."""

    def __init__(self, got: Any) -> None:
        self.sender, self.subject, self.text, self.message_id = got.sender, got.subject, got.text, got.message_id


class LeadSourcesService:
    FOLLOW_UP_S = (62.0, 122.0)   # seconds after a new lead is stored: two more outreach passes, for the rules that say 1 and 2 minutes

    def __init__(
        self,
        repo: LeadSourcesRepository,
        *,
        sheets: SheetFetcher | None = None,
        dnd: DndLookup | None = None,
        key_ring: KeyRing | None = None,
        receiver: TokenSource | None = None,
        meta: MetaLeadFetcher | None = None,
        meta_app_secret: str | None = None,
        resend: ResendInbound | None = None,
        inbound_domain: str | None = None,
        inbound_secret: str | None = None,
        public_base_url: str | None = None,
        service_account_email: str | None = None,
        indiamart_available: bool = False,
        indiamart_push: bool = False,
        billing: Any = None,
        matcher: mp.ColumnMatcher | None = None,
        after_arrival: Callable[[str], Any] | None = None,
    ) -> None:
        self.repo = repo
        self.sheets = sheets
        self.dnd = dnd
        self.key_ring = key_ring
        self.receiver = receiver
        self.meta = meta
        self._meta_secret = meta_app_secret
        self.resend = resend
        self.inbound_domain = (inbound_domain or "").strip().lower() or None
        self._inbound_secret = inbound_secret
        self.base = (public_base_url or "").rstrip("/")
        self.service_account_email = service_account_email
        self.indiamart_available = indiamart_available
        self.indiamart_push = indiamart_push   # INDIAMART_PUSH: a web-address source also understands IndiaMART's Push API body
        self.billing = billing
        self.matcher = matcher
        self._after_arrival = after_arrival   # speed to lead: run the outreach step the moment a new lead is stored (worker token in; counts only out)

    # ------------------------------------------------------------------------------------------------------------- reading a file
    def _bytes(self, body: Any) -> bytes:
        raw = body.content_base64 or ""
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise ApiError(422, "sheet_refused", "That file could not be read.", extra={"reason": "unreadable"}) from None
        if len(data) > MAX_UPLOAD_BYTES:
            raise ApiError(422, "sheet_refused", "That file is too big.", extra={"reason": "too_large"})
        return data

    def _grid_of(self, data: bytes) -> Grid:
        try:
            return load_grid(data)
        except SheetRefused as exc:
            raise ApiError(422, "sheet_refused", "That file could not be read.", extra={"reason": exc.code}) from None

    def _sheet_bytes(self, url: str) -> bytes:
        if self.sheets is None:
            raise ApiError(503, "sheets_unavailable", "Google Sheets cannot be read right now.")
        try:
            return self.sheets.fetch(parse_sheet_url(url))
        except SheetError as exc:
            if exc.code == "sheet_link_invalid":
                raise ApiError(422, "sheet_link_invalid", "That is not a Google Sheets link.") from None
            if exc.code == "sheet_not_public":
                raise ApiError(422, "sheet_not_public", "Share the sheet as 'Anyone with the link can view', or publish it to the web, and try again.") from None
            if exc.code == "too_large":
                raise ApiError(422, "sheet_refused", "That sheet is too big.", extra={"reason": "too_large"}) from None
            raise ApiError(502, "sheet_unreachable", "Google Sheets could not be reached. Try again.") from None

    def load(self, body: Any) -> Loaded:
        if body.kind == "file":
            grid = self._grid_of(self._bytes(body))
            return Loaded("file", grid, None, ["cells_cut"] * bool(grid.cut_cells) + ["formulas_ignored"] * bool(grid.formulas))
        if body.kind == "sheet":
            grid = self._grid_of(self._sheet_bytes(body.sheet_url or ""))
            return Loaded("sheet", grid, None, ["cells_cut"] * bool(grid.cut_cells) + ["formulas_ignored"] * bool(grid.formulas))
        if body.kind == "paste":
            rows = reading.parse_paste(body.text or "")
        else:
            rows = reading.parse_vcard(reading.decode_text(self._bytes(body)) if body.content_base64 else body.text or "")
        if not rows:
            raise ApiError(422, "sheet_refused", "Nothing was found to import.", extra={"reason": "empty"})
        return Loaded(body.kind, None, rows, [])

    def read(self, token: str, tenant_id: uuid.UUID, body: Any, matcher: mp.ColumnMatcher | None = None) -> dict[str, Any]:
        loaded = self.load(body)
        fields = [{"field": f, "label": label, "required": False} for f, (label, _s) in mp.FIELDS.items()]
        if loaded.grid is None:
            assert loaded.rows is not None  # noqa: S101
            return {"kind": loaded.kind, "rows": len(loaded.rows), "columns": [], "fields": fields, "mapping": None, "mapped_by": "none", "needs_confirmation": False, "warnings": loaded.warnings}
        grid = loaded.grid
        columns = [[r[i] for r in grid.rows] for i in range(len(grid.header))]
        suggestions = mp.suggest(grid.header, columns)
        mapped_by = "rules"
        use = matcher or self.matcher
        free = [f for f in mp.FIELDS if f not in {s.field for s in suggestions if s.field}]
        unplaced = [mp.ColumnInfo(s.index, s.header, mp.column_shape(columns[s.index])) for s in suggestions if s.field is None and s.header.strip() and mp.column_shape(columns[s.index]) != "empty"]
        if body.use_ai and use is not None and unplaced and free:
            try:
                answer = use.match(token, tenant_id, unplaced, free)
            except ApiError:
                answer = {}
            merged = mp.apply_ai(suggestions, answer, free)
            if merged != suggestions:
                suggestions, mapped_by = merged, "rules+ai"
        mapping = mp.mapping_from(suggestions)
        if "phone" not in mapping and "email" not in mapping:
            mapped_by = "none" if not mapping else mapped_by
        out_cols = [{"index": s.index, "header": s.header, "samples": [v[:60] for v in columns[s.index] if v.strip()][:3], "field": s.field, "confidence": s.confidence} for s in suggestions]
        return {"kind": loaded.kind, "rows": len(grid.rows), "columns": out_cols, "fields": fields, "mapping": mapping, "mapped_by": mapped_by, "needs_confirmation": True, "warnings": loaded.warnings}

    # ------------------------------------------------------------------------------------------------------------- preparing the rows
    def _raw_rows(self, loaded: Loaded, mapping: dict[str, int] | None) -> list[dict[str, Any]]:
        if loaded.grid is None:
            assert loaded.rows is not None  # noqa: S101
            return loaded.rows
        try:
            checked = mp.validate_mapping(mapping, len(loaded.grid.header))
        except ValueError as exc:
            raise ApiError(422, str(exc), "Choose which column is the phone number or the e-mail address.") from None
        return reading.rows_from_grid(loaded.grid, checked)

    def prepare(self, raw: list[dict[str, Any]], *, external_prefix: str | None = None) -> Prepared:
        sent: list[dict[str, Any]] = []
        lines: list[int] = []
        problems: list[dict[str, Any]] = []
        seen: set[str] = set()
        in_file = 0
        for i, r in enumerate(raw, start=1):
            line = int(r.get("line", i))
            phone = check_phone(r.get("phone"))
            email = r.get("email") if isinstance(r.get("email"), str) and r.get("email") else None
            ident = phone.key or (email.lower() if email else None)
            if ident is not None:
                if ident in seen:
                    in_file += 1
                    if len(problems) < 50:
                        problems.append({"row": line, "reason": "duplicate_in_file"})
                    continue
                seen.add(ident)
            message = r.get("message") if isinstance(r.get("message"), str) else ""
            if isinstance(r.get("city"), str) and r["city"]:
                message = (f"{message} (city: {r['city']})" if message else f"City: {r['city']}")[:1000]
            row: dict[str, Any] = {"name": r.get("name"), "phone": phone.stored or r.get("phone"), "email": email, "message": message or None, "received_at": r.get("received_at")}
            if r.get("is_test") is True:
                row["is_test"] = True
            if isinstance(r.get("consent"), dict):
                row["consent"] = r["consent"]   # a Meta lead form's consent evidence: stored with the lead in the same transaction (migration 20261231950000)
            if r.get("tag") in portals.TAGS:
                row["tag"] = r["tag"]
            if r.get("external_id"):
                row["external_id"] = r["external_id"]
            elif external_prefix and ident:
                row["external_id"] = f"{external_prefix}:{ident}"[:100]
            sent.append({k: v for k, v in row.items() if v is not None})
            lines.append(line)
        lookup = "not_configured"
        if self.dnd is not None:
            lookup = "checked"
            numbers = [r["phone"] for r in sent if isinstance(r.get("phone"), str) and check_phone(r["phone"]).stored == r["phone"]]
            marked = self.dnd.registered(numbers) if numbers else set()
            for r in sent:
                if r.get("phone") in marked:
                    r["dnd"] = True
        if self.key_ring is not None:
            for r in sent:
                keys, also = self.key_ring.keys_of(r.get("email"), r.get("phone"))
                if self.key_ring.has_keys(keys):
                    r["keys"], r["also"] = keys, also
        return Prepared(sent, lines, in_file, problems, lookup)

    def _apply(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID, kind: str, tag: str, consent_id: uuid.UUID | None, prepared: Prepared, cost: int | None, dry: bool, assume: bool) -> tuple[dict[str, int], list[dict[str, Any]], bool]:
        totals: dict[str, int] = {}
        replays: list[bool] = []
        problems = list(prepared.problems)
        rows = prepared.rows
        for part, start in enumerate(range(0, max(len(rows), 1), PART_ROWS), start=1):
            chunk = rows[start : start + PART_ROWS]
            if not chunk:
                break
            out = self.repo.intake_apply(
                token,
                tenant_id,
                {
                    "p_intake_id": str(uuid.uuid5(_NS, f"{import_id}:{part}")),
                    "p_import_id": str(import_id),
                    "p_part": part,
                    "p_kind": kind,
                    "p_tag": tag,
                    "p_consent_id": str(consent_id) if consent_id else None,
                    "p_rows": chunk,
                    "p_cost_paise": cost if part == 1 else None,
                    "p_dry_run": dry,
                    "p_assume_consent": assume,
                },
            )
            replays.append(bool(out.get("replayed")))
            for k, v in (out.get("counts") or {}).items():
                totals[k] = totals.get(k, 0) + int(v)
            for p in out.get("problems") or []:
                idx = int(p.get("row", 0))
                line = prepared.lines[start + idx - 1] if 1 <= idx <= len(chunk) and start + idx - 1 < len(prepared.lines) else idx
                if len(problems) < 50:
                    problems.append({"row": line, "reason": str(p.get("reason", "row_refused"))})
        problems.sort(key=lambda p: p["row"])
        return totals, problems[:50], bool(replays) and all(replays)

    def _counts(self, totals: dict[str, int], in_file: int) -> dict[str, int]:
        c = {k: totals.get(k, 0) for k in ("ready", "duplicates_merged", "already_imported", "invalid", "dnd", "no_consent", "blocked")}
        c["duplicates_in_file"] = in_file
        return c

    def _tag(self, body: Any) -> str:
        return body.source or mp_default_tag(body.kind)

    def _prices(self, token: str, tenant_id: uuid.UUID) -> tuple[int | None, int | None]:
        if self.billing is None:
            return None, None
        try:
            data = self.billing.billing(token, tenant_id)
        except Exception:   # a price lookup never blocks a preview
            return None, None
        return _find_number(data, "price_paise_per_message"), _find_number(data, "price_paise_per_minute")

    def preview(self, token: str, tenant_id: uuid.UUID, body: Any) -> dict[str, Any]:
        loaded = self.load(body)
        raw = self._raw_rows(loaded, body.mapping)
        prepared = self.prepare(raw)
        tag = self._tag(body)
        totals, problems, _same = self._apply(token, tenant_id, uuid.uuid4(), loaded.kind, tag, None, prepared, None, True, bool(body.consent_confirmed))
        counts = self._counts(totals, prepared.in_file)
        messages = min(counts["ready"], max(0, counts["ready"] + counts["duplicates_merged"] - counts["no_consent"]))
        minutes = max(0, messages - counts["dnd"]) * AVG_CALL_MINUTES
        per_message, per_minute = self._prices(token, tenant_id)
        cost = None if per_message is None or per_minute is None else messages * per_message + minutes * per_minute
        return {"rows_read": len(raw), "source": tag, "counts": counts, "estimate": {"messages": messages, "call_minutes": minutes, "cost_paise": cost, "basis": "estimate"}, "problems": problems, "dnd_lookup": prepared.dnd_lookup}

    def commit(self, token: str, tenant_id: uuid.UUID, body: Any) -> tuple[dict[str, Any], bool]:
        loaded = self.load(body)
        raw = self._raw_rows(loaded, body.mapping)
        prepared = self.prepare(raw)
        tag = self._tag(body)
        import_id = body.import_id
        consent_id: uuid.UUID | None = None
        if body.consent is not None:
            consent_id = uuid.uuid5(_NS, f"{import_id}:consent")
            self.repo.consent_confirm(token, tenant_id, consent_id, body.consent.model_dump())
        totals, problems, replayed = self._apply(token, tenant_id, import_id, loaded.kind, tag, consent_id, prepared, body.cost_per_lead_paise, False, False)
        return {"import_id": str(import_id), "status": "done", "source": tag, "consent_id": str(consent_id) if consent_id else None, "counts": self._counts(totals, prepared.in_file), "problems": problems, "created_at": datetime.now(UTC).isoformat()}, replayed

    def undo_import(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> dict[str, Any]:
        """Archives what the import created and nobody worked on since; the rest stays and is counted (the database decides: public.lead_import_undo). Once."""
        out = self.repo.import_undo(token, tenant_id, import_id)
        return {"import_id": str(import_id), "archived": int(out.get("archived") or 0), "kept": int(out.get("kept") or 0), "already_undone": bool(out.get("already_undone"))}

    def imports(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        out = []
        for item in self.repo.intakes(token, tenant_id, limit, before):
            counts = {k: int(item.get("counts", {}).get(k, 0)) for k in ("ready", "duplicates_merged", "already_imported", "invalid", "dnd", "no_consent", "blocked")}
            counts["duplicates_in_file"] = 0
            out.append({**item, "counts": counts, "problems": item.get("problems") or []})
        return out

    # ------------------------------------------------------------------------------------------------------------- live sources
    def _worker(self) -> str:
        from app.scheduler.session import SignInError

        if self.receiver is None:
            raise ApiError(503, "lead_intake_unavailable", "Not available right now.")
        try:
            return self.receiver.token()
        except SignInError:
            raise ApiError(503, "lead_intake_unavailable", "Not available right now.") from None

    def _available(self, kind: str) -> bool:
        if kind == "indiamart":
            return self.indiamart_available
        if self.receiver is None:
            return False
        if kind == "email_forward":
            return self.inbound_domain is not None
        if kind == "meta_lead_ads":
            return self.meta is not None and self._meta_secret is not None
        return True

    def _source_out(self, item: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in item.items() if k != "consent_id"}
        out["available"] = self._available(str(item.get("kind")))
        return out

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [self._source_out(s) for s in self.repo.sources(token, tenant_id)]

    # ------------------------------------------------------------------------------------------------------------- the Sources page (job EB part B)
    def cards(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        """The cards: one clear action and a live status each, in plain words."""
        available = cards_mod.Available(
            meta=self._available("meta_lead_ads"), indiamart=self.indiamart_available,
            email_forward=self._available("email_forward"), website=self.receiver is not None, missed_calls=self.receiver is not None, google_ads=self.receiver is not None,
        )
        sources = self.repo.sources(token, tenant_id)
        stats = self.repo.cards_stats(token, tenant_id)
        if available.indiamart and any(x.get("kind") == "indiamart" and x.get("status") == "active" for x in sources):
            try:
                stats = {**stats, "indiamart_pull": self.repo.indiamart_status(token, tenant_id)}   # the scheduled pull's word on the key; a card never fails for it
            except Exception as exc:   # noqa: BLE001
                logger.warning("indiamart status not read: %s", exc.__class__.__name__)
        return cards_mod.build_cards(sources, stats, available)

    def email_address(self, token: str, tenant_id: uuid.UUID, *, rotate: bool = False) -> dict[str, Any]:
        """The workspace's forwarding address (made on first use, shown again as often as asked; `rotate` makes a new one and the old one stops working)."""
        if not self.inbound_domain or self.receiver is None:
            raise ApiError(503, "not_available", "Portal e-mails are not switched on yet. Ask us to switch it on.")
        current = self.repo.inbound_get(token, tenant_id)
        secret = str(current.get("token") or "")
        if not secret or rotate:
            secret = secrets.token_hex(12)
            existing = next((s for s in self.repo.sources(token, tenant_id) if s.get("kind") == "email_forward"), None)
            if existing is not None:
                source_id = uuid.UUID(str(existing["id"]))
                self.repo.source_rotate(token, tenant_id, source_id, token_hash(secret), secret[-4:])
            else:
                source_id = uuid.uuid4()
                self.repo.source_create(
                    token, tenant_id,
                    {"p_id": str(source_id), "p_kind": "email_forward", "p_tag": tag_of("email_forward", None), "p_label": "Portal e-mails", "p_token_hash": token_hash(secret),
                     "p_token_hint": secret[-4:], "p_consent_id": None, "p_consent": None, "p_cost_paise": None},
                )
            self.repo.inbound_set(token, tenant_id, source_id, secret)
        return {
            "address": f"leads+{secret}@{self.inbound_domain}",
            "gmail_filter_guide": [{"step": i + 1, "text": text} for i, text in enumerate(GMAIL_GUIDE)],
            "sample_portals": ["JustDial", "Sulekha", "TradeIndia", "IndiaMART e-mail", "99acres", "MagicBricks", "Housing.com"],
            "gmail_confirmation": self._gmail_confirmation(token, tenant_id),
        }

    def website(self, token: str, tenant_id: uuid.UUID, *, rotate: bool = False) -> dict[str, Any]:
        """The workspace's website form (made on first use, shown again as often as asked; `rotate` makes a new address and the old one stops working): the snippet to paste, a hosted form link that needs no website at all, and the webhook address."""
        if not self.base:
            raise ApiError(503, "not_available", "The website form is not switched on yet. Ask us to switch it on.")
        current = self.repo.website_get(token, tenant_id)
        secret = str(current.get("token") or "")
        if not secret or rotate:
            secret = secrets.token_hex(12)
            existing = next((s for s in self.repo.sources(token, tenant_id) if s.get("kind") == "website_form"), None)
            if existing is not None:
                source_id = uuid.UUID(str(existing["id"]))
                self.repo.source_rotate(token, tenant_id, source_id, token_hash(secret), secret[-4:])
                if existing.get("status") == "disconnected":   # connecting again after a Disconnect: a new address and the source is live again
                    self.repo.source_status(token, tenant_id, source_id, "active")
            else:
                source_id = uuid.uuid4()
                self.repo.source_create(
                    token, tenant_id,
                    {"p_id": str(source_id), "p_kind": "website_form", "p_tag": tag_of("website_form", None), "p_label": "Website form", "p_token_hash": token_hash(secret),
                     "p_token_hint": secret[-4:], "p_consent_id": None, "p_consent": None, "p_cost_paise": None},
                )
            self.repo.website_set(token, tenant_id, source_id, secret)
        info = self._secret("website_form", secret)
        url = str(info["url"])
        return {"snippet": info["snippet_html"], "form_link": f"{url}/form", "webhook_url": url}

    # ------------------------------------------------------------------------------------------------------------- one card: connect, test, disconnect (docs/contracts/lead-sources-v2.md)
    def _card(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        found = next((c for c in self.cards(token, tenant_id) if c["kind"] == kind), None)
        if found is None:
            raise ApiError(404, "not_found", "That is not one of your sources.")
        return found

    def _shown_once(self, token: str, tenant_id: uuid.UUID, kind: str, *, rotate: bool) -> dict[str, Any]:
        """Missed calls and Google Ads: a secret address, made now and SHOWN ONCE (only its hash is kept). Connecting again, or making a new one, replaces it; a disconnected source is live again."""
        if not self.base or self.receiver is None:
            raise ApiError(409, "not_available", "This source is not switched on yet. Ask us to switch it on.")
        mail = kind == "email_forward"
        if mail and not self.inbound_domain:
            raise ApiError(409, "not_available", "This source is not switched on yet. Ask us to switch it on.")
        title, label, steps = ("Portal e-mails", "Portal e-mails", MAIL_STEPS) if mail else WEBHOOK_KINDS[kind]
        secret = secrets.token_hex(12)
        existing = next((x for x in self.repo.sources(token, tenant_id) if x.get("kind") == kind), None)
        if existing is not None:
            source_id = uuid.UUID(str(existing["id"]))
            self.repo.source_rotate(token, tenant_id, source_id, token_hash(secret), secret[-4:])
            if existing.get("status") != "active":
                self.repo.source_status(token, tenant_id, source_id, "active")
        else:
            self.repo.source_create(token, tenant_id, {"p_id": str(uuid.uuid4()), "p_kind": kind, "p_tag": kind, "p_label": label, "p_token_hash": token_hash(secret), "p_token_hint": secret[-4:],
                                                       "p_consent_id": None, "p_consent": None, "p_cost_paise": None})
        card = self._card(token, tenant_id, kind)
        if mail:
            address = str(self._secret("email_forward", secret)["email_address"])
            return {**card, "connect": {"type": "copy", "shown_once": True, "fields": [{"label": "Your lead e-mail address", "value": address, "secret": True}], "steps": list(steps), "step_codes": [f"connect.{kind}.{i}" for i in range(1, len(steps) + 1)]}}
        url = str(self._secret("webhook", secret)["url"])
        return {**card, "connect": {"type": "copy", "shown_once": True, "fields": [{"label": f"Address for {title}", "value": url, "secret": True}], "steps": list(steps), "step_codes": [f"connect.{kind}.{i}" for i in range(1, len(steps) + 1)]}}

    def card_connect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        """Turn a card on. The website form needs nothing from the owner; missed calls and Google Ads make an address that is shown once."""
        if kind in WEBHOOK_KINDS or kind == "email_forward":
            return self._shown_once(token, tenant_id, kind, rotate=False)
        if kind != "website":
            raise ApiError(409, "not_available", "This source cannot be connected from here yet.")
        self.website(token, tenant_id)
        return self._card(token, tenant_id, kind)

    def consent_tick(self, token: str, tenant_id: uuid.UUID, card: str) -> None:
        """Store who ticked, when and which wording on the sources behind this card (only with JOBS on: see consent_tick.py)."""
        self.repo.consent_tick(token, tenant_id, consent_tick.source_kinds(card), consent_tick.TEXT_VERSION)

    def card_rotate(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        if kind in WEBHOOK_KINDS or kind == "email_forward":
            return self._shown_once(token, tenant_id, kind, rotate=True)
        if kind != "website":
            raise ApiError(409, "not_available", "This source has no address to change.")
        self.website(token, tenant_id, rotate=True)
        return self._card(token, tenant_id, kind)

    def card_test(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        """The Test button: a test lead goes through the REAL intake path of the source, is marked as a test, and is never called or messaged (it has a +00 test number)."""
        card = self._card(token, tenant_id, kind)
        if kind not in cards_mod.TESTABLE:
            raise ApiError(409, "nothing_to_test", "There is nothing to test for this source yet.")
        if card["state"] == "paused":
            raise ApiError(409, "source_paused", "This source is paused. Resume it, then test.")
        if card["state"] == "off":
            raise ApiError(409, "not_connected", "Connect this source first, then test it.")
        if kind == "email_forward":   # a sample JustDial mail through the REAL reader (portals.parse_mail), then through this source's intake as a marked test
            from app.lead_sources import portals

            number = f"+00 99999 {secrets.randbelow(90000) + 10000}"
            parsed = portals.parse_mail("noreply@justdial.com", "JD Lead", f"Name\nTest lead (portal e-mail)\nMobile\n{number}\nLooking for: a test enquiry\nArea: Test\n")
            if parsed is None or not parsed.row.get("phone"):
                raise ApiError(502, "parser_failed", "The sample e-mail could not be read. Tell us, this should not happen.")
            done = self.repo.test_lead(token, tenant_id, "email_forward", {**parsed.row, "name": str(parsed.row.get("name") or "Test lead (portal e-mail)")})
            if not done.get("lead_id"):
                raise ApiError(502, "provider_unreachable", "The test lead did not arrive. Try again in a minute.")
            return {"ok": True, "kind": kind, "result": "lead_created", "message_text": {"code": "test.lead_created", "params": {"kind": kind}}, "portal": parsed.portal or "unknown", "message": f"A sample {parsed.portal or 'portal'} e-mail was read and arrived as a test lead.",
                    "lead": {"lead_id": str(done["lead_id"]), "name": str(parsed.row.get("name") or "Test lead (portal e-mail)"), "source": kind}}
        if kind in WEBHOOK_KINDS:   # no secret to send with: the Owner's own door puts one test row through this source's intake
            trow = {"name": f"Test lead ({card['title']})", "phone": f"+00 99999 {secrets.randbelow(90000) + 10000}", "message": "A test from the Test button. Remove it any time."}
            done = self.repo.test_lead(token, tenant_id, WEBHOOK_SOURCE_KIND.get(kind, kind), trow)
            if not done.get("lead_id"):
                raise ApiError(502, "provider_unreachable", "The test lead did not arrive. Try again in a minute.")
            return {"ok": True, "kind": kind, "result": "lead_created", "message_text": {"code": "test.lead_created", "params": {"kind": kind}}, "message": f"A test lead arrived from {card['title']}.", "lead": {"lead_id": str(done["lead_id"]), "name": trow["name"], "source": kind}}
        secret = str(self.repo.website_get(token, tenant_id).get("token") or "")
        row = self.form_row({"name": f"Test lead ({card['title']})", "phone": f"+00 99999 {secrets.randbelow(90000) + 10000}", "message": "A test from the Test button. Remove it any time."})
        if not secret or row is None:
            raise ApiError(409, "not_connected", "Connect this source first, then test it.")
        row.pop("_ticked", None)
        self._live(secret, [row])
        done = self.repo.test_finish(token, tenant_id, str(row["phone"]))
        lead_id = done.get("lead_id")
        if not lead_id:
            raise ApiError(502, "provider_unreachable", "The test lead did not arrive. Try again in a minute.")
        return {"ok": True, "kind": kind, "result": "lead_created", "message_text": {"code": "test.lead_created", "params": {"kind": kind}}, "message": f"A test lead arrived from {card['title']}.", "lead": {"lead_id": str(lead_id), "name": str(row["name"]), "source": kind}}

    def card_disconnect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        """Disconnect: the secret address stops working at once, the shown address is forgotten, every lead already received stays."""
        if kind not in cards_mod.DISCONNECTABLE:
            raise ApiError(409, "not_available", "This source cannot be disconnected from here yet.")
        kinds = ("website_form", "webhook") if kind == "website" else (kind,)
        for source in self.repo.sources(token, tenant_id):
            if source.get("kind") in kinds and source.get("status") != "disconnected":
                source_id = uuid.UUID(str(source["id"]))
                dead = secrets.token_hex(12)
                self.repo.source_rotate(token, tenant_id, source_id, token_hash(dead), dead[-4:])
                self.repo.source_status(token, tenant_id, source_id, "disconnected")
        if kind == "website":
            self.repo.website_clear(token, tenant_id)
        return self._card(token, tenant_id, kind)

    def _gmail_confirmation(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        """Gmail asks the new forwarding address to confirm with a code; that mail arrives here, so the code is shown to the owner (the mail itself is not a lead)."""
        for item in self.repo.unparsed(token, tenant_id):
            subject = str(item.get("subject") or "")
            if "forwarding confirmation" not in subject.lower():
                continue
            found = _GMAIL_CODE.search(subject) or _GMAIL_CODE.search(str(item.get("preview") or ""))
            if found:
                return {"code": found.group(1), "received_at": item.get("received_at")}
        return None

    def form_business(self, secret: str) -> str | None:
        """The business name on a website form's address (for the consent wording), or None when the address is unknown or anything fails: the page and the snippet then say "this business"."""
        try:
            name = self.repo.form_info(self._worker(), token_hash(secret)).get("business")
        except Exception:   # noqa: BLE001 - the wording falls back; the form still works
            return None
        return name if isinstance(name, str) and name.strip() else None

    def _secret(self, kind: str, secret: str) -> dict[str, Any]:
        url = f"{self.base}/v1/lead-intake/{secret}" if self.base else f"/v1/lead-intake/{secret}"
        snippet = None
        if kind == "website_form":
            u = html.escape(url, quote=True)
            snippet = (
                f'<form method="post" action="{u}">\n'
                '  <input type="text" name="name" placeholder="Your name" required>\n'
                '  <input type="tel" name="phone" placeholder="Phone or WhatsApp number" required>\n'
                '  <input type="email" name="email" placeholder="E-mail (optional)">\n'
                '  <textarea name="message" placeholder="What do you need?"></textarea>\n'
                f'  <label><input type="checkbox" name="consent" value="yes" required> {html.escape(consent_text(self.form_business(secret)), quote=True)}</label>\n'
                f'  <input type="hidden" name="consent_text" value="{html.escape(consent_text(self.form_business(secret)), quote=True)}">\n'
                '  <input type="text" name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">\n'
                '  <button type="submit">Send</button>\n</form>'
            )
        return {
            "shown_once": True,
            "url": url if kind in ("website_form", "webhook", "email_forward") else None,
            "email_address": f"leads+{secret}@{self.inbound_domain}" if kind == "email_forward" and self.inbound_domain else None,
            "snippet_html": snippet,
            "meta_callback_url": (f"{self.base}/v1/lead-intake/meta/{secret}" if self.base else f"/v1/lead-intake/meta/{secret}") if kind == "meta_lead_ads" else None,
            "meta_verify_token": secret if kind == "meta_lead_ads" else None,
        }

    def source_create(self, token: str, tenant_id: uuid.UUID, body: Any) -> tuple[dict[str, Any], bool]:
        tag = tag_of(body.kind, body.portal)
        secret = None if body.kind == "indiamart" else secrets.token_urlsafe(24)
        consent_id = uuid.uuid5(_NS, f"{body.source_id}:consent") if body.consent else None
        created = self.repo.source_create(
            token,
            tenant_id,
            {
                "p_id": str(body.source_id),
                "p_kind": body.kind,
                "p_tag": tag,
                "p_label": body.label,
                "p_token_hash": token_hash(secret) if secret else None,
                "p_token_hint": secret[-4:] if secret else None,
                "p_consent_id": str(consent_id) if consent_id else None,
                "p_consent": body.consent.model_dump() if body.consent else None,
                "p_cost_paise": body.cost_per_lead_paise,
            },
        )
        out = self._source_out(created["source"])
        if created.get("created") and secret:
            out["secret"] = self._secret(body.kind, secret)
        return out, bool(created.get("created"))

    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]:
        secret = secrets.token_urlsafe(24)
        item = self.repo.source_rotate(token, tenant_id, source_id, token_hash(secret), secret[-4:])
        out = self._source_out(item)
        out["secret"] = self._secret(str(item.get("kind")), secret)
        return out

    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._source_out(self.repo.source_status(token, tenant_id, source_id, status))

    # ------------------------------------------------------------------------------------------------------------- the public doors
    def _live(self, secret: str, rows: list[dict[str, Any]]) -> str:
        if not _TOKEN.fullmatch(secret):
            raise not_found()
        prepared = self.prepare(rows, external_prefix=None)
        out = self.repo.live(self._worker(), token_hash(secret), prepared.rows[:20])
        status = str(out.get("status"))
        counts: dict[str, Any] = {}
        if isinstance(out.get("counts"), dict):
            counts = out["counts"]
        logger.info("lead intake: status=%s rows=%d counts=%s", status, len(prepared.rows[:20]), ",".join(f"{k}={v}" for k, v in sorted(counts.items()) if isinstance(v, int) and v) or "-")   # numbers and closed words only
        if status == "unknown":
            raise not_found()
        if status == "rate":
            self.record_activity(secret, "refused", "rate_limited")
            raise ApiError(429, "rate_limited", "Too many requests. Try again in a minute.", headers={"Retry-After": "60"})
        problems = out.get("problems")
        if isinstance(problems, list):
            for item in problems[:20]:   # closed words only (a row number and a reason): why a row was not stored, e.g. duplicate_within_10_min
                if isinstance(item, dict) and isinstance(item.get("reason"), str) and re.fullmatch(r"[a-z0-9_]{1,40}", item["reason"]):
                    logger.info("lead intake: row %s not stored: %s", int(item.get("row") or 0), item["reason"])
        again = out.get("again")
        arrived = (isinstance(counts.get("ready"), int) and counts["ready"] > 0) or (isinstance(again, int) and again > 0)   # a new lead, or a known customer enquiring again: the rule runs now
        if status == "received" and arrived:
            self._first_touch()
        if status == "received":
            outcome, reason = activity_of(counts, again if isinstance(again, int) else 0)
            self.record_activity(secret, outcome, reason)
        return status

    def record_activity(self, secret: str, outcome: str, reason: str) -> None:
        """One closed row per post for the activity list (never a field of the post). Best effort: the lead is already handled, a failure here never changes the answer."""
        try:
            self.repo.activity_add(self._worker(), token_hash(secret), outcome, reason, False)
        except Exception as exc:  # noqa: BLE001 - only the class is logged
            logger.warning("lead intake: the activity row could not be written (%s)", exc.__class__.__name__)

    def source_activity(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, limit: int = 50) -> dict[str, Any]:
        return self.repo.activity(token, tenant_id, source_id, limit)

    def job_address(self, token: str, tenant_id: uuid.UUID, job_id: str) -> dict[str, Any] | None:
        return self.repo.job_address(token, tenant_id, job_id)

    def source_dry_run(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, sample: dict[str, Any]) -> dict[str, Any]:
        """"Send a test lead": what a post like this WOULD become at this address, with nothing stored as a lead. The activity list records that a test was tried."""
        row = self.form_row(sample)
        if row is None:
            outcome, reason, mapped = "refused", "bot", {}
        else:
            ticked = bool(row.pop("_ticked", False))
            for key in ("_ctext", "_cat", "_cform"):
                row.pop(key, None)
            mapped = {k: ("set" if v else "empty") for k, v in row.items() if k != "consent"}
            prepared = self.prepare([dict(row)], external_prefix=None)
            if not prepared.rows:
                outcome, reason = "refused", "invalid"
            elif ticked:
                outcome, reason = "accepted", "new_lead"
            else:
                outcome, reason = "accepted", "ask_first"
        self.repo.test_logged(token, tenant_id, source_id, outcome, reason)
        return {"outcome": outcome, "reason": reason, "mapped": mapped, "stored": False}

    def job_address_ensure(self, token: str, tenant_id: uuid.UUID, job_id: str, source_id: uuid.UUID) -> tuple[dict[str, Any], bool]:
        """The lead address of one job: the same address on every call; made (a webhook source, linked to the job) the first time, its secret shown only then."""
        existing = self.repo.job_address(token, tenant_id, job_id)
        if existing is not None:
            return {**existing, "secret": None}, False
        from app.lead_sources.models import SourceCreate

        out, created = self.source_create(token, tenant_id, SourceCreate(source_id=source_id, kind="webhook", label=f"Form for {job_id.replace('_', ' ')}"))
        linked = self.repo.job_link(token, tenant_id, job_id, source_id)
        return {
            "source_id": linked["source_id"], "job_id": job_id, "status": out["status"], "token_hint": out.get("token_hint"),
            "last_received_at": out.get("last_received_at"), "received_count": out.get("received_count", 0), "label": out["label"],
            "secret": out.get("secret"),
        }, created

    def _first_touch(self) -> None:
        """A NEW lead is stored: the outreach step runs now, in a thread (the arrival is answered at once), instead of at the worker's next minute. The database still decides everything (hours, consent, caps)."""
        run = self._after_arrival
        if run is None or self.receiver is None:
            return

        def go() -> None:
            try:
                run(self._worker())
            except Exception as exc:   # noqa: BLE001 - the worker's own tick still picks the lead up a minute later
                logger.warning("speed to lead: the run after an arrival failed (%s)", exc.__class__.__name__)

        threading.Thread(target=go, name="first-touch", daemon=True).start()
        for delay in self.FOLLOW_UP_S:   # a rule that says "within 1 minute" makes the call due one minute later: a pass just after it (timed test, 15 Nov: the call waited 59 s for the worker's tick)
            timer = threading.Timer(delay, go)
            timer.daemon = True
            timer.start()

    @staticmethod
    def form_row(data: dict[str, Any]) -> dict[str, Any] | None:
        """A lead from a form or a webhook body: aliases accepted, extra fields ignored, a filled honeypot = a bot (None)."""
        data = form_templates.flatten(data)   # a form tool's own envelope (Typeform, Tally, Jotform, Webflow, Google Ads) as a flat body; untouched while LEAD_FORM_TEMPLATES is off
        lower = {str(k).lower(): v for k, v in data.items() if isinstance(k, str)}
        for k, v in data.items():   # a form plugin's own names ("your-name") are read like "your_name"
            if isinstance(k, str) and "-" in k:
                lower.setdefault(k.lower().replace("-", "_"), v)
        if str(lower.get("_hp") or "").strip():
            return None
        columns = data.get("user_column_data")
        if isinstance(columns, list):   # a Google Ads lead form delivers its answers as a list of columns
            for item in columns:
                if isinstance(item, dict) and _GOOGLE_COLUMNS.get(str(item.get("column_id") or "").upper()) and str(item.get("string_value") or "").strip():
                    lower.setdefault(_GOOGLE_COLUMNS[str(item["column_id"]).upper()], str(item["string_value"]).strip())
        row: dict[str, Any] = {}
        for field, names in _FORM_ALIASES.items():
            for n in names:
                v = lower.get(n)
                if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
                    row[field] = str(v).strip()[: reading.LIMITS.get(field, 200)]
                    break
        ticked = lower.get("consent")
        if ticked is True or (isinstance(ticked, (str, int)) and not isinstance(ticked, bool) and str(ticked).strip().lower() in _CONSENT_YES):
            row["_ticked"] = True   # the form's consent checkbox; receive_form believes it only with its evidence (the wording the person saw, and when)
            for field, key, size in (("_ctext", "consent_text", 800), ("_cat", "consent_at", 40), ("_cform", "consent_form", 80)):
                v = lower.get(key)
                if isinstance(v, str) and v.strip():
                    row[field] = " ".join(v.split())[:size]
        return row

    def receive_form(self, secret: str, data: dict[str, Any]) -> str | None:
        """Takes one post to a lead address. Answers `indiamart_push` when it was one of IndiaMART's pushed leads (its Push API wants an HTTP 200 for "received"), else None."""
        if not _TOKEN.fullmatch(secret):
            raise not_found()
        if self.indiamart_push and indiamart_push.is_push(data):
            rows = indiamart_push.rows_of(data)
            if not rows:
                self.record_activity(secret, "refused", "invalid")
                return "indiamart_push"
            self._live(secret, rows)
            return "indiamart_push"
        row = self.form_row(data)
        if row is None:
            self.record_activity(secret, "refused", "bot")
            return None   # a bot: answered like a success, nothing stored
        ticked, evidence = row.pop("_ticked", False), (row.pop("_ctext", None), row.pop("_cat", None), row.pop("_cform", None))
        if ticked:
            consent = self.consent_evidence(self.form_business(secret), *evidence)
            if consent is not None:
                row["consent"] = consent
        self._live(secret, [row])
        return None

    @staticmethod
    def consent_evidence(business: str | None, text: str | None, given_at: str | None, form: str | None, now: datetime | None = None) -> dict[str, Any] | None:
        """What a tick is worth (owner, 18 Nov 2026): the stored consent of a post that says "consent: yes". Believed only with its evidence:
          * our own hosted form and snippet send the wording they showed (the server's exact words for this business): stored as before, with the time we received it;
          * a connected tool sends `consent_text` (the wording the person saw, 10 to 800 characters) AND `consent_at` (when they agreed: ISO 8601, not in the future, at most 30 days old), and may name the form or page
            (`consent_form`): stored as the tool's own say-so, with those three;
          * anything else (no wording, no time, a time that does not fit) is ask-first: nothing is consented."""
        now = now or datetime.now(UTC)
        if not text or not (10 <= len(text) <= 800) or not text.isprintable():
            return None
        if text == consent_text(business):
            return {"checkbox_key": "consent", "ticked": True, "disclaimer": text, "given_at": now.isoformat()}
        if not given_at:
            return None
        try:
            when = datetime.fromisoformat(given_at.strip().replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when > now + timedelta(minutes=5) or when < now - timedelta(days=30):
            return None
        out: dict[str, Any] = {"checkbox_key": "consent", "ticked": True, "disclaimer": text, "given_at": when.isoformat()}
        if form and form.isprintable():
            out["form_name"] = form[:80]
        return out

    def receive_mail(self, secret: str, mail: Any) -> str:
        parsed = form_templates.tradeindia_mail(mail.sender, mail.subject, mail.text) or portals.parse_mail(mail.sender, mail.subject, mail.text)   # TradeIndia's own labels first (LEAD_FORM_TEMPLATES), then the portals' reader
        if parsed is None:
            if not _TOKEN.fullmatch(secret):
                raise not_found()
            out = self.repo.unparsed_add(self._worker(), token_hash(secret), mail.subject or None, mail.text[:4000] or mail.subject or "(empty)")
            if out.get("status") == "unknown":
                logger.info("mail: outcome=dropped reason=unknown_address")   # the parse log: closed words and numbers, never a sender, a subject or a word of the body
                raise not_found()
            logger.info("mail: outcome=unparsed status=%s chars=%d", str(out.get("status")), min(len(mail.text or ""), 4000))
            return "unrecognised"
        row = dict(parsed.row)
        if mail.message_id:
            row["external_id"] = "m:" + hashlib.sha256(mail.message_id.encode("utf-8")).hexdigest()[:40]
        if parsed.portal in portals.TAGS:
            row["tag"] = parsed.portal   # the lead shows the real portal ("JustDial", "Sulekha" ...), not "Forwarded e-mail"
        try:
            self._live(secret, [row])
        except ApiError as err:
            if err.status_code == 404:
                logger.info("mail: outcome=dropped reason=unknown_address")
            raise
        logger.info("mail: outcome=parsed portal=%s", parsed.portal or "unknown")   # the raw mail is not kept: only the lead
        return "received"

    def signed_ok(self, raw: bytes, timestamp: str | None, signature: str | None) -> bool:
        """The Cloudflare mail worker signs `<unix seconds>.<body>` with HMAC-SHA256 under the shared secret (hex, optionally `sha256=` first). Five minutes either way."""
        if self._inbound_secret is None or not timestamp or not signature:
            return False
        try:
            seconds = int(timestamp)
        except ValueError:
            return False
        if abs(time.time() - seconds) > 300:
            return False
        expected = hmac.new(self._inbound_secret.encode(), f"{seconds}.".encode() + raw, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature.strip().removeprefix("sha256=").lower())

    def receive_mail_global(self, provided_secret: str | None, mail: Any, *, signed: bool = False) -> str:
        if self._inbound_secret is None or self.receiver is None:
            raise ApiError(503, "not_available", "Not available right now.")
        if not signed and (not provided_secret or not hmac.compare_digest(provided_secret.encode(), self._inbound_secret.encode())):
            raise ApiError(401, "unauthorized", "Not allowed.")
        m = _MAIL_TO.search(mail.to or "")
        if not m:
            raise not_found()
        return self.receive_mail(m.group(1), mail)

    def receive_resend(self, raw: bytes, svix_id: str | None, timestamp: str | None, signature: str | None, payload: object) -> str:
        """Resend's `email.received` webhook (leads.stack19.com). Signed (Svix); the mail is fetched with the leads key and read like any forwarded mail. Answers: `received`, `unrecognised` (the mail was read but
        is not a lead, or was not for a known address: nothing is retried), `ignored` (another kind of event). A mail that cannot be fetched is a 502 so that Resend tries again."""
        if self.resend is None or self.receiver is None:
            raise ApiError(503, "not_available", "Not available right now.")
        if not resend_signature_ok(self.resend.webhook_secret, svix_id, timestamp, signature, raw):
            raise ApiError(401, "unauthorized", "Not allowed.")
        email_id = email_id_of(payload)
        if email_id is None:
            return "ignored"
        try:
            got = self.resend.fetcher.fetch(email_id)
        except ResendError:
            raise ApiError(502, "upstream_unavailable", "Try again shortly.") from None
        m = next((hit for hit in (_MAIL_TO.search(a) for a in got.to) if hit), None)
        if m is None:
            return "unrecognised"
        try:
            return self.receive_mail(m.group(1), _ReceivedAsMail(got))
        except ApiError as err:
            if err.status_code == 404:   # an address that was rotated or never existed: a retry would not change that
                return "unrecognised"
            raise

    def meta_verify(self, secret: str, mode: str | None, verify_token: str | None, challenge: str | None) -> str:
        if self.meta is None or not _TOKEN.fullmatch(secret):
            raise ApiError(503, "not_available", "Not available right now.")
        if mode != "subscribe" or not verify_token or not hmac.compare_digest(verify_token.encode(), secret.encode()):
            raise ApiError(403, "forbidden", "Not allowed.")
        return (challenge or "")[:200]

    def meta_receive(self, secret: str, raw: bytes, signature: str | None, payload: object) -> None:
        if self.meta is None or self._meta_secret is None or self.receiver is None:
            raise ApiError(503, "not_available", "Not available right now.")
        if not _TOKEN.fullmatch(secret):
            raise not_found()
        if not signature_ok(self._meta_secret, raw, signature):
            raise ApiError(401, "unauthorized", "Not allowed.")
        rows: list[dict[str, Any]] = []
        for ref in refs_of(payload)[:20]:
            try:
                row = self.meta.fetch(LeadgenRef(ref.leadgen_id, ref.page_id, ref.form_id))
                consent = row.pop("_consent", None)   # the form's consent evidence: the database stores it with the lead in the SAME transaction
                if isinstance(consent, dict):
                    row["consent"] = consent
                rows.append(row)
                logger.info("meta: lead fetched", extra={"fields": {"lead_id": re.sub(r"[^0-9]", "", ref.leadgen_id)[:24]}})
            except MetaError as exc:
                logger.warning("meta: a lead could not be fetched: reason=%s %s", exc.reason, exc.detail, extra={"fields": {"lead_id": re.sub(r"[^0-9]", "", ref.leadgen_id)[:24]}})   # `lead_id` is its own JSON field: Meta's object number, never masked like a phone number; never an answer
        if rows:
            self._live(secret, rows)

    # ------------------------------------------------------------------------------------------------------------- unparsed mail, history, sheets
    def unparsed(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self.repo.unparsed(token, tenant_id)

    def arrivals(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any]:
        return self.repo.arrivals(token, tenant_id, lead_id)

    def sheet_access(self) -> dict[str, Any]:
        has_account = self.service_account_email is not None
        return {
            "modes": [
                {"mode": "anyone_with_link", "available": self.sheets is not None, "service_account_email": None},
                {"mode": "published_csv", "available": self.sheets is not None, "service_account_email": None},
                {"mode": "service_account", "available": False, "service_account_email": self.service_account_email if has_account else None},
            ]
        }

    def sheet_link_create(self, token: str, tenant_id: uuid.UUID, body: Any) -> dict[str, Any]:
        try:
            ref = parse_sheet_url(body.sheet_url)
        except SheetError:
            raise ApiError(422, "sheet_link_invalid", "That is not a Google Sheets link.") from None
        grid = self._grid_of(self._sheet_bytes(body.sheet_url))
        try:
            mapping = mp.validate_mapping(body.mapping, len(grid.header))
        except ValueError as exc:
            raise ApiError(422, str(exc), "Choose which column is the phone number or the e-mail address.") from None
        consent_id = uuid.uuid5(_NS, f"{body.link_id}:consent") if body.consent else None
        return self.repo.sheet_link_create(
            token,
            tenant_id,
            {
                "p_id": str(body.link_id),
                "p_sheet_id": ref.sheet_id,
                "p_gid": ref.gid,
                "p_mapping": mapping,
                "p_header_sha": reading.header_sha(grid.header),
                "p_consent_id": str(consent_id) if consent_id else None,
                "p_consent": body.consent.model_dump() if body.consent else None,
                "p_cost_paise": body.cost_per_lead_paise,
            },
        )

    def sheet_links(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self.repo.sheet_links(token, tenant_id)

    def sheet_link_action(self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self.repo.sheet_link_action(token, tenant_id, link_id, action)


def mp_default_tag(kind: str) -> str:
    from app.lead_sources.models import DEFAULT_TAG

    return DEFAULT_TAG[kind]


__all__ = ["LeadSourcesService", "SheetRef", "tag_of", "token_hash"]


def activity_of(counts: dict[str, Any], again: int) -> tuple[str, str]:
    """The closed outcome and reason of a post from the database's counts (never a field of the post)."""
    def n(key: str) -> int:
        value = counts.get(key)
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    if n("ready") > 0:
        return "accepted", "new_lead"
    if again > 0:
        return "accepted", "known_customer"
    if n("no_consent") > 0:
        return "accepted", "ask_first"
    if n("dnd") > 0:
        return "accepted", "on_do_not_call"
    if n("duplicates_merged") > 0 or n("already_imported") > 0:
        return "duplicate", "duplicate"
    if n("blocked") > 0:
        return "refused", "blocked"
    if n("invalid") > 0:
        return "refused", "invalid"
    return "refused", "nothing_taken"
