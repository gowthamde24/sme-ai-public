"""The notice a person gets AFTER a sensitive privacy action (job DT, ADR 0115): a full copy of the workspace's data was asked for, deletion was requested, deletion was carried out. The Owner typed the business name to
do it; this is the e-mail that tells them it happened (and where to stop it while there is still time). Fixed words, the business name only ever between lines; sent AFTER the action succeeded, as a background task, and
never able to undo or block it: a failure to send is logged (without the address) and nothing else."""

from __future__ import annotations

import logging
from typing import Literal

from app.billing.mail import Email, EmailSender

logger = logging.getLogger("app.privacy.notice")
Kind = Literal["export_requested", "deletion_requested", "deletion_executed"]

_WORDS: dict[str, tuple[str, str, str]] = {
    "export_requested": (
        "A full copy of your workspace's data was requested",
        "A full copy of the data of your workspace was requested from your account.",
        "The file is made in the background and stays available for a short time. If this was not you, sign in and change your password now, then write to us.",
    ),
    "deletion_requested": (
        "Deletion of your workspace was requested",
        "Deletion of your workspace and all its data was requested from your account.",
        "Nothing is deleted yet: there is a cooling-off period, and you can cancel the request in the app under Settings, Privacy. If this was not you, cancel it and change your password now.",
    ),
    "deletion_executed": (
        "Your workspace was deleted",
        "Your workspace and its data were deleted at your request.",
        "This cannot be undone. Copies in backups age out within 7 days. If this was not you, write to us at once.",
    ),
}


def compose_notice(kind: Kind, business: str, to: str, key: str) -> Email:
    subject, lead, tail = _WORDS[kind]
    body = f"{lead}\n\nWorkspace: {business}\n\n{tail}\n\nStack19 Team\n"
    return Email(to=to, subject=subject, body=body, idempotency_key=key)


def send_notice(sender: EmailSender | None, kind: Kind, business: str, to: str | None, key: str) -> None:
    """For a background task: never raises."""
    if sender is None or not to:
        logger.warning("privacy notice not sent: %s (no sender or no address on the account)", kind)
        return
    try:
        sender.send(compose_notice(kind, business, to, key))
    except Exception:  # noqa: BLE001 - a notice must never undo or block the action it reports
        logger.warning("privacy notice failed: %s", kind)
