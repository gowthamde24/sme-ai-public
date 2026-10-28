"""THE one rule for what a workspace may do when it cannot be changed (job DP part 3).

A workspace is in one of three states for this purpose:
  * normal                       nothing is held
  * READ-ONLY                    its trial or plan ended unpaid (access `read_only`): signing in, viewing and exporting stay; every change, send, AI and call stops
  * WAITING FOR WHATSAPP         it chose a plan but has not connected WhatsApp (status `trial_pending`): it may set up everything (catalogue, customers, assistant settings), but sending, AI and calls stay off

Every request to a tenant's address goes through `require_tenant_role` (app/auth/deps.py), which asks `classify(method, tail)` here, and then BillingService.ensure(...). There is no other door: a test lists
every route of the application, proves each tenant route uses that dependency, and proves each write and each spend route refuses in read-only with 403 `workspace_read_only`.

  kind `read`    GET/HEAD/OPTIONS: always allowed, except the few GETs that spend (below)
  kind `change`  any other method: held in read-only, unless the path is one of READ_ONLY_OK (see the plan, choose one, ask for a copy of the data, ask for deletion, export)
  kind `spend`   sends a message, calls a model, starts a call, approves a campaign, reaches an outside service: held in read-only AND while waiting for WhatsApp

Inbound events from outside (a customer's WhatsApp message, a payment provider's webhook) are not requests of the business and are still recorded; they send nothing. The worker never runs a read-only or
waiting workspace (public.scheduler_tenants), and the outbox's claim hands out nothing for it (the database)."""

from __future__ import annotations

import re
from typing import Literal

Kind = Literal["read", "change", "spend"]
READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# what a read-only workspace may still do: see its plan and choose one (or pay again), ask for a copy of its data, ask for its deletion, export
READ_ONLY_OK = ("/billing", "/data-exports", "/deletion-requests", "/exports")

# (method, path relative to /v1/tenants/{tenant_id}) of the requests that SPEND: a message is sent, a model is called, a call is started, a campaign is approved, an outside service is reached
_SPEND = (
    ("POST", r"/leads/[^/]+/draft-message"),
    ("POST", r"/leads/[^/]+/followup-drafts"),
    ("POST", r"/followup-drafts/[^/]+/(approve|sent)"),
    ("POST", r"/requirements/[^/]+/question-drafts/sync"),
    ("POST", r"/question-drafts/[^/]+/approve"),
    ("POST", r"/agent-runs"),
    ("POST", r"/enquiries/[^/]+/quotes"),
    ("POST", r"/outbox/messages"),
    ("POST", r"/outbox/messages/[^/]+/approve"),
    ("POST", r"/outbox/dispatch"),
    ("POST", r"/call-requests/[^/]+/(approve|connect|offer-visit)"),
    ("POST", r"/visits/[^/]+/messages"),
    ("POST", r"/assistant/(messages|voice|turns)"),   # job EA: turns call the model
    ("POST", r"/assistant/actions/[^/]+/confirm"),   # job EA: a yes starts the calls and messages of a plan
    ("POST", r"/connectors/indiamart/pull"),
    ("POST", r"/payment-links/[^/]+/send"),
    ("POST", r"/missed-calls/[^/]+/handle"),
    ("POST", r"/campaigns/[^/]+/(approve|resume)"),
    ("POST", r"/outreach/batches/[^/]+/(approve|resume)"),   # job DR A3: calling and messaging a whole batch
    ("POST", r"/outreach/rules"),
    ("POST", r"/outreach/rules/[^/]+/resume"),
    ("POST", r"/voice-notes/preview"),
    ("POST", r"/ai-assistant/test-call"),
    ("POST", r"/knowledge/sources/[^/]+/draft-facts"),   # job DR / A1: a model call
    ("POST", r"/lead-imports/read"),   # job DR / A2: column matching may ask the model
    ("POST", r"/institution/marks-messages/send"),
    ("POST", r"/trips/[^/]+/notify"),
    ("POST", r"/ai-assistant/context/(understand|test)"),   # job EB: a model call (or a transcription)
    ("POST", r"/tasks/(plan|[^/]+/(answer|approve|run|resume))"),   # job DR B1: calls the model, starts calls and messages
    ("GET", r"/leads/search"),   # the outside lead search
)
_SPEND_RE = tuple((method, re.compile(pattern + r"$")) for method, pattern in _SPEND)


def tail_of(path: str, tenant_id: str) -> str:
    base = f"/v1/tenants/{tenant_id}"
    return path[len(base) :] if path.startswith(base) else path


def classify(method: str, tail: str) -> Kind:
    """What this request is, for the read-only rule. `tail` is the path after /v1/tenants/{tenant_id}."""
    verb = method.upper()
    if any(verb == m and rx.match(tail) for m, rx in _SPEND_RE):
        return "spend"
    if verb in READ_METHODS:
        return "read"
    if tail.startswith(READ_ONLY_OK):
        return "read"   # allowed even when read-only (a plan, an export, a deletion request)
    return "change"
