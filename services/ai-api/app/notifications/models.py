"""Request bodies of the notification routes (job BY). The subscription is the browser's own PushSubscription JSON (endpoint and keys)."""

from __future__ import annotations

from typing import Annotated

from pydantic import StrictBool, StringConstraints

from app.crm.models import _Strict

Endpoint = Annotated[str, StringConstraints(min_length=20, max_length=1000, pattern=r"^https://\S+$")]
Key = Annotated[str, StringConstraints(min_length=16, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")]


class PushKeys(_Strict):
    p256dh: Key
    auth: Key


class PushSubscriptionIn(_Strict):
    endpoint: Endpoint
    keys: PushKeys


class RemoveSubscriptionIn(_Strict):
    endpoint: Endpoint


class PushEnabledIn(_Strict):
    enabled: StrictBool
