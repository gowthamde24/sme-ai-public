"""Setting a business up on Plivo (job 3 phase C). Fakes only: no network, no account, nothing is rented.

Proven: Plivo's REST shapes as we send them; nothing is done until the business's own compliance application is `accepted`; a dry run changes nothing; a subaccount's token goes to Secret Manager and nowhere else (not a
result, not a log, not the SQL); a purchase needs --execute AND an explicit number; every step skips itself when done, so a run that stopped is run again; the operator SQL holds no secret; the API believes a subaccount's
line only through the token its secret holds; and there is no document handling anywhere."""

# ruff: noqa: E501

from __future__ import annotations

import json
import subprocess
import uuid
from typing import Any

import httpx
import pytest

from app.telephony.plivo_admin import PlivoAdmin, e164
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_onboarding import (
    GcloudSecretWriter,
    OnboardPlan,
    line_sql,
    onboard,
    vault_key,
)
from app.telephony.plivo_routes import PlivoConfig, SubaccountTokens

MAIN_ID, MAIN_TOKEN = "MAMAINACCOUNT0000001", "main-token-aaaaaaaaaaaaaaaaaaaa"
SUB_ID, SUB_TOKEN = "SA2025RK4E639VJFZAMM", "sub-token-bbbbbbbbbbbbbbbbbbbbbbbb"
TENANT = uuid.UUID(int=0xA11CE)
BASE = "https://api.example.test"


class FakePlivo:
    """Plivo's account side, as a MockTransport handler that remembers every request."""

    def __init__(self, status: str = "accepted") -> None:
        self.status = status
        self.requests: list[tuple[str, str, dict[str, Any] | None, str]] = []
        self.fail_on: str | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        who = request.url.path.split("/")[3]
        self.requests.append((request.method, request.url.path + ("?" + request.url.query.decode() if request.url.query else ""), body, who))
        path = request.url.path
        if self.fail_on and self.fail_on in path:
            return httpx.Response(400, json={"error": "refused for +919502380998"})
        if path.endswith("/Subaccount/"):
            return httpx.Response(201, json={"api_id": "x", "auth_id": SUB_ID, "auth_token": SUB_TOKEN, "message": "created"})
        if "/PhoneNumber/Compliance/" in path:
            return httpx.Response(200, json={"compliance_application_id": "cmp-1", "status": self.status})
        if request.method == "GET" and "/PhoneNumber/" in path:
            return httpx.Response(200, json={"objects": [{"number": "918065590140"}, {"number": "918065590141"}]})
        if request.method == "POST" and "/PhoneNumber/" in path:
            return httpx.Response(201, json={"status": "fulfilled"})
        if path.endswith("/Application/"):
            return httpx.Response(201, json={"app_id": "app-123456", "message": "created"})
        if "/Number/" in path:
            return httpx.Response(202, json={"message": "changed"})
        return httpx.Response(404)


def admins(fake: FakePlivo) -> tuple[PlivoAdmin, Any]:
    transport = httpx.MockTransport(fake)
    return PlivoAdmin(MAIN_ID, MAIN_TOKEN, client=httpx.Client(transport=transport)), lambda sub_id, token: PlivoAdmin(sub_id, token, client=httpx.Client(transport=transport))


class FakeSecrets:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def exists(self, name: str) -> bool:
        return name in self.values

    def put(self, name: str, value: str) -> None:
        self.values[name] = value


def plan(**over: Any) -> OnboardPlan:
    return OnboardPlan(**{"tenant_id": TENANT, "business": "Padma Silks", "compliance_id": "cmp-1", "public_base": BASE, "number": "+918065590140", **over})


def names(result: Any) -> dict[str, str]:
    return {s.name: s.status for s in result.steps}


# ---------------------------------------------------------------------------------------------------------------------------------- Plivo's REST as we send it
def test_each_call_is_the_documented_one_with_the_right_account() -> None:
    fake = FakePlivo()
    main, make = admins(fake)
    handed: list[str] = []
    assert main.create_subaccount("stack19-a11ce", handed.append) == SUB_ID and handed == [SUB_TOKEN], "the token goes to the keeper and is not part of the answer"
    assert main.compliance_status("cmp-1") == "accepted"
    assert main.search_numbers(pattern="+91 80", limit=2) == ["+918065590140", "+918065590141"]
    main.buy_number("+918065590140", subaccount_id=SUB_ID, compliance_application_id="cmp-1")
    assert make(SUB_ID, SUB_TOKEN).create_application("stack19-padma", f"{BASE}/v1/telephony/plivo/answer", f"{BASE}/v1/telephony/plivo/hangup") == "app-123456"
    make(SUB_ID, SUB_TOKEN).link_number("+918065590140", "app-123456")
    got = [(m, p.split("?")[0].replace(MAIN_ID, "<main>").replace(SUB_ID, "<sub>"), b, w) for m, p, b, w in fake.requests]
    assert got[0] == ("POST", "/v1/Account/<main>/Subaccount/", {"name": "stack19-a11ce", "enabled": True}, MAIN_ID)
    assert got[1] == ("GET", "/v1/Account/<main>/PhoneNumber/Compliance/cmp-1/", None, MAIN_ID)
    search = fake.requests[2][1]
    assert got[2][1] == "/v1/Account/<main>/PhoneNumber/" and "country_iso=IN" in search and "services=voice" in search and "pattern=91" in search and "limit=2" in search
    assert got[3] == ("POST", "/v1/Account/<main>/PhoneNumber/918065590140/", {"subaccount": SUB_ID, "compliance_application_id": "cmp-1"}, MAIN_ID), "the purchase is the main account's, for the subaccount"
    assert got[4][0:2] == ("POST", "/v1/Account/<sub>/Application/") and got[4][2] == {"app_name": "stack19-padma", "answer_url": f"{BASE}/v1/telephony/plivo/answer", "answer_method": "POST", "hangup_url": f"{BASE}/v1/telephony/plivo/hangup", "hangup_method": "POST"} and got[4][3] == SUB_ID, "the Application is the subaccount's own"
    assert got[5] == ("POST", "/v1/Account/<sub>/Number/918065590140/", {"app_id": "app-123456"}, SUB_ID)


