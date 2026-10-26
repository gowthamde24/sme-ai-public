"""Marks and report messages to guardians, from a file that is NEVER stored (job DP part 2; owner decision: the platform does not keep children's marks).

The flow, and where the file lives at each step:
  1. PREVIEW  the Owner or an Admin uploads the file. It is read in memory for this request, checked, matched to the school's guardians and counted. The answer has counts, closed codes with line numbers, the file's
              SHA-256 and the first ready message (so the wording can be read). The file is dropped when the request ends. Nothing is written anywhere.
  2. SEND     the Owner (second factor) uploads THE SAME FILE again with the SHA-256 and the count they saw. A different file, or a different count (a guardian opted out meanwhile), is refused (409) and nothing is
              sent. The Owner's approval is written to the send log first (line number, guardian, template id: `pending`), each message is then handed to the sender, and the log says what happened. The words of a
              message exist only in this function's memory between building and handing over. A retry with the same batch id never sends a line twice.
  3. CANCEL   there is nothing to cancel: stopping before step 2 leaves nothing behind. (The file is not held between steps, so no hold has to expire after 24 hours.)

What is KEPT: the send log (guardian contact, time, template id, status). What is never kept, never logged and never passed to any model: marks, the child's name, the subject, the term, the message text.
This module imports nothing that talks to a model, a speech engine or the network (a test reads its imports); no module of the assistant, the agents or the voice path imports it (a test reads theirs)."""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Any

from app.education import progress
from app.marksmessages import reader
from app.marksmessages.models import IssueOut, PreviewOut, SendOut
from app.marksmessages.repository import MarksSendRepository
from app.marksmessages.sender import GuardianSender, SendRefused, SendUnreachable

logger = logging.getLogger("app.marksmessages")

CHUNK = 500
MAX_ISSUES = 50
_SCHOOL_BAD = re.compile(r"[^\w .'’()\-]", re.UNICODE)


class FileRefused(Exception):
    """The file cannot be used. `code` is a closed word; `fields` are column NAMES."""

    def __init__(self, code: str, fields: tuple[str, ...] = ()) -> None:
        super().__init__(code)
        self.code = code
        self.fields = fields


class ApprovalMismatch(Exception):
    """The Owner approved something other than what is in front of the service now (`file` changed, or the `count` moved)."""

    def __init__(self, what: str) -> None:
        super().__init__(what)
        self.what = what


def school_name(raw: str) -> str:
    """The workspace's name as the template may carry it: letters, digits, space, dot, apostrophe, hyphen, brackets."""
    cleaned = " ".join(_SCHOOL_BAD.sub(" ", unicodedata.normalize("NFC", raw)).split())
    return cleaned[: progress.LIMITS["school"]] or "School"


@dataclass(frozen=True)
class _Ready:
    line: reader.Line
    contact_id: uuid.UUID
    template_id: str


@dataclass(frozen=True)
class _Prepared:
    reading: reader.Reading
    ready: list[_Ready]
    blocked: list[_Ready]
    issues: list[IssueOut]
    unknown: int


def template_id(kind: str, language: str) -> str:
    return f"{kind}.{language}"


