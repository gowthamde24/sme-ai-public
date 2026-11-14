"""The Google Maps cap alerts, e-mailed (admin console, 14 Nov 2026). The database (`ops_google_alerts_run`) makes ONE alert per SKU per month at 80 percent of the free monthly cap (and one more at 100) and lists the ones not yet e-mailed;
this pass sends each to the active owner account(s) of the staff console and marks them sent. A failed send is tried again on the next tick (the alert stays unmarked). The e-mail holds a SKU name and counts only: no personal data."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

from app.billing.mail import Email, EmailSender

log = logging.getLogger("app.ops.alerts")


class AlertsRpc(Protocol):
    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


def alert_email(to: str, alert_id: str, severity: str, title: str, detail: str | None) -> Email:
    prefix = "Limit reached" if severity == "over" else "Heads-up"
    body = "\n".join([title, "", detail or "", "", "Nothing has been charged: Stack19 stops asking Google at the free monthly limit. You can raise a limit or wait until the 1st.", "Open the staff console, Usage & cost, to see every Google Maps line.", ""])
    return Email(to=to, subject=f"[Stack19] {prefix}: {title}"[:200], body=body, idempotency_key=f"google-cap-{alert_id}")


class GoogleCapAlerts:
    def __init__(self, rpc: AlertsRpc, sender: EmailSender) -> None:
        self._rpc, self._sender = rpc, sender

    def run(self, token: str) -> int:
        """Send what is due. Returns the number of alerts marked as sent."""
        new = self._rpc.object(token, "ops_google_alerts_run", {}).get("new") or []
        if not new:
            return 0
        emails = [e for e in (self._rpc.object(token, "ops_alert_recipients", {}).get("emails") or []) if isinstance(e, str) and "@" in e]
        if not emails:
            log.warning("google cap alerts: no owner account to tell (%d waiting)", len(new))
            return 0
        sent: list[uuid.UUID] = []
        for a in new:
            ok = [self._sender.send(alert_email(e, str(a["id"]), str(a["severity"]), str(a["title"]), a.get("detail"))) for e in emails]
            if all(ok):
                sent.append(uuid.UUID(str(a["id"])))
        if sent:
            self._rpc.call(token, "ops_alert_mark_emailed", {"p_ids": [str(i) for i in sent]})
        return len(sent)
