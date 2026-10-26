"""The worker's pass over the Google Sheets that are kept in sync (job DR / A2). Runs on every tick; the database says which links are due (never synced, or last synced over 15 minutes ago), so a
tick with nothing due costs one call. A sheet that cannot be read stops that link (`needs_attention`) and the owner sees why; it never stops the tick. Rows seen before are skipped by the database
(the phone is the identity), so only new rows become leads."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.integrations.sheet import SheetRefused, load_grid
from app.lead_sources import reading
from app.lead_sources.service import PART_ROWS, LeadSourcesService
from app.lead_sources.sheets import SheetError, SheetRef

logger = logging.getLogger("app.lead_sources.sync")
MAX_LINKS_PER_TICK = 5


class SheetSync:
    def __init__(self, service: LeadSourcesService) -> None:
        self._service = service

    def run(self, worker_token: str) -> int:
        repo, fetcher = self._service.repo, self._service.sheets
        if fetcher is None:
            return 0
        done = 0
        for link in repo.sheets_due(worker_token, MAX_LINKS_PER_TICK):
            link_id = uuid.UUID(str(link["id"]))
            try:
                grid = load_grid(fetcher.fetch(SheetRef(str(link["sheet_id"]), link.get("gid"))))
            except SheetError as exc:
                repo.sheet_failed(worker_token, link_id, exc.code if exc.code in ("sheet_not_public", "too_large") else "unreachable")
                continue
            except SheetRefused as exc:
                repo.sheet_failed(worker_token, link_id, "too_large" if exc.code in ("too_large", "too_many_rows") else "unreachable")
                continue
            sha = reading.header_sha(grid.header)
            mapping: dict[str, Any] = link.get("mapping") or {}
            if sha != link.get("header_sha"):
                repo.sheet_apply(worker_token, link_id, [], sha)   # the database stops the link (`columns_changed`)
                continue
            prepared = self._service.prepare(reading.rows_from_grid(grid, {k: int(v) for k, v in mapping.items()}), external_prefix=f"sh:{str(link_id)[:8]}")
            if not prepared.rows:
                repo.sheet_apply(worker_token, link_id, [], sha)
            for start in range(0, len(prepared.rows), PART_ROWS):
                repo.sheet_apply(worker_token, link_id, prepared.rows[start : start + PART_ROWS], sha)
            done += 1
        return done
