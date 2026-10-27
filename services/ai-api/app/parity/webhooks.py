"""(g) Outbound webhooks (call.completed, lead.outcome, task.done), a public API key per workspace for leads in and out, and a CSV export of leads (Zoho, LeadSquared and HubSpot connectors are STUBS behind the
webhook). Pure: signing, the retry schedule, key hashing, the CSV. Storage of endpoints and keys is the next step (a table with the secret held server-side); nothing here stores or sends."""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import secrets
from typing import Any

EVENTS = ("call.completed", "lead.outcome", "task.done")
RETRY_SECONDS = (0, 60, 300, 1800, 7200)  # the first try, then four retries, each later
CRM_CONNECTORS = ("zoho", "leadsquared", "hubspot")


class NotConnected(Exception):
    """The connector exists as a name only: deliveries go through the generic webhook until it is built."""


def sign(secret: str, timestamp: int, body: bytes) -> str:
    """`X-Stack19-Signature: sha256=<hex>` over `<timestamp>.<body>`; the receiver checks it and rejects a timestamp older than five minutes (the same rule as app/hardening/replay.py)."""
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


def verify(secret: str, timestamp: int, body: bytes, signature: str, *, now: int, tolerance: int = 300) -> bool:
    return abs(now - timestamp) <= tolerance and hmac.compare_digest(sign(secret, timestamp, body), signature)


def envelope(event: str, workspace_id: str, data: dict[str, Any], *, event_id: str, at: str) -> bytes:
    if event not in EVENTS:
        raise ValueError("unknown event")
    return json.dumps({"id": event_id, "type": event, "workspace_id": workspace_id, "created_at": at, "data": data}, sort_keys=True, separators=(",", ":")).encode()


def retry_after(attempt: int) -> int | None:
    """Seconds to wait before attempt number `attempt` (0 = first); None when the schedule is used up."""
    return RETRY_SECONDS[attempt] if attempt < len(RETRY_SECONDS) else None


def new_api_key() -> tuple[str, str, str]:
    """(the key to show ONCE, its sha-256 to store, a short prefix to recognise it). The key is never stored."""
    key = "s19_" + secrets.token_urlsafe(32)
    return key, hashlib.sha256(key.encode()).hexdigest(), key[:8]


def check_api_key(presented: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hashlib.sha256(presented.encode()).hexdigest(), stored_hash)


def leads_csv(rows: list[dict[str, Any]]) -> bytes:
    """The CRM export (CSV now). A cell that starts with = + - @ gets an apostrophe so a spreadsheet never runs it."""
    cols = ["lead_id", "name", "phone", "source", "state", "outcome", "created_at"]

    def safe(v: Any) -> str:
        s = "" if v is None else str(v)
        return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([safe(r.get(c)) for c in cols])
    return out.getvalue().encode("utf-8")


def push_to_crm(connector: str, rows: list[dict[str, Any]]) -> None:
    if connector not in CRM_CONNECTORS:
        raise ValueError("unknown connector")
    raise NotConnected(connector)