class MarksSendService:
    def __init__(self, repo: MarksSendRepository, sender: GuardianSender) -> None:
        # no storage client, no path, no cache: the file is a local variable of one call
        self._repo = repo
        self._sender = sender

    # ------------------------------------------------------------------ the shared part
    def _prepare(self, token: str, tenant_id: uuid.UUID, data: bytes, kind: str, language: str, term: str | None) -> _Prepared:
        try:
            reading = reader.read(data, kind, language, term)
        except reader.FileProblem as exc:
            raise FileRefused(exc.code, exc.fields) from None
        issues = [IssueOut(line=b.line, code=b.code, field=b.field) for b in reading.bad]  # type: ignore[arg-type]
        ready: list[_Ready] = []
        blocked: list[_Ready] = []
        unknown = 0
        if reading.lines:
            answers = self._repo.resolve(token, tenant_id, [ln.phone for ln in reading.lines])
            if len(answers) != len(reading.lines):
                raise FileRefused("guardians_unavailable")
            for ln, answer in zip(reading.lines, answers, strict=True):
                state = answer.get("state")
                if state == "unknown" or not answer.get("contact_id"):
                    unknown += 1
                    issues.append(IssueOut(line=ln.seq, code="unknown_guardian"))
                    continue
                item = _Ready(ln, uuid.UUID(str(answer["contact_id"])), template_id(kind, ln.language))
                if state == "ok":
                    ready.append(item)
                else:
                    blocked.append(item)
                    issues.append(IssueOut(line=ln.seq, code="blocked_guardian"))
        issues.sort(key=lambda i: (i.line, i.code))
        return _Prepared(reading, ready, blocked, issues, unknown)

    # ------------------------------------------------------------------ 1. preview
    def preview(self, token: str, tenant_id: uuid.UUID, school: str, data: bytes, kind: str, language: str, term: str | None) -> PreviewOut:
        prepared = self._prepare(token, tenant_id, data, kind, language, term)
        example: str | None = None
        if prepared.ready:
            example = self._text(kind, school, prepared.ready[0].line)
        counts = Counter(r.template_id for r in prepared.ready)
        return PreviewOut(
            kind=kind,  # type: ignore[arg-type]
            file_sha256=prepared.reading.sha256,
            rows=prepared.reading.rows,
            will_send=len(prepared.ready),
            blocked=len(prepared.blocked),
            unknown_guardian=prepared.unknown,
            invalid=len(prepared.reading.bad) - prepared.reading.duplicates,
            duplicates=prepared.reading.duplicates,
            by_template=dict(sorted(counts.items())),
            issues=prepared.issues[:MAX_ISSUES],
            issues_truncated=len(prepared.issues) > MAX_ISSUES,
            example_text=example,
        )

    @staticmethod
    def _text(kind: str, school: str, line: reader.Line) -> str:
        return progress.render(kind, line.language, school_name(school), dict(line.fields)).text

    # ------------------------------------------------------------------ 2. send
    def send(
        self,
        token: str,
        tenant_id: uuid.UUID,
        school: str,
        data: bytes,
        kind: str,
        language: str,
        term: str | None,
        batch_id: uuid.UUID,
        expect_sha256: str,
        expect_count: int,
    ) -> SendOut:
        prepared = self._prepare(token, tenant_id, data, kind, language, term)
        if prepared.reading.sha256 != expect_sha256:
            raise ApprovalMismatch("file")
        if len(prepared.ready) != expect_count:
            raise ApprovalMismatch("count")
        items = prepared.ready + prepared.blocked
        items.sort(key=lambda r: r.line.seq)
        sent = failed = blocked = already = 0
        for start in range(0, len(items), CHUNK):
            part = items[start : start + CHUNK]
            answer = self._repo.begin(
                token, tenant_id, batch_id, [{"seq": r.line.seq, "contact_id": str(r.contact_id), "template_id": r.template_id} for r in part]
            )
            to_send = {int(s) for s in answer.get("to_send", [])}
            blocked += int(answer.get("blocked", 0))
            already += int(answer.get("already", 0))
            results: list[dict[str, Any]] = []
            for r in part:
                if r.line.seq not in to_send:
                    continue
                results.append(self._deliver(tenant_id, school, kind, r))
            if results:
                self._repo.finish(token, tenant_id, batch_id, results)
                sent += sum(1 for x in results if x["status"] == "sent")
                failed += sum(1 for x in results if x["status"] == "failed")
        skipped = len(prepared.reading.bad) + prepared.unknown
        logger.info("marks messages: batch done sent=%d failed=%d blocked=%d already=%d skipped=%d", sent, failed, blocked, already, skipped)  # counts only
        return SendOut(batch_id=batch_id, kind=kind, rows=prepared.reading.rows, sent=sent, failed=failed, blocked=blocked, already_handled=already, skipped=skipped)  # type: ignore[arg-type]

    def _deliver(self, tenant_id: uuid.UUID, school: str, kind: str, item: _Ready) -> dict[str, Any]:
        try:
            text = self._text(kind, school, item.line)
            self._sender.send(tenant_id, item.contact_id, item.template_id, text)
        except SendRefused:
            return {"seq": item.line.seq, "status": "failed", "reason": "provider_refused"}
        except (SendUnreachable, progress.ProgressMessageError):
            return {"seq": item.line.seq, "status": "failed", "reason": "provider_unreachable"}
        except Exception as exc:  # the channel broke in a way we do not know; the log says so, the words are not logged
            logger.error("marks messages: the sender failed (%s)", exc.__class__.__name__)
            return {"seq": item.line.seq, "status": "failed", "reason": "provider_unreachable"}
        return {"seq": item.line.seq, "status": "sent"}


    # ------------------------------------------------------------------ 3. the log
    def batches(self, token: str, tenant_id: uuid.UUID, limit: int, before: Any) -> dict[str, Any]:
        return self._repo.batches(token, tenant_id, limit, before)

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.batch(token, tenant_id, batch_id)
