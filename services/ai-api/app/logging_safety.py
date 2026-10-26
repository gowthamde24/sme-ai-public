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
        # job DI: plans and billing
        "plans", "billing", "trial", "access",
        # job DP part 4: call settings
        "call-settings",
        # job DM: outcomes of calls and follow-ups
        "outcomes", "totals", "correct", "ai-assistant", "preview", "test-call",
        # job DQ part 4 (DPDP): consent, profile, the public grievance and waitlist doors
        "consents", "marketing", "privacy", "notice", "subprocessors", "grievance", "public",
        "waitlist", "speaking-style",
        # job DR B1: tasks
        "tasks", "plan", "answer", "exclude", "run", "pause", "resume", "cancel", "cap", "report",
        "templates",
        # job DP: marks and report messages to guardians (a file that is never stored)
        "marks-messages", "batches",
        # job CN: sites, dues, material quotes, deliveries, the public calculator
        "calculate", "materials", "sites", "dues", "customers", "invoices", "payments",
        "credit-limit", "credit-check", "ledger", "items", "photos", "order", "trips", "delivered",
        "challan", "notify", "policy", "orders", "catalogue", "void",
        # job CP: the shared ledger, reminder campaigns, the call list
        "statement", "entries", "charges", "receipts", "campaigns", "recipients", "from-ledger",
        "clear", "results", "call-list", "outcome",
        # job CR: the education pack (the school's own vocabulary, never a person)
        "institution", "programmes", "groups", "students", "admissions", "stage", "admit",
        "erase", "fee-plans", "fee-assignments", "fees", "adjustments", "concessions",
        "guardians", "late-fees", "post", "pending", "announcements", "audience",
        # job CV: the one reports API and the voice notes
        "choices", "usage", "disclosure", "notes", "voice-notes", "voices",
        # job DP part 5: the Owner's own voice
        "voice-clone", "sentence", "delete",
        # job CK
        "packs", "auth", "providers", "pack", "modules", "example-data",
        "custom-fields", "custom", "security", "remove",
        "account", "setup", "today", "ai-usage", "agents", "assistant", "messages", "conversations",
        "companies", "contacts", "products", "leads", "opportunities",
        "archive", "restore", "record-consent", "suppress", "lift-suppression",
        "evidence", "evidence-links",
        "icp-configs", "active", "import", "review-queue", "labels", "exports",
        "agent-claims", "agent-cost", "agent-runs", "agent-settings", "claims", "reviews",
        "enquiries", "requirement", "requirement-fields", "requirements",
        "confirm", "decision", "discard",
        "quote-setup", "quotes", "picks", "approve", "reject", "withdraw", "text",
        "suppression", "status", "backfill", "allow-without-key",
        # job BI: exports, imports, the calendar feed (its token is never a word: always redacted)
        "accounting", "formats", "imports", "spreadsheet", "inspect", "jobs",
        "calendar-feed", "calendar", "feed", "revoke", "policies", "current",
        "policy-acceptances", "by-phone",
        # job BN: privacy rights
        "data-exports", "deletion-requests", "retention", "grievances", "link",
        # job BR: WhatsApp (no secret in the path; the verify token travels in the query, redacted)
        "webhooks", "whatsapp", "activate", "disable", "submit", "read",
        # job BY: the team, the shop's basics, the report, notifications and push
        "team", "invitations", "accept", "role", "reports", "weekly", "profile",
        "notifications", "seen", "push", "push-subscriptions", "public-key",
        "events", "order-policy-versions", "quote-policy-versions", "price-lists",
        "item-types", "manual-quotes",
        "followup", "followups", "followup-drafts", "followup-policy-versions", "question-drafts",
        "touches", "due", "sent", "sync",
        "erasure-requests", "execute", "data-policy",
        "outbox", "approvals", "dispatch", "edit", "settings", "call-requests",
        "visits", "slots", "change", "arrive", "no-show", "complete", "offer-visit", "week",
        "scheduler", "search", "draft-message",
        "summary", "voice", "research", "places", "business-profile", "ready", "metrics",
        # job BZ: connectors and webhooks (a secret in an address is never a word: always redacted)
        "connectors", "indiamart", "pull", "payment-links", "send", "record",
        "missed-calls", "handle", "connect",
        "razorpay", "cashfree", "fake-payments", "exotel", "missed-call", "call-status",
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
