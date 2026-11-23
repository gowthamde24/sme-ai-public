"""T008 commit 3c on the real stack: TWO database connections racing on one enquiry (ADR 0018, "lock order").

One lock order everywhere: the enquiry row, then the requirement row. The tests make a race DETERMINISTIC instead of hoping for one: a
psql session in the database container runs a decision in an open transaction and sleeps before it commits (so it HOLDS its locks); a second
connection (PostgREST, as the real client) then does the competing write. The second must wait for the first and then be refused:

  * confirm  vs  add_requirement_field            -> SM208, and the confirmed requirement gained no field
  * confirm  vs  an agent write                   -> SM208, same
  * confirm  vs  a re-run's first write           -> SM208, same
  * a person's decision  vs  a re-run's first write -> SM211, and the person's decision is still in the active draft

A last test lets five competing operations run at once for several rounds and checks the outcome set: no deadlock or serialization failure,
at most one active requirement, a re-run never overwrites a person's work, a confirmed requirement is confirmable.
All text is synthetic."""

# ruff: noqa: E501, F811, S608, S603

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import User
from crm_support import World
from evidence_support import code_of, pg
from test_agent_direct_postgrest import rpc
from test_requirement_direct_postgrest import BODY, capture, on, start, write  # noqa: F401

HOLD_SECONDS = 4.0


