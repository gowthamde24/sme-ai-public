"""A line's opening, kept ready across restarts (owner, 6 Nov 2026; migration 20261231310000).

The first call after the opening's wording (or voice) changes streams the opening as usual, and that very audio is stored in the private `call-openings` bucket. Every later call, also after a
restart or on another instance, reads it while the call is being admitted (~0.1 s) and plays it at once. Storing what a real call spoke costs no extra voice characters.

The path is `<tenant>/<sha256(language | voice | wording)>.pcm`, so a new wording or voice is simply a new file. Only the telephony worker reads and writes the bucket. Failures are quiet: a missing or
unreadable file means the opening is streamed, never a failed call."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import urllib.parse
import uuid
from collections.abc import Callable

import httpx

log = logging.getLogger("app.telephony.opening_store")
BUCKET = "call-openings"
MAX_BYTES = 2 * 1024 * 1024


def opening_path(tenant: uuid.UUID, language: str, voice: str, text: str) -> str:
    return f"{tenant}/{hashlib.sha256(f'{language}|{voice}|{text}'.encode()).hexdigest()}.pcm"


class OpeningStore:
    def __init__(self, storage_url: str, anon_key: str, token: Callable[[], str], *, client: httpx.Client | None = None) -> None:
        self._base, self._anon, self._token = storage_url.rstrip("/"), anon_key, token
        self._client = client or httpx.Client(timeout=httpx.Timeout(3.0, connect=2.0))

    def _headers(self, **extra: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}", "apikey": self._anon, **extra}

    def get(self, path: str) -> bytes | None:
        try:
            response = self._client.get(f"{self._base}/object/authenticated/{BUCKET}/{urllib.parse.quote(path, safe='/')}", headers=self._headers())
        except httpx.HTTPError as exc:
            log.info("opening_store_unreachable %s", exc.__class__.__name__)
            return None
        if response.status_code == 200 and 0 < len(response.content) <= MAX_BYTES:
            return response.content
        if response.status_code not in (400, 404):
            log.info("opening_store_read http=%s", response.status_code)
        return None

    def put(self, path: str, pcm: bytes) -> bool:
        if not pcm or len(pcm) > MAX_BYTES:
            return False
        try:
            response = self._client.post(f"{self._base}/object/{BUCKET}/{urllib.parse.quote(path, safe='/')}", content=pcm,
                                         headers=self._headers(**{"Content-Type": "application/octet-stream", "x-upsert": "true"}))
        except httpx.HTTPError as exc:
            log.info("opening_store_unreachable %s", exc.__class__.__name__)
            return False
        if response.status_code in (200, 201):
            log.info("opening_stored bytes=%d", len(pcm))
            return True
        log.info("opening_store_write http=%s", response.status_code)
        return False
