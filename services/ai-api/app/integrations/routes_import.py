"""Spreadsheet import (job BI, ADR 0073): customers/leads and catalogue stock from a CSV or XLSX file (Google Sheets > File > Download works). Owner or Admin.

  POST /v1/tenants/{t}/imports/spreadsheet/inspect?kind=customers|stock            body: the file (raw bytes)
        -> the columns with a suggested meaning (English, Telugu, Hindi, Kannada and Tamil headers), the fields to fill, three sample rows. Changes nothing, stores nothing.
  POST /v1/tenants/{t}/imports/spreadsheet/preview?kind=&job_id=&mapping={"field": column index}   body: the file
        -> a dry run: one verdict per row (will create / duplicate / needs review / rejected, or the problem with the row), the counts, and a JOB (job_id, a uuid the client makes) that remembers the
           file's hash and the mapping. Changes no customer or item. May be repeated (another mapping) until the job is run.
  POST /v1/tenants/{t}/imports/spreadsheet/{job_id}/confirm                         body: THE SAME FILE. Second factor required.
        -> runs it (customers: the lead import with batch id = job id; stock: the status changes), closes the job with its counts. A different file than the preview is refused (409
           import_file_changed). Running a finished job again returns its stored result (replay: true); nothing is imported twice. A failed job may be run again.
  GET  /v1/tenants/{t}/imports/spreadsheet/jobs, .../jobs/{job_id}                  the jobs and their results.

NEVER OVERWRITES: an existing customer (same match keys as the lead import) is reported as a duplicate and left alone; stock changes only set the status of items you named, and the preview shows old
and new. The file is held in memory for the request and never stored; the job keeps hashes, column numbers, counts and line numbers, and no cell value. Cells that look like formulas, hidden characters,
oversized files and over-long cells are refused with closed codes."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.crm.repository import InvalidReferenceError
from app.customfields import importing as custom_import
from app.errors import ApiError, not_found
from app.integrations import importer
from app.integrations import mapping as mapping_mod
from app.integrations.repository import IntegrationsRepository
from app.integrations.sheet import MAX_UPLOAD_BYTES, PART_ROWS, Grid, SheetRefused, load_grid
from app.leads.routes import commit_import_batch
from app.tenancy.models import Role

logger = logging.getLogger("app.integrations.import")

router = APIRouter(prefix="/v1/tenants/{tenant_id}/imports/spreadsheet", tags=["imports"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
AdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
Kind = Literal["customers", "stock"]

FILE_REFUSALS: dict[str, tuple[int, str]] = {
    "empty": (422, "That file is empty."),
    "too_large": (413, "That file is too big. Keep it under 3 MB (a CSV under 2 MB)."),
    "not_utf8": (422, "That file is not UTF-8 text. In Excel use Save As > CSV UTF-8, or upload the .xlsx."),
    "malformed_csv": (422, "That CSV could not be read. Check for a stray quotation mark."),
    "too_many_rows": (422, "That file has more than 5,000 rows. Split it and import in parts."),
    "too_many_columns": (422, "That file has too many columns."),
    "no_header": (422, "The first row must be the column names."),
    "not_xlsx": (415, "That is not a CSV or an Excel (.xlsx) file."),
    "too_many_parts": (422, "That Excel file could not be read safely."),
    "encrypted": (422, "That Excel file is password protected. Remove the password and try again."),
    "unsafe_xml": (422, "That Excel file could not be read safely."),
    "unreadable": (422, "That file could not be read."),
    "no_sheet": (422, "That Excel file has no sheet to read."),
}


def _repo(runtime: Runtime) -> IntegrationsRepository:
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "Imports are not available on this system.")
    return runtime.integrations


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise ApiError(*_refusal("too_large"))
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise ApiError(*_refusal("too_large"))
        chunks.append(chunk)
    return b"".join(chunks)


def _refusal(code: str) -> tuple[int, str, str]:
    status, message = FILE_REFUSALS.get(code, (422, "That file could not be read."))
    return status, f"file_{code}", message


def _grid(data: bytes) -> Grid:
    try:
        return load_grid(data)
    except SheetRefused as exc:
        raise ApiError(*_refusal(exc.code)) from None


def _custom_defs(runtime: Runtime, ctx: TenantContext, kind: str) -> dict[str, dict[str, Any]]:
    """The business's ACTIVE contact custom fields (job CK): the extra targets a customers file may map. None for a stock file or when custom fields are not wired."""
    if kind != "customers" or runtime.custom_fields is None:
        return {}
    return custom_import.active_contact_defs(runtime.custom_fields.defs_list(ctx.principal.token, ctx.tenant.id, "contact"))


