"""Unit tests for CSV export and formula injection neutralisation (app/leads/export.py)."""

from __future__ import annotations

import hashlib

from app.leads.export import (
    build_lead_labels_csv,
    build_lead_labels_json,
    sanitize_csv_cell,
)


def test_formula_injection_characters_are_escaped() -> None:
    assert sanitize_csv_cell("=cmd|'/C calc'!A0") == "'=cmd|'/C calc'!A0"
    assert sanitize_csv_cell("+12345") == "'+12345"
    assert sanitize_csv_cell("-SOMETHING") == "'-SOMETHING"
    assert sanitize_csv_cell("@SUM(1,2)") == "'@SUM(1,2)"
    assert sanitize_csv_cell("\tTAB") == "'\tTAB"
    assert sanitize_csv_cell("\rRETURN") == "'\rRETURN"


def test_harmless_values_are_not_modified() -> None:
    assert sanitize_csv_cell("Bengaluru") == "Bengaluru"
    assert sanitize_csv_cell("Sri Lakshmi Sarees") == "Sri Lakshmi Sarees"
    assert sanitize_csv_cell(100) == "100"
    assert sanitize_csv_cell(None) == ""


def test_build_lead_labels_csv() -> None:
    rows = [
        {
            "lead_id": "00000000-0000-0000-0000-000000000001",
            "company_name": "=Hostile Corp",
            "company_city": "Bengaluru",
            "lead_source": "manual",
            "label": "good",
            "reason_code": None,
            "score": 90,
            "score_max_reachable": 100,
            "score_band": "priority",
            "created_at": "2026-10-04T12:00:00Z",
        }
    ]
    csv_bytes, count, h = build_lead_labels_csv(rows)
    assert count == 1
    assert h == hashlib.sha256(csv_bytes).hexdigest()
    text = csv_bytes.decode("utf-8")
    assert "'=Hostile Corp" in text


def test_build_lead_labels_json() -> None:
    rows = [{"lead_id": "test", "label": "maybe"}]
    data, count, h = build_lead_labels_json(rows)
    assert count == 1
    assert h == hashlib.sha256(data).hexdigest()
