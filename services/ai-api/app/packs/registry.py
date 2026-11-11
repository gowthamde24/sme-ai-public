"""The packs as the repository holds them (packages/packs/<id>/pack.json), read once and served to people who are not signed in yet (GET /v1/packs: the sign-up cards).

Everything about a SIGNED-IN business comes from the database (the version it chose, pinned and immutable); these files only describe the types a new person may choose. A pack that does not parse is
skipped and logged, never served half-read. Where the files live: PACKS_DIR, else the checkout's packages/packs, else /srv/packages/packs (the container image)."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from app.packs.models import PackListOut, PackStatus, PackSummaryOut

logger = logging.getLogger("app.packs.registry")


class _Manifest(BaseModel):
    """The part of pack.json the sign-up cards need. Extra keys are ignored here (packages/packs/pack.schema.json is the strict check, run in CI)."""

    model_config = ConfigDict(extra="ignore")

    id: str
    version: int
    status: PackStatus
    names: dict[str, str]
    summary: dict[str, str]
    accent: str
    owl_prop: str


def candidate_directories(here: Path) -> list[Path]:
    """Where the packs may be: next to the source tree (development), or where the image puts them. In the image the source sits at /srv/app/packs, which is too shallow for the repository layout: look only as high as the path goes."""
    found = [here.parents[4] / "packages" / "packs"] if len(here.parents) > 4 else []
    return [*found, Path("/srv/packages/packs")]


def default_directory() -> Path | None:
    for candidate in candidate_directories(Path(__file__).resolve()):
        if (candidate / "modules.json").is_file():
            return candidate
    return None


class PackRegistry:
    def __init__(self, directory: Path | None) -> None:
        self._directory = directory
        self._cache: PackListOut | None = None

    def call_tone(self, pack_id: str | None) -> str:
        """The default tone of phone calls to customers for this business type (packages/packs/call_tones.json): respectful or friendly."""
        return call_tone(pack_id, self._directory)

    def selectable(self) -> PackListOut:
        """The business types a new person may choose: preview and published packs, newest version of each, in a stable order."""
        if self._cache is not None:
            return self._cache
        found: dict[str, PackSummaryOut] = {}
        if self._directory is not None and self._directory.is_dir():
            for manifest in sorted(self._directory.glob("*/pack.json")):
                try:
                    pack = _Manifest.model_validate(json.loads(manifest.read_text(encoding="utf-8")))
                except (OSError, ValueError, ValidationError):
                    logger.error("a pack file could not be read: %s", manifest.parent.name)
                    continue
                if pack.status == "draft" or pack.id != manifest.parent.name:
                    continue
                current = found.get(pack.id)
                if current is None or current.version < pack.version:
                    found[pack.id] = PackSummaryOut(
                        pack_id=pack.id, version=pack.version, status=pack.status, validated=pack.status == "published",
                        names=pack.names, summary=pack.summary, accent=pack.accent, owl_prop=pack.owl_prop,
                    )  # fmt: skip
        else:
            logger.error("the packs directory was not found: sign-up cards cannot be served")
        self._cache = PackListOut(packs=sorted(found.values(), key=lambda p: (not p.validated, p.pack_id)))
        return self._cache


DEFAULT_CALL_TONE = "friendly"
CALL_TONES = ("respectful", "friendly")


def call_tone(pack_id: str | None, directory: Path | None = None) -> str:
    """The default tone of the phone calls to customers for a business type (packages/packs/call_tones.json): respectful or friendly. Anything unknown, unreadable or missing is friendly, never casual.
    The caller passes the pack id it read from the database; no pack id is ever written in code."""
    folder = directory if directory is not None else default_directory()
    if folder is None or not pack_id:
        return DEFAULT_CALL_TONE
    try:
        doc = json.loads((folder / "call_tones.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return DEFAULT_CALL_TONE
    if not isinstance(doc, dict):
        return DEFAULT_CALL_TONE
    default = doc.get("default") if doc.get("default") in CALL_TONES else DEFAULT_CALL_TONE
    raw_tones = doc.get("tones")
    tones: dict[str, object] = raw_tones if isinstance(raw_tones, dict) else {}
    chosen = tones.get(pack_id, default)
    return str(chosen) if chosen in CALL_TONES else DEFAULT_CALL_TONE
