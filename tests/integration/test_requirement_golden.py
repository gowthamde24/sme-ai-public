"""`make eval` (requirement golden set): 20 synthetic enquiries with a known answer, run through the scripted requirement model, the real local
stack and the real decision functions, with a careful reviewer script. Prints the report; FAILS on any field proposed as `stated` that is wrong
or that nobody asked for, on any containment invariant, and on any change of the committed report that was not made on purpose
(`UPDATE_GOLDEN=1 make eval`). See requirement_golden.py."""

# ruff: noqa: E501

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import agent_eval as ev
import pytest
import requirement_eval as rq
import requirement_golden as gr
from requirement_eval import Ctx
from test_requirement_evals import (
    ctx,  # noqa: F401  (the module fixture: agents on, the requirement agent enabled)
)

from app.agents import runtime
from app.agents.db import AgentDb
from app.agents.llm.fake import FakeProvider
from app.agents.llm.fake_requirement import requirement_script
from app.agents.registry import AGENTS
from app.enquiries.repository import PostgrestEnquiriesRepository
from app.enquiries.service import build_view

ENQUIRIES = gr.load_enquiries()
REPORT_FILE = rq.EVALS / "golden-report.txt"
THRESHOLDS = json.loads((rq.EVALS / "golden-thresholds.json").read_text())
REQUIREMENT = AGENTS["requirement"]


def run_one(c: Ctx, enquiry: dict[str, Any]) -> tuple[gr.Review, list[str]]:
    w = c.w
    eid, body = c.capture(w.a, enquiry["text"], received_at=enquiry["received_at"])
    run_id = c.start(w.a, eid)
    before_a, before_b = (
        ev.snapshot(w.a.id, run_id, rq.SCOPE),
        ev.snapshot(w.b.id, rq.RUN_NONE, rq.SCOPE),
    )
    provider = FakeProvider(requirement_script())
    db = AgentDb(
        w.stack.rest,
        w.stack.anon_key,
        c.sales.token,
        uuid.UUID(run_id),
        claim_predicate=REQUIREMENT.claim_predicate,
    )
    try:
        result = runtime.AgentRunner(db=db, llm=provider, spec=REQUIREMENT).run()
    finally:
        db.close()
    violations = (
        []
        if result.status == "succeeded"
        else [f"the run ended {ev.outcome_text(result.status, result.error_code, run_id)}"]
    )
    violations += rq.request_violations(provider)
    violations += rq.check_invariants(
        tenant_a=w.a.id,
        tenant_b=w.b.id,
        run_id=run_id,
        enquiry_id=eid,
        body=body,
        before_a=before_a,
        before_b=before_b,
    )
    review = gr.classify(enquiry, rq.field_rows(w.a.id, eid))
    repo = PostgrestEnquiriesRepository(w.stack.rest, w.stack.anon_key)
    token = c.sales.token
    for field_id, decision, typed in review.actions:
        value = (
            {
                "value_code": typed["code"],
                "value_int": typed["int"],
                "value_date": typed["date"],
                "value_text": typed["text"],
                "basis": typed["basis"],
            }
            if decision == "correct"
            else {}
        )
        repo.decide(token, uuid.UUID(field_id), decision, value)
        review.confirmed += decision == "confirm"
        review.corrected += decision == "correct"
        review.rejected += decision == "reject"
    requirement, rows = repo.get_requirement(token, uuid.UUID(w.a.id), uuid.UUID(eid))
    view = build_view(requirement, rows)
    review.confirmable, review.ready = view.confirmable, view.ready_for_quote
    review.questions = [
        q.code if q.line_no is None else f"{q.code}@{q.line_no}" for q in view.questions
    ]
    review.view = view  # type: ignore[attr-defined]
    c.cancel(run_id)
    return review, violations


