"""One entry point for the accounting export: the rows the database returned in, the file out (bytes, media type, file name). Every format is written from the same Accounting structure."""

from __future__ import annotations

import hashlib
import io
import zipfile
from dataclasses import dataclass
from typing import Any

from app.integrations import accounting, plain, tally, vyapar

FORMATS = ("tally_zip", "tally_masters_xml", "tally_vouchers_xml", "vyapar_xlsx", "csv", "xlsx")
DESCRIPTIONS = {
    "tally_zip": "Tally Prime: masters and vouchers (XML) with step-by-step import notes, in one zip",
    "tally_masters_xml": "Tally Prime: the ledgers (import this first)",
    "tally_vouchers_xml": "Tally Prime: the Sales, Receipt and Payment vouchers (import this second)",
    "vyapar_xlsx": "Vyapar: an Excel workbook with Parties, Items, Sales and Payments sheets",
    "csv": "Plain CSV (UTF-8) for any spreadsheet or accountant",
    "xlsx": "Plain Excel workbook: register, sale lines and payments",
}
_MEDIA = {
    "tally_zip": ("application/zip", "zip"),
    "tally_masters_xml": ("application/xml", "xml"),
    "tally_vouchers_xml": ("application/xml", "xml"),
    "vyapar_xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    "csv": ("text/csv; charset=utf-8", "csv"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
}


@dataclass(frozen=True)
class ExportFile:
    content: bytes
    media_type: str
    filename: str
    sales: int
    payments: int

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


def _zip(files: list[tuple[str, str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, text in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, text.encode("utf-8"))
    return buf.getvalue()


def build_export(fmt: str, payload: dict[str, Any]) -> ExportFile:
    if fmt not in FORMATS:
        raise ValueError("unknown format")
    acc = accounting.build(payload)
    if fmt == "tally_zip":
        content = _zip([("1-masters.xml", tally.masters_xml(acc)), ("2-vouchers.xml", tally.vouchers_xml(acc)), ("README.txt", tally.readme(acc))])
    elif fmt == "tally_masters_xml":
        content = tally.masters_xml(acc).encode("utf-8")
    elif fmt == "tally_vouchers_xml":
        content = tally.vouchers_xml(acc).encode("utf-8")
    elif fmt == "vyapar_xlsx":
        content = vyapar.workbook(acc)
    elif fmt == "csv":
        content = plain.csv_bytes(acc)
    else:
        content = plain.xlsx_bytes(acc)
    media, ext = _MEDIA[fmt]
    base = {"tally_zip": "tally", "tally_masters_xml": "tally-masters", "tally_vouchers_xml": "tally-vouchers", "vyapar_xlsx": "vyapar", "csv": "accounts", "xlsx": "accounts"}[fmt]
    return ExportFile(content, media, f"{base}_{acc.date_from}_to_{acc.date_to}.{ext}", len(acc.sales), len(acc.payments))
