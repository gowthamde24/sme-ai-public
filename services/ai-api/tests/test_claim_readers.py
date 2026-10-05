# ruff: noqa: E501
"""Every reader of the two claim views, listed (T007 M2 claim-home follow-up).

A claim has ONE home (the company); the lead is provenance (`source_lead_id`). So a SCORE reader must look claims up by the
company (`claims_for_scoring.company_id`, which is the derived home) and never by lead: filtering by lead_id would miss every
claim a lead run stored on the company, and would make two leads of one company see different claims.

This test pins the complete list of readers. A new reader makes it fail, which is the prompt to review it against that rule
(and to add it here). The scoring readers' request parameters are asserted in test_crm_repository.py and
test_leads_queue_repository.py (no lead_id parameter)."""

from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

# module -> what it reads, and why that is allowed
SCORING_READERS = {
    # the single-lead score (leads/routes.py -> crm.list_claims): filter company_id = the lead's company
    "crm/repository.py",
    # the review queue and the label snapshot (batch): filter company_id in (the leads' companies)
    "leads/repository.py",
}
DISPLAY_READERS = {
    # "agent suggestions" on a company page (home_company_id) and on a lead page (about_lead_id), and one claim by id for a review.
    # DISPLAY only: nothing here feeds a score.
    "agent_runs/repository.py",
}


def modules_mentioning(pattern: str) -> set[str]:
    found: set[str] = set()
    for path in APP.rglob("*.py"):
        if re.search(pattern, path.read_text(encoding="utf-8")):
            found.add(path.relative_to(APP).as_posix())
    return found


def test_the_only_modules_that_read_claims_for_scoring_are_the_two_scoring_readers() -> None:
    assert modules_mentioning(r"claims_for_scoring|CLAIMS_FOR_SCORING") == SCORING_READERS


def test_the_only_module_that_reads_claims_effective_is_the_display_reader() -> None:
    assert modules_mentioning(r"claims_effective|CLAIMS_EFFECTIVE") == DISPLAY_READERS


def test_no_module_reads_the_raw_claims_table() -> None:
    # a request path "/claims" (not a view, not a URL path of OUR API such as /companies/{id}/claims)
    raw = modules_mentioning(r"""["']/claims["'?]|f"/\{?[A-Z_]*CLAIMS\}?"\s*[,)]""")
    assert raw == set(), raw


def test_the_scoring_readers_filter_by_company_never_by_lead() -> None:
    for module in sorted(SCORING_READERS):
        source = (APP / module).read_text(encoding="utf-8")
        # find each request to the scoring view and the parameter block that follows it
        for match in re.finditer(r"CLAIMS_FOR_SCORING\}", source):
            block = source[match.end() : match.end() + 700]
            block = block.split("evidence", 1)[0]
            assert '"company_id"' in block, (module, "a scoring read must filter by company_id")
            assert '"lead_id"' not in block, (module, "a scoring read must not filter by lead_id")
