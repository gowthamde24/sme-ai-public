"""WhatsApp's decision on our templates, read by the worker (20 Nov 2026): the right word for every Meta status, a template Meta does not list yet stays submitted, one call per account, Meta silent = nothing changes,
a missing token skips the account, nothing about a token is logged, off by default."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

import pytest

from app.config import Settings
from app.whatsapp import status_sync as ss


class FakeRpc:
    def __init__(self, due: list[dict[str, Any]], changed: int = 1) -> None:
        self.due, self.changed = due, changed
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, args))
        return self.due

    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((function, args))
        return {"changed": self.changed}


class FakeGraph:
    def __init__(self, theirs: list[dict[str, Any]] | None) -> None:
        self.theirs, self.asked = theirs, []   # type: ignore[var-annotated]

    def list_templates(self, waba_id: str, token: str) -> list[dict[str, Any]] | None:
        self.asked.append((waba_id, token))
        return self.theirs


class FakeTokens:
    def __init__(self, tokens: dict[str, str]) -> None:
        self.tokens = tokens

    def get(self, ref: str) -> str | None:
        return self.tokens.get(ref)


def account(*templates: dict[str, Any]) -> dict[str, Any]:
    return {"tenant_id": "11111111-1111-4111-8111-111111111111", "waba_id": "100000000000777", "token_ref": "default", "templates": list(templates)}


T1 = {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "visit_invite", "meta_name": None, "language": "en"}
T2 = {"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": "visit_reminder", "meta_name": "visit_reminder_v2", "language": "te"}
T3 = {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "name": "order_ready", "meta_name": None, "language": "en"}


def test_every_meta_status_becomes_our_word_and_a_meta_name_is_the_one_asked_about() -> None:
    theirs = [{"name": "visit_invite", "language": "en_US", "status": "APPROVED"}, {"name": "visit_reminder_v2", "language": "te", "status": "REJECTED", "rejected_reason": "INVALID_FORMAT"},
              {"name": "order_ready", "language": "en", "status": "PAUSED", "rejected_reason": "NONE"}]
    got = {d["id"]: d for d in ss.decisions([T1, T2, T3], theirs)}
    assert got[T1["id"]] == {"id": T1["id"], "status": "approved", "reject_code": None}
    assert got[T2["id"]] == {"id": T2["id"], "status": "rejected", "reject_code": "INVALID_FORMAT"}
    assert got[T3["id"]]["status"] == "paused" and got[T3["id"]]["reject_code"] is None, "Meta's 'NONE' is no reason"


def test_a_template_meta_does_not_list_yet_stays_submitted_and_a_prose_reason_is_never_kept() -> None:
    got = ss.decisions([T1], [])
    assert got == [{"id": T1["id"], "status": "submitted", "reject_code": None}]
    prose = ss.decisions([T1], [{"name": "visit_invite", "language": "en", "status": "REJECTED", "rejected_reason": "Your template was rejected because it has a price in it"}])
    assert prose[0]["status"] == "rejected" and prose[0]["reject_code"] is None


def test_one_call_per_account_with_the_decisions_and_the_count_of_changes() -> None:
    rpc = FakeRpc([account(T1, T2)], changed=2)
    graph = FakeGraph([{"name": "visit_invite", "language": "en", "status": "APPROVED"}])
    assert ss.TemplateStatusSync(graph, FakeTokens({"default": "tok"}), rpc).run("sched") == 2
    assert graph.asked == [("100000000000777", "tok")]
    assert [c[0] for c in rpc.calls] == ["scheduler_wa_templates_due", "scheduler_wa_templates_decided"]
    assert len(rpc.calls[1][1]["p_decisions"]) == 2


def test_meta_silent_or_no_token_changes_nothing_and_nothing_stops() -> None:
    rpc = FakeRpc([account(T1)])
    assert ss.TemplateStatusSync(FakeGraph(None), FakeTokens({"default": "tok"}), rpc).run("s") == 0 and [c[0] for c in rpc.calls] == ["scheduler_wa_templates_due"]
    rpc2 = FakeRpc([account(T1)])
    assert ss.TemplateStatusSync(FakeGraph([]), FakeTokens({}), rpc2).run("s") == 0 and [c[0] for c in rpc2.calls] == ["scheduler_wa_templates_due"]
    assert ss.TemplateStatusSync(FakeGraph([]), FakeTokens({}), FakeRpc([])).run("s") == 0


def test_no_token_reaches_the_log(caplog: pytest.LogCaptureFixture) -> None:
    rpc = FakeRpc([account(T1)])
    with caplog.at_level(logging.DEBUG):
        ss.TemplateStatusSync(FakeGraph([{"name": "visit_invite", "language": "en", "status": "APPROVED"}]), FakeTokens({"default": "marker-9Zk-not-for-logs"}), rpc).run("s")
    assert "marker-9Zk-not-for-logs" not in caplog.text


def test_it_is_off_by_default() -> None:
    assert ss.build_template_sync(Settings(_env_file=None, api_env="development"), "http://x", "k") is None   # type: ignore[call-arg]
    assert ss.build_template_sync(Settings(_env_file=None, api_env="development", template_sync=True), "http://x", "k") is not None   # type: ignore[call-arg]
