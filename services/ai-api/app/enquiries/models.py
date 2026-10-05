"""API models for enquiries (T008). Responses are `extra="forbid"`: a column added to the
database cannot leak by accident.

An enquiry is UNTRUSTED CONTENT (CLAUDE.md #6): `subject` and `body` are data, rendered as plain
text by every client, never followed, never interpreted. They were scrubbed of e-mail addresses and
mobile numbers before storage (owner change A)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from app.crm.models import _Strict

Channel = Literal["email", "whatsapp", "form", "other"]


class EnquiryOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    company_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    channel: Channel
    received_at: datetime
    subject: str | None
    body: str
    truncated_from: int | None
    created_by: uuid.UUID | None
    created_at: datetime
    archived_at: datetime | None
