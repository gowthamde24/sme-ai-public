"""The marks-message API's shapes (job DP part 2). NOTHING here can hold a child's marks beyond the request: the preview and the send answer with counts, closed codes and line numbers, and the
log (`BatchOut`) has the guardian, the time, the template id and the status only. The one exception is `example_text` in the preview: the first ready message, built from the file the Owner just uploaded and
shown only to them in that answer, so they can read the wording before approving; it is never stored, logged or sent anywhere.

NOTE: no `from __future__ import annotations` (the models are attached to endpoint signatures at registration time)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Kind = Literal["marks", "report_ready"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
LogStatus = Literal["pending", "sent", "blocked", "failed"]
Reason = Literal["suppressed", "consent_withdrawn", "erased", "provider_refused", "provider_unreachable"]
# a problem with the FILE, never a copy of what the file says
IssueCode = Literal[
    "bad_phone", "bad_value", "bad_language", "formula_cell", "duplicate_row", "unknown_guardian", "blocked_guardian",
]  # fmt: skip


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IssueOut(_Out):
    """One line of the file that will not be sent, and why. `field` names the column at fault (never its value)."""

    line: int = Field(ge=1)
    code: IssueCode
    field: str | None = None


class TemplateOut(_Out):
    kind: Kind
    language: Language
    template_id: str
    columns: list[str]
    example_text: str


class TemplatesOut(_Out):
    """The fixed, approved messages and the columns the file needs. `columns` are the English names; the same words in the school's language, `phone` / `mobile` / `whatsapp` ..., are accepted (see `aliases`)."""

    kinds: list[Kind]
    languages: list[Language]
    templates: list[TemplateOut]
    aliases: dict[str, list[str]]
    max_rows: int
    max_bytes: int


class PreviewOut(_Out):
    kind: Kind
    file_sha256: str
    rows: int
    will_send: int
    blocked: int
    unknown_guardian: int
    invalid: int
    duplicates: int
    by_template: dict[str, int]
    issues: list[IssueOut]
    issues_truncated: bool
    example_text: str | None


class SendOut(_Out):
    batch_id: uuid.UUID
    kind: Kind
    rows: int
    sent: int
    failed: int
    blocked: int
    already_handled: int
    skipped: int
    # nothing is kept of the file: it was read for this request only
    file_kept: Literal[False] = False


class BatchLineOut(_Out):
    batch_id: uuid.UUID
    started_at: datetime
    approved_by: uuid.UUID
    total: int
    sent: int
    blocked: int
    failed: int
    pending: int
    templates: list[str]


class BatchesOut(_Out):
    items: list[BatchLineOut]
    next_cursor: str | None


class LogRowOut(_Out):
    seq: int
    contact_id: uuid.UUID
    guardian_name: str | None
    template_id: str
    status: LogStatus
    reason: Reason | None
    sent_at: datetime | None


class BatchOut(_Out):
    batch_id: uuid.UUID
    started_at: datetime
    approved_by: uuid.UUID
    total: int
    sent: int
    blocked: int
    failed: int
    pending: int
    rows: list[LogRowOut]
