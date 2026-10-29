"""Models of the lead sources and imports (job DR / A2). Strict. The contract is docs/contracts/lead-sources.md."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.crm.models import ApiUuid

SourceTag = Literal["indiamart", "justdial", "99acres", "magicbricks", "housing", "meta_lead_ads", "website_form", "webhook", "excel_upload", "google_sheet", "pasted_list", "vcard"]
Portal = Literal["indiamart", "justdial", "99acres", "magicbricks", "housing"]
SourceKind = Literal["website_form", "webhook", "email_forward", "meta_lead_ads", "indiamart"]
ReadKind = Literal["file", "paste", "vcard", "sheet"]
MAX_FILE_BYTES = 3_000_000
MAX_TEXT_CHARS = 600_000
DEFAULT_TAG: dict[str, str] = {"file": "excel_upload", "paste": "pasted_list", "vcard": "vcard", "sheet": "google_sheet"}
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Sentence = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsentIn(_Strict):
    confirmed: Literal[True]
    list_name: Short
    purpose: Sentence
    basis: Literal["explicit_consent", "legitimate_use", "contractual"]
    how_collected: Sentence


class ReadIn(_Strict):
    kind: ReadKind
    filename: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    content_base64: Annotated[str, Field(max_length=MAX_FILE_BYTES * 4 // 3 + 16)] | None = None
    text: Annotated[str, Field(max_length=MAX_TEXT_CHARS)] | None = None
    sheet_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    use_ai: bool = True

    @model_validator(mode="after")
    def _content(self) -> ReadIn:
        if self.kind == "file" and not self.content_base64:
            raise ValueError("a file needs its content")
        if self.kind == "paste" and not (self.text and self.text.strip()):
            raise ValueError("a pasted list needs its text")
        if self.kind == "vcard" and not (self.content_base64 or (self.text and self.text.strip())):
            raise ValueError("a vCard needs its content")
        if self.kind == "sheet" and not self.sheet_url:
            raise ValueError("a sheet needs its link")
        return self


class PreviewIn(ReadIn):
    mapping: dict[str, int] | None = None
    source: SourceTag | None = None
    consent_confirmed: bool = False


class ImportIn(PreviewIn):
    import_id: ApiUuid
    consent: ConsentIn | None = None
    cost_per_lead_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None


class ColumnOut(_Strict):
    index: int
    header: str
    samples: list[str]
    field: str | None
    confidence: Literal["exact", "partial", "weak", "ai", "none"]


class FieldOut(_Strict):
    field: str
    label: str
    required: bool


class ReadOut(_Strict):
    kind: ReadKind
    rows: int
    columns: list[ColumnOut]
    fields: list[FieldOut]
    mapping: dict[str, int] | None
    mapped_by: Literal["rules", "rules+ai", "none"]
    needs_confirmation: bool
    warnings: list[str]


class Counts(_Strict):
    ready: int = 0
    duplicates_merged: int = 0
    duplicates_in_file: int = 0
    already_imported: int = 0
    invalid: int = 0
    dnd: int = 0
    no_consent: int = 0
    blocked: int = 0


class Problem(_Strict):
    row: int
    reason: str


class Estimate(_Strict):
    messages: int
    call_minutes: int
    cost_paise: int | None
    basis: Literal["estimate"] = "estimate"


class PreviewOut(_Strict):
    rows_read: int
    source: str
    counts: Counts
    estimate: Estimate
    problems: list[Problem]
    dnd_lookup: Literal["checked", "not_configured"]


class ImportOut(_Strict):
    import_id: ApiUuid
    status: Literal["done"] = "done"
    source: str
    consent_id: ApiUuid | None
    counts: Counts
    problems: list[Problem]
    created_at: datetime


class ImportItem(_Strict):
    import_id: ApiUuid
    kind: str
    source: str
    rows_read: int
    counts: Counts
    problems: list[Problem]
    consent_id: ApiUuid | None
    by: str | None
    created_at: datetime


class ImportsOut(_Strict):
    items: list[ImportItem]
    next_cursor: str | None = None


# ------------------------------------------------------------------------------------------------------------------ live sources
class SourceCreate(_Strict):
    source_id: ApiUuid
    kind: SourceKind
    label: Short
    portal: Portal | None = None
    consent: ConsentIn | None = None
    cost_per_lead_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None

    @model_validator(mode="after")
    def _portal(self) -> SourceCreate:
        if self.portal is not None and self.kind != "email_forward":
            raise ValueError("only a forwarding address names a portal")
        return self


class SourceOut(_Strict):
    id: ApiUuid
    kind: SourceKind
    tag: SourceTag
    label: str
    status: Literal["active", "paused"]
    created_at: datetime
    last_received_at: datetime | None
    received_count: int
    token_hint: str | None
    cost_per_lead_paise: int | None
    consent_confirmed: bool
    available: bool


class SecretOut(_Strict):
    shown_once: Literal[True] = True
    url: str | None
    email_address: str | None
    snippet_html: str | None
    meta_callback_url: str | None
    meta_verify_token: str | None


class SourceWithSecretOut(SourceOut):
    secret: SecretOut | None = None


class SourcesOut(_Strict):
    items: list[SourceOut]


class UnparsedOut(_Strict):
    id: ApiUuid
    source_id: ApiUuid
    received_at: datetime
    subject: str | None
    preview: str


class UnparsedListOut(_Strict):
    items: list[UnparsedOut]


class IndiaMartPullOut(_Strict):
    fetched: int
    created: int
    merged: int
    invalid: int
    existing: int
    window_start: datetime
    window_end: datetime


# ------------------------------------------------------------------------------------------------------------------ sheets kept in sync
class SheetLinkIn(_Strict):
    link_id: ApiUuid
    sheet_url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)]
    mapping: dict[str, int]
    consent: ConsentIn | None = None
    cost_per_lead_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None


class SheetLinkOut(_Strict):
    id: ApiUuid
    status: Literal["active", "paused", "needs_attention"]
    source: str
    last_synced_at: datetime | None
    last_row_count: int | None
    last_result: dict[str, Any] | None
    last_error: Literal["sheet_not_public", "columns_changed", "unreachable", "too_large"] | None
    created_at: datetime
    next_sync_at: datetime | None


class SheetLinksOut(_Strict):
    items: list[SheetLinkOut]


class SheetModeOut(_Strict):
    mode: Literal["anyone_with_link", "published_csv", "service_account"]
    available: bool
    service_account_email: str | None = None


class SheetAccessOut(_Strict):
    modes: list[SheetModeOut]


# ------------------------------------------------------------------------------------------------------------------ the history of a lead
class TouchOut(_Strict):
    at: datetime
    kind: Literal["first", "repeat"]
    source: str
    message: str | None


class TouchesOut(_Strict):
    items: list[TouchOut]
    flags: list[Literal["dnd", "invalid_number"]]


class ReceivedOut(_Strict):
    status: Literal["received"] = "received"


class MailIn(_Strict):
    sender: Annotated[str, StringConstraints(max_length=320)] = Field(alias="from")
    to: Annotated[str, StringConstraints(max_length=1000)] | None = None
    subject: Annotated[str, StringConstraints(max_length=500)] = ""
    text: Annotated[str, Field(max_length=200_000)] = ""
    html: Annotated[str, Field(max_length=400_000)] | None = None
    message_id: Annotated[str, StringConstraints(max_length=300)] | None = None
    # job EB part B: the whole raw mail (base64, at most 150,000 bytes) from the Cloudflare mail worker; the API reads it with a real mail parser and fills sender, subject and text
    raw_base64: Annotated[str, Field(max_length=210_000)] | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class MailOut(_Strict):
    status: Literal["received", "unrecognised"]


# ---- the Sources page (job EB part B)
class CardAction(_Strict):
    type: Literal["oauth", "paste_key", "copy_address", "copy_snippet", "upload", "resume", "open", "none"]
    label: str


class CardProblem(_Strict):
    code: str
    message: str
    fix: CardAction


class Card(_Strict):
    kind: Literal["meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls"]
    title: str
    status: Literal["not_connected", "connected", "needs_attention", "coming_soon"]
    headline: str
    detail: str | None
    received_7d: int
    last_received_at: datetime | None
    action: CardAction
    problem: CardProblem | None
    available: bool


class CardsOut(_Strict):
    items: list[Card]


class GuideStep(_Strict):
    step: int
    text: str


class GmailConfirmation(_Strict):
    code: str
    received_at: datetime


class EmailAddressOut(_Strict):
    address: str
    gmail_filter_guide: list[GuideStep]
    sample_portals: list[str]
    gmail_confirmation: GmailConfirmation | None
