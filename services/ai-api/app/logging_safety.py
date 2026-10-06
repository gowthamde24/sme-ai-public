"""Keep personal data out of log lines.

Request URLs can carry personal data in their query string (e.g. ?q=<a person's name>) or, when a
caller types something where an id belongs, in the path (a pasted URL in place of a link id), and
the HTTP client logs full URLs at INFO. Three measures:
  * the uvicorn access log keeps the method, the path and the status but drops the query string;
  * a path segment is logged only if it is a route word of this API or a canonical UUID; anything
    else is replaced by <redacted> (a test checks that every route word is on the list);
  * httpx / httpcore are held at WARNING (their INFO line prints the whole request URL).
Application code additionally never logs request bodies, data-layer messages, details or hints.
"""

from __future__ import annotations

import logging
import re
from typing import Any

# Every literal segment of every route of this API (tests/test_logging_safety.py proves the list is
# complete), plus the framework's documentation routes. Anything else in a path is user-supplied.
ROUTE_WORDS = frozenset(
    {
        "v1", "me", "tenants", "members", "audit-events", "health",
        "companies", "contacts", "products", "leads", "opportunities",
        "archive", "restore", "record-consent", "suppress", "lift-suppression",
        "evidence", "evidence-links",
        "icp-configs", "active", "import", "preview", "review-queue", "labels", "exports",
        "agent-claims", "agent-cost", "agent-runs", "agent-settings", "cancel", "claims", "reviews",
        "enquiries", "requirement", "requirement-fields", "requirements",
        "confirm", "decision", "discard",
        "quote-setup", "quotes", "picks", "approve", "reject", "withdraw", "text",
        "suppression", "status", "backfill", "allow-without-key",
        "orders", "events", "order-policy-versions", "price-lists",
        "followup", "followups", "followup-drafts", "followup-policy-versions", "question-drafts",
        "touches", "due", "sent", "sync",
        "erasure-requests", "execute", "data-policy",
        "openapi.json", "docs", "redoc", "oauth2-redirect",
    }
)  # fmt: skip
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def redact_path(path: str) -> str:
    """Keep route words and canonical UUIDs; replace every other segment."""
    return "/".join(
        seg if seg == "" or seg in ROUTE_WORDS or _UUID.fullmatch(seg) else "<redacted>"
        for seg in path.split("/")
    )


class RedactQueryFilter(logging.Filter):
    """uvicorn.access args are (client_addr, method, full_path, http_version, status_code)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args: Any = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            path, has_query, _ = args[2].partition("?")
            safe = redact_path(path) + ("?<redacted>" if has_query else "")
            record.args = (*args[:2], safe, *args[3:])
        return True


_installed = False


def install_log_redaction() -> None:
    global _installed
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    if not _installed:
        logging.getLogger("uvicorn.access").addFilter(RedactQueryFilter())
        _installed = True
