"""What the notifications feature needs at run time (job BY). The VAPID private key is a secret: never in a repr, a log line or an answer."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.notifications.repository import NotificationsRepository
from app.notifications.webpush import VapidKeys


@dataclass(frozen=True)
class NotificationsRuntime:
    repository: NotificationsRepository
    # None until VAPID_PRIVATE_KEY and VAPID_SUBJECT are set: subscriptions and the feed work, nothing is pushed
    vapid: VapidKeys | None = field(default=None, repr=False)