def _suggestions(grid: Grid, kind: str, defs: dict[str, dict[str, Any]]) -> list[mapping_mod.Suggestion]:
    if not defs:
        return mapping_mod.suggest(grid.header, kind)
    # a header that IS a custom field's label (or code) belongs to that field: it wins over a partial match with a built-in field ("Customer type" is not the line of business)
    by_column = {ci: f for f, ci in custom_import.suggest(grid.header, defs, set()).items()}
    masked = ["" if i in by_column else h for i, h in enumerate(grid.header)]
    found = mapping_mod.suggest(masked, kind)
    return [mapping_mod.Suggestion(s.index, grid.header[s.index][:60], by_column[s.index], "exact") if s.index in by_column else s for s in found]


def _mapping(raw: str | None, kind: str, grid: Grid, defs: dict[str, dict[str, Any]] | None = None) -> dict[str, int]:
    codes = frozenset(defs or {})
    if raw is None:
        found = mapping_mod.mapping_from(_suggestions(grid, kind, defs or {}))
        try:
            return mapping_mod.validate_mapping(found, kind, len(grid.header), codes)
        except ValueError:
            raise ApiError(422, "mapping_required_missing", "Say which column holds the customer name." if kind == "customers" else "Say which column holds the saree name.") from None
    try:
        return mapping_mod.validate_mapping(json.loads(raw), kind, len(grid.header), codes)
    except (ValueError, TypeError) as exc:
        code = "mapping_required_missing" if str(exc) == "mapping_required_missing" else "mapping_invalid"
        raise ApiError(422, code, "The column choices are not valid.") from None


