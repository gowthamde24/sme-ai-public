"""Describe the job in your own words (docs/contracts/jobs-describe.md): a draft only, checked by code against the real catalogue, the sentence treated as data and never stored, 30 a day. A scripted model stands in for the real one."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.jobs.describe import catalogue_facts, check, nearest, words_for
from app.jobs.wiring import JobsRuntime
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import TENANT_A, auth, make_client
from tests.test_jobs_s2a_routes import FakePacks

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
URL = f"/v1/tenants/{TENANT_A.id}/jobs/describe"
HOURS = "2026-11-19T12:00:00+00:00"


def world(*answers: Any, cap: Any = None) -> tuple[Any, Scripted, FakeTurnDb, Any]:
    llm = Scripted(*answers)
    db = FakeTurnDb()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, jobs=JobsRuntime(directory=PACKS), packs=FakePacks())  # type: ignore[arg-type]
    runtime = client.app.state.runtime
    if cap is not None:
        object.__setattr__(runtime, "daily_cap", cap)
    return client, llm, db, runtime


def a_template() -> tuple[dict[str, str], dict[str, Any]]:
    from app.jobs import packdata, templates

    own = packdata.for_pack("textiles", PACKS)
    assert own is not None
    shown = templates.pack_jobs_out(own, get_paid=False).templates
    items, kinds = catalogue_facts(list(shown))
    item = next(i for i in items if kinds.get(i["kind"]))
    return item, kinds


def test_the_catalogue_given_to_the_model_is_closed() -> None:
    item, kinds = a_template()
    assert item["id"] and item["kind"] in kinds and all(isinstance(v, (list, str)) for v in kinds[item["kind"]].values())


def test_check_keeps_only_what_the_catalogue_allows(caplog: pytest.LogCaptureFixture) -> None:
    from app.jobs.catalogue import CATALOGUE

    item, _ = a_template()
    specs = CATALOGUE[item["kind"]]
    choice = next(s for s in specs if s.type == "choice" and s.options)
    caplog.set_level(logging.INFO, logger="app.jobs.describe")
    draft = check({"template_id": item["id"], "settings": [{"key": choice.key, "value": choice.options[0]}, {"key": "invented_key", "value": "x"}, {"key": choice.key, "value": "not-an-option"}], "unclear": [choice.key, "also_invented"]}, [item], "text")
    assert draft["understood"] is True and draft["template_id"] == item["id"] and draft["kind"] == item["kind"]
    assert draft["fields"] == [{"key": choice.key, "value": choice.options[0]}]
    assert draft["unclear"] == []   # the key was settled by its first, valid entry; invented ones never get in
    assert "describe_dropped_key" in caplog.text


def test_unclear_keys_are_kept_when_the_model_could_not_settle_them(caplog: pytest.LogCaptureFixture) -> None:
    from app.jobs.catalogue import CATALOGUE

    item, _ = a_template()
    choice = next(s for s in CATALOGUE[item["kind"]] if s.type == "choice")
    caplog.set_level(logging.INFO, logger="app.jobs.describe")
    draft = check({"template_id": item["id"], "settings": [], "unclear": [choice.key]}, [item], "x")
    assert draft["unclear"] == [choice.key] and "describe_unclear" in caplog.text


def test_an_unknown_template_is_not_understood_and_the_three_nearest_come_back() -> None:
    items = [{"id": "a", "kind": "k", "goal": "g", "title": "Call new customers fast"}, {"id": "b", "kind": "k", "goal": "g", "title": "Remind about payments"}, {"id": "c", "kind": "k", "goal": "g", "title": "Follow up quotes"}, {"id": "d", "kind": "k", "goal": "g", "title": "Visit booking"}]
    draft = check({"template_id": "invented", "settings": [{"key": "x", "value": "y"}], "unclear": []}, items, "please remind about payments")
    assert draft["understood"] is False and draft["fields"] == [] and draft["template_id"] is None
    assert draft["nearest"][0] == "b" and len(draft["nearest"]) == 3
    assert check(None, items, "x")["understood"] is False
    assert nearest("", items)[:1] == ["a"]


def test_a_toggle_accepts_words_and_booleans_only() -> None:
    from app.jobs.catalogue import CATALOGUE

    kind = next(k for k, specs in CATALOGUE.items() if any(s.type == "toggle" for s in specs))
    key = next(s.key for s in CATALOGUE[kind] if s.type == "toggle")
    item = {"id": "t", "kind": kind, "goal": "g", "title": "x"}
    ok = check({"template_id": "t", "settings": [{"key": key, "value": "on"}], "unclear": []}, [item], "x")
    assert ok["fields"] == [{"key": key, "value": True}]
    bad = check({"template_id": "t", "settings": [{"key": key, "value": "maybe"}], "unclear": []}, [item], "x")
    assert bad["fields"] == [] and bad["unclear"] == [key]
    assert words_for({"key": key, "value": True}).endswith(": on") and words_for({"key": "gap_days", "value": "days_3"}) == "Gap days: days 3"


def test_the_route_returns_a_draft_and_never_stores_the_sentence() -> None:
    item, _ = a_template()
    from app.jobs.catalogue import CATALOGUE

    choice = next(s for s in CATALOGUE[item["kind"]] if s.type == "choice" and s.options)
    client, llm, db, _ = world({"template_id": item["id"], "settings": [{"key": choice.key, "value": choice.options[0]}], "unclear": []})
    sentence = "Call every new customer quickly, my secret phrase is 9876543210"
    r = client.post(URL, json={"text": sentence, "language": "en", "source": "typed"}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["understood"] is True and out["fields"][0]["key"] == choice.key and out["fields"][0]["words"]
    request = llm.requests[0]
    sent = " ".join(b.text for b in request.blocks)
    assert sentence in sent and "<<<DATA" in sent and "DATA" in sent   # the sentence goes to the model as DATA, between delimiters
    stored = repr(db.messages) + repr(db.calls)
    assert sentence not in stored and "9876543210" not in stored   # never kept by the run's own record
    assert out["unclear_words"] is None


def test_unclear_fields_show_one_neutral_line_and_nothing_is_switched_on() -> None:
    item, _ = a_template()
    from app.jobs.catalogue import CATALOGUE

    choice = next(s for s in CATALOGUE[item["kind"]] if s.type == "choice")
    client, _, _, _ = world({"template_id": item["id"], "settings": [], "unclear": [choice.key]})
    out = client.post(URL, json={"text": "do the usual thing"}, headers=auth("a_owner")).json()
    assert out["unclear"] == [choice.key] and out["unclear_words"].startswith("A few things were not clear")


def test_roles_validation_and_the_daily_cap() -> None:
    client, *_ = world({"template_id": None, "settings": [], "unclear": []})
    assert client.post(URL, json={"text": "hello there"}, headers=auth("a_sales")).status_code == 403
    assert client.post(URL, json={"text": "hi"}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={"text": "x" * 1001}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={"text": "valid text", "language": "fr"}, headers=auth("a_owner")).status_code == 422
    nothing = client.post(URL, json={"text": "something odd"}, headers=auth("a_owner")).json()
    assert nothing["understood"] is False and nothing["fields"] == [] and len(nothing["nearest"]) == 3
    used: list[tuple[str, int]] = []

    def cap(token: str, tenant: Any, feature: str, limit: int) -> bool:
        used.append((feature, limit))
        return False

    limited, llm, _, _ = world(cap=cap)
    r = limited.post(URL, json={"text": "describe a job"}, headers=auth("a_owner"))
    assert r.status_code == 429 and r.json()["error"]["code"] == "ai_limit" and used == [("describe_job", 30)] and llm.requests == []


def test_a_model_failure_is_a_plain_503() -> None:
    from app.agents.llm.interface import LlmError

    client, *_ = world(LlmError())
    r = client.post(URL, json={"text": "describe a job"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "describe_unavailable"
