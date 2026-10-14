"""Deliveries under /v1/tenants/{tenant_id} (job CN, ADR 0085; module `deliveries`).

  POST   /orders/{order_id}/trips          Owner, Admin, Sales: plan a trip (the id is the caller's); the quantities never exceed what the order line holds (409 `quantity_exceeds_order`).
  GET    /orders/{order_id}/trips          the trips of an order.
  GET    /trips?date=&status=&limit        the day board: trips on a date, or in a status.
  GET    /trips/{id}                       a trip with its history and its proof.
  PATCH  /trips/{id}                       change a trip that is planned or in problem.
  POST   /trips/{id}/status                planned -> loaded -> on_the_way; problem (with a reason); cancelled. A truck does not leave before the order is dispatched (409 `order_not_dispatched`).
  POST   /trips/{id}/delivered             delivered: the BODY is the proof photo (jpeg, png or webp, at most 5 MB: resized and stripped of location data), `received_by` names who received the goods.
  GET    /trips/{id}/challan               the delivery note: no amounts, no GST.
  POST   /trips/{id}/notify                tell the site contact how the trip is going (fixed words, no amounts) through the outbox: its own consent, suppression and quiet-hours rules apply.

A Viewer reads no trip (a trip names a person and a place). The module check is in the database (SM701 -> 403 `module_off`).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import date
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import images
from app.catalogue.errors import PhotoRejectedError
from app.catalogue.images import MAX_UPLOAD_BYTES
from app.catalogue.service import REJECTIONS
from app.catalogue.storage import SIGNED_URL_SECONDS
from app.crm.models import parse_uuid
from app.deliveries import messages
from app.deliveries.models import (
    ChallanOut,
    NotifyOut,
    ProofOut,
    TripDetailOut,
    TripListOut,
    TripNotifyIn,
    TripOut,
    TripPlanIn,
    TripStatus,
    TripStatusIn,
    TripUpdateIn,
)
from app.deliveries.repository import DeliveriesRepository
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.tenancy.repository import UpstreamError

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["deliveries"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Dispatcher = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Limit = Annotated[int, Query(ge=1, le=200)]


def _repo(runtime: Runtime) -> DeliveriesRepository:
    if runtime.deliveries is None:
        raise ApiError(503, "deliveries_unavailable", "Deliveries are not available right now.")
    return runtime.deliveries


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _trip(runtime: Runtime, ctx: TenantContext, row: dict[str, Any], *, detail: bool = False) -> TripOut | TripDetailOut:
    proof = row.get("proof")
    shaped = {k: v for k, v in row.items() if k not in ("replayed", "events")}
    shaped["proof"] = None
    if isinstance(proof, dict):
        urls: dict[str, str] = {}
        if runtime.catalogue_storage is not None:
            try:
                urls = runtime.catalogue_storage.sign(ctx.principal.token, str(proof["bucket"]), [str(proof["path"])])
            except UpstreamError:
                urls = {}
        shaped["proof"] = ProofOut(
            received_by=proof["received_by"],
            recorded_at=proof["recorded_at"],
            width=proof["width"],
            height=proof["height"],
            bytes=proof["bytes"],
            photo_url=urls.get(str(proof["path"])),
            expires_in_seconds=SIGNED_URL_SECONDS,
        )
    if detail:
        events = [{"seq": ev["seq"], "from_status": ev.get("from"), "to_status": ev["to"], "problem_code": ev.get("problem_code"), "recorded_at": ev["recorded_at"]} for ev in row.get("events") or []]
        return TripDetailOut.model_validate({**shaped, "events": events})
    return TripOut.model_validate(shaped)


def _lines(lines: list[Any]) -> list[dict[str, Any]]:
    return [{"line_no": ln.line_no, "quantity": ln.quantity} for ln in lines]


@router.post("/orders/{order_id}/trips", response_model=TripOut, status_code=201)
def plan_trip(order_id: str, body: TripPlanIn, ctx: Dispatcher, runtime: RuntimeDep) -> TripOut:
    row = _repo(runtime).plan(
        ctx.principal.token,
        {
            "p_trip_id": str(body.trip_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_order_id": str(_row_id(order_id)),
            "p_planned_date": body.planned_date.isoformat(),
            "p_vehicle_no": body.vehicle_no,
            "p_driver_name": body.driver_name,
            "p_driver_phone": body.driver_phone,
            "p_site_id": str(body.site_id) if body.site_id else None,
            "p_site_contact_id": str(body.site_contact_id) if body.site_contact_id else None,
            "p_lines": _lines(body.lines),
        },
    )
    return _trip(runtime, ctx, row)


@router.get("/orders/{order_id}/trips", response_model=TripListOut)
def order_trips(order_id: str, ctx: Dispatcher, runtime: RuntimeDep, limit: Limit = 50) -> TripListOut:
    rows = _repo(runtime).list(ctx.principal.token, ctx.tenant.id, _row_id(order_id), None, None, limit)
    return TripListOut(items=[_trip(runtime, ctx, r) for r in rows])


@router.get("/trips", response_model=TripListOut)
def trips(ctx: Dispatcher, runtime: RuntimeDep, on: Annotated[date | None, Query(alias="date")] = None, status: TripStatus | None = None, limit: Limit = 50) -> TripListOut:
    rows = _repo(runtime).list(ctx.principal.token, ctx.tenant.id, None, on, status, limit)
    return TripListOut(items=[_trip(runtime, ctx, r) for r in rows])


@router.get("/trips/{trip_id}", response_model=TripDetailOut)
def get_trip(trip_id: str, ctx: Dispatcher, runtime: RuntimeDep) -> TripDetailOut:
    return cast("TripDetailOut", _trip(runtime, ctx, _repo(runtime).get(ctx.principal.token, ctx.tenant.id, _row_id(trip_id)), detail=True))


@router.patch("/trips/{trip_id}", response_model=TripOut)
def update_trip(trip_id: str, body: TripUpdateIn, ctx: Dispatcher, runtime: RuntimeDep) -> TripOut:
    row = _repo(runtime).update(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_trip_id": str(_row_id(trip_id)),
            "p_planned_date": body.planned_date.isoformat(),
            "p_vehicle_no": body.vehicle_no,
            "p_driver_name": body.driver_name,
            "p_driver_phone": body.driver_phone,
            "p_site_id": str(body.site_id) if body.site_id else None,
            "p_site_contact_id": str(body.site_contact_id) if body.site_contact_id else None,
            "p_lines": _lines(body.lines) if body.lines is not None else None,
        },
    )
    return _trip(runtime, ctx, row)


@router.post("/trips/{trip_id}/status", response_model=TripOut)
def set_status(trip_id: str, body: TripStatusIn, ctx: Dispatcher, runtime: RuntimeDep) -> TripOut:
    row = _repo(runtime).set_status(ctx.principal.token, ctx.tenant.id, _row_id(trip_id), body.status, body.problem_code)
    return _trip(runtime, ctx, row)


@router.post("/trips/{trip_id}/delivered", response_model=TripOut)
async def deliver(
    trip_id: str,
    request: Request,
    ctx: Dispatcher,
    runtime: RuntimeDep,
    received_by: Annotated[str, Query(min_length=1, max_length=80)],
    photo_id: str | None = None,
) -> TripOut:
    """The proof: the BODY is the photo (with its own Content-Type), `received_by` is the name of the person who received the goods. `photo_id` (a UUID of the caller's) makes a retry safe."""
    tid = _row_id(trip_id)
    pid = _row_id(photo_id) if photo_id is not None else uuid.uuid4()
    repo = _repo(runtime)
    storage = runtime.catalogue_storage
    if storage is None:
        raise ApiError(503, "deliveries_unavailable", "Deliveries are not available right now.")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + 65536:
        raise ApiError(413, "photo_too_large", "That photo is bigger than 5 MB.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES + 65536:
            raise ApiError(413, "photo_too_large", "That photo is bigger than 5 MB.")
        chunks.append(chunk)

    def work() -> dict[str, Any]:
        try:
            processed = images.process(b"".join(chunks), request.headers.get("content-type") or "")
        except PhotoRejectedError as exc:
            status, code, message = REJECTIONS[exc.code]
            raise ApiError(status, code, message) from None
        bucket = repo.ensure_bucket(ctx.principal.token, ctx.tenant.id)
        path = f"{tid}/{pid}.jpg"
        storage.upload(ctx.principal.token, bucket, path, processed.photo, "image/jpeg")
        try:
            return repo.deliver(
                ctx.principal.token,
                {
                    "p_tenant_id": str(ctx.tenant.id),
                    "p_trip_id": str(tid),
                    "p_received_by": received_by,
                    "p_photo_id": str(pid),
                    "p_width": processed.width,
                    "p_height": processed.height,
                    "p_bytes": len(processed.photo),
                },
            )
        except Exception:
            storage.remove(ctx.principal.token, bucket, [path])  # the proof was not recorded: the file is not kept
            raise

    row = await run_in_threadpool(work)
    return _trip(runtime, ctx, row)


@router.get("/trips/{trip_id}/challan", response_model=ChallanOut)
def challan(trip_id: str, ctx: Dispatcher, runtime: RuntimeDep) -> ChallanOut:
    return ChallanOut.model_validate(_repo(runtime).challan(ctx.principal.token, ctx.tenant.id, _row_id(trip_id)))


@router.post("/trips/{trip_id}/notify", response_model=NotifyOut)
def notify(trip_id: str, body: TripNotifyIn, ctx: Dispatcher, runtime: RuntimeDep) -> NotifyOut:
    repo = _repo(runtime)
    tid = _row_id(trip_id)
    trip = repo.get(ctx.principal.token, ctx.tenant.id, tid)
    words = messages.compose(body.kind, body.language, trip.get("vehicle_no"), body.eta)
    row = repo.notify(
        ctx.principal.token,
        {"p_message_id": str(body.message_id), "p_tenant_id": str(ctx.tenant.id), "p_trip_id": str(tid), "p_body": words, "p_language": body.language},
    )
    return NotifyOut(message_id=body.message_id, status=row["status"], reason=row["reason"], text=words, replayed=row.get("replayed") is True)
