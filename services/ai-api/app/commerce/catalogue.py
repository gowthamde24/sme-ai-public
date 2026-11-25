"""A store's products as rows for a "What you sell" list (kind Products): price columns in whole paise, an availability word from the list's own choices, a short description. PREVIEW first (nothing is saved),
then the owner saves the rows she kept through the lists' own import (so every rule of the lists applies: only the Owner sets a price, 1,000 rows at most, all or nothing).
  Shopify: one row per variant that has its own price or name ("Kurta, Large"); a product with the single "Default Title" variant is one row.
  WooCommerce: a simple product is one row; a variable product is one row at its current `price` (the variations are not read: said in a note).
An amount is read only from a store whose currency is rupees; the shop's currency is not part of a product, so the preview note `check_currency` always says the amounts are taken as rupees."""

# ruff: noqa: E501

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

MAX_ROWS = 1000
_IN, _FEW, _OUT = "in stock", "few left", "out of stock"


def _paise(raw: Any) -> int | None:
    try:
        value = Decimal(str(raw).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None
    if value < 1 or value > Decimal("100000000"):
        return None
    return int((value * 100).quantize(Decimal(1)))


def _columns(list_json: dict[str, Any]) -> dict[str, str | None]:
    cols = [c for c in list_json.get("columns", []) if isinstance(c, dict)]
    prices = [c for c in cols if c.get("role") == "price" and c.get("type") == "rupees"]
    price = next((c for c in prices if c.get("quote_default")), prices[0] if prices else None)
    avail = next((c for c in cols if c.get("role") == "availability" and c.get("type") == "choice"), None)
    desc = next((c for c in cols if c.get("role") == "description" and c.get("type") == "text"), None)
    qty = next((c for c in cols if c.get("role") == "quantity" and c.get("type") == "number"), None)
    return {"price": price["key"] if price else None, "availability": avail["key"] if avail else None, "description": desc["key"] if desc else None, "quantity": qty["key"] if qty else None}


def _choice(list_json: dict[str, Any], key: str | None, want: str) -> str | None:
    if key is None:
        return None
    col = next((c for c in list_json.get("columns", []) if isinstance(c, dict) and c.get("key") == key), None)
    for word in (col or {}).get("choices") or []:
        if str(word).lower() == want:
            return str(word)
    return None


def _words(text: Any, limit: int) -> str:
    return " ".join(re.sub(r"<[^>]*>", " ", str(text or "")).split())[:limit]


def _availability(in_stock: bool, quantity: int | None) -> str:
    if not in_stock or (quantity is not None and quantity <= 0):
        return _OUT
    return _FEW if quantity is not None and 0 < quantity <= 3 else _IN


def _row(name: str, price: Any, availability: str, desc: str, qty: int | None, cols: dict[str, str | None], list_json: dict[str, Any], notes: list[dict[str, Any]], n: int) -> dict[str, Any] | None:
    name = " ".join(name.split())[:120]
    if not name:
        notes.append({"code": "name_missing", "row": n})
        return None
    cells: dict[str, Any] = {}
    if cols["price"] is not None:
        paise = _paise(price)
        if paise is None:
            notes.append({"code": "price_missing", "row": n})
        else:
            cells[cols["price"]] = paise
    word = _choice(list_json, cols["availability"], availability)
    if word is not None:
        cells[cols["availability"] or ""] = word
    elif cols["availability"] is not None:
        notes.append({"code": "availability_word_missing", "row": n, "column": cols["availability"]})
    if cols["description"] is not None and desc:
        cells[cols["description"]] = desc[:200]
    if cols["quantity"] is not None and qty is not None and qty >= 0:
        cells[cols["quantity"]] = qty
    return {"name": name, "cells": cells}


def shopify_rows(products: list[dict[str, Any]], list_json: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cols, notes = _columns(list_json), [{"code": "check_currency"}]
    rows: list[dict[str, Any]] = []
    if cols["price"] is None:
        notes.append({"code": "no_price_column"})
    for product in products:
        title = _words(product.get("title"), 100)
        variants = [v for v in ((product.get("variants") or {}).get("nodes") or []) if isinstance(v, dict)] if isinstance(product.get("variants"), dict) else []
        for v in variants or [{}]:
            vt = _words(v.get("title"), 40)
            single = not vt or vt.lower() == "default title" or len(variants) <= 1
            qty = v.get("inventoryQuantity") if isinstance(v.get("inventoryQuantity"), int) else None
            row = _row(title if single else f"{title}, {vt}", v.get("price"), _availability(v.get("availableForSale") is not False, qty), _words(product.get("description"), 200), qty, cols, list_json, notes, len(rows) + 1)
            if row is not None:
                rows.append(row)
            if len(rows) >= MAX_ROWS:
                notes.append({"code": "too_many"})
                return rows, notes
    return rows, notes


def woo_rows(products: list[dict[str, Any]], list_json: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cols, notes = _columns(list_json), [{"code": "check_currency"}]
    rows: list[dict[str, Any]] = []
    if cols["price"] is None:
        notes.append({"code": "no_price_column"})
    if any(p.get("type") == "variable" for p in products):
        notes.append({"code": "variable_products_one_row"})
    for product in products:
        qty = product.get("stock_quantity") if isinstance(product.get("stock_quantity"), int) and product.get("manage_stock") else None
        row = _row(_words(product.get("name"), 100), product.get("price") or product.get("regular_price"), _availability(product.get("stock_status", "instock") != "outofstock", qty),
                   _words(product.get("short_description") or product.get("description"), 200), qty, cols, list_json, notes, len(rows) + 1)
        if row is not None:
            rows.append(row)
        if len(rows) >= MAX_ROWS:
            notes.append({"code": "too_many"})
            break
    return rows, notes
