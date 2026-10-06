"""Price-list import endpoints under /v1/tenants/{tenant_id}/... (rehearsal step 5).

Authorization, in order, for both endpoints (as for the quote and order routes): a valid JWT (401); membership of the tenant in the PATH (404); a role that may publish a price list
(Owner or Admin, 403); a second factor (403 mfa_required); then the database decides again (the definer function re-checks the role and the second factor and re-validates every field).
A PREVIEW writes nothing and may be repeated; a COMMIT parses the file again and creates one VERSION, or refuses with the file's issues (row, column, closed code: never a cell).

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.pricelists import csv_port, service
from app.pricelists.models import CommitIn, CommitOut, PreviewIn, PreviewOut
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]


def _repo(runtime: Runtime) -> Any:
    if runtime.pricelists is None:
        raise ApiError(503, "price_lists_unavailable", "Price lists are not available right now.")
    return runtime.pricelists


def _unavailable(exc: Exception) -> ApiError:
    if isinstance(exc, csv_port.PriceCsvUnavailable):
        return ApiError(503, "price_csv_unavailable", "Price list files cannot be read right now.")
    return ApiError(502, "price_csv_failed", "The file could not be checked. Nothing was saved.")


@router.post("/price-lists/import/preview", response_model=PreviewOut)
def preview_price_list(body: PreviewIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> PreviewOut:
    """Check a price-list file and show what it would become. Nothing is written."""
    try:
        return service.preview(
            _repo(runtime), ctx.principal.token, ctx.tenant.id, body.csv, body.effective_from
        )
    except (csv_port.PriceCsvUnavailable, csv_port.PriceCsvError) as exc:
        raise _unavailable(exc) from None


@router.post("/price-lists/import", response_model=CommitOut, status_code=201)
def commit_price_list(
    body: CommitIn, ctx: OwnerAdminStrong, runtime: RuntimeDep, response: Response
) -> CommitOut | JSONResponse:
    """Make a price-list VERSION from a file (Owner or Admin, second factor). An exact retry replays (200); a file with issues is refused with them (422) and nothing is saved."""
    try:
        done = service.commit(
            _repo(runtime),
            ctx.principal.token,
            ctx.tenant.id,
            body.id,
            body.csv,
            body.effective_from,
        )
    except service.PriceListInvalid as exc:
        return JSONResponse(
            {
                "error": {
                    "code": "price_list_invalid",
                    "message": "The file has problems. Nothing was saved.",
                },
                "issues": [i.model_dump(mode="json") for i in exc.issues],
            },
            status_code=422,
        )
    except (csv_port.PriceCsvUnavailable, csv_port.PriceCsvError) as exc:
        raise _unavailable(exc) from None
    response.status_code = 200 if done.replayed else 201
    return done
