"""Job DG: the figure tool gives the Main agent a school's fee totals and a construction business's dues and trips, and nothing that names a person. A fake reports repository stands in for the database; nothing
is contacted. The structural rule (no assistant module names a child column or the education repository) is tests/test_cr_child_fields.py, which still holds with this tool in place."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from datetime import date
from types import SimpleNamespace
from typing import Any, Literal

import pytest

# isort: off
from app.assistant.tools import TOOLS, Ctx, State  # first: the tools module imports figure_tools at its end
from app.assistant import figure_tools
from app.assistant.models import NOT_STORED_SOURCES

# isort: on
from app.packs.errors import ModuleOffError
from app.today.service import format_rupees

CANARIES = ("Zubin Canary", "Admission DG-777", "Guardian Canary", "Customer Canary Pvt")
TENANT = uuid.UUID("11111111-1111-4111-8111-111111111111")


def report(kpis: dict[str, int], tables: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"kpis": [{"key": k, "value": v, "unit": "count"} for k, v in kpis.items()], "tables": tables or [], "series": []}


class FakeReports:
    def __init__(self, by_code: dict[str, dict[str, Any]], off: bool = False) -> None:
        self.by_code, self.off = by_code, off
        self.calls: list[tuple[str, date | None, date | None]] = []

    def run(self, token: str, tenant: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        self.calls.append((code, date_from, date_to))
        if self.off:
            raise ModuleOffError("off")
        return self.by_code[code]


def ctx(reports: Any) -> Ctx:
    return Ctx(db=None, runtime=SimpleNamespace(reports=reports), token="t", tenant=TENANT, run_id=uuid.uuid4(), state=State())  # type: ignore[arg-type]


SCHOOL = {
    # the real reports carry no person; here the other tables and an extra headline are FULL of canaries to prove the tool reads only what it names
    "education.collection": report(
        {"due_paise": 1_200_000, "pending_paise": 300_000, "collected_paise": 450_000, "collection_pct": 75, "students_pending": 4},
        [
            {"key": "by_programme", "rows": [["Class 5", 12, 600_000, 200_000, 66]]},
            {"key": "by_child", "rows": [[CANARIES[0], CANARIES[1], 99]]},
        ],
    ),
    "education.pending": report(
        {"pending_paise": 300_000, "students_pending": 4},
        [
            {"key": "by_programme", "rows": [["Class 5", 3, 250_000], ["Class 6", 1, 50_000]]},
            {"key": "guardians", "rows": [[CANARIES[2], 5]]},
        ],
    ),
}
SITE = {
    "construction.dues_ageing": report({"outstanding_paise": 5_000_000, "overdue_paise": 1_500_000, "customers_owing": 3}, [{"key": "by_customer", "rows": [[CANARIES[3], 1_500_000]]}]),
    "construction.trips_per_day": report({"trips": 5, "delivered": 2, "problems": 1, "cancelled": 1}),
}


def serialised(out: Any) -> str:
    return str(json.dumps([(i.type, str(i.id), i.label, i.fields) for i in out.items], default=str, ensure_ascii=False)) + str(json.dumps(out.facts)) + str(out.note)


def test_the_tool_is_registered_as_a_read_tool_and_report_sources_are_never_stored() -> None:
    tool = next(t for t in TOOLS if t.name == "get_figures")
    assert not tool.action
    assert "report" in NOT_STORED_SOURCES


def test_school_fees_totals_counts_and_pending_by_class() -> None:
    reports = FakeReports(SCHOOL)
    out = figure_tools.get_figures(ctx(reports), figure_tools.FigureArgs(topic="school_fees", period="this_month"))
    assert out.note == "ok"
    summary, *classes = out.items
    assert summary.fields["collected_in_period"] == format_rupees(450_000)
    assert summary.fields["fees_pending_now"] == format_rupees(300_000)
    assert summary.fields["families_with_fees_pending"] == 4
    assert summary.fields["collected_percent"] == "75%"
    assert [(c.label, c.fields["families_pending"]) for c in classes] == [("Pending in Class 5", 3), ("Pending in Class 6", 1)]
    # the month starts on the 1st (India's today), the week on a Monday, today is a day
    code, start, end = reports.calls[0]
    assert code == "education.collection" and start is not None and end is not None and start == end.replace(day=1)


def test_every_rupee_figure_is_added_to_the_amounts_an_answer_may_repeat() -> None:
    c = ctx(FakeReports(SCHOOL))
    figure_tools.get_figures(c, figure_tools.FigureArgs(topic="school_fees"))
    assert {450_000, 300_000, 1_200_000, 250_000, 50_000} <= c.state.allowed_paise


def test_no_person_reaches_the_output_whatever_the_report_holds() -> None:
    topics: tuple[tuple[Literal["school_fees", "site_dues_and_trips"], dict[str, dict[str, Any]]], ...] = (("school_fees", SCHOOL), ("site_dues_and_trips", SITE))
    for topic, data in topics:
        out = figure_tools.get_figures(ctx(FakeReports(data)), figure_tools.FigureArgs(topic=topic))
        text = serialised(out)
        for canary in CANARIES:
            assert canary not in text, (topic, canary)
        for word in ("child", "admission", "guardian", "phone", "label"):
            assert word not in text.lower(), (topic, word)


def test_construction_dues_and_trips_today() -> None:
    reports = FakeReports(SITE)
    out = figure_tools.get_figures(ctx(reports), figure_tools.FigureArgs(topic="site_dues_and_trips"))
    owed, trips = out.items
    assert owed.fields["outstanding"] == format_rupees(5_000_000) and owed.fields["overdue"] == format_rupees(1_500_000) and owed.fields["customers_owing"] == 3
    assert trips.fields == {**trips.fields, "trips_planned_today": 5, "delivered": 2, "with_a_problem": 1, "cancelled": 1}
    assert reports.calls[1][1] == reports.calls[1][2], "trips: today only"


@pytest.mark.parametrize("topic", ["school_fees", "site_dues_and_trips"])
def test_a_business_without_the_module_gets_a_closed_note_not_an_error(topic: Literal["school_fees", "site_dues_and_trips"]) -> None:
    out = figure_tools.get_figures(ctx(FakeReports({}, off=True)), figure_tools.FigureArgs(topic=topic))
    assert out.items == () and out.note == "not_available"


def test_no_reports_door_is_unavailable() -> None:
    assert figure_tools.get_figures(ctx(None), figure_tools.FigureArgs(topic="school_fees")).note == "unavailable"


def test_the_arguments_are_closed() -> None:
    with pytest.raises(ValueError):
        figure_tools.FigureArgs.model_validate({"topic": "school_fees", "tenant_id": str(TENANT)})
    with pytest.raises(ValueError):
        figure_tools.FigureArgs.model_validate({"topic": "everything"})
