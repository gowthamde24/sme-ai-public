"""Wires the notifications feature from settings (job BY). The feed and subscriptions always work; pushing needs the VAPID keys."""

from __future__ import annotations

from typing import Any

from app.config import ConfigurationError, Settings
from app.notifications.repository import PostgrestNotificationsRepository
from app.notifications.runtime import NotificationsRuntime
from app.notifications.webpush import VapidKeys


def build_vapid(settings: Settings) -> VapidKeys | None:
    if settings.vapid_private_key is None or not settings.vapid_subject:
        return None
    try:
        return VapidKeys.parse(settings.vapid_private_key.get_secret_value(), settings.vapid_subject, settings.vapid_public_key)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


def build_notifications(settings: Settings, config: Any) -> NotificationsRuntime:
    return NotificationsRuntime(PostgrestNotificationsRepository(config.rest_url, config.anon_key), build_vapid(settings))
