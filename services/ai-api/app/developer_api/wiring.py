"""Builds the developer API from the settings: None (every route answers 404) unless DEVELOPER_API=test. The program's requests run as the registered worker account (SCHEDULER_EMAIL /
SCHEDULER_PASSWORD), the same account the public lead-intake doors use; without it the API answers 503."""

# ruff: noqa: E501

from __future__ import annotations

import httpx

from app.config import Settings
from app.developer_api.repository import PostgrestDeveloperRepository
from app.developer_api.service import DeveloperApi
from app.scheduler.session import PrincipalSession


def build_developer_api(settings: Settings, rest_url: str, auth_url: str, anon_key: str) -> DeveloperApi | None:
    if settings.developer_api != "test":
        return None
    receiver: PrincipalSession | None = None
    if settings.scheduler_email and settings.scheduler_password and settings.scheduler_password.get_secret_value():
        receiver = PrincipalSession(auth_url, anon_key, settings.scheduler_email, settings.scheduler_password.get_secret_value(), client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))
    return DeveloperApi(PostgrestDeveloperRepository(rest_url, anon_key), receiver, trusted_hops=settings.trusted_proxy_hops)
