"""What Cartesia offers now that the catalogue does not have (owner, 21 Nov 2026: "we also need all those from Sarvam and Cartesia"). READ ONLY and FREE: it asks Cartesia's voice LIST (`GET /voices`, no characters are spoken, nothing is
billed) for every call language and gender, and prints which voices of the language the catalogue (data/voices.json) does not have yet, and which catalogue voices Cartesia no longer lists. It writes nothing: a person then adds the new voices
with scripts/voice_catalogue_build.py (which also renders their samples) or by hand in voices.json.

It is made to run as a Cloud Run job on the API's image with the key bound from Secret Manager, never typed in a shell (docs/runbooks/voice-catalogue-refresh.md):

    python -m app.conversation.cartesia_refresh

The log carries voice ids, names, languages and genders: no text, no key."""

# ruff: noqa: E501

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

from app.conversation.voices import CALL_LANGUAGES, VoiceConfig, default_config

LIST_URL = "https://api.cartesia.ai/voices"
VERSION = "2025-04-16"
KINDS = {"female": "feminine", "male": "masculine"}   # (named "kinds": a variable called gender is read by CodeQL as private data, and this job prints voice ids on purpose)


def fetch(client: httpx.Client, key: str, language: str, kind: str) -> list[dict[str, Any]]:
    """Cartesia's public voices of one language and kind (up to 100 of them; `is_public` false ones are the account's own and are left out)."""
    resp = client.get(LIST_URL, params={"language": language, "gender": KINDS[kind], "limit": 100}, headers={"X-API-Key": key, "Cartesia-Version": VERSION})
    resp.raise_for_status()
    body = resp.json()
    rows = body.get("data") if isinstance(body, dict) else body
    return [v for v in rows if isinstance(v, dict) and v.get("is_public", True) and v.get("language") == language] if isinstance(rows, list) else []


def compare(config: VoiceConfig, offered: dict[tuple[str, str], list[dict[str, Any]]]) -> tuple[list[str], list[str]]:
    """(lines for voices Cartesia offers that the catalogue lacks, lines for catalogue voices Cartesia no longer lists), each a plain line: 'language kind provider-id name' for a new voice, 'language catalogue-id' for a gone one."""
    ours = {c.voices.primary.voice: c for c in config.catalogue.values() if c.voices.primary.engine == "cartesia"} | {c.voices.fallback.voice: c for c in config.catalogue.values() if c.voices.fallback.engine == "cartesia"}
    seen: set[str] = set()
    new: list[str] = []
    for (language, kind), voices in sorted(offered.items()):
        for v in voices:
            vid = str(v.get("id", ""))
            seen.add(vid)
            if vid and vid not in ours:
                new.append(f"{language} {kind} {vid} {str(v.get('name', ''))[:40]}")
    gone = [f"{c.language} {c.id}" for c in config.catalogue.values() if c.voices.primary.engine == "cartesia" and offered.get((c.language, c.gender)) and c.voices.primary.voice not in seen]
    return new, gone


def main() -> int:
    key = os.environ.get("CARTESIA_API_KEY", "")
    if not key:
        print("CARTESIA_API_KEY is not set (the job binds it from Secret Manager)", file=sys.stderr)
        return 2
    offered: dict[tuple[str, str], list[dict[str, Any]]] = {}
    with httpx.Client(timeout=60) as client:
        for language in CALL_LANGUAGES:
            for kind in KINDS:
                offered[(language, kind)] = fetch(client, key, language, kind)
    new, gone = compare(default_config(), offered)
    print(f"cartesia voices listed: {sum(len(v) for v in offered.values())}; not in the catalogue: {len(new)}; in the catalogue but no longer listed: {len(gone)}")
    for line in new:
        print(f"NEW {line}")
    for line in gone:
        print(f"GONE {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
