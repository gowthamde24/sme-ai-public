"""The price-list import use cases: PREVIEW a file, then COMMIT it as a version. The API decides nothing about prices: the parser (pinned) turns the text into items or closed error codes, the catalog
says which products exist, and the database function re-validates everything it is given. A commit parses the file AGAIN (a client's preview is never trusted)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from typing import Any

from pydantic import ValidationError

from app.pricelists import csv_port
from app.pricelists.models import (
    MAX_ITEMS,
    BreakOut,
    CommitOut,
    CurrentOut,
    CurrentRow,
    CurrentVersionOut,
    IssueOut,
    PreviewItemOut,
    PreviewOut,
    VersionOut,
)
from app.pricelists.repository import PriceListRepository, Product
from app.text_rules import has_hidden_characters


def _rows_by_sku(text: str) -> dict[str, int]:
    """sku -> its DATA row number (the first row after the header is 1), counted the way the parser counts. Used only to put a row number on an issue the parser cannot see."""
    body = text[1:] if text.startswith("﻿") else text
    reader = csv.reader(io.StringIO(body, newline=""), delimiter=",", strict=True)
    try:
        header = [c.strip().lower() for c in next(reader, [])]
        if "sku" not in header:
            return {}
        at = header.index("sku")
        out: dict[str, int] = {}
        for n, cells in enumerate(reader, start=1):
            if len(cells) == len(header):
                out.setdefault(cells[at], n)
        return out
    except csv.Error:
        return {}


def _issue(row: int, column: str | None, code: str) -> IssueOut:
    return IssueOut.model_validate({"row": row, "column": column, "code": code})


def _build(
    repo: PriceListRepository, token: str, tenant: uuid.UUID, text: str, effective_from: date
) -> tuple[PreviewOut, dict[str, Product]]:
    """Parse the file and read the catalog ONCE. The preview is built from that read, and a commit uses the very same read."""
    catalog: dict[str, Product] = {}
    parsed = csv_port.parse(text)
    issues = [_issue(e["row"], e["column"], e["code"]) for e in parsed["errors"]]
    items: list[PreviewItemOut] = []
    if parsed["ok"]:
        parsed_items: list[dict[str, Any]] = parsed["items"]
        if not parsed_items:
            issues.append(_issue(0, None, "NO_ITEMS"))
        elif len(parsed_items) > MAX_ITEMS:
            issues.append(_issue(0, None, "TOO_MANY_ITEMS"))
        else:
            catalog = repo.products_by_sku(token, tenant, [i["sku"] for i in parsed_items])
            rows = _rows_by_sku(text)
            for item in parsed_items:
                product: Product | None = catalog.get(item["sku"])
                row = rows.get(item["sku"], 0)
                if product is None:
                    issues.append(_issue(row, "sku", "UNKNOWN_SKU"))
                if has_hidden_characters(item["name"], allow_newline=False):
                    issues.append(_issue(row, "name", "HIDDEN_CHARACTERS"))
                items.append(
                    PreviewItemOut(
                        sku=item["sku"],
                        name=item["name"],
                        catalog_name=product.name if product else None,
                        name_matches=product is not None and product.name == item["name"],
                        sale_unit="set"
                        if product and product.unit == "set"
                        else ("piece" if product else None),
                        unit_price_paise=item["unit_price"],
                        minimum_order_quantity=item["minimum_order_quantity"],
                        tax_bps=item["tax_bps"],
                        breaks=[
                            BreakOut(min_qty=b["min_qty"], unit_price_paise=b["unit_price"])
                            for b in item["price_breaks"]
                        ],
                    )
                )
    issues.sort(key=lambda i: (i.row, i.column or "", i.code))
    out = PreviewOut(
        ok=not issues,
        parser_version=csv_port.parser_version(),
        effective_from=effective_from,
        row_count=parsed["row_count"],
        canonical_hash=parsed["canonical_hash"] if not issues else None,
        items=items if not parsed["errors"] else [],
        issues=issues,
    )
    return out, catalog


def _analyse(
    repo: PriceListRepository, token: str, tenant: uuid.UUID, text: str, effective_from: date
) -> tuple[PreviewOut, dict[str, Product]]:
    """Parse the file and read the catalog ONCE (see `_build`). A parser result that does not fit our models (a wrong type, a missing field, a code we do not know) is the adapter's
    `PriceCsvError`: the route answers a fixed 502 and nothing is saved. The package's own error text never leaves."""
    try:
        return _build(repo, token, tenant, text, effective_from)
    except (ValidationError, KeyError, TypeError, AttributeError):
        raise csv_port.PriceCsvError from None