@pytest.fixture(scope="module")
def report(ctx: Ctx) -> tuple[list[gr.Review], dict[str, list[str]]]:  # noqa: F811
    reviews: list[gr.Review] = []
    violations: dict[str, list[str]] = {}
    for enquiry in ENQUIRIES:
        review, bad = run_one(ctx, enquiry)
        reviews.append(review)
        if bad:
            violations[enquiry["id"]] = bad
    text = gr.render(reviews)
    print("\n" + text)
    return reviews, violations


def totals(reviews: list[gr.Review]) -> gr.Counts:
    total = gr.Counts()
    for r in reviews:
        for c in r.by_key.values():
            total.add(c)
    return total


def review_of(reviews: list[gr.Review], enquiry_id: str) -> gr.Review:
    return next(r for r in reviews if r.id == enquiry_id)


def test_the_golden_set_is_twenty_enquiries_with_the_hard_cases() -> None:
    assert len(ENQUIRIES) == 20 and len({e["id"] for e in ENQUIRIES}) == 20
    titles = " ".join(e["title"] for e in ENQUIRIES)
    for needed in (
        "Hinglish",
        "festival",
        "conflict",
        "forwarded",
        "signature",
        "nothing usable",
        "injected",
        "Kannada",
        "unrelated",
        "dozens",
        "range",
        "two lines",
        "per-piece",
        "words",
    ):
        assert needed.lower() in titles.lower(), needed
    assert sum(1 for e in ENQUIRIES if not e["expected"]) >= 2  # abstention is part of the answer


