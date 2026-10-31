"""Builds the AI lead reader from settings (owner decision, 31 Oct 2026). OFF unless LEAD_READER_ENABLED=true and the model's key and name are set in the WORKER's environment; a half-set configuration stays
off and the log names what is missing (never a value)."""

# ruff: noqa: E501

from __future__ import annotations

import logging

from app.config import Settings
from app.lead_profile.read_runner import LeadReadRunner, PostgrestLeadReadRepository
from app.lead_profile.reader import AnthropicLeadReader

logger = logging.getLogger("app.lead_profile")


def build_lead_reader(settings: Settings, rest_url: str, anon_key: str) -> LeadReadRunner | None:
    if not settings.lead_reader_enabled:
        return None
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else ""
    model = settings.lead_reader_model or settings.auto_reply_model or settings.llm_model or ""
    missing = [name for name, value in (("ANTHROPIC_API_KEY", key), ("LEAD_READER_MODEL (or AUTO_REPLY_MODEL / LLM_MODEL)", model)) if not value]
    if missing:
        logger.warning("the lead reader is off: %s", ", ".join(missing))
        return None
    return LeadReadRunner(PostgrestLeadReadRepository(rest_url, anon_key), AnthropicLeadReader(key, model))
