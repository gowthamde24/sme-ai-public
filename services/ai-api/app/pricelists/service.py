"""The price-list import use cases: PREVIEW a file, then COMMIT it as a version. The API decides nothing about prices: the parser (pinned) turns the text into items or closed error codes, the catalog
says which products exist, and the database function re-validates everything it is given. A commit parses the file AGAIN (a client's preview is never trusted)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from typing import Any

from app.pricelists import csv_port
from app.pricelists.models import (
    MAX_ITEMS,
    BreakOut,
    CommitOut,
    IssueOut,
    PreviewItemOut,
    PreviewOut,
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


def preview(
    repo: PriceListRepository, token: str, tenant: uuid.UUID, text: str, effective_from: date
) -> PreviewOut:
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
    return PreviewOut(
        ok=not issues,
        parser_version=csv_port.parser_version(),
        effective_from=effective_from,
        row_count=parsed["row_count"],
        canonical_hash=parsed["canonical_hash"] if not issues else None,
        items=items if not parsed["errors"] else [],
        issues=issues,
    )


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
    checked = preview(repo, token, tenant, text, effective_from)
    if not checked.ok:
        raise PriceListInvalid(checked.issues)
    catalog = repo.products_by_sku(token, tenant, [i.sku for i in checked.items])
    payload = [
        {
            "product_id": str(catalog[i.sku].id),
            "sale_unit": i.sale_unit,
            "unit_price_paise": i.unit_price_paise,
            "minimum_order_quantity": i.minimum_order_quantity,
            "tax_bps": i.tax_bps,
            "breaks": [
                {"min_qty": b.min_qty, "unit_price_paise": b.unit_price_paise} for b in i.breaks
            ],
        }
        for i in checked.items
    ]
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
