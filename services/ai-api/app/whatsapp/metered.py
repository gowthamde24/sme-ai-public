"""The WhatsApp Cloud API sender, metered for the provider usage ledger (admin console, 13 Nov 2026): after Meta ACCEPTED a message, one line says what kind of message it was, so what Meta charges us is known per workspace.

  * a free-form reply inside the customer's 24-hour window                -> `message_service`
  * an approved template (outside the window), by the template's category  -> `message_marketing` or `message_utility`
  * a template whose category is not known (the database did not say and it is not one of the first templates), or an authentication template: NOTHING is recorded and a warning says so (never a guess)
Nothing is recorded for a message Meta refused, for the fake adapter, or for "Open in WhatsApp" (a person sends that one from their own phone: it never reaches this sender).
The reference is the WhatsApp message id Meta returned (so a message sent twice because a claim lapsed is two lines, as Meta bills it twice), else the outbox message's own id.
Best effort and quiet: a recorder that fails changes nothing about the send (app/ops/usage.py)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.ops.usage import REF_ID, UsageLine, UsageRecorder, record_best_effort
from app.outbox.adapter import ChannelAdapter, OutgoingMessage, SendContext, SendResult
from app.whatsapp.first_templates import load as first_templates

log = logging.getLogger("app.whatsapp.metered")

UNIT_OF_CATEGORY = {"marketing": "message_marketing", "utility": "message_utility"}


def category_of_template(name: str) -> str | None:
    """The category of one of the first five templates (app/whatsapp/data/first_templates.json), by name."""
    return next((str(t["category"]) for t in first_templates() if t.get("name") == name), None)


def message_unit(wa: SendContext) -> str | None:
    """The ledger unit of a message sent in this context, or None when it cannot be said."""
    if wa.window_open:
        return "message_service"
    if wa.template is None:
        return None
    category = wa.template.category or category_of_template(wa.template.name)
    return UNIT_OF_CATEGORY.get(category or "")


class MeteredAdapter:
    """Wraps the real WhatsApp adapter; everything else about the send is the inner adapter's."""

    def __init__(self, inner: ChannelAdapter, recorder: UsageRecorder) -> None:
        self._inner, self._recorder = inner, recorder
        self.name = inner.name

    def __getattr__(self, attr: str) -> Any:
        return getattr(self._inner, attr)

    def send(self, message: OutgoingMessage) -> SendResult:
        result = self._inner.send(message)
        if result.ok and result.adapter_message_id and message.wa is not None and message.tenant_id is not None:
            try:
                unit = message_unit(message.wa)
                if unit is None:
                    log.warning("provider usage not recorded: the category of a template message is not known")
                else:
                    ref = result.adapter_message_id if REF_ID.fullmatch(result.adapter_message_id) else str(message.message_id)
                    record_best_effort(self._recorder, message.tenant_id, [UsageLine("meta", unit, 1, "message", ref)])
            except Exception as exc:  # noqa: BLE001 - a send that happened is never undone by its bookkeeping
                log.warning("provider usage not recorded: %s", exc.__class__.__name__)
        return result


def metered(adapter: ChannelAdapter, recorder: UsageRecorder | None) -> ChannelAdapter:
    """The adapter with its sends recorded: only the real WhatsApp adapter, and only when a recorder is configured; anything else is returned unchanged."""
    if recorder is None or adapter.name != "whatsapp":
        return adapter
    return MeteredAdapter(adapter, recorder)
