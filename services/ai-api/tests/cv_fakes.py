"""In-memory fakes for job CV (no database): the voice notes repository and the reports repository. They record every call and answer with the shapes the database functions return; the database's own rules are
proved in supabase/tests/database/108 and 109 and tests/integration/test_cv_voice_reports.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

NOW = "2026-10-14T09:00:00+00:00"
CAMPAIGN = str(uuid.UUID(int=0xCA))
DISCLOSURE_EN: dict[str, Any] = {"language": "en", "version": 1, "status": "draft", "text": "This is an automated voice message from the AI assistant of Silks.", "usable": True}
USAGE: dict[str, Any] = {"today_seconds": 0, "month_seconds": 0, "day_percent": 0, "month_percent": 0, "state": "ok"}


class FakeVoiceNotes:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.error: Exception | None = None
        self.plan: dict[str, Any] = {"ok": True, "voice_code": "fake-en", "speed": 1.0, "language": "en", "text": DISCLOSURE_EN["text"]}
        self.usage_row: dict[str, Any] = dict(USAGE)

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.error is not None:
            raise self.error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("settings", token)
        return {"enabled": False, "speed": 1.0, "call_from_hour": 9, "call_to_hour": 21, "recording": False, "choices": {}, "updated_at": None}

    def set_settings(self, token: str, tenant_id: uuid.UUID, enabled: bool, speed: float, call_from_hour: int, call_to_hour: int) -> dict[str, Any]:
        self._go("set_settings", token, enabled, speed, call_from_hour, call_to_hour)
        return {"enabled": enabled, "speed": speed, "call_from_hour": call_from_hour, "call_to_hour": call_to_hour, "recording": False, "choices": {}, "updated_at": NOW}

    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._go("voices", token)
        return [{"code": "fake-en", "language": "en", "label": "Synthetic English (no human voice)", "synthetic": True}]

    def set_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_code: str | None) -> dict[str, Any]:
        self._go("set_choice", token, language, voice_code)
        return {"enabled": True, "speed": 1.0, "call_from_hour": 9, "call_to_hour": 21, "recording": False, "choices": {} if voice_code is None else {language: voice_code}, "updated_at": NOW}

    def disclosure(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]:
        self._go("disclosure", token, language)
        return {**DISCLOSURE_EN, "language": language}

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("usage", token)
        return dict(self.usage_row)

    def campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self._go("campaign", token, campaign_id)
        return {"campaign_id": str(campaign_id), "enabled": False, "language": "en", "voice_code": "fake-en", "disclosure": DISCLOSURE_EN, "issues": ["voice_off"], "usage": dict(USAGE)}

    def set_campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        self._go("set_campaign", token, campaign_id, enabled)
        return {**self.campaign(token, tenant_id, campaign_id), "enabled": enabled, "changed": True}

    def preview_plan(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]:
        self._go("preview_plan", token, language)
        return dict(self.plan)

    def preview_record(self, token: str, tenant_id: uuid.UUID, preview_id: uuid.UUID, language: str, seconds: int, chars: int) -> dict[str, Any]:
        self._go("preview_record", token, preview_id, language, seconds, chars)
        return {**USAGE, "today_seconds": seconds}


def report_row(code: str, d: date | None = None) -> dict[str, Any]:
    day = (d or date(2026, 10, 14)).isoformat()
    return {
        "report": code, "as_of": day, "from": "2026-09-15", "to": day,
        "kpis": [{"key": "quotes_sent", "value": 4, "unit": "count"}],
        "tables": [{"key": "top_customers", "columns": [{"key": "name", "type": "text"}, {"key": "revenue_paise", "type": "paise"}], "rows": [["Sri Constructions", 1250000]]}],
        "series": [{"key": "trips_per_day", "points": [{"day": day, "value": 3}]}],
    }  # fmt: skip


class FakeReports:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.error: Exception | None = None

    def catalogue(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self.calls.append(("catalogue", (token,)))
        if self.error is not None:
            raise self.error
        return [{"code": "construction.quotes", "title_key": "reports.construction.quotes", "window": "range", "modules": ["quotes", "reports"]}]

    def run(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        self.calls.append(("run", (token, code, date_from, date_to)))
        if self.error is not None:
            raise self.error
        return report_row(code)