def test_THE_GATE_not_one_stated_field_is_wrong_or_unasked_for(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    reviews, _ = report
    bad = [(r.id, n) for r in reviews for n in r.notes if "(STATED)" in n]
    assert not bad, f"fields proposed as `stated` that are wrong or that nobody asked for: {bad}"
    t = totals(reviews)
    assert (
        (t.wrong_stated, t.extra_stated)
        == (0, 0)
        == (THRESHOLDS["max_wrong_stated"], THRESHOLDS["max_extra_stated"])
    )


def test_no_enquiry_broke_a_containment_invariant_and_every_quote_is_at_its_offsets(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    _, violations = report
    assert violations == {}, violations


def test_the_agent_still_gets_the_answers_it_used_to(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    t = totals(report[0])
    assert t.matched >= THRESHOLDS["min_matched"], (
        f"matched {t.matched} < {THRESHOLDS['min_matched']}"
    )
    assert t.missed <= THRESHOLDS["max_missed"], f"missed {t.missed} > {THRESHOLDS['max_missed']}"


def test_the_hard_cases_are_handled_as_designed(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    reviews, _ = report

    def g(i: str) -> gr.Review:
        return review_of(reviews, i)

    # a festival is not a date: no deadline is proposed, and a question asks for it
    assert "deadline" not in {
        n.split(":")[1].strip() for n in g("G07").notes if "extra" in n or "matched" in n
    }
    assert any(q.startswith("missing_deadline") for q in g("G07").questions)
    # an injected quantity never becomes the quantity
    assert not any("1000000" in n for n in g("G14").notes) and any(
        "quantity: matched" in n for n in g("G14").notes
    )
    # nothing usable and an unrelated message: nothing proposed, nothing to approve
    for i in ("G13", "G16"):
        assert g(i).by_key == {} or all(c.proposed == 0 for c in g(i).by_key.values())
        assert g(i).confirmable is False
    # two deadlines that conflict are flagged, and a person decides
    assert any("deadline" in n and "flagged" in n for n in g("G10").notes)
    # a quoted old mail is not the order
    assert not any("extra" in n for n in g("G11").notes) and any(
        "quantity" in n and "matched" in n for n in g("G11").notes
    )
    # a total budget without a stated basis is flagged, not asserted
    assert any("budget: matched (flagged)" in n for n in g("G08").notes)
    # a range is flagged, never a stated quantity
    assert not any("quantity" in n and "(STATED)" in n for n in g("G18").notes)
    # an order that has everything a quote needs ends ready for a quote once a person approved it
    assert g("G20").confirmable and g("G20").ready and g("G20").questions == []
    assert g("G01").confirmable and g("G01").ready


def test_the_requirement_view_after_review_matches_the_answer_for_what_was_found(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    for r in report[0]:
        view: Any = r.view  # type: ignore[attr-defined]
        for f in view.fields:
            assert f.state in ("confirmed", "corrected", "rejected"), (
                r.id,
                f.field_key,
            )  # the reviewer decided every proposal
        # a field is never "ready" unless a person approved the needed ones
        assert not view.ready_for_quote or view.confirmable


def test_the_report_is_what_was_committed(
    report: tuple[list[gr.Review], dict[str, list[str]]],
) -> None:
    text = gr.render(report[0])
    if os.environ.get("UPDATE_GOLDEN") == "1":
        REPORT_FILE.write_text(text, encoding="utf-8")
    assert REPORT_FILE.read_text(encoding="utf-8") == text, (
        "the golden report changed: read it, and if the change is wanted run `UPDATE_GOLDEN=1 make eval`"
    )


# ---- the gate and the reviewer can FAIL (offline: no database)
def test_the_gate_sees_a_wrong_stated_field_and_an_extra_stated_one() -> None:
    enquiry = {
        "id": "GX",
        "title": "t",
        "expected": [{"line": 1, "key": "quantity", "int": 20, "basis": "piece"}],
    }
    wrong = {
        "id": "f1",
        "line_no": 1,
        "field_key": "quantity",
        "value_code": None,
        "value_int": 21,
        "value_date": None,
        "value_text": None,
        "basis": "piece",
        "certainty": "stated",
        "conflict": False,
    }
    extra = {
        "id": "f2",
        "line_no": None,
        "field_key": "budget",
        "value_code": None,
        "value_int": 100,
        "value_date": None,
        "value_text": None,
        "basis": "total",
        "certainty": "stated",
        "conflict": False,
    }
    review = gr.classify(enquiry, [wrong, extra])
    assert review.by_key["quantity"].wrong_stated == 1 and review.by_key["budget"].extra_stated == 1
    assert [a[1] for a in review.actions] == [
        "reject",
        "correct",
    ]  # in slot order: the order-level budget first
    flagged = gr.classify(
        enquiry, [{**wrong, "certainty": "ambiguous"}, {**extra, "conflict": True}]
    )
    assert (
        flagged.by_key["quantity"].wrong_flagged == 1
        and flagged.by_key["budget"].extra_flagged == 1
        and flagged.by_key["quantity"].wrong_stated == 0
    )


def test_the_reviewer_confirms_what_is_right_and_leaves_what_is_missing() -> None:
    enquiry = {
        "id": "GY",
        "title": "t",
        "expected": [
            {"line": 1, "key": "quantity", "int": 20, "basis": "piece"},
            {"key": "delivery_city", "text": "Pune"},
        ],
    }
    right = {
        "id": "f1",
        "line_no": 1,
        "field_key": "quantity",
        "value_code": None,
        "value_int": 20,
        "value_date": None,
        "value_text": None,
        "basis": "piece",
        "certainty": "implied",
        "conflict": False,
    }
    review = gr.classify(enquiry, [right])
    assert review.actions == [("f1", "confirm", {})]
    assert (
        review.by_key["quantity"].matched == 1
        and review.by_key["quantity"].matched_flagged == 1
        and review.by_key["delivery_city"].missed == 1
    )
    city = {
        **right,
        "id": "f3",
        "line_no": None,
        "field_key": "delivery_city",
        "value_int": None,
        "basis": None,
        "value_text": "  pune ",
        "certainty": "stated",
    }
    assert (
        gr.classify(enquiry, [right, city]).by_key["delivery_city"].matched == 1
    )  # whitespace and case do not matter for a city
