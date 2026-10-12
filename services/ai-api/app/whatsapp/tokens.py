"""Where a business's WhatsApp access token comes from: the environment, by the NAME the business's account row holds (`token_ref`). The database never holds a token. A token is a bearer secret: it is
never logged, never returned and not in a repr."""

from __future__ import annotations

import json
from collections.abc import Mapping


class TokenResolver:
    def __init__(self, default: str | None = None, by_ref: Mapping[str, str] | None = None) -> None:
        self._default = default or None
        self._by_ref = {k: v for k, v in (by_ref or {}).items() if v}

    def __repr__(self) -> str:
        return "TokenResolver(<hidden>)"

    def get(self, token_ref: str) -> str | None:
        return self._by_ref.get(token_ref) or self._default

    def any(self) -> bool:
        return bool(self._default or self._by_ref)

    @staticmethod
    def from_settings(default: str | None, tokens_json: str | None) -> TokenResolver:
        by_ref: dict[str, str] = {}
        if tokens_json:
            try:
                parsed = json.loads(tokens_json)
            except ValueError:
                raise ValueError("WHATSAPP_ACCESS_TOKENS must be a JSON object of token reference to token") from None
            if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
                raise ValueError("WHATSAPP_ACCESS_TOKENS must be a JSON object of token reference to token")
            by_ref = parsed
        return TokenResolver(default, by_ref)
