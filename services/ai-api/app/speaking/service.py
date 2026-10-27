"""What the routes and the prompts call (job DS): the saved speaking styles with their options, and the one style a prompt needs. A failure to read the setting never stops a message: the default is used."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.agents import register
from app.speaking.models import LanguageStyleOut, OptionsOut, SpeakingStyleIn, SpeakingStyleOut
from app.speaking.repository import SpeakingRepository
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.speaking")


class SpeakingService:
    def __init__(self, repository: SpeakingRepository) -> None:
        self._repo = repository

    def _out(self, raw: dict[str, Any]) -> SpeakingStyleOut:
        saved = raw.get("languages") or {}
        languages: dict[Any, LanguageStyleOut] = {
            lang: LanguageStyleOut(
                style=(saved.get(lang) or {}).get("style", register.DEFAULT_STYLE),
                region=(saved.get(lang) or {}).get("region", "neutral"),
                saved=bool((saved.get(lang) or {}).get("saved", False)),
                examples=register.status(lang),  # type: ignore[arg-type]
            )
            for lang in register.LANGUAGES
        }
        regions: dict[Any, list[Any]] = {lang: list(r) for lang, r in register.REGIONS.items()}
        options = OptionsOut(styles=list(register.STYLES), default_style=register.DEFAULT_STYLE, regions=regions)  # type: ignore[arg-type]
        return SpeakingStyleOut(languages=languages, options=options)

    def get(self, token: str, tenant_id: uuid.UUID) -> SpeakingStyleOut:
        return self._out(self._repo.get(token, tenant_id))

    def save(self, token: str, tenant_id: uuid.UUID, body: SpeakingStyleIn) -> SpeakingStyleOut:
        document = {"languages": {lang: choice.model_dump() for lang, choice in body.languages.items()}}
        return self._out(self._repo.save(token, tenant_id, document))

    def style_for(self, token: str, tenant_id: uuid.UUID, language: str) -> tuple[str, str]:
        """(style, region) for one language; the default when nothing is saved or the setting cannot be read."""
        try:
            chosen = (self._repo.get(token, tenant_id).get("languages") or {}).get(language) or {}
        except TokenRejected:
            raise
        except Exception as exc:
            logger.warning("speaking style unreadable (%s); the default is used", exc.__class__.__name__)
            chosen = {}
        return str(chosen.get("style") or register.DEFAULT_STYLE), str(chosen.get("region") or "neutral")
