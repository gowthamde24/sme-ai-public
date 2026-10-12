"""Running a "download my data" request (job BN, ADR 0075): begin, build the zip, put it in the person's private bucket, finish. It runs in the background after the request was accepted; the person
polls the export row (queued, running, ready, failed) and asks for a short-lived link when it is ready. Every database call is made with the PERSON's own token, so the database (not this code) decides
that it is their export and their bucket. A failure is recorded with a reason word only; the file of a failed attempt is removed. Nothing about the content is logged: ids, counts and sizes."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from app.catalogue.storage import StorageClient
from app.privacy.export_builder import (
    BuiltExport,
    ExportTooLarge,
    build_person_export,
    build_workspace_export,
)
from app.privacy.repository import PrivacyRepository
from app.tenancy.repository import RepositoryError, TokenRejected, UpstreamError

logger = logging.getLogger("app.privacy.export")

LINK_SECONDS = 300


def run_export_job(
    repository: PrivacyRepository,
    storage: StorageClient,
    token: str,
    export_id: uuid.UUID,
    scope: str,
    tenant_id: uuid.UUID | None,
    tenant_name: str | None,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> None:
    """Never raises: the outcome is the export row's status."""
    path = f"{export_id}.zip"
    bucket: str | None = None
    uploaded = False
    reason = "internal"
    try:
        repository.export_begin(token, export_id)
        generated_at = now()
        built: BuiltExport
        reason = "source_unreadable"
        if scope == "workspace" and tenant_id is not None:
            built = build_workspace_export(repository, token, tenant_id, tenant_name or "the workspace", generated_at)
        else:
            built = build_person_export(repository.person_data(token), generated_at)
        reason = "storage"
        bucket = repository.export_bucket(token)
        storage.upload(token, bucket, path, built.content, "application/zip")
        uploaded = True
        reason = "internal"
        repository.export_finish(token, export_id, True, built.size, built.sha256, None)
        logger.info("export ready id=%s scope=%s bytes=%d", export_id, scope, built.size)
        return
    except ExportTooLarge:
        reason = "too_large"
    except TokenRejected:
        reason = "internal"
    except UpstreamError:
        pass  # `reason` already says which step
    except RepositoryError:
        pass
    except Exception as exc:  # a bug must not leave the export "running" for ever
        logger.error("export crashed: %s", exc.__class__.__name__)
        reason = "internal"
    if uploaded and bucket is not None:
        storage.remove(token, bucket, [path])
    try:
        repository.export_finish(token, export_id, False, None, None, reason)
    except Exception as exc:
        logger.error("export could not be marked failed: %s", exc.__class__.__name__)
    logger.warning("export failed id=%s scope=%s reason=%s", export_id, scope, reason)
