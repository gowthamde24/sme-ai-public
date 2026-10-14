"""The material-quote flow, step by step, with no HTTP in it: read what the caller may see, let the DATABASE build the calculator's request from its own sources, run the pinned calculator, compare with the database's
own recomputation, and let the database store the result (it refuses anything that differs). Nothing here computes a price, sends anything, or decides an approval. Every read and write carries the CALLER's token."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.errors import ApiError
from app.materials import engine_port
from app.materials.errors import MaterialDisagreementError
from app.materials.models import (
    CalcIn,
    CalcOut,
    CreditWarningOut,
    MaterialInputsOut,
    MaterialItemOut,
    MaterialItemSummaryOut,
    MaterialPhotoOut,
    MaterialQuoteDetailOut,
    MaterialQuoteOut,
    OrderCreatedOut,
    PolicyBody,
    QuotePreviewOut,
)
from app.materials.repository import MaterialsRepository
from app.today.service import format_rupees

logger = logging.getLogger("app.materials.service")
_IST_OFFSET = timedelta(hours=5, minutes=30)
SIGNED_URL_SECONDS = 600
CORE_KEYS = ("lines", "trips", "totals", "payment_terms", "valid_until")


def today_ist(now: datetime | None = None) -> date:
    return ((now or datetime.now(UTC)) + _IST_OFFSET).date()


def calculator_unavailable() -> ApiError:
    return ApiError(503, "calculator_unavailable", "The calculator is not available right now.")


def request_dict(body: CalcIn, *, today: date | None = None) -> dict[str, Any]:
    """The calculator's own request shape from the API model: dates as text, unset optional values left out (the calculator takes a key it does not need as an error)."""
    data = body.model_dump(mode="json", exclude_none=True)
    data["as_of"] = (body.as_of or today or today_ist()).isoformat()
    if body.customer.credit_limit_paise is None:
        data["customer"].pop("credit_limit_paise", None)
    if not body.laying:
        data.pop("laying", None)
    return data


def policy_dict(policy: PolicyBody) -> dict[str, Any]:
    return policy.model_dump(mode="json", exclude_none=True)


def run(request: dict[str, Any]) -> dict[str, Any]:
    """The calculator's raw answer, with every failure said once in plain words."""
    try:
        return engine_port.calculate(request)
    except engine_port.CalculatorUnavailable:
        raise calculator_unavailable() from None
    except engine_port.CalculatorInputError:
        raise ApiError(422, "validation_error", "Invalid input.") from None
    except engine_port.CalculatorInconsistent:
        logger.error("the calculator answered something the adapter does not accept")
        raise ApiError(500, "calculator_inconsistent", "The calculator gave an answer that could not be trusted. Nothing was stored.") from None


def calc_out(result: dict[str, Any]) -> CalcOut:
    return CalcOut.model_validate({"codes": [], **result})


def calculate(request: dict[str, Any]) -> CalcOut:
    return calc_out(run(request))


def database_agrees(built: dict[str, Any], result: dict[str, Any]) -> bool:
    """Does the calculator's answer have exactly the figures the database computed from the same request?"""
    core = built.get("core") or {}
    flags = ((result.get("flags") or {}).get("reasons")) or []
    return all(result.get(k) == core.get(k) for k in CORE_KEYS) and flags == (built.get("flag_list") or [])