def mapping_sha(mapping: dict[str, int]) -> str:
    return hashlib.sha256(json.dumps(mapping, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _job_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise ApiError(422, "validation_error", "Invalid input.")
    return parsed


def _issues(items: list[importer.Issue]) -> list[dict[str, Any]]:
    return [{"line": i.line, "code": i.code, "field": i.field} for i in items[:200]]


def _fields(kind: str, defs: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    built_in = [{"field": f, "label": label, "required": req} for f, (label, req, _s) in mapping_mod.FIELDS[kind].items()]
    return built_in + custom_import.import_fields(defs or {})  # a custom target also says its `kind`


def _part_id(job_id: uuid.UUID, index: int) -> uuid.UUID:
    """The batch id of part `index` of a job: part 0 IS the job id (a file of 500 rows or fewer behaves exactly as before), the others are derived, so a retry repeats no part."""
    return job_id if index == 0 else uuid.uuid5(job_id, f"part-{index}")


def _parts(rows: list[dict[str, Any]]) -> list[tuple[int, int, list[dict[str, Any]]]]:
    return [(i, start, rows[start : start + PART_ROWS]) for i, start in enumerate(range(0, len(rows), PART_ROWS))]


# ----------------------------------------------------------------------------------------------------------------------------- inspect
@router.post("/inspect")
async def inspect(request: Request, ctx: AdminPlus, runtime: RuntimeDep, kind: Kind) -> dict[str, Any]:
    data = await _read_body(request)
    grid = _grid(data)
    defs = _custom_defs(runtime, ctx, kind)
    suggestions = _suggestions(grid, kind, defs)
    return {
        "kind": kind,
        "file_sha256": hashlib.sha256(data).hexdigest(),
        "file_kind": grid.kind,
        "rows": len(grid.rows),
        "columns": [{"index": s.index, "header": s.header, "suggested_field": s.field, "confidence": s.confidence} for s in suggestions],
        "suggested_mapping": mapping_mod.mapping_from(suggestions),
        "fields": _fields(kind, defs),
        "sample": [r[:20] for r in grid.rows[:3]],
        "cut_cells": grid.cut_cells,
    }


# ----------------------------------------------------------------------------------------------------------------------------- preview
def _customer_preview(runtime: Runtime, ctx: TenantContext, job_id: uuid.UUID, prepared: importer.Prepared) -> tuple[dict[str, int], list[dict[str, Any]]]:
    counts = {"will_create": 0, "duplicate": 0, "needs_review": 0, "rejected": 0}
    rows: list[dict[str, Any]] = []
    by_row: dict[int, Any] = {}
    # parts of 500 (job CK): the database takes at most 500 rows per call. A row that repeats a row of an EARLIER part is only found when the parts run for real (it then shows as a duplicate)
    for index, start, part in _parts(prepared.rows):
        report = runtime.leads.import_leads(ctx.principal.token, ctx.tenant.id, _part_id(job_id, index), part, dry_run=True, label=None)
        by_row.update({start + o.row: o for o in report.rows})
    for n, (row, line, note) in enumerate(zip(prepared.rows, prepared.lines, prepared.notes, strict=True), start=1):
        out = by_row.get(n)
        verdict = "rejected"
        reason: str | None = "no_verdict"
        if out is not None:
            verdict = {"created": "will_create", "skipped_duplicate": "duplicate", "ambiguous": "needs_review", "rejected": "rejected"}[out.outcome.value]
            reason = out.reason
        counts[verdict] += 1
        rows.append({"line": line, "status": verdict, "reason": reason if verdict in ("needs_review", "rejected") else None, "label": row["company_name"], "city": row.get("city"), "note": note})
    return counts, rows


def _stock_preview(runtime: Runtime, ctx: TenantContext, prepared: importer.Prepared) -> tuple[dict[str, int], list[dict[str, Any]], list[dict[str, Any]]]:
    matched = importer.match_catalogue(prepared, _repo(runtime).stock_list(ctx.principal.token, ctx.tenant.id))
    counts = {"will_change": 0, "unchanged": 0, "not_found": 0, "ambiguous": 0}
    for m in matched:
        counts[m["action"]] += 1
    rows = [{"line": m["line"], "status": m["action"], "label": m["name"], "old_status": m["old_status"], "new_status": m["new_status"], "note": m["note"]} for m in matched]
    return counts, rows, matched


@router.post("/preview")
async def preview(request: Request, ctx: AdminPlus, runtime: RuntimeDep, kind: Kind, job_id: str, mapping: str | None = Query(default=None, max_length=1000)) -> dict[str, Any]:
    data = await _read_body(request)
    jid = _job_id(job_id)
    grid = _grid(data)
    defs = _custom_defs(runtime, ctx, kind)
    cols = _mapping(mapping, kind, grid, defs)
    if kind == "customers":
        prepared = importer.prepare_customers(grid, cols, defs)
        counts, rows = _customer_preview(runtime, ctx, jid, prepared)
    else:
        prepared = importer.prepare_stock(grid, cols)
        counts, rows, _ = _stock_preview(runtime, ctx, prepared)
    counts = {"rows": len(grid.rows) - prepared.blank, "usable": len(prepared.rows), "file_problems": len(prepared.issues), **counts}
    job = _repo(runtime).job_preview_save(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id), "p_job_id": str(jid), "p_kind": kind, "p_file_sha256": hashlib.sha256(data).hexdigest(), "p_mapping": cols,
            "p_mapping_sha256": mapping_sha(cols), "p_rows": len(grid.rows), "p_counts": counts, "p_issues": _issues(prepared.issues),
        },
    )  # fmt: skip
    out: dict[str, Any] = {"job": job, "counts": counts, "rows": rows, "issues": _issues(prepared.issues), "mapping": cols}
    if len(prepared.rows) > PART_ROWS:
        out["parts"] = len(_parts(prepared.rows))  # the file runs in parts of 500 rows, one after the other
    return out


# ----------------------------------------------------------------------------------------------------------------------------- confirm
@router.post("/{job_id}/confirm")
async def confirm(job_id: str, request: Request, ctx: AdminStrong, runtime: RuntimeDep) -> dict[str, Any]:
    data = await _read_body(request)
    jid = _job_id(job_id)
    repo = _repo(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    try:
        job = repo.job_get(token, tenant, jid)
    except InvalidReferenceError:
        raise not_found() from None
    began = repo.job_begin(token, tenant, jid, hashlib.sha256(data).hexdigest(), job["mapping_sha256"])
    if began.get("replay"):
        return {"job": job, "replay": True, "result": None}
    grid = _grid(data)
    cols = {str(k): int(v) for k, v in job["mapping"].items()}
    kind = job["kind"]
    try:
        defs = _custom_defs(runtime, ctx, kind)
        cols = mapping_mod.validate_mapping(cols, kind, len(grid.header), frozenset(defs))
        if mapping_sha(cols) != job["mapping_sha256"]:
            raise ApiError(409, "import_file_changed", "This is not the file that was checked. Check it again.")
        if kind == "customers":
            prepared = importer.prepare_customers(grid, cols, defs)
            counts, result_rows = _run_customers(runtime, ctx, jid, prepared)
        else:
            prepared = importer.prepare_stock(grid, cols)
            counts, result_rows = _run_stock(runtime, ctx, jid, prepared)
    except Exception:
        # a failed run is recorded (best effort) and may be run again with the same file; the cause is not echoed
        try:
            repo.job_finish(token, tenant, jid, "failed", {"error": True}, [])
        except Exception:  # noqa: BLE001, S110 - recording the failure must never hide the failure
            logger.warning("could not record a failed import job")
        raise
    counts = {"rows": len(grid.rows) - prepared.blank, "usable": len(prepared.rows), "file_problems": len(prepared.issues), **counts}
    closed = repo.job_finish(token, tenant, jid, "completed", counts, _issues(prepared.issues))
    logger.info("import tenant=%s user=%s job=%s kind=%s counts=%s", tenant, ctx.principal.user_id, jid, kind, json.dumps(counts, sort_keys=True))
    return {"job": closed, "replay": False, "result": {"counts": counts, "rows": result_rows, "issues": _issues(prepared.issues)}}


def _run_customers(runtime: Runtime, ctx: TenantContext, jid: uuid.UUID, prepared: importer.Prepared) -> tuple[dict[str, int], list[dict[str, Any]]]:
    totals = {"created": 0, "skipped_duplicate": 0, "ambiguous": 0, "rejected": 0, "companies_created": 0, "contacts_created": 0}
    result_rows: list[dict[str, Any]] = []
    custom_set = custom_failed = 0
    with_custom = any(prepared.customs)
    for index, start, part in _parts(prepared.rows):
        # each part is its own transaction with its own batch id: a retry of the job replays the parts that ran and runs the rest
        report = commit_import_batch(runtime, ctx.principal.token, ctx.tenant.id, _part_id(jid, index), part, None)
        c = report.counts
        for key, n in (("created", c.created), ("skipped_duplicate", c.skipped_duplicate), ("ambiguous", c.ambiguous), ("rejected", c.rejected), ("companies_created", c.companies_created), ("contacts_created", c.contacts_created)):
            totals[key] += n
        items: list[dict[str, Any]] = []
        for o in report.rows:
            if not 1 <= o.row <= len(part):
                continue
            n = start + o.row - 1
            result_rows.append({"line": prepared.lines[n], "status": o.outcome.value, "reason": o.reason, "label": prepared.rows[n]["company_name"], "lead_id": str(o.lead_id) if o.lead_id else None})
            # custom values go only to a contact this import CREATED: an existing customer is never changed by an import
            if o.contact_created and o.contact_id is not None and prepared.customs[n]:
                items.append({"id": str(o.contact_id), "values": prepared.customs[n]})
        if items and runtime.custom_fields is not None:
            done = runtime.custom_fields.values_set_many(ctx.principal.token, ctx.tenant.id, items)
            custom_set += int(done.get("set", 0))
            custom_failed += len(done.get("failed") or [])
    if with_custom:
        totals["custom_values_set"] = custom_set  # the number of contacts that got values
        totals["custom_values_failed"] = custom_failed
    return totals, result_rows


def _run_stock(runtime: Runtime, ctx: TenantContext, jid: uuid.UUID, prepared: importer.Prepared) -> tuple[dict[str, int], list[dict[str, Any]]]:
    repo = _repo(runtime)
    matched = importer.match_catalogue(prepared, repo.stock_list(ctx.principal.token, ctx.tenant.id))
    changes = [{"id": str(m["item_id"]), "stock_status": m["new_status"]} for m in matched if m["action"] == "will_change"]
    done = repo.stock_apply(ctx.principal.token, ctx.tenant.id, jid, changes) if changes else {"updated": 0, "unchanged": 0, "missing": 0}
    counts = {"updated": int(done["updated"]), "unchanged": int(done["unchanged"]) + sum(1 for m in matched if m["action"] == "unchanged"), "missing": int(done["missing"]),
              "not_found": sum(1 for m in matched if m["action"] == "not_found"), "ambiguous": sum(1 for m in matched if m["action"] == "ambiguous")}  # fmt: skip
    rows = [{"line": m["line"], "status": m["action"], "label": m["name"], "old_status": m["old_status"], "new_status": m["new_status"]} for m in matched]
    return counts, rows


# ----------------------------------------------------------------------------------------------------------------------------- jobs
@router.get("/jobs")
def jobs(ctx: AdminPlus, runtime: RuntimeDep, limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    return {"jobs": _repo(runtime).job_list(ctx.principal.token, ctx.tenant.id, limit)}


@router.get("/jobs/{job_id}")
def job(job_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> dict[str, Any]:
    try:
        return _repo(runtime).job_get(ctx.principal.token, ctx.tenant.id, _job_id(job_id))
    except InvalidReferenceError:
        raise not_found() from None
