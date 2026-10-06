"""API models for suppression (T010, ADR 0020). Responses are `extra="forbid"` and NEVER carry a key, an identifier or an HMAC: only counts and flags."""

from __future__ import annotations

import uuid

from app.crm.models import _Strict


class SuppressionStatusOut(_Strict):
    key_configured: bool
    key_version: int | None
    unkeyed_contacts: int | None


class BackfillOut(_Strict):
    recorded: int
    skipped: int
    flagged: int
    unkeyable: int
    remaining: int


class WithoutKeyOut(_Strict):
    request_id: uuid.UUID
    without_key: bool
    replayed: bool