def preview(repo: MaterialsRepository, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> QuotePreviewOut:
    built = repo.quote_build(token, tenant_id, requirement_id, picks, site_id)
    result = run(built["request"])
    return QuotePreviewOut(
        as_of=date.fromisoformat(str(built["as_of"])), valid_until=date.fromisoformat(str(built["valid_until"])), result=calc_out(result), database_agrees=database_agrees(built, result)
    )


def _engine_ok() -> bool:
    try:
        engine_port.engine()
    except engine_port.CalculatorUnavailable:
        raise calculator_unavailable() from None
    return True


def draft(repo: MaterialsRepository, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, quote_id: uuid.UUID, picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> dict[str, Any]:
    """Build, calculate, agree, store. The database stores nothing unless it computes the same quote."""
    _engine_ok()
    built = repo.quote_build(token, tenant_id, requirement_id, picks, site_id)
    request = built["request"]
    result = run(request)
    if engine_port.is_rejected(result):
        raise ApiError(422, "quote_not_computable", "A quote cannot be computed from these inputs.", extra={"reason": str((result.get("codes") or ["OTHER"])[0])})
    if not database_agrees(built, result):
        logger.error("the calculator and the database disagree on a material quote")
        raise MaterialDisagreementError
    return repo.quote_draft(
        token,
        {
            "p_quote_id": str(quote_id),
            "p_tenant_id": str(tenant_id),
            "p_requirement_id": str(requirement_id),
            "p_picks": picks,
            "p_site_id": str(site_id) if site_id else None,
            "p_engine_version": engine_port.engine_version(),
            "p_request_text": engine_port.canonical_json(request),
            "p_result_text": engine_port.canonical_json(result),
        },
    )


def recompute_hash(stored: dict[str, Any]) -> str:
    """The approver's recomputation: the hash the calculator reports when it runs the STORED request again (and the stored figures must be the ones it computes)."""
    _engine_ok()
    request = json.loads(str(stored["request_text"]))
    result = run(request)
    if engine_port.is_rejected(result):
        raise ApiError(409, "quote_mismatch", "This quote does not match the calculator's own recomputation. Nothing was changed: make a new draft.")
    saved = json.loads(str(stored["result_text"]))
    if any(result.get(k) != saved.get(k) for k in CORE_KEYS):
        raise ApiError(409, "quote_mismatch", "This quote does not match the calculator's own recomputation. Nothing was changed: make a new draft.")
    return str(result["canonical_hash"])


def quote_out(row: dict[str, Any]) -> MaterialQuoteOut:
    return MaterialQuoteOut.model_validate({k: v for k, v in row.items() if k not in ("request_text", "result_text")})


def quote_detail(row: dict[str, Any]) -> MaterialQuoteDetailOut:
    saved = json.loads(str(row["result_text"])) if row.get("result_text") else {}
    return MaterialQuoteDetailOut.model_validate({**{k: v for k, v in row.items() if k not in ("request_text", "result_text")}, "trace": saved.get("trace") or []})


def credit_out(raw: Any) -> CreditWarningOut | None:
    if not isinstance(raw, dict):
        return None
    return CreditWarningOut.model_validate(raw)


def order_out(row: dict[str, Any]) -> OrderCreatedOut:
    return OrderCreatedOut(
        order_id=row["order_id"], order_no=row["order_no"], state=row["state"], replayed=row.get("replayed") is True, credit=credit_out(row.get("credit"))
    )


# ---------------------------------------------------------------------------------------------- items
def photo_out(p: dict[str, Any], urls: dict[str, str]) -> MaterialPhotoOut:
    return MaterialPhotoOut(
        id=p["id"],
        position=p["position"],
        url=urls.get(str(p["path"])),
        thumb_url=urls.get(str(p["thumb_path"])),
        width=p["width"],
        height=p["height"],
        bytes=p["bytes"],
        expires_in_seconds=SIGNED_URL_SECONDS,
    )


def price_text(paise: Any) -> str | None:
    return format_rupees(int(paise)) if isinstance(paise, int) and not isinstance(paise, bool) else None


def item_out(row: dict[str, Any], inputs: dict[str, Any], urls: dict[str, str]) -> MaterialItemOut:
    photos = row.get("photos") or []
    return MaterialItemOut(
        id=row["id"],
        name=row["name"],
        sell_unit=row["sell_unit"],
        area_unit=row.get("area_unit"),
        stock_status=row["stock_status"],
        active=row["active"],
        price_paise=row.get("price_paise"),
        price_text=price_text(row.get("price_paise")),
        photo_count=len(photos),
        photos=[photo_out(p, urls) for p in photos],
        inputs=MaterialInputsOut.model_validate(inputs),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def item_summary(row: dict[str, Any], urls: dict[str, str]) -> MaterialItemSummaryOut:
    photos = row.get("photos") or []
    return MaterialItemSummaryOut(
        id=row["id"],
        name=row["name"],
        sell_unit=row["sell_unit"],
        area_unit=row.get("area_unit"),
        stock_status=row["stock_status"],
        active=row["active"],
        price_paise=row.get("price_paise"),
        price_text=price_text(row.get("price_paise")),
        photo_count=len(photos),
        cover=photo_out(photos[0], urls) if photos else None,
    )