def test_strange_answers_and_bad_ids_are_closed_words() -> None:
    main, _ = admins(FakePlivo(status="weird"))
    with pytest.raises(PlivoError) as caught:
        main.compliance_status("cmp-1")
    assert caught.value.reason == "bad_response"
    for call in (lambda: main.compliance_status("../x"), lambda: main.buy_number("+918065590140", subaccount_id="a b", compliance_application_id="c-1"), lambda: main.link_number("+918065590140", "")):
        with pytest.raises(PlivoError) as bad:
            call()
        assert bad.value.reason == "rejected"
    assert e164("91 80655-90140") == "+918065590140"


# ---------------------------------------------------------------------------------------------------------------------------------- the steps
def test_nothing_is_done_until_the_businesss_own_application_is_accepted() -> None:
    for status in ("draft", "submitted", "rejected", "suspended", "expired"):
        fake = FakePlivo(status=status)
        main, make = admins(fake)
        result = onboard(plan(), main, FakeSecrets(), make, execute=True)
        assert names(result) == {"compliance": "waiting"} and status in result.steps[0].detail
        assert [r[0] for r in fake.requests] == ["GET"], "only the free read of the status"


def test_a_dry_run_changes_nothing_and_says_what_it_would_do() -> None:
    fake, secrets = FakePlivo(), FakeSecrets()
    main, make = admins(fake)
    result = onboard(plan(), main, secrets, make, execute=False)
    assert names(result) == {"compliance": "done", "subaccount": "would", "number": "would", "application": "would", "link": "would", "line": "would"}
    assert [r[0] for r in fake.requests] == ["GET"] and secrets.values == {}
    assert result.sql is None and result.subaccount_id is None


def test_a_full_run_makes_the_subaccount_stores_its_token_only_in_the_secret_and_prints_the_line_sql_without_any_secret() -> None:
    fake, secrets = FakePlivo(), FakeSecrets()
    main, make = admins(fake)
    result = onboard(plan(), main, secrets, make, execute=True, token_of=lambda _id: None)
    assert names(result) == {"compliance": "done", "subaccount": "done", "number": "done", "application": "done", "link": "done", "line": "done"}
    assert secrets.values == {vault_key(TENANT): SUB_TOKEN} and vault_key(TENANT) == f"sme-ws-{TENANT}-plivo-token"
    shown = json.dumps([vars(s) for s in result.steps]) + (result.sql or "") + repr(result)
    assert SUB_TOKEN not in shown and MAIN_TOKEN not in shown, "no token in anything the tool shows"
    assert result.subaccount_id == SUB_ID and result.application_id == "app-123456" and result.number == "+918065590140"
    assert result.sql is not None and "'plivo'" in result.sql and f"'{vault_key(TENANT)}'" in result.sql and f"'{SUB_ID}'" in result.sql and "false" in result.sql and "inbound_on = true" in result.sql
    assert "+918065590140" in result.sql


def test_no_number_named_means_nothing_is_bought_and_the_free_offer_is_shown() -> None:
    fake, secrets = FakePlivo(), FakeSecrets()
    main, make = admins(fake)
    result = onboard(plan(number=None), main, secrets, make, execute=True)
    assert names(result)["number"] == "waiting" and result.offered == ["+918065590140", "+918065590141"]
    assert not any(m == "POST" and "/PhoneNumber/9" in p for m, p, _b, _w in fake.requests), "a number is never picked for the operator"


