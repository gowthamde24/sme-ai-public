# ruff: noqa: E501
"""Importing a file into a list (28 Nov 2026, lists slice 3): headings matched to the list's columns (remembered mapping, then the column's own label, then plain role words), each cell converted to what its column holds, what cannot be read left empty with a note. Nothing is saved by the preview."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.assistant_work.extract import FileReader
from app.jobs.wiring import JobsRuntime
from app.lead_sources.service import LeadSourcesService
from app.sell_lists import importer
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.test_aw_files import MATCHER
from tests.test_aw_files_read import FakeLocal, fid

URL = f"/v1/tenants/{TENANT_A.id}/lists"
LIST = str(uuid.uuid4())

COLUMNS = [
    {"key": "retail_price", "label": "Retail price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": True, "choices": []},
    {"key": "wholesale_price", "label": "Wholesale price", "type": "rupees", "role": "price", "billing_period": "per_unit", "quote_default": False, "choices": []},
    {"key": "stock", "label": "Stock", "type": "choice", "role": "availability", "choices": ["In stock", "Out of stock"]},
    {"key": "colour", "label": "Colour", "type": "text"},
    {"key": "starts", "label": "Starts", "type": "date"},
    {"key": "length", "label": "Length", "type": "duration"},
    {"key": "gift", "label": "Gift wrap", "type": "yes_no"},
    {"key": "link", "label": "Buy link", "type": "link", "role": "how_to_buy"},
]
THE_LIST = {"id": LIST, "name": "Dress materials", "kind": "products", "columns": COLUMNS}


def test_headings_find_their_columns_by_label_by_role_words_and_the_default_price() -> None:
    got = importer.auto_mapping(COLUMNS, ["Item", "Wholesale Price", "Rate", "Stock", "Colour", "Remarks"])  # type: ignore[arg-type]
    assert got == {"Item": "name", "Wholesale Price": "wholesale_price", "Rate": "retail_price", "Stock": "stock", "Colour": "colour", "Remarks": None}


def test_cells_become_what_their_column_holds_and_unreadable_ones_are_left_out_with_a_note() -> None:
    table = [["Name", "Retail price", "Stock", "Starts", "Length", "Gift wrap", "Buy link", "Colour"],
             ["Cotton", "Rs. 1,250", "in stock", "01/12/2026", "1.5 h", "yes", "https://shop.example/c", "Red"],
             ["Linen", "call us", "Sold", "31/02/2026", "ninety", "maybe", "http://x.example", ""],
             ["", "100", "", "", "", "", "", ""]]
    got = importer.propose(THE_LIST, table)
    assert got.rows[0] == {"name": "Cotton", "cells": {"retail_price": 125000, "stock": "In stock", "starts": "2026-12-01", "length": 90, "gift": True, "link": "https://shop.example/c", "colour": "Red"}}
    assert got.rows[1] == {"name": "Linen", "cells": {}}
    unreadable = [n for n in got.notes if n["code"] == "cell_unreadable"]
    assert {(n["row"], n["column"]) for n in unreadable} == {(2, "retail_price"), (2, "stock"), (2, "starts"), (2, "length"), (2, "gift"), (2, "link")}
    assert {"code": "name_missing", "row": 3} in got.notes and got.unclear is False


def test_a_remembered_mapping_wins_and_an_explicit_one_wins_over_that() -> None:
    table = [["Design", "MRP", "Qty"], ["Silk", "900", "3"]]
    saved = [{"label": "my sheet", "mapping": {"Design": "name", "MRP": "wholesale_price", "Qty": None}}]
    assert importer.propose(THE_LIST, table, saved=saved).rows == [{"name": "Silk", "cells": {"wholesale_price": 90000}}]
    chosen = {"Design": "name", "MRP": "retail_price", "Qty": None}
    assert importer.propose(THE_LIST, table, saved=saved, mapping=chosen).rows == [{"name": "Silk", "cells": {"retail_price": 90000}}]
    assert importer.propose(THE_LIST, table, mapping={"Design": "name", "MRP": "no_such_column", "Qty": None}).rows == [{"name": "Silk", "cells": {}}], "a key that is not a column is dropped"


def test_no_name_column_or_no_rows_is_unclear() -> None:
    assert importer.propose(THE_LIST, [["Rate"], ["10"]], mapping={"Rate": "retail_price"}).unclear is True
    assert importer.propose(THE_LIST, [["Name", "Rate"]]).unclear is True


class FakeLists:
    def __init__(self) -> None:
        self.committed: list[Any] = []

    def get(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return THE_LIST

    def mappings(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return {"mappings": []}

    def rows_import(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, rows: list[dict[str, Any]], label: str | None, mapping: dict[str, Any] | None) -> dict[str, Any]:
        self.committed.append((rows, label, mapping))
        return {"created": len(rows), "updated": 0}


@pytest.fixture
def w() -> tuple[Any, FakeLists]:
    repo = FakeLists()
    tasks = TasksService(FakeTasksRepository(school=False), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(sell_lists=repo, jobs=JobsRuntime(), tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=FakeWorkStore(),  # type: ignore[arg-type]
                            assistant_file_reader=FileReader(FakeLocal(text_layer="")))
    return client, repo


def test_preview_reads_the_file_proposes_rows_and_saves_nothing(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    f = fid(client, "stock.csv", b"Item,Wholesale price,Stock\nCotton,450,In stock\nLinen,520,Out of stock\n", "text/csv")
    r = client.post(f"{URL}/{LIST}/import/preview", json={"file_id": f}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mapping"] == {"Item": "name", "Wholesale price": "wholesale_price", "Stock": "stock"}
    assert body["rows"][1] == {"name": "Linen", "cells": {"wholesale_price": 52000, "stock": "Out of stock"}} and body["unclear"] is False
    assert repo.committed == []


def test_commit_sends_the_corrected_rows_and_the_mapping_to_remember(w: tuple[Any, FakeLists]) -> None:
    client, repo = w
    body = {"rows": [{"name": "Cotton", "cells": {"retail_price": 125000}}], "save_label": "stock sheet", "mapping": {"Item": "name", "Rate": "retail_price"}}
    r = client.post(f"{URL}/{LIST}/import/commit", json=body, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json() == {"created": 1, "updated": 0}
    assert repo.committed[0][1] == "stock sheet"
    for user in ("a_sales", "a_viewer"):
        assert client.post(f"{URL}/{LIST}/import/commit", json=body, headers=auth(user)).status_code == 403
        assert client.post(f"{URL}/{LIST}/import/preview", json={"file_id": str(uuid.uuid4())}, headers=auth(user)).status_code == 403
    assert client.post(f"{URL}/{LIST}/import/commit", json={**body, "extra": 1}, headers=auth("a_owner")).status_code == 422
    assert client.get(f"{URL}/{LIST}/import/mappings", headers=auth("a_viewer")).json() == {"mappings": []}
