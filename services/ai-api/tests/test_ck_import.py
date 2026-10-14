"""Job CK: the spreadsheet import at 5,000 rows and with custom-field columns (ADR 0084 part 2, blueprint section 6). The file safety, the roles and the job flow are tests/test_integrations_*.py; the database
rules are pgTAP 94/95 and tests/integration/test_ck_import_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

import pytest

from app.customfields import importing as ci
from app.integrations import importer, mapping
from app.integrations.sheet import MAX_DATA_ROWS, PART_ROWS, load_grid
from tests.fakes import TENANT_A, FakeLeadsRepository, make_client
from tests.integrations_fakes import FakeIntegrations
from tests.test_integrations_routes import JOB, S, World, confirm, preview


def _def(code: str, kind: str, label: str, *, required: bool = False, pii: str = "none", choices: list[tuple[str, str]] | None = None, active: bool = True) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, code)), "entity": "contact", "code": code, "label": {"en": label}, "kind": kind, "required": required, "pii_class": pii, "active": active, "position": 0, "mergeable": False,
        "source": "owner", "choices": [{"code": c, "label": {"en": lab}} for c, lab in choices] if choices else None,
    }  # fmt: skip


DEFS = {
    d["code"]: d
    for d in (
        _def("customer_kind", "choice", "Customer type", choices=[("contractor", "Contractor"), ("builder", "Builder")]),
        _def("site_area", "text", "Site area"),
        _def("credit_days", "number", "Credit days"),
        _def("first_order", "date", "First order"),
        _def("gst_registered", "yes_no", "GST registered"),
        _def("uses", "multi_choice", "Usually buys for", choices=[("driveway", "Driveway"), ("parking", "Parking"), ("garden", "Garden")]),
    )
}


# ----------------------------------------------------------------------------------------------------------------------------- one cell
@pytest.mark.parametrize(
    ("code", "cell", "want"),
    [
        ("site_area", "Hitech City", ("Hitech City", None)), ("site_area", "  ", (None, None)), ("site_area", "x" * 101, (None, "too_long")), ("site_area", "call 9876543210", (None, "contains_contact")),
        ("site_area", "mail a@b.co", (None, "contains_contact")),
        ("credit_days", "30", (30, None)), ("credit_days", "1,20,000", (120000, None)), ("credit_days", "2.5", (2.5, None)), ("credit_days", "thirty", (None, "bad_number")), ("credit_days", "1e9", (None, "bad_number")),
        ("credit_days", "9" * 13, (None, "bad_number")),
        ("first_order", "2026-10-14", ("2026-10-14", None)), ("first_order", "14/10/2026", ("2026-10-14", None)), ("first_order", "14-10-2026", ("2026-10-14", None)), ("first_order", "31/02/2026", (None, "bad_date")),
        ("first_order", "45000", (None, "bad_date")), ("first_order", "14/10/1800", (None, "bad_date")),
        ("gst_registered", "Yes", (True, None)), ("gst_registered", "no", (False, None)), ("gst_registered", "maybe", (None, "bad_yes_no")),
        ("customer_kind", "builder", ("builder", None)), ("customer_kind", "Contractor", ("contractor", None)), ("customer_kind", "architect", (None, "not_a_choice")),
        ("uses", "driveway; garden", (["driveway", "garden"], None)), ("uses", "Parking, parking", (["parking"], None)), ("uses", "driveway; roof", (None, "not_a_choice")),
    ],
)  # fmt: skip
def test_a_cell_becomes_a_typed_value_or_a_closed_issue_code(code: str, cell: str, want: tuple[Any, str | None]) -> None:
    assert ci.parse_cell(DEFS[code], cell) == want


def test_a_personal_class_text_field_may_hold_what_a_none_class_field_may_not() -> None:
    personal = _def("note", "text", "Note", pii="personal")
    assert ci.parse_cell(personal, "ask 9876543210") == ("ask 9876543210", None)


def test_an_unknown_choice_is_an_issue_never_a_new_choice() -> None:
    assert ci.parse_cell(DEFS["customer_kind"], "Dealer") == (None, "not_a_choice")


def test_every_issue_code_is_in_the_closed_list() -> None:
    assert set(ci.ISSUE_CODES) <= set(importer.ISSUE_CODES)
    assert {"bad_number", "bad_date", "not_a_choice", "too_long", "required_missing"} <= set(ci.ISSUE_CODES)


# ----------------------------------------------------------------------------------------------------------------------------- mapping
def test_a_customers_mapping_may_name_an_active_contact_field_and_nothing_else() -> None:
    codes = frozenset(DEFS)
    ok = mapping.validate_mapping({"company_name": 0, "custom:site_area": 1}, "customers", 3, codes)
    assert ok == {"company_name": 0, "custom:site_area": 1}
    for bad in ({"company_name": 0, "custom:nope": 1}, {"company_name": 0, "custom:": 1}, {"company_name": 0, "custom:site_area": 0}, {"company_name": 0, "CUSTOM:site_area": 1}, {"custom:site_area": 1}):
        with pytest.raises(ValueError):  # noqa: PT011
            mapping.validate_mapping(bad, "customers", 3, codes)
    # without the field list (or for a stock file) a custom target is not a field at all
    with pytest.raises(ValueError):  # noqa: PT011
        mapping.validate_mapping({"company_name": 0, "custom:site_area": 1}, "customers", 3)
    with pytest.raises(ValueError):  # noqa: PT011
        mapping.validate_mapping({"item_name": 0, "custom:site_area": 1}, "stock", 3, codes)


def test_a_column_named_like_a_field_is_suggested_for_it() -> None:
    got = ci.suggest(["Party", "Customer type", "SITE AREA", "city"], DEFS, taken={0})
    assert got == {"custom:customer_kind": 1, "custom:site_area": 2}
    assert ci.suggest(["Party", "Customer type"], DEFS, taken={1}) == {}, "a column already taken is not reused"


# ----------------------------------------------------------------------------------------------------------------------------- the rows
HEAD = "Party,Customer type,Site area,Credit days,First order,GST registered,Usually buys for\n"


def _grid(body: str) -> Any:
    return load_grid((HEAD + body).encode())


COLS = {"company_name": 0, "custom:customer_kind": 1, "custom:site_area": 2, "custom:credit_days": 3, "custom:first_order": 4, "custom:gst_registered": 5, "custom:uses": 6}


def test_custom_columns_are_parsed_and_kept_apart_from_the_lead_import_rows() -> None:
    p = importer.prepare_customers(_grid("Sai Constructions,Builder,Hitech City,30,14/10/2026,yes,driveway; garden\n"), COLS, DEFS)
    assert p.issues == [] and len(p.rows) == 1
    assert p.rows[0] == {"company_name": "Sai Constructions", "source": "Spreadsheet import"}, "nothing custom reaches the lead import"
    assert p.customs == [{"customer_kind": "builder", "site_area": "Hitech City", "credit_days": 30, "first_order": "2026-10-14", "gst_registered": True, "uses": ["driveway", "garden"]}]


def test_a_row_with_a_bad_custom_value_is_skipped_whole_with_one_closed_issue() -> None:
    p = importer.prepare_customers(_grid("A,Builder,x,thirty,,,\nB,Architect,,,,,\nC,,,,,,\n"), COLS, DEFS)
    assert [(i.line, i.code, i.field) for i in p.issues] == [(2, "bad_number", "custom:credit_days"), (3, "not_a_choice", "custom:customer_kind")]
    assert [r["company_name"] for r in p.rows] == ["C"] and p.customs == [{}], "the good row is kept; an empty custom cell is no value and no issue"


def test_a_required_field_is_needed_even_when_its_column_is_not_mapped() -> None:
    required = {**DEFS, "region": _def("region", "text", "Region", required=True)}
    p = importer.prepare_customers(_grid("A,Builder,x,,,,\n"), COLS, required)
    assert [(i.code, i.field) for i in p.issues] == [("required_missing", "custom:region")] and p.rows == []
    ok = importer.prepare_customers(load_grid(b"Party,Region\nA,North\n"), {"company_name": 0, "custom:region": 1}, required)
    assert ok.issues == [] and ok.customs == [{"region": "North"}]


def test_without_custom_fields_the_importer_behaves_exactly_as_before() -> None:
    grid = load_grid(b"Party,City\nRavi Silks,Hyd\n")
    old = importer.prepare_customers(grid, {"company_name": 0, "city": 1})
    assert old.rows == [{"company_name": "Ravi Silks", "city": "Hyd", "source": "Spreadsheet import"}] and old.customs == [{}]


def test_a_cell_that_looks_like_a_formula_is_refused_in_a_custom_column_too() -> None:
    p = importer.prepare_customers(_grid('A,Builder,"=HYPERLINK(1)",,,,\n'), COLS, DEFS)
    assert [(i.code, i.field) for i in p.issues] == [("formula_like", "custom:site_area")]


# ----------------------------------------------------------------------------------------------------------------------------- the routes
class FakeCustomRepo:
    def __init__(self, defs: dict[str, dict[str, Any]] | None = None) -> None:
        self.defs = DEFS if defs is None else defs
        self.many: list[list[dict[str, Any]]] = []
        self.fail_ids: set[str] = set()

    def defs_list(self, token: str, tenant_id: uuid.UUID, entity: str | None) -> list[dict[str, Any]]:
        return list(self.defs.values())

    def values_set_many(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        assert 1 <= len(items) <= 500, "the database takes at most 500 per call"
        self.many.append(items)
        failed = [{"id": i["id"], "code": "SM711"} for i in items if i["id"] in self.fail_ids]
        return {"set": len(items) - len(failed), "failed": failed}


class RecordingLeads(FakeLeadsRepository):
    def __init__(self) -> None:
        super().__init__()
        self.batches: list[tuple[uuid.UUID, int, bool]] = []

    def import_leads(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]], *, dry_run: bool, label: str | None) -> Any:
        assert len(rows) <= 500
        self.batches.append((batch_id, len(rows), dry_run))
        return super().import_leads(token, tenant_id, batch_id, rows, dry_run=dry_run, label=label)


def _csv(n: int, extra: bool = False) -> bytes:
    lines = ["Party,Phone" + (",Customer type,Credit days" if extra else "")]
    for i in range(n):
        lines.append(f"Shop {i},{9000000000 + i}" + (",Builder,30" if extra else ""))
    return ("\n".join(lines) + "\n").encode()


def test_a_5000_row_file_runs_in_ten_parts_of_500_each_with_its_own_batch_id() -> None:
    leads = RecordingLeads()
    w = World(leads=leads)
    data = _csv(MAX_DATA_ROWS)
    p = preview(w, data)
    assert p.status_code == 200, p.text
    body = p.json()
    assert body["counts"]["rows"] == 5000 and body["counts"]["will_create"] == 5000 and body["parts"] == 10 and len(body["rows"]) == 5000
    assert [(n, d) for _, n, d in leads.batches] == [(500, True)] * 10
    ids = [b for b, _, _ in leads.batches]
    assert ids[0] == uuid.UUID(JOB) and len(set(ids)) == 10 and ids[1] == uuid.uuid5(uuid.UUID(JOB), "part-1")
    leads.batches.clear()
    done = confirm(w, data)
    assert done.status_code == 200, done.text
    result = done.json()["result"]
    assert result["counts"]["created"] == 5000 and result["counts"]["rows"] == 5000 and len(result["rows"]) == 5000
    assert [(n, d) for _, n, d in leads.batches] == [(500, False)] * 10 and [b for b, _, _ in leads.batches] == ids
    # the lines of the first and the last row are the file's own, across the part boundaries
    assert [r["line"] for r in result["rows"]][:2] == [2, 3] and result["rows"][-1]["line"] == 5001 and result["rows"][500]["line"] == 502
    assert w.db.jobs[JOB]["status"] == "completed" and w.db.jobs[JOB]["rows_total"] == 5000


def test_a_file_of_500_rows_or_fewer_behaves_exactly_as_before() -> None:
    leads = RecordingLeads()
    w = World(leads=leads)
    body = preview(w, _csv(500)).json()
    assert "parts" not in body and [b for b, _, _ in leads.batches] == [uuid.UUID(JOB)]
    leads.batches.clear()
    confirm(w, _csv(500))
    assert [(b, n, d) for b, n, d in leads.batches] == [(uuid.UUID(JOB), 500, False)], "part 0 IS the job id, as it always was"


def test_a_file_over_5000_rows_is_refused_with_its_closed_code() -> None:
    w = World()
    r = w.upload(S + "/inspect?kind=customers", "a_owner", _csv(MAX_DATA_ROWS + 1))
    assert r.status_code == 422 and r.json()["error"]["code"] == "file_too_many_rows" and "5,000" in r.json()["error"]["message"]


def test_a_failed_job_run_again_repeats_no_part_it_replays_them() -> None:
    """Part 0 ran, part 1 failed: the retry sends the same batch ids, so the database replays what ran (no duplicate) and runs the rest."""
    leads = RecordingLeads()
    w = World(leads=leads)
    data = _csv(1200)
    preview(w, data)
    leads.batches.clear()
    calls = {"n": 0}
    real = leads.import_leads

    def flaky(token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]], *, dry_run: bool, label: str | None) -> Any:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("the second part failed")
        return real(token, tenant_id, batch_id, rows, dry_run=dry_run, label=label)

    leads.import_leads = flaky  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        confirm(w, data)
    first_try = [b for b, _, _ in leads.batches]
    leads.import_leads = real  # type: ignore[method-assign]
    leads.batches.clear()
    r = confirm(w, data)
    assert r.status_code == 200 and r.json()["result"]["counts"]["created"] == 1200
    assert [b for b, _, _ in leads.batches] == [uuid.UUID(JOB), uuid.uuid5(uuid.UUID(JOB), "part-1"), uuid.uuid5(uuid.UUID(JOB), "part-2")]
    assert first_try == [uuid.UUID(JOB)], "only part 0 had run before the failure"


def test_inspect_lists_the_custom_targets_and_suggests_a_matching_column() -> None:
    w = World(custom_fields=FakeCustomRepo())
    r = w.upload(S + "/inspect?kind=customers", "a_owner", b"Party,Customer type,Site area,Nothing\nA,Builder,x,y\n")
    body = r.json()
    assert r.status_code == 200
    assert {"field": "custom:site_area", "label": "Site area", "required": False, "kind": "text"} in body["fields"]
    assert body["suggested_mapping"] == {"company_name": 0, "custom:customer_kind": 1, "custom:site_area": 2}
    assert [c["suggested_field"] for c in body["columns"]] == ["company_name", "custom:customer_kind", "custom:site_area", None]
    stock = w.upload(S + "/inspect?kind=stock", "a_owner", b"Item,Stock\nA,in stock\n").json()
    assert not any(f["field"].startswith("custom:") for f in stock["fields"]), "a stock file has no custom targets"


def test_an_inactive_field_is_not_a_target() -> None:
    off = {**DEFS, "site_area": _def("site_area", "text", "Site area", active=False)}
    w = World(custom_fields=FakeCustomRepo(off))
    body = w.upload(S + "/inspect?kind=customers", "a_owner", b"Party,Site area\nA,x\n").json()
    assert "custom:site_area" not in {f["field"] for f in body["fields"]} and "custom:site_area" not in body["suggested_mapping"]
    bad = preview(w, b"Party,Site area\nA,x\n", mapping="&mapping=" + json.dumps({"company_name": 0, "custom:site_area": 1}))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "mapping_invalid"


def test_custom_values_go_to_the_contacts_the_import_created_in_parts_of_500() -> None:
    custom = FakeCustomRepo()
    leads = RecordingLeads()
    w = World(leads=leads, custom_fields=custom)
    data = _csv(1201, extra=True)
    mapping_arg = "&mapping=" + json.dumps({"company_name": 0, "contact_phone": 1, "custom:customer_kind": 2, "custom:credit_days": 3})
    p = preview(w, data, mapping=mapping_arg)
    assert p.status_code == 200 and p.json()["counts"]["usable"] == 1201 and "Builder" not in p.text
    done = confirm(w, data)
    assert done.status_code == 200, done.text
    assert [len(items) for items in custom.many] == [500, 500, 201]
    assert custom.many[0][0]["values"] == {"customer_kind": "builder", "credit_days": 30} and len(custom.many[0][0]["id"]) == 36
    counts = done.json()["result"]["counts"]
    assert counts["custom_values_set"] == 1201 and counts["custom_values_failed"] == 0 and counts["created"] == 1201


def test_a_value_the_database_refuses_is_counted_and_the_import_goes_on() -> None:
    custom = FakeCustomRepo()
    w = World(leads=RecordingLeads(), custom_fields=custom)
    data = _csv(3, extra=True)
    arg = "&mapping=" + json.dumps({"company_name": 0, "contact_phone": 1, "custom:customer_kind": 2})
    preview(w, data, mapping=arg)

    real = custom.values_set_many

    def refuse_first(token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        custom.fail_ids = {items[0]["id"]}
        return real(token, tenant_id, items)

    custom.values_set_many = refuse_first  # type: ignore[method-assign]
    counts = confirm(w, data).json()["result"]["counts"]
    assert counts["created"] == 3 and counts["custom_values_set"] == 2 and counts["custom_values_failed"] == 1


def test_a_file_with_no_custom_column_has_no_custom_counts_and_never_calls_the_custom_repository() -> None:
    custom = FakeCustomRepo()
    w = World(leads=RecordingLeads(), custom_fields=custom)
    preview(w)
    counts = confirm(w).json()["result"]["counts"]
    assert "custom_values_set" not in counts and custom.many == []


def test_an_existing_customer_is_never_given_values_by_an_import() -> None:
    """The lead import reports an existing customer as a duplicate (no contact_created): its custom values are left alone."""
    custom = FakeCustomRepo()

    class Dup(RecordingLeads):
        def import_leads(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]], *, dry_run: bool, label: str | None) -> Any:
            report = super().import_leads(token, tenant_id, batch_id, rows, dry_run=dry_run, label=label)
            for o in report.rows:
                o.contact_created = False
            return report

    w = World(leads=Dup(), custom_fields=custom)
    arg = "&mapping=" + json.dumps({"company_name": 0, "contact_phone": 1, "custom:customer_kind": 2})
    data = _csv(2, extra=True)
    preview(w, data, mapping=arg)
    confirm(w, data)
    assert custom.many == []


def test_the_stored_job_holds_no_cell_value_even_with_custom_columns() -> None:
    custom = FakeCustomRepo()
    w = World(leads=RecordingLeads(), custom_fields=custom)
    data = b"Party,Site area\nSecret Shop,Secret Place\n"
    preview(w, data, mapping="&mapping=" + json.dumps({"company_name": 0, "custom:site_area": 1}))
    stored = json.dumps(w.db.jobs[JOB])
    assert "Secret" not in stored and "custom:site_area" in stored and hashlib.sha256(data).hexdigest() in stored


def test_the_fake_world_is_the_one_the_other_import_tests_use() -> None:
    assert isinstance(World().db, FakeIntegrations) and PART_ROWS == 500 and str(TENANT_A.id) in S
    assert make_client()[0] is not None
