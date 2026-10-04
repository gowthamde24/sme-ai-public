"""Export generation with spreadsheet formula injection protection (ADR 0010, milestone 2)."""

from __future__ import annotations

import csv
import hashlib
import io
import json
from typing import Any


def sanitize_csv_cell(value: Any) -> str:
    """Neutralise CSV/spreadsheet formula injection.

    Cells starting with `= + - @ \\t \\r` get a prepended `'` so spreadsheet software does not
    execute them as formulas or macros.
    """
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def build_lead_labels_csv(rows: list[dict[str, Any]]) -> tuple[bytes, int, str]:
    """Generate safe CSV bytes, row count, and SHA256 content hash."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")

    headers = [
        "lead_id",
        "company_name",
        "company_city",
        "lead_source",
        "label",
        "reason_code",
        "score",
        "score_max_reachable",
        "score_band",
        "created_at",
    ]
    writer.writerow(headers)

    for row in rows:
        writer.writerow([sanitize_csv_cell(row.get(h)) for h in headers])

    content = buf.getvalue().encode("utf-8")
    row_count = len(rows)
    sha256 = hashlib.sha256(content).hexdigest()
    return content, row_count, sha256


def build_lead_labels_json(rows: list[dict[str, Any]]) -> tuple[bytes, int, str]:
    """Generate JSON bytes, row count, and SHA256 content hash."""
    content = json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8")
    row_count = len(rows)
    sha256 = hashlib.sha256(content).hexdigest()
    return content, row_count, sha256
