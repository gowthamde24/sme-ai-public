"""Wiring of speed to lead (job DR A3): the API's service and the worker's runner."""

from __future__ import annotations

from app.config import ConfigurationError, Settings
from app.outreach.repository import PostgrestOutreachRepository
from app.outreach.runner import Dialer, FakeDialer, OutreachRunner
from app.outreach.service import OutreachService


def build_outreach(rest_url: str, anon_key: str) -> OutreachService:
    return OutreachService(PostgrestOutreachRepository(rest_url, anon_key))


def build_dialer(settings: Settings) -> Dialer | None:
    """Empty = no dialer (calls wait in the queue). `fake` = the table-driven fake (an explicit choice; staging and development). There is no real telephony yet."""
    choice = settings.outreach_dialer.strip().lower()
    if choice == "":
        return None
    if choice == "fake":
        return FakeDialer()   # explicit opt-in: only deploy/staging.sh sets it; it dials nobody and answers by a table
    raise ConfigurationError("OUTREACH_DIALER must be empty or 'fake' (no real telephony exists yet)")


def build_outreach_runner(settings: Settings, rest_url: str, anon_key: str) -> OutreachRunner:
    return OutreachRunner(PostgrestOutreachRepository(rest_url, anon_key), build_dialer(settings))
