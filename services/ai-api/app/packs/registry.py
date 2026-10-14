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


def default_directory() -> Path | None:
    here = Path(__file__).resolve()
    for candidate in (here.parents[4] / "packages" / "packs", Path("/srv/packages/packs")):
        if (candidate / "modules.json").is_file():
            return candidate
    return None


class PackRegistry:
    def __init__(self, directory: Path | None) -> None:
        self._directory = directory
        self._cache: PackListOut | None = None

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
