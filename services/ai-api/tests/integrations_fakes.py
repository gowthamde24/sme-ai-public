"""An in-memory IntegrationsRepository for the route tests of job BI: it keeps what the database would (jobs, stock, feed hashes, acceptances), enforces the same small rules (the job's file and
mapping hashes, the state of a job) and records every call with the token it was made with."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import jwt

from app.crm.repository import InvalidReferenceError
from app.integrations.errors import ImportJobStateError, ImportMismatchError
from app.tenancy.repository import RepositoryError, UpstreamError


def who(token: str) -> str:
    """The person behind a (test) token: its subject."""
    return str(jwt.decode(token, options={"verify_signature": False})["sub"])


class FakeIntegrations:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str | None] = []
        self.export: dict[str, Any] = {"from": "2026-10-01", "to": "2026-10-31", "orders": [], "payments": []}
        self.jobs: dict[str, dict[str, Any]] = {}
        self.catalogue: list[dict[str, Any]] = []
        self.applied: list[dict[str, str]] = []
        self.feeds: dict[str, dict[str, Any]] = {}  # token hash -> feed
        self.feed_state: dict[tuple[str, str], dict[str, Any]] = {}
        self.accepted: list[dict[str, Any]] = []
        self.fail: RepositoryError | None = None

    def _note(self, name: str, token: str | None, args: Any = None) -> None:
        self.calls.append((name, args))
        self.tokens.append(token)
        if self.fail is not None:
            raise self.fail

    # export
    def export_data(self, token: str, tenant_id: uuid.UUID, export_id: uuid.UUID, fmt: str, date_from: str, date_to: str) -> dict[str, Any]:
        self._note("export_data", token, (str(tenant_id), str(export_id), fmt, date_from, date_to))
        return {**self.export, "from": date_from, "to": date_to}

    # jobs
    def job_preview_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._note("job_preview_save", token, args)
        jid = args["p_job_id"]
        old = self.jobs.get(jid)
        if old is not None and old["status"] == "completed":
            return old
        job = {"id": jid, "kind": args["p_kind"], "status": "previewed", "file_sha256": args["p_file_sha256"], "mapping": args["p_mapping"], "mapping_sha256": args["p_mapping_sha256"],
               "rows_total": args["p_rows"], "counts": args["p_counts"], "issues": args["p_issues"], "created_at": "2026-10-05T10:00:00+00:00", "updated_at": "2026-10-05T10:00:00+00:00", "completed_at": None}  # fmt: skip
        self.jobs[jid] = job
        return job

    def job_get(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, Any]:
        self._note("job_get", token)
        if str(job_id) not in self.jobs:
            raise InvalidReferenceError("23503")
        return self.jobs[str(job_id)]

    def job_list(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        self._note("job_list", token)
        return list(self.jobs.values())[:limit]

    def job_begin(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, file_sha256: str, mapping_sha256: str) -> dict[str, Any]:
        self._note("job_begin", token)
        job = self.jobs[str(job_id)]
        if job["file_sha256"] != file_sha256 or job["mapping_sha256"] != mapping_sha256:
            raise ImportMismatchError("SM603")
        return {**job, "replay": job["status"] == "completed"}

    def job_finish(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, status: str, counts: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, Any]:
        self._note("job_finish", token, (status, counts))
        job = self.jobs[str(job_id)]
        if job["status"] != "completed":
            job.update(status=status, counts=counts, issues=issues, completed_at="2026-10-05T10:05:00+00:00" if status == "completed" else None)
        return job

    def stock_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._note("stock_list", token)
        return [dict(i) for i in self.catalogue]

    def stock_apply(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, changes: list[dict[str, str]]) -> dict[str, Any]:
        self._note("stock_apply", token, changes)
        job = self.jobs.get(str(job_id))
        if job is None or job["kind"] != "stock" or job["status"] not in ("previewed", "failed"):
            raise ImportJobStateError("SM602")
        updated = same = missing = 0
        for c in changes:
            item = next((i for i in self.catalogue if i["id"] == c["id"]), None)
            if item is None:
                missing += 1
            elif item["stock_status"] == c["stock_status"]:
                same += 1
            else:
                item["stock_status"] = c["stock_status"]
                updated += 1
                self.applied.append(c)
        return {"updated": updated, "unchanged": same, "missing": missing}

    # calendar
    def calendar_create(self, token: str, tenant_id: uuid.UUID, token_sha256: str) -> dict[str, Any]:
        self._note("calendar_create", token, token_sha256)
        for h, f in list(self.feeds.items()):
            if f.get("_owner") == who(token):
                del self.feeds[h]  # rotation: the member's earlier address stops
        self.feeds[token_sha256] = {"_owner": who(token), "business": "Tenant A", "generated_at": "2026-10-05T08:30:00+00:00", "events": []}
        return {"active": True, "created_at": "2026-10-05T08:30:00+00:00", "last_used_at": None}

    def calendar_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("calendar_status", token)
        mine = [f for f in self.feeds.values() if f.get("_owner") == who(token)]
        return {"active": bool(mine), "created_at": "2026-10-05T08:30:00+00:00" if mine else None, "last_used_at": None}

    def calendar_revoke(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("calendar_revoke", token)
        gone = [h for h, f in self.feeds.items() if f.get("_owner") == who(token)]
        for h in gone:
            del self.feeds[h]
        return {"active": False, "revoked": len(gone)}

    def calendar_read(self, token_sha256: str) -> dict[str, Any] | None:
        self._note("calendar_read", None, token_sha256)
        feed = self.feeds.get(token_sha256)
        return None if feed is None else {k: v for k, v in feed.items() if not k.startswith("_")}

    # policy
    def policy_accept(self, token: str, terms: str | None, privacy: str | None, via: str) -> list[dict[str, Any]]:
        self._note("policy_accept", token, (terms, privacy, via))
        for kind, version in (("terms", terms), ("privacy", privacy)):
            if version is not None and not any(a["kind"] == kind and a["version"] == version for a in self.accepted):
                self.accepted.append({"kind": kind, "version": version, "accepted_at": dt.datetime(2026, 10, 5, tzinfo=dt.UTC).isoformat(), "via": via})
        return list(self.accepted)

    def policy_mine(self, token: str) -> list[dict[str, Any]]:
        self._note("policy_mine", token)
        return list(self.accepted)


def upstream_down() -> RepositoryError:
    return UpstreamError("data layer unreachable")
