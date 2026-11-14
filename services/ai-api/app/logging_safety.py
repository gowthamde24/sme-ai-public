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
        "practice",   # POST /talk-training/practice (app v4)
        "goodwill-credit", "unmask",   # POST /admin/businesses/{id}/goodwill-credit (14 Nov)
        "reply", "assign",   # POST /admin/support/tickets/{id}/reply and /assign (14 Nov)
        "demo", "start", "end",   # POST /calls/demo/start and /end (13 Nov)
        "corrections",   # POST /knowledge/corrections and /corrections/{id}/undo (13 Nov)
        "done",   # POST /conversations/{lead}/done (13 Nov)
        "pricing", "balance", "estimate", "free-start",   # billing v2 (13 Nov)
        "subscription-checkout", "subscribe", "change-quote", "gst-invoices",   # billing v2 pay
        "go-live",   # POST /assistant/go-live (13 Nov)
        "admin", "audit", "businesses", "support-access",   # admin console (13 Nov)
        "overview", "search", "tickets", "support",
        "config", "disconnect",   # GET /whatsapp/connect/config, POST /whatsapp/disconnect (W3)
        "first", "submit-drafts",   # POST /whatsapp/templates/first and /submit-drafts (13 Nov)
        "checkout",   # POST /billing/checkout (C12)
        "razorpay-billing",   # POST /webhooks/razorpay-billing (C12: signed billing events)
        "draft",   # POST /talk-training/draft (C15)
        "mark-sent",   # POST /outbox/messages/{id}/mark-sent (C10: "I sent it")
        "timeline",   # GET /customers/{id}/timeline (app v4)
        "correction",   # POST /calls/{id}/correction (app v4)
        "take-over", "take-over-setting",   # WS /calls/{id}/take-over (app v4)
        "whisper",   # POST /calls/{id}/whisper (app v4)
        "money", "low-stock",   # GET /money/summary, /catalogue/low-stock (app v4)
        "v1", "me", "tenants", "members", "audit-events", "health",
        # 5 Nov 2026 (C1): a switch per helper
        "switches", "switch",
        # 9 Nov 2026 (C1): Everything it did, and Limits
        "activity-log", "limits",
        # 5 Nov 2026 (C1): "secrets"
        "secrets",
        # 5 Nov 2026 (C1): the developer API (ADR 0121): /api/v1/... and Settings -> Developers
        "api", "developer", "keys",
        # 5 Nov 2026 (C1): guided setups (POST /assistant/setups/{id}/test)
        "setups",
        # 6 Nov 2026 (C1): My AI team v2 (/ai-team/day, /ai-team/{helper}, /ai-team/standup)
        "ai-team", "day", "standup",
        # 5 Nov 2026 (C1): a hand-over call was dealt with
        "handled",
        # 5 Nov 2026 (C1): "talk-training"
        "talk-training",
        # 5 Nov 2026 (C1): "nav-counts"
        "nav-counts",
        # job DT (ADR 0115, 0116): the business profile, pictures, people and the opening line
        "workspace", "logo", "picture", "people", "voice-preview", "opening-line", "mention-ai",
        "resolved",
        "pronunciation",
        # job test-workspaces: the lead sources a business type uses; example data in one call
        "offered",
        # Lead Finder (ADR 0119)
        "lead-finder", "availability", "searches", "prospects", "redecide", "simulated-call",
        "telephony", "stream", "stream-url", "tools",
        "files", "undo",  # job assistant-does-the-work A2
        "entitlements",  # plans as feature switches
        "stats", "quote-draft",
        # job voice-picker
        "voice-samples", "voice-chat", "auto-reply", "turns", "actions",
        # job EB: the owner's notes
        "context", "save", "test", "understand", "versions",
        # job DI: plans and billing
        "plans", "billing", "trial", "access",
        # job DP part 4: call settings
        "call-settings",
        # job DM: outcomes of calls and follow-ups
        "outcomes", "totals", "correct", "ai-assistant", "preview", "test-call",
        # job DQ part 4 (DPDP): consent, profile, the public grievance and waitlist doors
        "consents", "marketing", "privacy", "notice", "subprocessors", "grievance", "public",
        "waitlist", "speaking-style", "lead-templates", "lead-playbook", "knowledge",
        "how-assistant-speaks",
        "bootstrap",
        "sources", "facts", "draft-facts", "decide", "reset",
        # job DR / A2: lead imports, sheets kept in sync, live sources, the public intake doors
        "lead-imports", "lead-sheet-links", "sync", "pause", "resume", "lead-sources",
        "rotate", "indiamart", "pull", "unparsed",
        "leads", "touches", "lead-intake", "email", "mail", "meta", "cards", "email-address",
        "resend", "activity",
        # job DR A3: speed to lead and approve once
        "outreach", "exclude", "caps", "rules", "result", "handoffs", "acted", "source-costs",
        # job DR B1: tasks
        "tasks", "plan", "answer", "run", "cancel", "cap", "report",
        # job phone-calls part 6: the Calls page
        "calls", "hang-up",
        "templates",
        "voice-sample",
        # job DP: marks and report messages to guardians (a file that is never stored)
        "marks-messages", "batches",
        # job CN: sites, dues, material quotes, deliveries, the public calculator
        # job DS part E2: top-ups, the upgrade
        "topups", "upgrade", "upgrade-preview",
        "calculate", "materials", "sites", "dues", "customers", "invoices", "payments",
        "credit-limit", "credit-check", "ledger", "items", "photos", "order", "trips", "delivered",
        "challan", "notify", "policy", "orders", "catalogue", "void", "quantity",
        "speech", "transcribe",   # POST /speech/transcribe (typing by voice)
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
        "companies", "contacts", "products", "opportunities",
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
        # job EK: the website form
        "website", "form",
        # job EE: the lead profile
        "normalise",
        "followup", "followups", "followup-drafts", "followup-policy-versions", "question-drafts",
        "due", "sent", "erasure-requests", "execute", "data-policy",
        "outbox", "approvals", "dispatch", "edit", "settings", "call-requests",
        "visits", "slots", "change", "arrive", "no-show", "complete", "offer-visit", "week",
        "scheduler", "draft-message",
        "summary", "voice", "research", "places", "business-profile", "ready", "metrics",
        # job BZ: connectors and webhooks (a secret in an address is never a word: always redacted)
        "connectors", "payment-links", "send", "record",
        "missed-calls", "handle", "connect",
        "razorpay", "cashfree", "fake-payments", "exotel", "missed-call", "call-status",
        "plivo", "outbound-answer", "place", "test-numbers",
        "hangup", "stream-status",
        "openapi.json", "docs", "redoc", "oauth2-redirect",
    }
)  # fmt: skip
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def one_line(value: object, limit: int = 80) -> str:
    """A value that may come from a caller, made safe for ONE log line.

    No line break, no other control character, at most `limit` characters
    (code scanning: py/log-injection).
    """
    text = str(value).replace("\r", " ").replace("\n", " ")
    return re.sub(r"[\x00-\x1f\x7f]", " ", text)[:limit]


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


class RedactWebSocketFilter(logging.Filter):
    """uvicorn logs a WebSocket's opening to `uvicorn.error` with the path AND its query, which
    can hold a credential (the phone stream's per-call token). The path is redacted like an HTTP
    access line and the query is dropped."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        msg = record.msg
        if isinstance(msg, str) and '"WebSocket %s"' in msg and isinstance(args, tuple):
            if len(args) >= 2 and isinstance(args[1], str):
                path, has_query, _ = args[1].partition("?")
                safe = redact_path(path) + ("?<redacted>" if has_query else "")
                record.args = (args[0], safe, *args[2:])
        return True


def install_log_redaction() -> None:
    global _installed
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    if not _installed:
        logging.getLogger("uvicorn.access").addFilter(RedactQueryFilter())
        logging.getLogger("uvicorn.error").addFilter(RedactWebSocketFilter())
        _installed = True
