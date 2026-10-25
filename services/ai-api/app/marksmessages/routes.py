"""Marks and report messages to guardians under /v1/tenants/{tenant_id}/institution/marks-messages (job DP part 2). The contract is packages/contracts/marks_messages.* and docs/contracts/marks-messages.md.

  GET  /templates            the fixed, approved messages (a sample in each language), the file's columns and limits. Owner, Admin.
  POST /preview              body: THE FILE (raw bytes, CSV or XLSX, like the spreadsheet imports); query `kind` (marks | report_ready), `language` (default for lines that name none), `term` (when the file has
                             no term column). Counts, problems by line number, the file's SHA-256, the first ready message. Stores nothing. Owner, Admin.
  POST /send                 body: THE SAME FILE; the same query plus `batch_id` (a uuid the client makes; a retry with it never sends a line twice), `expect_sha256` and `expect_count` from the preview. Owner with a
                             second factor. A different file or count is refused (409 `marks_file_changed` / `marks_count_changed`) and nothing is sent. Sending is FAKE for now.
  GET  /batches              the send log, one line per batch (newest first; `limit`, `cursor`). Owner, Admin.
  GET  /batches/{batch_id}   one batch: its lines with the guardian, the template id, the status. Owner, Admin.

The file is never stored. It lives in memory for one request. There is nothing to cancel and nothing to expire (see service.py). A school only: another business gets 403 `module_off`.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.education import progress
from app.errors import ApiError, not_found
from app.integrations.routes_import import FILE_REFUSALS
from app.integrations.sheet import MAX_UPLOAD_BYTES
from app.marksmessages import reader
from app.marksmessages.models import (
    BatchesOut,
    BatchLineOut,
    BatchOut,
    Kind,
    Language,
    PreviewOut,
    SendOut,
    TemplateOut,
    TemplatesOut,
)
from app.marksmessages.service import ApprovalMismatch, FileRefused, MarksSendService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/institution/marks-messages", tags=["school"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
TermQuery = Annotated[str | None, Query(max_length=progress.LIMITS["term"])]

# a sample child that does not exist, used only to show what each fixed message says
SAMPLE = {"student": "Asha", "subject": "Maths", "marks": "42", "out_of": "50", "term": "Term 1"}


def _id(raw: str, *, missing: bool = False) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found() if missing else ApiError(422, "invalid_id", "That id is not valid.")
    return parsed


def _service(runtime: Runtime) -> MarksSendService:
    if runtime.marks_messages is None:
        raise ApiError(503, "marks_messages_unavailable", "Marks messages are not available right now.")
    return runtime.marks_messages


async def _read_file(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise _refusal("file_too_large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise _refusal("file_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def _refusal(code: str, fields: tuple[str, ...] = ()) -> ApiError:
    if code == "missing_column":
        return ApiError(422, "marks_file_missing_column", "The file needs these columns: " + ", ".join(fields) + ".")
    if code == "guardians_unavailable":
        return ApiError(503, "marks_guardians_unavailable", "Guardians could not be matched right now. Nothing was sent.")
    if code == "bad_request":
        return ApiError(422, "marks_bad_request", "That kind or language is not available.")
    status, message = FILE_REFUSALS.get(code.removeprefix("file_"), (422, "That file could not be read."))
    return ApiError(status, f"marks_{code}" if code.startswith("file_") else code, message)


@router.get("/templates", response_model=TemplatesOut)
def templates(ctx: OwnerAdmin) -> TemplatesOut:
    items = [
        TemplateOut(
            kind=kind,  # type: ignore[arg-type]
            language=language,  # type: ignore[arg-type]
            template_id=f"{kind}.{language}",
            columns=list(reader.REQUIRED[kind]) + ["term", "language"],
            example_text=progress.render(kind, language, "Sample School", {f: SAMPLE[f] for f in progress.FIELDS[kind]}).text,
        )
        for kind in progress.KINDS
        for language in progress.LANGUAGES
    ]
    return TemplatesOut(
        kinds=list(progress.KINDS),  # type: ignore[arg-type]
        languages=list(progress.LANGUAGES),  # type: ignore[arg-type]
        templates=items,
        aliases={field: list(names) for field, names in reader.ALIASES.items()},
        max_rows=reader.MAX_ROWS,
        max_bytes=MAX_UPLOAD_BYTES,
    )


@router.post("/preview", response_model=PreviewOut)
async def preview(request: Request, ctx: OwnerAdmin, runtime: RuntimeDep, kind: Kind, language: Language = "en", term: TermQuery = None) -> PreviewOut:
    service = _service(runtime)
    data = await _read_file(request)
    try:
        return service.preview(ctx.principal.token, ctx.tenant.id, ctx.tenant.name, data, kind, language, term)
    except FileRefused as exc:
        raise _refusal(exc.code, exc.fields) from None


@router.post("/send", response_model=SendOut)
async def send(
    request: Request,
    ctx: OwnerStrong,
    runtime: RuntimeDep,
    kind: Kind,
    batch_id: str,
    expect_sha256: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
    expect_count: Annotated[int, Query(ge=0, le=reader.MAX_ROWS)],
    language: Language = "en",
    term: TermQuery = None,
) -> SendOut:
    service = _service(runtime)
    batch = _id(batch_id)
    data = await _read_file(request)
    try:
        return service.send(ctx.principal.token, ctx.tenant.id, ctx.tenant.name, data, kind, language, term, batch, expect_sha256, expect_count)
    except FileRefused as exc:
        raise _refusal(exc.code, exc.fields) from None
    except ApprovalMismatch as exc:
        if exc.what == "file":
            raise ApiError(409, "marks_file_changed", "This is not the file you checked. Nothing was sent. Check the file again.") from None
        raise ApiError(409, "marks_count_changed", "The number of messages changed since you checked (a guardian may have opted out). Nothing was sent. Check the file again.") from None


def encode_cursor(at: datetime) -> str:
    return base64.urlsafe_b64encode(at.isoformat().encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> datetime:
    try:
        return datetime.fromisoformat(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "invalid_cursor", "That page marker is not valid.") from None


@router.get("/batches", response_model=BatchesOut)
def batches(ctx: OwnerAdmin, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 20, cursor: str | None = None) -> BatchesOut:
    service = _service(runtime)
    page = service.batches(ctx.principal.token, ctx.tenant.id, limit, decode_cursor(cursor) if cursor else None)
    items = [BatchLineOut.model_validate(i) for i in page["items"]]
    return BatchesOut(items=items, next_cursor=encode_cursor(items[-1].started_at) if page.get("has_more") and items else None)


@router.get("/batches/{batch_id}", response_model=BatchOut)
def batch(batch_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> BatchOut:
    service = _service(runtime)
    return BatchOut.model_validate(service.batch(ctx.principal.token, ctx.tenant.id, _id(batch_id, missing=True)))