# ------------------------------------------------------------------------------ a transaction that holds its locks
class Held:
    """A psql session that runs `statement` as `user` inside an open transaction and sleeps before committing."""

    def __init__(self, user: User, statement: str) -> None:
        docker = shutil.which("docker")
        assert docker is not None, "docker is required for the integration tests"
        self.marker = f"hold-{uuid.uuid4().hex}"
        claims = json.dumps({"sub": str(user.id), "role": "authenticated", "aal": "aal2"})
        script = (
            # the marker comes FIRST: pg_stat_activity.query is cut at 1,024 characters, and a quote's request text alone is longer
            f"/* {self.marker} */ begin; select set_config('request.jwt.claims', '{claims}', true); set local role authenticated; "
            f"{statement}; select pg_sleep({HOLD_SECONDS}); commit;"
        )
        self.proc = subprocess.Popen(
            [docker, "exec", "-i", operator_sql.container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )  # fmt: skip

    def holding(self) -> None:
        """Wait until the session is inside its sleep: its statement ran and its locks are held."""
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                pytest.fail(f"the holding session ended early: {self.proc.communicate()}")
            held = operator_sql.sql(
                f"select count(*) from pg_stat_activity where query like '%{self.marker}%' and wait_event = 'PgSleep' and pid <> pg_backend_pid()"
            )
            if held.strip() == "1":
                return
            time.sleep(0.1)
        pytest.fail("the holding session never reached its sleep")

    def finish(self) -> str:
        out, err = self.proc.communicate(timeout=60)
        assert self.proc.returncode == 0, err
        return out


# ------------------------------------------------------------------------------ a draft a person could confirm
class Draft:
    def __init__(self, on: World, rerun: bool = False) -> None:
        self.on, self.sales = on, on.a.users["sales"]
        self.eid = capture(on, on.a)
        self.run = self._start()
        q = "Need  20 kanjivaram   sarees"
        s = BODY.index(q)
        w1 = write(
            on,
            self.sales,
            self.run,
            "f1",
            1,
            "quantity",
            q,
            (s, s + len(q)),
            value_int=20,
            basis="piece",
        )
        assert w1.status_code == 200, w1.text
        k = BODY.index("kanjivaram")
        w2 = write(
            on,
            self.sales,
            self.run,
            "f2",
            1,
            "saree_type",
            "kanjivaram",
            (k, k + 10),
            value_code="kanjivaram",
        )
        assert w2.status_code == 200, w2.text
        self.requirement = str(w1.json()["requirement_id"])
        self.quantity, self.type = str(w1.json()["field_id"]), str(w2.json()["field_id"])
        # a second run, started while the draft holds proposals only (that is allowed)
        self.run2 = self._start() if rerun else ""

    def _start(self) -> str:
        r = start(self.on, self.sales, self.on.a, self.eid)
        assert r.status_code == 200, r.text
        return str(r.json()["run_id"])

    def decide(self, field: str, decision: str = "confirm", **value: Any) -> httpx.Response:
        return rpc(
            self.on,
            self.sales,
            "decide_requirement_field",
            p_field_id=field,
            p_decision=decision,
            **{f"p_{k}": v for k, v in value.items()},
        )

    def confirm_both(self) -> None:
        for field in (self.quantity, self.type):
            r = self.decide(field)
            assert r.status_code == 200 and r.json()["state"] == "confirmed", r.text

    def competing_write(self, run: str | None = None) -> httpx.Response:
        """An agent write of a field the draft does not have yet (the quote is the text's first word; the database does not read meaning into it)."""
        return write(
            self.on,
            self.sales,
            run or self.run,
            "late",
            1,
            "colour",
            "Hello,",
            (0, 6),
            value_code="red",
        )

    def add_field(self) -> httpx.Response:
        return rpc(
            self.on,
            self.sales,
            "add_requirement_field",
            p_enquiry_id=self.eid,
            p_line=None,
            p_key="delivery_city",
            p_value_text="Hyderabad",
        )

    def requirements(self) -> list[dict[str, Any]]:
        return list(
            pg(
                self.on.stack,
                self.sales,
                "GET",
                f"/requirements?enquiry_id=eq.{self.eid}&select=id,status,agent_run_id,created_via",
            ).json()
        )

    def field_keys(self, requirement: str) -> set[tuple[str, str, str]]:
        rows = pg(
            self.on.stack,
            self.sales,
            "GET",
            f"/requirement_fields?requirement_id=eq.{requirement}&select=field_key,state,created_via",
        ).json()
        return {(r["field_key"], r["state"], r["created_via"]) for r in rows}

    def cleanup(self) -> None:
        for run in (self.run, self.run2):
            if run:
                rpc(self.on, self.on.a.users["owner"], "cancel_agent_run", p_run_id=run)


@pytest.fixture
def draft(on: World) -> Any:
    d = Draft(on, rerun=True)
    yield d
    d.cleanup()


def _timed(action: Callable[[], httpx.Response]) -> tuple[httpx.Response, float]:
    begun = time.monotonic()
    response = action()
    return response, time.monotonic() - begun


# ------------------------------------------------------------------------------ the deterministic races
def _race_a_confirm(
    d: Draft, competitor: Callable[[], httpx.Response]
) -> tuple[httpx.Response, float, set[tuple[str, str, str]]]:
    """Hold a confirm open; run the competitor; return its answer, how long it waited, and the confirmed requirement's fields before."""
    d.confirm_both()
    before = d.field_keys(d.requirement)
    held = Held(d.sales, f"select public.confirm_requirement('{d.requirement}')")
    held.holding()
    response, waited = _timed(competitor)
    assert '"confirmed"' in held.finish(), "the held confirm did not commit"
    return response, waited, before


def _assert_confirmed_and_untouched(d: Draft, before: set[tuple[str, str, str]]) -> None:
    reqs = {r["id"]: r for r in d.requirements()}
    assert reqs[d.requirement]["status"] == "confirmed"
    assert d.field_keys(d.requirement) == before, (
        "a field appeared in (or vanished from) a requirement after its confirmation"
    )
    assert sum(1 for r in reqs.values() if r["status"] in ("draft", "confirmed")) == 1, (
        "more than one active requirement"
    )


def test_confirm_versus_add_requirement_field(draft: Draft) -> None:
    response, waited, before = _race_a_confirm(draft, draft.add_field)
    assert code_of(response) == "SM208", response.text
    assert waited > 1.5, "the add did not wait for the confirm: the enquiry lock is missing"
    _assert_confirmed_and_untouched(draft, before)


def test_confirm_versus_an_agent_write(draft: Draft) -> None:
    response, waited, before = _race_a_confirm(draft, draft.competing_write)
    assert code_of(response) == "SM208", response.text
    assert waited > 1.5, "the agent write did not wait for the confirm: the enquiry lock is missing"
    _assert_confirmed_and_untouched(draft, before)


def test_confirm_versus_a_rerun(draft: Draft) -> None:
    response, waited, before = _race_a_confirm(draft, lambda: draft.competing_write(draft.run2))
    assert code_of(response) == "SM208", response.text
    assert waited > 1.5, (
        "the re-run's first write did not wait for the confirm: the enquiry lock is missing"
    )
    _assert_confirmed_and_untouched(draft, before)
    assert not [r for r in draft.requirements() if r["agent_run_id"] == draft.run2], (
        "the re-run left a requirement behind"
    )


def test_confirm_versus_discard_is_one_or_the_other(draft: Draft) -> None:
    """A discard that races a held confirm waits for it, then discards the CONFIRMED requirement (a person's choice): never half of each."""
    draft.confirm_both()
    held = Held(draft.sales, f"select public.confirm_requirement('{draft.requirement}')")
    held.holding()
    response, waited = _timed(
        lambda: rpc(
            draft.on, draft.sales, "discard_requirement", p_requirement_id=draft.requirement
        )
    )
    held.finish()
    assert response.status_code == 200 and response.json()["status"] == "discarded", response.text
    assert waited > 1.5, "the discard did not wait for the confirm: the enquiry lock is missing"
    assert {r["status"] for r in draft.requirements()} == {"discarded"}


def test_a_decision_versus_a_reruns_first_write(draft: Draft) -> None:
    """A person's decision that has not committed yet is waited for, and then seen: the re-run is refused (SM211), the decision survives."""
    held = Held(draft.sales, f"select public.decide_requirement_field('{draft.type}', 'confirm')")
    held.holding()
    response, waited = _timed(lambda: draft.competing_write(draft.run2))
    held.finish()
    assert code_of(response) == "SM211", response.text
    assert waited > 1.5, (
        "the re-run's first write did not wait for the decision: the draft lock is missing"
    )
    reqs = draft.requirements()
    assert [r["status"] for r in reqs] == ["draft"] and reqs[0]["id"] == draft.requirement, (
        "the person's draft was replaced"
    )
    assert ("saree_type", "confirmed", "agent") in draft.field_keys(draft.requirement)


def test_a_decision_versus_an_agent_write_of_the_same_run(draft: Draft) -> None:
    """The run's OWN later write is not a re-run: it waits for the decision and then succeeds (the person's work is not touched)."""
    held = Held(draft.sales, f"select public.decide_requirement_field('{draft.type}', 'confirm')")
    held.holding()
    response, waited = _timed(draft.competing_write)
    held.finish()
    assert response.status_code == 200, response.text
    assert waited > 1.5
    assert ("saree_type", "confirmed", "agent") in draft.field_keys(draft.requirement)
    assert ("colour", "proposed", "agent") in draft.field_keys(draft.requirement)


# ------------------------------------------------------------------------------ the lock order itself
def _row_is_locked(table: str, row_id: str) -> bool:
    """Is the row locked by another transaction? (`for update nowait` as the operator: it fails at once when someone holds the row.)"""
    docker = shutil.which("docker")
    assert docker is not None
    r = subprocess.run(
        [docker, "exec", "-i", operator_sql.container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c", f"select 1 from public.{table} where id = '{row_id}' for update nowait"],
        capture_output=True,
        text=True,
    )  # fmt: skip
    if r.returncode == 0:
        return False
    assert "could not obtain lock" in r.stderr, r.stderr
    return True


@pytest.mark.parametrize(
    ("writer", "enquiry_locked", "requirement_locked"),
    [
        ("confirm", True, True),
        ("discard", True, True),
        ("add_field", True, True),
        ("agent_write", True, True),
        (
            "decide",
            False,
            True,
        ),  # decide_requirement_field never takes the enquiry lock: that is what keeps the order cycle-free
    ],
)
def test_every_writer_takes_the_enquiry_row_then_the_requirement_row(
    draft: Draft, writer: str, enquiry_locked: bool, requirement_locked: bool
) -> None:
    statements = {
        "confirm": f"select public.confirm_requirement('{draft.requirement}')",
        "discard": f"select public.discard_requirement('{draft.requirement}')",
        "add_field": f"select public.add_requirement_field(p_enquiry_id => '{draft.eid}', p_line => null, p_key => 'delivery_city', p_value_text => 'Hyderabad')",
        "agent_write": f"select public.agent_write_requirement_field('{draft.run}', 'probe', 1::smallint, 'colour', 'red', null, null, null, null, 'stated', 'Hello,', 0, 6, false)",
        "decide": f"select public.decide_requirement_field('{draft.type}', 'confirm')",
    }
    if writer in ("confirm", "discard"):
        draft.confirm_both()
    held = Held(draft.sales, statements[writer])
    held.holding()
    try:
        assert _row_is_locked("enquiries", draft.eid) is enquiry_locked, (
            f"{writer}: the enquiry row lock"
        )
        assert _row_is_locked("requirements", draft.requirement) is requirement_locked, (
            f"{writer}: the requirement row lock"
        )
    finally:
        held.finish()


# ------------------------------------------------------------------------------ everything at once
ROUNDS = 8
ALLOWED = {"SM208", "SM209", "SM210", "SM211", "23514"}


def _one_round(on: World, round_no: int) -> None:
    d = Draft(on, rerun=True)
    try:
        d.confirm_both()
        confirm = lambda: rpc(on, d.sales, "confirm_requirement", p_requirement_id=d.requirement)  # noqa: E731
        discard = lambda: rpc(on, d.sales, "discard_requirement", p_requirement_id=d.requirement)  # noqa: E731
        correct = lambda: d.decide(d.quantity, "correct", value_int=25, basis="piece")  # noqa: E731
        actions: list[Callable[[], httpx.Response]] = [
            confirm,
            d.add_field,
            lambda: d.competing_write(d.run2),
            d.competing_write,
            correct if round_no % 2 else discard,
        ]
        barrier = threading.Barrier(len(actions))

        def go(action: Callable[[], httpx.Response]) -> httpx.Response:
            barrier.wait(timeout=10)
            return action()

        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            responses = [f.result(timeout=90) for f in [pool.submit(go, a) for a in actions]]
        for r in responses:
            assert r.status_code < 500, r.text
            assert code_of(r) not in ("40P01", "40001"), (
                f"deadlock or serialization failure: {r.text}"
            )
            assert r.status_code == 200 or code_of(r) in ALLOWED, r.text
        reqs = d.requirements()
        assert sum(1 for r in reqs if r["status"] in ("draft", "confirmed")) <= 1, reqs
        # both fields were confirmed before the race: the re-run may write only after a person DISCARDED the draft
        by_id = {r["id"]: r for r in reqs}
        if [r for r in reqs if r["agent_run_id"] == d.run2]:
            assert by_id[d.requirement]["status"] == "discarded", (
                "a re-run overwrote a person's draft"
            )
        for req in reqs:
            if req["status"] == "confirmed":
                settled = {k: st for k, st, _ in d.field_keys(req["id"])}
                assert settled["saree_type"] in ("confirmed", "corrected") and settled[
                    "quantity"
                ] in ("confirmed", "corrected"), "confirmed without a person's type and quantity"
    finally:
        d.cleanup()


def test_five_competing_operations_never_deadlock_or_overwrite_a_person(on: World) -> None:
    for round_no in range(ROUNDS):
        _one_round(on, round_no)
