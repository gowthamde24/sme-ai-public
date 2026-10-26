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
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.errors import ApiError, not_found
from app.integrations.sheet import MAX_UPLOAD_BYTES, Grid, SheetRefused, load_grid
from app.lead_sources import mapping as mp
from app.lead_sources import portals, reading
from app.lead_sources.dnd import DndLookup
from app.lead_sources.meta import LeadgenRef, MetaError, MetaLeadFetcher, refs_of, signature_ok
from app.lead_sources.phones import check_phone
from app.lead_sources.repository import LeadSourcesRepository
from app.lead_sources.sheets import SheetError, SheetFetcher, SheetRef, parse_sheet_url
from app.suppression.keys import KeyRing

if TYPE_CHECKING:
    from app.scheduler.session import PrincipalSession

logger = logging.getLogger("app.lead_sources")
PART_ROWS = 500
AVG_CALL_MINUTES = 3
_NS = uuid.UUID("5c1f2f55-0d0b-4b8e-9a3b-6a1d5f0c7e21")
_FORM_ALIASES = {
    "name": ("name", "full_name", "fullname", "your_name", "customer_name", "first_name"),
    "phone": ("phone", "mobile", "whatsapp", "contact_number", "phone_number", "mobile_number", "contact", "tel"),
    "email": ("email", "e-mail", "email_address", "mail"),
    "message": ("message", "requirement", "enquiry", "inquiry", "comments", "comment", "query", "note", "notes"),
    "city": ("city", "location", "town"),
    "external_id": ("external_id", "lead_id", "id"),
}
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{24,64}$")
_MAIL_TO = re.compile(r"leads\+([A-Za-z0-9_-]{24,64})@", re.I)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tag_of(kind: str, portal: str | None) -> str:
    return {"website_form": "website_form", "webhook": "webhook", "meta_lead_ads": "meta_lead_ads", "indiamart": "indiamart"}.get(kind) or (portal or "webhook")


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


class LeadSourcesService:
    def __init__(
        self,
        repo: LeadSourcesRepository,
        *,
        sheets: SheetFetcher | None = None,
        dnd: DndLookup | None = None,
        key_ring: KeyRing | None = None,
        receiver: PrincipalSession | None = None,
        meta: MetaLeadFetcher | None = None,
        meta_app_secret: str | None = None,
        inbound_domain: str | None = None,
        inbound_secret: str | None = None,
        public_base_url: str | None = None,
        service_account_email: str | None = None,
        indiamart_available: bool = False,
        billing: Any = None,
        matcher: mp.ColumnMatcher | None = None,
    ) -> None:
        self.repo = repo
        self.sheets = sheets
        self.dnd = dnd
        self.key_ring = key_ring
        self.receiver = receiver
        self.meta = meta
        self._meta_secret = meta_app_secret
        self.inbound_domain = (inbound_domain or "").strip().lower() or None
        self._inbound_secret = inbound_secret
        self.base = (public_base_url or "").rstrip("/")
        self.service_account_email = service_account_email
        self.indiamart_available = indiamart_available
        self.billing = billing
        self.matcher = matcher

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
        if status == "unknown":
            raise not_found()
        if status == "rate":
            raise ApiError(429, "rate_limited", "Too many requests. Try again in a minute.", headers={"Retry-After": "60"})
        return status

    @staticmethod
    def form_row(data: dict[str, Any]) -> dict[str, Any] | None:
        """A lead from a form or a webhook body: aliases accepted, extra fields ignored, a filled honeypot = a bot (None)."""
        lower = {str(k).lower(): v for k, v in data.items() if isinstance(k, str)}
        if str(lower.get("_hp") or "").strip():
            return None
        row: dict[str, Any] = {}
        for field, names in _FORM_ALIASES.items():
            for n in names:
                v = lower.get(n)
                if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
                    row[field] = str(v).strip()[: reading.LIMITS.get(field, 200)]
                    break
        return row

    def receive_form(self, secret: str, data: dict[str, Any]) -> None:
        row = self.form_row(data)
        if not _TOKEN.fullmatch(secret):
            raise not_found()
        if row is None:
            return   # a bot: answered like a success, nothing stored
        self._live(secret, [row])

    def receive_mail(self, secret: str, mail: Any) -> str:
        parsed = portals.parse_mail(mail.sender, mail.subject, mail.text)
        if parsed is None:
            if not _TOKEN.fullmatch(secret):
                raise not_found()
            out = self.repo.unparsed_add(self._worker(), token_hash(secret), mail.subject or None, mail.text[:4000] or mail.subject or "(empty)")
            if out.get("status") == "unknown":
                raise not_found()
            return "unrecognised"
        row = dict(parsed.row)
        if mail.message_id:
            row["external_id"] = "m:" + hashlib.sha256(mail.message_id.encode("utf-8")).hexdigest()[:40]
        self._live(secret, [row])
        return "received"

    def receive_mail_global(self, provided_secret: str | None, mail: Any) -> str:
        if self._inbound_secret is None or self.receiver is None:
            raise ApiError(503, "not_available", "Not available right now.")
        if not provided_secret or not hmac.compare_digest(provided_secret.encode(), self._inbound_secret.encode()):
            raise ApiError(401, "unauthorized", "Not allowed.")
        m = _MAIL_TO.search(mail.to or "")
        if not m:
            raise not_found()
        return self.receive_mail(m.group(1), mail)

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
                rows.append(self.meta.fetch(LeadgenRef(ref.leadgen_id, ref.page_id, ref.form_id)))
            except MetaError:
                logger.warning("meta: a lead could not be fetched")
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