def test_a_run_that_stopped_is_run_again_and_each_finished_step_skips_itself() -> None:
    fake, secrets = FakePlivo(), FakeSecrets()
    secrets.put(vault_key(TENANT), SUB_TOKEN)
    main, make = admins(fake)
    result = onboard(plan(subaccount_id=SUB_ID, application_id="app-123456"), main, secrets, make, execute=True, token_of=lambda _id: SUB_TOKEN)
    assert names(result)["subaccount"] == "skipped" and names(result)["application"] == "skipped"
    assert not any(p.endswith("/Subaccount/") or p.endswith("/Application/") for _m, p, _b, _w in fake.requests), "nothing is made twice"
    assert names(result)["link"] == "done"


def test_a_plivo_refusal_stops_the_run_at_that_step_with_a_closed_word_and_never_its_text() -> None:
    for fail, step in (("Subaccount", "subaccount"), ("Application", "application"), ("/PhoneNumber/918", "number"), ("/Number/", "link")):
        fake, secrets = FakePlivo(), FakeSecrets()
        fake.fail_on = fail
        main, make = admins(fake)
        result = onboard(plan(), main, secrets, make, execute=True, token_of=lambda _id: SUB_TOKEN)
        assert result.steps[-1].name == step and result.steps[-1].status == "failed" and result.steps[-1].detail == "rejected", fail
        assert "9502380998" not in json.dumps([vars(s) for s in result.steps])


def test_the_line_sql_cleans_the_name_and_refuses_a_bad_id() -> None:
    sql = line_sql(TENANT, "+918065590140", SUB_ID, "O'Brien'); drop table x; --")
    statement = sql.split("on conflict")[0]
    assert "O'Brien" not in sql and "');" not in statement and ";" not in statement, "no quote or semicolon of the name reaches the statement"
    assert "'OBrien drop table x --'" in statement, "only letters, digits, space . & - survive, inside the string"
    with pytest.raises(ValueError):
        line_sql(TENANT, "+918065590140", "SA'; drop", "x")


# ---------------------------------------------------------------------------------------------------------------------------------- the secret writer and the runtime resolver
def test_the_gcloud_writer_sends_the_token_on_stdin_never_in_an_argument_and_drops_gclouds_text() -> None:
    calls: list[tuple[list[str], str | None]] = []

    def run(args: list[str], **kw: Any) -> subprocess.CompletedProcess[str]:
        calls.append((args, kw.get("input")))
        return subprocess.CompletedProcess(args, 1 if "describe" in args else 0, "", "")

    GcloudSecretWriter("project-abc-12345", run=run).put("sme-ws-x-plivo-token", SUB_TOKEN)
    assert [a[2] for a, _ in calls] == ["describe", "create"]
    assert all(SUB_TOKEN not in " ".join(a) for a, _ in calls), "never in a process list"
    assert calls[-1][1] == SUB_TOKEN and "--data-file=-" in calls[-1][0] and "--locations=asia-south1" in calls[-1][0]
    failing = GcloudSecretWriter("project-abc-12345", run=lambda args, **kw: subprocess.CompletedProcess(args, 1, "", f"error with {SUB_TOKEN}"))
    with pytest.raises(RuntimeError) as caught:
        failing.put("sme-ws-x-plivo-token", SUB_TOKEN)
    assert SUB_TOKEN not in str(caught.value)
    with pytest.raises(ValueError):
        GcloudSecretWriter("Not A Project")


def test_the_api_reads_a_subaccounts_token_by_the_lines_vault_key_remembers_it_and_fails_closed() -> None:
    asked: list[str] = []

    class Store:
        def access(self, name: str) -> str | None:
            asked.append(name)
            if name == "boom":
                raise RuntimeError("down")
            return SUB_TOKEN if name == "sme-ws-x-plivo-token" else None

    now = [0.0]
    tokens = SubaccountTokens(Store(), ttl_s=300.0, clock=lambda: now[0])
    assert tokens({"account_ref": "sme-ws-x-plivo-token"}) == SUB_TOKEN and tokens({"account_ref": "sme-ws-x-plivo-token"}) == SUB_TOKEN and asked == ["sme-ws-x-plivo-token"], "remembered"
    now[0] = 301.0
    tokens({"account_ref": "sme-ws-x-plivo-token"})
    assert len(asked) == 2, "and asked again after the time"
    assert tokens({"account_ref": "sme-ws-nothing"}) is None and tokens({"account_ref": "boom"}) is None and tokens({}) is None and tokens({"account_ref": None}) is None


def test_a_subaccounts_line_is_signed_with_its_own_token_and_the_main_one_does_not_pass() -> None:
    config = PlivoConfig(auth_token=MAIN_TOKEN, public_base=BASE, token_for=SubaccountTokens(type("S", (), {"access": lambda self, n: SUB_TOKEN})()))
    assert config.token({"account_ref": "sme-ws-x-plivo-token"}) == SUB_TOKEN
    assert config.token({"account_ref": None}) == MAIN_TOKEN and config.token(None) == MAIN_TOKEN
    assert PlivoConfig(auth_token=MAIN_TOKEN, public_base=BASE).token({"account_ref": "sme-ws-x-plivo-token"}) == MAIN_TOKEN, "no resolver: the main token, so a subaccount's request fails its signature and is refused"
