"""The worker's privacy housekeeping (job BN, ADR 0075): carried out with the registered scheduler principal's token, at most every few minutes, independent of the outbox switches.

  1. accounts whose 14-day cooling-off has ended are deleted (the database decides which, and refuses an account that has become the only Owner of a workspace)
  2. export files past their 24 hours are deleted from storage, and only then marked removed (so a failed delete is tried again)
  3. the retention clean-up: old chats, voice transcripts, enquiries, scheduler rows and audit rows, for the workspaces whose Owner set an age (the database throttles it to once an hour per workspace)
  4. job CR: the students who left more than the school's retention months ago are erased (the label and the admission number; the money records stay)

Counts only are logged. A failing step is counted and the next one still runs; a refused token ends the pass (the worker signs in again)."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.catalogue.storage import StorageClient
from app.privacy.repository import PrivacyRepository
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.privacy.housekeeping")

RUN_EVERY_SECONDS = 300.0
DELETIONS_PER_PASS = 10
EXPORT_FILES_PER_PASS = 50
RETENTION_WORKSPACES_PER_PASS = 20


@dataclass
class HousekeepingResult:
    accounts_deleted: int = 0
    accounts_blocked: int = 0
    export_files_removed: int = 0
    export_files_failed: int = 0
    retention_workspaces: int = 0
    students_erased: int = 0
    errors: int = 0

    def line(self) -> str:
        return (
            f"privacy housekeeping: accounts_deleted={self.accounts_deleted} accounts_blocked={self.accounts_blocked} "
            f"export_files_removed={self.export_files_removed} export_files_failed={self.export_files_failed} "
            f"retention_workspaces={self.retention_workspaces} students_erased={self.students_erased} errors={self.errors}"
        )

    def idle(self) -> bool:
        return not any(
            (self.accounts_deleted, self.accounts_blocked, self.export_files_removed, self.export_files_failed, self.retention_workspaces, self.students_erased, self.errors)
        )


class Housekeeping:
    def __init__(
        self,
        repository: PrivacyRepository,
        storage: StorageClient | None,
        *,
        every_seconds: float = RUN_EVERY_SECONDS,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._every = every_seconds
        self._monotonic = monotonic
        self._next_at = 0.0

    def due(self) -> bool:
        return self._monotonic() >= self._next_at

    def run_if_due(self, token: str) -> HousekeepingResult | None:
        if not self.due():
            return None
        self._next_at = self._monotonic() + self._every
        return self.run(token)

    def run(self, token: str) -> HousekeepingResult:
        result = HousekeepingResult()
        steps: tuple[tuple[str, Callable[[], None]], ...] = (
            ("accounts", lambda: self._accounts(token, result)),
            ("exports", lambda: self._exports(token, result)),
            ("retention", lambda: self._retention(token, result)),
            ("students", lambda: self._students(token, result)),
        )
        for name, step in steps:
            try:
                step()
            except TokenRejected:
                raise
            except Exception as exc:
                result.errors += 1
                logger.error("privacy housekeeping step %s failed: %s", name, exc.__class__.__name__)
        if not result.idle():
            logger.info(result.line())
        return result

    def _accounts(self, token: str, result: HousekeepingResult) -> None:
        answer = self._repository.execute_account_deletions(token, DELETIONS_PER_PASS)
        result.accounts_deleted += int(answer.get("executed", 0))
        result.accounts_blocked += int(answer.get("blocked", 0))

    def _exports(self, token: str, result: HousekeepingResult) -> None:
        if self._storage is None:
            return
        for item in self._repository.expired_exports(token, EXPORT_FILES_PER_PASS):
            bucket, path = str(item.get("bucket") or ""), str(item.get("path") or "")
            if not bucket or not path:
                result.errors += 1
                continue
            if self._storage.remove_checked(token, bucket, [path]):
                self._repository.export_cleaned(token, uuid.UUID(str(item["id"])))
                result.export_files_removed += 1
            else:
                result.export_files_failed += 1

    def _retention(self, token: str, result: HousekeepingResult) -> None:
        answer = self._repository.run_retention(token, RETENTION_WORKSPACES_PER_PASS)
        result.retention_workspaces += int(answer.get("workspaces", 0))

    def _students(self, token: str, result: HousekeepingResult) -> None:
        answer = self._repository.run_students_retention(token, RETENTION_WORKSPACES_PER_PASS)
        result.students_erased += int(answer.get("erased", 0))