def preview(
    repo: PriceListRepository, token: str, tenant: uuid.UUID, text: str, effective_from: date
) -> PreviewOut:
    return _analyse(repo, token, tenant, text, effective_from)[0]


class PriceListInvalid(Exception):
    """The file has issues: nothing is written. The issues are on the exception for the route to report (row, column, closed code: never a cell)."""

    def __init__(self, issues: list[IssueOut]) -> None:
        super().__init__("price_list_invalid")
        self.issues = issues


def commit(
    repo: PriceListRepository,
    token: str,
    tenant: uuid.UUID,
    version_id: uuid.UUID,
    text: str,
    effective_from: date,
) -> CommitOut:
    checked, catalog = _analyse(repo, token, tenant, text, effective_from)
    if not checked.ok:
        raise PriceListInvalid(checked.issues)
    rows = _rows_by_sku(text)
    payload = []
    for i in checked.items:
        product = catalog.get(i.sku)
        if (
            product is None
        ):  # cannot happen with one read; if it ever does it is a refusal of the file, never a KeyError
            raise PriceListInvalid([_issue(rows.get(i.sku, 0), "sku", "UNKNOWN_SKU")])
        payload.append(
            {
                "product_id": str(product.id),
                "sale_unit": i.sale_unit,
                "unit_price_paise": i.unit_price_paise,
                "minimum_order_quantity": i.minimum_order_quantity,
                "tax_bps": i.tax_bps,
                "breaks": [
                    {"min_qty": b.min_qty, "unit_price_paise": b.unit_price_paise} for b in i.breaks
                ],
            }
        )
    done = repo.create_version(
        token,
        {
            "p_version_id": str(version_id),
            "p_tenant_id": str(tenant),
            "p_effective_from": effective_from.isoformat(),
            "p_items": payload,
        },
    )
    return CommitOut.model_validate(done)


SAMPLE_ROWS = 5


def current(repo: Any, token: str, tenant_id: uuid.UUID, today: date) -> CurrentOut:
    """What is loaded: the version in force today (the newest whose day has come) with its first rows, and the next one if a later day was loaded."""
    rows = repo.list_versions(token, tenant_id, 20)
    parsed: list[tuple[date, dict[str, Any]]] = []
    for r in rows:
        try:
            parsed.append((date.fromisoformat(str(r["effective_from"])), r))
        except (KeyError, ValueError):
            continue
    in_force = next((r for d, r in parsed if d <= today), None)
    later = [r for d, r in parsed if d > today]
    def head(r: dict[str, Any]) -> dict[str, Any]:
        return {"version_id": r["id"], "version_no": r["version_no"], "effective_from": r["effective_from"], "item_count": r["item_count"], "created_at": str(r["created_at"])}
    current_out = None
    if in_force is not None:
        sample = [{k: row[k] for k in ("sku", "name", "sale_unit", "unit_price_paise", "minimum_order_quantity", "tax_bps")} for row in repo.list_version_rows(token, tenant_id, uuid.UUID(str(in_force["id"])), SAMPLE_ROWS)]
        current_out = CurrentVersionOut(**head(in_force), sample=[CurrentRow(**x) for x in sample])
    return CurrentOut(current=current_out, upcoming=VersionOut(**head(later[-1])) if later else None)
