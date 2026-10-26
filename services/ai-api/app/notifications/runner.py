"""The worker's push step (job BY, ADR 0077): ask the database who has something new waiting, send one notification each, tell the database what happened. Carried out with the scheduler account's token.

What is sent is a FIXED sentence by kind and a count: no customer name, no amount, no message text. The browser's service worker can localize from `kinds`. A member is told at most once about an item, only if
they opted in, only for things that wait for THEM, and not during the business's quiet hours (all decided by the database). A failing subscription is reported, five in a row delete it, a forgotten one (404/410)
is deleted at once. Counts only are logged."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from app.notifications.repository import NotificationsRepository
from app.notifications.webpush import Subscription, WebPushSender

logger = logging.getLogger("app.notifications.runner")

SENTENCES = {
    "quote_approval": "A quote is waiting for your approval.",
    "followup_due": "A follow-up is waiting for your approval.",
    "order_money_held": "Money is held on an order.",
    "outbox_approval": "A message is waiting for your approval.",
    "call_approval": "A call is waiting for your approval.",
    "outreach_paused": "Calling is paused and waits for you.",
    "hot_lead_waiting": "An interested customer is waiting for a call back.",
}


@dataclass
class PushTally:
    members: int = 0
    sent: int = 0
    gone: int = 0
    failed: int = 0

    def idle(self) -> bool:
        return not (self.members or self.sent or self.gone or self.failed)


def build_payload(tenant_id: str, items: list[dict[str, Any]]) -> bytes:
    kinds: dict[str, int] = {}
    for item in items:
        kinds[str(item["kind"])] = kinds.get(str(item["kind"]), 0) + 1
    count = len(items)
    body = SENTENCES.get(next(iter(kinds)), "Something needs you.") if len(kinds) == 1 and count == 1 else f"{count} things need you."
    return json.dumps({"v": 1, "tenant_id": tenant_id, "title": "Needs you", "body": body, "count": count, "kinds": kinds}, separators=(",", ":")).encode()


class PushRunner:
    def __init__(self, repository: NotificationsRepository, sender: WebPushSender, *, per_pass: int = 50) -> None:
        self._repository = repository
        self._sender = sender
        self._per_pass = per_pass

    def run(self, token: str) -> PushTally:
        tally = PushTally()
        for member in self._repository.pending(token, self._per_pass):
            tenant_id = str(member["tenant_id"])
            items = [i for i in member.get("items") or [] if isinstance(i, dict)]
            if not items:
                continue
            tally.members += 1
            payload = build_payload(tenant_id, items)
            delivered = False
            for raw in member.get("subscriptions") or []:
                subscription = Subscription(str(raw["id"]), str(raw["endpoint"]), str(raw["p256dh"]), str(raw["auth"]))
                result = self._sender.send(subscription, payload)
                self._repository.report(token, uuid.UUID(subscription.id), result.outcome)
                if result.outcome == "ok":
                    delivered = True
                    tally.sent += 1
                elif result.outcome == "gone":
                    tally.gone += 1
                else:
                    tally.failed += 1
            if delivered:
                self._repository.mark(token, uuid.UUID(tenant_id), uuid.UUID(str(member["user_id"])), items)
        if not tally.idle():
            logger.info("push pass: members=%d sent=%d gone=%d failed=%d", tally.members, tally.sent, tally.gone, tally.failed)
        return tally
