"""Builds the automatic WhatsApp reply from settings (job DY). OFF unless AUTO_REPLY_ENABLED=true and the model's key and name are set; a half-set configuration stays off and the log names what is missing (never a key)."""

from __future__ import annotations

import logging

from app.autoreply.drafter import AnthropicDrafter
from app.autoreply.repository import PostgrestAutoReplyRepository
from app.autoreply.runner import AutoReplyRunner
from app.config import Settings

logger = logging.getLogger("app.autoreply")


def build_auto_reply(settings: Settings, rest_url: str, anon_key: str) -> AutoReplyRunner | None:
    if not settings.auto_reply_enabled:
        return None
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else ""
    model = settings.auto_reply_model or settings.llm_model or ""
    missing = [name for name, value in (("ANTHROPIC_API_KEY", key), ("AUTO_REPLY_MODEL or LLM_MODEL", model)) if not value]
    if missing:
        logger.warning("automatic replies are off: %s", ", ".join(missing))
        return None
    return AutoReplyRunner(PostgrestAutoReplyRepository(rest_url, anon_key), AnthropicDrafter(key, model))
