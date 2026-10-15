"""Job CR (ADR 0084 part 5, decision 6): a child's fields never reach a model, a log line, a metric, an error message, a search index or a default export.

A student's `child_label` and `admission_no` live in two columns of one table, read by one repository that only the education routes, the students file of the spreadsheet import and the privacy housekeeping
may hold. This file proves the SHAPE of that rule in the code, without a database:

  * no module outside the education package (and the three named doors) names a child column, the education repository or the students table: no agent, assistant tool, prompt builder, search, export, metric,
    log filter, scheduler step or notification can read a child because none of them can even name one;
  * the generic exports and searches the code has (the accounting export, the lead search, the weekly report, the data export of a person) do not select from the student tables;
  * the response models are the only places a label is a field, and every one of them is behind Owner, Admin or Sales;
  * the runtime that the agents receive does not carry the education repository.

The same rule is proved with the whole stack in tests/integration/test_cr_education.py (a canary label driven through the assistant, the agents, the outbox, the audit trail and the logs)."""

# ruff: noqa: E501

from __future__ import annotations

import dataclasses
import re
from pathlib import Path

from app.agent_runs.wiring import AgentsRuntime
from app.auth.deps import Runtime

APP = Path(__file__).resolve().parents[1] / "app"
FORBIDDEN = re.compile(r"child_label|admission_no|\bstudents?\b|programme_groups|institution_profiles|PostgrestEducationRepository|\.education\b|app\.education|EducationRepository", re.IGNORECASE)

# the only places that may name a child column or the education repository, and why
ALLOWED = {
    "education/": "the pack itself",
    "main.py": "the wiring (the repository and the router) and the fixed sentences of the pack's refusals",
    "auth/deps.py": "the runtime carries the repository for the routes",
    "integrations/routes_import.py": "the students file of the spreadsheet import (it never echoes a label)",
    "integrations/importer.py": "reading the file",
    "integrations/mapping.py": "which column is which",
    "privacy/housekeeping.py": "the retention step erases students; it reads no label",
    "privacy/repository.py": "the worker's call of that step",
    "privacy/export_builder.py": "the Owner's own data download lists the business's tables, the students included (Owner only, second factor, deleted after 24 hours; ADR 0087): it reads rows as the Owner and names no column",
    "campaigns/models.py": "the ledger filter can name `student` as a party kind: a word, never a label",
    "dues/models.py": "the statement of a student's own ledger account carries a student_id: an id, never a label",
    "logging_safety.py": "route words only",
}


def python_files() -> list[Path]:
    return sorted(p for p in APP.rglob("*.py") if "__pycache__" not in p.parts)


def allowed(rel: str) -> bool:
    return any(rel == a or (a.endswith("/") and rel.startswith(a)) for a in ALLOWED)


def test_no_module_outside_the_doors_can_name_a_child_or_the_education_repository() -> None:
    offenders: dict[str, list[str]] = {}
    for path in python_files():
        rel = path.relative_to(APP).as_posix()
        if allowed(rel):
            continue
        hits = [f"{n}: {line.strip()[:90]}" for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1) if FORBIDDEN.search(line)]
        if hits:
            offenders[rel] = hits[:3]
    assert offenders == {}, f"a module outside the doors names a child column or the education repository: {offenders}"


def test_the_agents_and_the_assistant_hold_no_education_repository() -> None:
    fields = {f.name for f in dataclasses.fields(AgentsRuntime)}
    assert not any("education" in f or "student" in f for f in fields), fields
    # the runtime has the repository (the routes use it); the AGENTS' runtime is a separate object that is built without it
    assert "education" in {f.name for f in dataclasses.fields(Runtime)}


def test_the_agent_and_assistant_packages_never_import_the_education_package() -> None:
    for pkg in ("agents", "assistant", "agent_runs", "leadtools", "requirements", "voice", "voice_notes", "reports", "today", "outbox", "followups", "scheduler", "notifications", "privacy/export_service.py"):
        target = APP / pkg
        files = [target] if target.is_file() else sorted(target.rglob("*.py"))
        for path in files:
            text = path.read_text(encoding="utf-8")
            assert "app.education" not in text and "child_label" not in text, f"{path.relative_to(APP)} reaches the education pack"


def test_the_generic_readers_do_not_select_from_the_student_tables() -> None:
    sql = "\n".join(p.read_text(encoding="utf-8") for p in sorted((APP.parents[2] / "supabase" / "migrations").glob("*.sql")))
    # the functions that build exports, searches, the weekly report, the person's data export and the agents' reads (by name) may not read `public.students`
    readers = re.findall(r"create (?:or replace )?function (?:public|app)\.((?:export|lead_search|weekly_report|data_export|agent_|assistant_|today_|requirement_)[a-z_]*)\(", sql)
    assert readers, "the test finds the readers"
    for name in set(readers):
        for m in re.finditer(rf"create (?:or replace )?function (?:public|app)\.{name}\(", sql):
            body = sql[m.start() : sql.index("\n$$;", m.start()) if "\n$$;" in sql[m.start() :] else m.start() + 6000]
            assert "public.students" not in body and "child_label" not in body, f"{name} reads the student table"


def test_the_response_models_are_the_only_fields_that_carry_a_label() -> None:
    carriers = {p.relative_to(APP).as_posix() for p in python_files() if re.search(r"child_label", p.read_text(encoding="utf-8"))}
    assert carriers <= {"education/models.py", "education/routes.py", "education/repository.py", "integrations/importer.py", "integrations/routes_import.py", "integrations/mapping.py"}, carriers


def test_the_routes_that_return_a_label_are_behind_owner_admin_or_sales() -> None:
    text = (APP / "education" / "routes.py").read_text(encoding="utf-8")
    for fn in re.findall(r"@router\.(?:get|put|post)\([^\n]*\)\ndef (\w+)\(([^)]*)\)", text):
        name, params = fn
        if name in {"get_profile", "list_programmes"}:  # no child in them (a count only)
            assert "Member" in params, name
        else:
            assert "Member" not in params, f"{name} returns a child but is open to a Viewer"
