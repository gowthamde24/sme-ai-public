"""API models for the price-list CSV import (rehearsal step 5). Every model is `extra="forbid"`. The file arrives as ONE text field; what comes back about it is numbers, the file's own
sku and name cells (for the person to check), and ISSUES: a row number, a known column name and a closed code. An issue NEVER repeats a cell. Money is integer paise."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import StringConstraints

from app.crm.models import ApiUuid, _Strict
from app.pricelists.csv_port import COLUMNS, PARSER_CODES

# the parser's closed codes plus the API's own: a product the workspace does not have, a name with a hidden character, an empty or oversized list, a catalog that cannot be read
API_CODES: tuple[str, ...] = ("UNKNOWN_SKU", "HIDDEN_CHARACTERS", "NO_ITEMS", "TOO_MANY_ITEMS")
IssueCode = Literal[*PARSER_CODES, *API_CODES]  # type: ignore[valid-type]
ColumnName = Literal[*COLUMNS]  # type: ignore[valid-type]
MAX_CSV_CHARS = 2 * 1024 * 1024
MAX_ITEMS = 1000  # the database's own limit for one version


class _CsvText(_Strict):
    csv: Annotated[str, StringConstraints(min_length=1, max_length=MAX_CSV_CHARS)]
    effective_from: date


class PreviewIn(_CsvText):
    """Check a file: nothing is written."""


class CommitIn(_CsvText):
    """Make a price list VERSION from a file. `id` is the version's id, chosen by the caller: an exact retry replays, other content under the same id is a conflict."""

    id: ApiUuid


class IssueOut(_Strict):
    row: int  # 0 = the file or its header; otherwise the DATA row (the first row after the header is row 1)
    column: ColumnName | None
    code: IssueCode


class BreakOut(_Strict):
    min_qty: int
    unit_price_paise: int


class PreviewItemOut(_Strict):
    sku: str
    name: str
    catalog_name: str | None  # the product's name in the catalog (None for an unknown sku)
    name_matches: bool
    sale_unit: Literal["piece", "set"] | None
    unit_price_paise: int
    minimum_order_quantity: int
    tax_bps: int
    breaks: list[BreakOut]


class PreviewOut(_Strict):
    ok: bool
    parser_version: str
    effective_from: date
    row_count: int
    canonical_hash: str | None
    items: list[PreviewItemOut]
    issues: list[IssueOut]


class CommitOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    item_count: int
    content_sha256: str
    replayed: bool
