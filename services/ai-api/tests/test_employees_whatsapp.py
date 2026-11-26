# ruff: noqa: E501
"""AI employees on WhatsApp (26 Nov 2026): the reply is drafted with the answering employee's block and held for the owner when it holds one of the employee's never-say words; flag off: nothing changes."""

from __future__ import annotations

import uuid
from typing import Any

from app.autoreply.drafter import Draft, build_prompt
from app.autoreply.runner import AutoReplyRunner
from tests.test_dy_auto_reply import FakeDrafter, FakeRepo, item

EMPLOYEE: dict[str, Any] = {"id": "e", "name": "Priya", "role_code": "sales", "role_title": "Sales assistant", "responsibilities": ["quote_chase"], "persona_in": "employee", "never_say": ["discount code"],
                            "ask_first": ["send_message", "give_discount"], "autonomy": {}, "extra_instructions": "Ask which fabric first."}


def tenant_item(text: str) -> dict[str, Any]:
    return {**item(text), "tenant_id": str(uuid.uuid4())}


class RepoWithEmployee(FakeRepo):
    def employee(self, token: str, tenant_id: Any) -> dict[str, Any] | None:
        return EMPLOYEE


def test_the_employees_block_reaches_the_prompt_and_its_name_signs_the_reply() -> None:
    drafter = FakeDrafter(Draft("Hello, which fabric?", "en", "Hello.", 0.9, False))
    AutoReplyRunner(RepoWithEmployee([tenant_item("Do you have silk?")]), drafter, employees_on=True).run("tok")
    ctx = drafter.contexts[0]
    assert ctx["assistant_name"] == "Priya" and "YOU ARE Priya, Sales assistant" in ctx["employee"] and "Ask which fabric first." in ctx["employee"]
    assert "send a message" not in ctx["employee"], "a WhatsApp reply IS a message: that line is not said here"
    assert "give a discount" in ctx["employee"]
    system, _ = build_prompt(ctx, "en")
    assert "YOU ARE Priya" in system and system.index("NEVER state a price") < system.index("YOU ARE Priya")


def test_a_reply_with_a_never_say_word_is_held_for_the_owner() -> None:
    repo = RepoWithEmployee([tenant_item("Do you have silk?")])
    AutoReplyRunner(repo, FakeDrafter(Draft("Yes, use the discount code on the page.", "en", "Yes.", 0.9, False)), employees_on=True).run("tok")
    assert repo.submitted and repo.submitted[0][4] is True, "held (needs approval), not sent"
    plain = FakeRepo([tenant_item("Do you have silk?")])
    AutoReplyRunner(plain, FakeDrafter(Draft("Yes, use the discount code on the page.", "en", "Yes.", 0.9, False))).run("tok")
    assert plain.submitted[0][4] is False, "the same reply is sent when no employee forbids the word"


def test_flag_off_the_employee_is_never_read() -> None:
    repo = RepoWithEmployee([tenant_item("Do you have silk?")])
    drafter = FakeDrafter(Draft("Yes, use the discount code on the page.", "en", "Yes.", 0.9, False))
    AutoReplyRunner(repo, drafter).run("tok")
    assert "employee" not in drafter.contexts[0] and repo.submitted[0][4] is False


# ---- a task's calls (26 Nov 2026): the employee a task names does the call, inside its own hours only
def _task_dialer(employee: dict[str, Any] | None, hour: int) -> tuple[Any, Any]:
    from datetime import datetime, timedelta, timezone

    from app.telephony.plivo_tasks import PlivoTaskDialer
    from tests.test_pl_outbound import placer
    from tests.test_pl_tasks import PERSON

    out, repo, api = placer(numbers=frozenset({PERSON}))

    def sleep(_: float) -> None:
        for row in repo.rows.values():
            if row["state"] == "ringing":
                row.update(state="completed", duration_s=70)

    ticks = iter(range(10_000))
    ist = datetime(2026, 11, 10, hour, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    return PlivoTaskDialer(out, repo, sleep=sleep, clock=lambda: float(next(ticks)), employee_for=lambda token, tenant, task: employee, ist_now=lambda: ist), api


def test_a_task_names_its_employee_and_the_call_is_made_by_it_inside_its_hours() -> None:
    from tests.test_pl_tasks import ask

    employee = {"id": str(uuid.uuid4()), "name": "Priya", "hours": {"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": 660, "to_minute": 1140}}
    dialer, api = _task_dialer(employee, 12)
    result = ask(dialer)
    assert result.simulated is False and api.placed, "12:00 is inside 11:00 to 19:00: the call was placed"


def test_outside_the_employees_own_hours_the_call_is_not_made_now() -> None:
    from tests.test_pl_tasks import ask

    employee = {"id": str(uuid.uuid4()), "name": "Priya", "hours": {"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": 660, "to_minute": 1140}}
    dialer, api = _task_dialer(employee, 10)
    result = ask(dialer)
    assert result.outcome == "unclear" and result.category == "call_back_later" and not api.placed, "10:30 is outside 11:00 to 19:00 (the legal window alone would allow it)"


def test_a_task_that_names_no_employee_is_called_as_before() -> None:
    from tests.test_pl_tasks import ask

    dialer, api = _task_dialer(None, 10)
    assert ask(dialer).simulated is False and api.placed
