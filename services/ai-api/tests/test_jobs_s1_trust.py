"""Jobs, slice S1 (jobs contract 1.0 sections 1, 6, 15.6, 16): the do-not-call list, the FAQs of a job and the consent tick on a lead source, with fakes (no database). The database rules (who may, the reasons, that a
customer's own stop can never be removed, the words an FAQ answer may not use) are pgTAP 260; here: the flag, the roles, the second factor, the closed refusals, what goes to the data layer, and the consent tick."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from typing import Any

import httpx
import pytest

from app.crm.repository import NotFoundError
from app.jobs.trust import REFUSALS, JobsRefused, TrustStore
from app.jobs.wiring import JobsRuntime, build_jobs
from app.lead_sources.service import LeadSourcesService
from app.rpc_base import RpcClient
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.suppression_fakes import RING

A = TENANT_A.id
DNC = f"/v1/tenants/{A}/do-not-call"
JOB = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
FAQ = "ffffffff-ffff-4fff-8fff-fffffffffff1"
ENTRY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
FAQS = f"/v1/tenants/{A}/jobs/{JOB}/faqs"
HEX64 = re.compile(r"[0-9a-f]{64}")
AT = "2026-11-20T10:00:00+00:00"


def entry(**over: Any) -> dict[str, Any]:
    return {"id": ENTRY_ID, "state": "active", "reason": "added_by_owner", "phone_masked": "•••• 0001", "last4": "0001", "added_by": "Ramesh", "added_at": AT, "lifted_at": None, "history": [], **over}


def faq(**over: Any) -> dict[str, Any]:
    return {"id": FAQ, "job_id": JOB, "question": "What are your hours?", "answer": "We are open from 9 am to 6 pm.", "created_at": AT, "updated_at": AT, **over}


class FakeTrust:
    """Answers like the database for the happy path, remembers every call, and refuses with whatever the test sets for a function."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.refuse: dict[str, Exception] = {}

    def _go(self, name: str, token: str, args: dict[str, Any]) -> None:
        self.calls.append((name, token, args))
        if name in self.refuse:
            raise self.refuse[name]

    def last(self, name: str) -> dict[str, Any]:
        return [c for c in self.calls if c[0] == name][-1][2]

    def dnc_list(self, token: str, tenant_id: uuid.UUID, *, q: str | None, cursor: str | None, limit: int, include_lifted: bool) -> dict[str, Any]:
        self._go("dnc_list", token, {"tenant": str(tenant_id), "q": q, "cursor": cursor, "limit": limit, "include_lifted": include_lifted})
        out: dict[str, Any] = {"items": [entry()], "count": 1, "next_cursor": None}
        if include_lifted:
            out["items"].append(entry(id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2", state="lifted", reason="stop_whatsapp", added_by=None, lifted_at=AT, history=[{"at": AT, "how": "customer_message", "by": "customer"}]))
            out["lifted_count"] = 1
        return out

    def dnc_add(self, token: str, tenant_id: uuid.UUID, phone: str, keys: dict[str, Any]) -> dict[str, Any]:
        self._go("dnc_add", token, {"tenant": str(tenant_id), "phone": phone, "keys": keys})
        return entry()

    def dnc_remove(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        self._go("dnc_remove", token, {"tenant": str(tenant_id), "id": str(entry_id)})
        return entry(state="removed")

    def faq_list(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> list[dict[str, Any]]:
        self._go("faq_list", token, {"job": str(job_id)})
        return [faq()]

    def faq_add(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID, question: str, answer: str) -> dict[str, Any]:
        self._go("faq_add", token, {"job": str(job_id), "id": str(faq_id), "question": question, "answer": answer})
        return faq(id=str(faq_id), question=question, answer=answer)

    def faq_update(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID, question: str | None, answer: str | None) -> dict[str, Any]:
        self._go("faq_update", token, {"job": str(job_id), "id": str(faq_id), "question": question, "answer": answer})
        return faq()

    def faq_remove(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID) -> dict[str, Any]:
        self._go("faq_remove", token, {"job": str(job_id), "id": str(faq_id)})
        return {"id": str(faq_id), "removed": True}


def world(*, on: bool = True, ring: Any = RING) -> tuple[Any, FakeTrust]:
    trust = FakeTrust()
    client, _ = make_client(jobs=JobsRuntime(trust=trust) if on else None, key_ring=ring)  # type: ignore[arg-type]
    return client, trust


def call(client: Any, method: str, path: str, user: str | None = "a_owner", body: Any = None, **claims: str) -> Any:
    return client.request(method, path, json=body, headers=auth(user, **claims) if user else {})


# ------------------------------------------------------------------------------------------------------------------ JOBS off: not there
ROUTES = [
    ("GET", DNC, None), ("POST", DNC, {"phone": "+91 98450 20001"}), ("POST", f"{DNC}/{ENTRY_ID}/remove", None),
    ("GET", FAQS, None), ("POST", FAQS, {"question": "q", "answer": "a"}), ("PATCH", f"{FAQS}/{FAQ}", {"answer": "a"}), ("POST", f"{FAQS}/{FAQ}/remove", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
@pytest.mark.parametrize("user", ["a_owner", "a_viewer", "outsider", None])
def test_with_jobs_off_every_trust_route_is_a_404_as_if_it_did_not_exist(method: str, path: str, body: Any, user: str | None) -> None:
    client, trust = world(on=False)
    r = call(client, method, path, user, body)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", (user, r.text)
    assert trust.calls == []


def test_the_trust_store_is_built_with_the_flag_and_the_data_layer() -> None:
    from app.config import Settings

    off = build_jobs(Settings(_env_file=None, api_env="development"), "http://rest.invalid", "anon")  # type: ignore[call-arg]
    assert off is None
    on = build_jobs(Settings(_env_file=None, api_env="development", jobs="on"), "http://rest.invalid", "anon")  # type: ignore[call-arg]
    assert on is not None and on.trust is not None
    bare = build_jobs(Settings(_env_file=None, api_env="development", jobs="on"))  # type: ignore[call-arg]
    assert bare is not None and bare.trust is None


# ------------------------------------------------------------------------------------------------------------------ the do-not-call list
@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_every_member_reads_the_list(user: str | None, status: int) -> None:
    client, _ = world()
    assert call(client, "GET", DNC, user).status_code == status


def test_the_list_answers_in_the_contract_shape_and_passes_what_was_asked() -> None:
    client, trust = world()
    r = call(client, "GET", DNC + "?q=0001&cursor=123_abc&limit=20&include=lifted", "a_viewer")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1 and body["lifted_count"] == 1 and body["next_cursor"] is None
    first, lifted = body["items"]
    assert first["phone_masked"] == "•••• 0001" and first["reason"] == "added_by_owner" and first["added_by"] == "Ramesh" and first["state"] == "active"
    assert lifted["state"] == "lifted" and lifted["history"] == [{"at": "2026-11-20T10:00:00Z", "how": "customer_message", "by": "customer"}]
    assert trust.last("dnc_list") == {"tenant": str(A), "q": "0001", "cursor": "123_abc", "limit": 20, "include_lifted": True}
    plain = call(client, "GET", DNC).json()
    assert "lifted_count" in plain and plain["lifted_count"] is None, "lifted_count is only filled with include=lifted"
    assert trust.last("dnc_list")["include_lifted"] is False and trust.last("dnc_list")["limit"] == 50


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?include=everything", "?q=" + "x" * 81])
def test_a_bad_query_is_a_422(query: str) -> None:
    client, trust = world()
    assert call(client, "GET", DNC + query).status_code == 422
    assert trust.calls == []


def test_another_workspace_is_not_reachable() -> None:
    client, trust = world()
    assert call(client, "GET", f"/v1/tenants/{TENANT_B.id}/do-not-call", "a_owner").status_code == 404
    assert trust.calls == []


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), (None, 401)])
def test_the_owner_and_admin_add(user: str | None, status: int) -> None:
    client, _ = world()
    assert call(client, "POST", DNC, user, {"phone": "+91 98450 20001"}).status_code == status


def test_an_added_number_goes_to_the_database_with_its_key_and_the_key_alone_is_the_hmac() -> None:
    client, trust = world()
    r = call(client, "POST", DNC, "a_owner", {"phone": " +91 98450 20001 "})
    assert r.status_code == 200 and r.json()["phone_masked"] == "•••• 0001"
    sent = trust.last("dnc_add")
    assert sent["phone"] == "+91 98450 20001" and sent["keys"]["version"] == RING.current.version
    assert HEX64.fullmatch(sent["keys"]["phone"]) and sent["keys"]["phone"] == RING.key_for("phone", "+91 98450 20001")
    assert set(sent["keys"]) == {"version", "phone"}
    assert "98450" not in r.text and sent["keys"]["phone"] not in r.text, "the answer holds the last four digits only"


@pytest.mark.parametrize("body", [{}, {"phone": "abc"}, {"phone": "12"}, {"phone": "+91 98450 20001", "reason": "x"}, {"phone": "9" * 41}])
def test_a_phone_that_is_not_one_is_refused_before_the_database(body: dict[str, Any]) -> None:
    client, trust = world()
    r = call(client, "POST", DNC, "a_owner", body)
    assert r.status_code == 422, r.text
    assert trust.calls == []
    if body.get("phone") == "abc":
        assert r.json()["error"]["code"] == "phone_invalid"


def test_without_the_suppression_key_nothing_is_added() -> None:
    client, trust = world(ring=None)
    r = call(client, "POST", DNC, "a_owner", {"phone": "+91 98450 20001"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "suppression_key_not_configured"
    assert trust.calls == []


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 403), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), (None, 401)])
def test_only_the_owner_removes(user: str | None, status: int) -> None:
    client, _ = world()
    assert call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", user).status_code == status


def test_removing_needs_the_second_factor_and_nothing_reaches_the_database_without_it() -> None:
    client, trust = world()
    weak = call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner", aal="aal1")
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert trust.calls == []
    ok = call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner")
    assert ok.status_code == 200 and ok.json()["state"] == "removed"
    assert trust.last("dnc_remove") == {"tenant": str(A), "id": ENTRY_ID}


def test_the_database_second_factor_refusal_is_the_same_word() -> None:
    from app.tenancy.repository import MfaRequired

    client, trust = world()
    trust.refuse["dnc_remove"] = MfaRequired("SM306")
    r = call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner")
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"


def test_a_number_the_customer_asked_us_to_stop_answers_409_stopped_by_customer_with_a_fixed_sentence() -> None:
    client, trust = world()
    trust.refuse["dnc_remove"] = JobsRefused("SM985")
    r = call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner")
    err = r.json()["error"]
    assert r.status_code == 409 and err["code"] == "stopped_by_customer" and err["message"] == REFUSALS["SM985"][2]
    trust.refuse["dnc_remove"] = JobsRefused("SM986")
    r = call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_removable"
    trust.refuse["dnc_remove"] = NotFoundError("23503")
    assert call(client, "POST", f"{DNC}/{ENTRY_ID}/remove", "a_owner").status_code == 404


def test_a_malformed_id_is_a_404_and_there_is_no_http_delete() -> None:
    client, trust = world()
    assert call(client, "POST", f"{DNC}/not-an-id/remove", "a_owner").status_code == 404
    assert call(client, "DELETE", f"{DNC}/{ENTRY_ID}", "a_owner").status_code in (404, 405)
    assert call(client, "DELETE", f"{FAQS}/{FAQ}", "a_owner").status_code in (404, 405)
    assert trust.calls == []


# ------------------------------------------------------------------------------------------------------------------ FAQs
@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_every_member_reads_the_faqs(user: str | None, status: int) -> None:
    client, _ = world()
    r = call(client, "GET", FAQS, user)
    assert r.status_code == status
    if status == 200:
        assert r.json()["items"][0]["question"] == "What are your hours?"


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), (None, 401)])
def test_the_owner_and_admin_write_faqs(user: str | None, status: int) -> None:
    client, _ = world()
    for method, path, body in (("POST", FAQS, {"question": "q", "answer": "a"}), ("PATCH", f"{FAQS}/{FAQ}", {"answer": "a"}), ("POST", f"{FAQS}/{FAQ}/remove", None)):
        assert call(client, method, path, user, body).status_code == status, (method, user)


def test_a_faq_goes_to_the_database_with_its_own_id_for_a_retry() -> None:
    client, trust = world()
    r = call(client, "POST", FAQS, "a_owner", {"id": FAQ, "question": "  What are your hours?  ", "answer": "We are open from 9 am to 6 pm."})
    assert r.status_code == 200 and r.json()["id"] == FAQ
    assert trust.last("faq_add") == {"job": JOB, "id": FAQ, "question": "What are your hours?", "answer": "We are open from 9 am to 6 pm."}
    call(client, "POST", FAQS, "a_owner", {"question": "q", "answer": "a"})
    assert uuid.UUID(trust.last("faq_add")["id"]), "without an id one is made"
    patched = call(client, "PATCH", f"{FAQS}/{FAQ}", "a_owner", {"question": "Do you deliver?"})
    assert patched.status_code == 200 and trust.last("faq_update") == {"job": JOB, "id": FAQ, "question": "Do you deliver?", "answer": None}
    gone = call(client, "POST", f"{FAQS}/{FAQ}/remove", "a_owner")
    assert gone.status_code == 200 and gone.json() == {"id": FAQ, "removed": True} and trust.last("faq_remove") == {"job": JOB, "id": FAQ}


@pytest.mark.parametrize("body", [{"question": "q"}, {"answer": "a"}, {"question": "", "answer": "a"}, {"question": "q", "answer": "a" * 301}, {"question": "q" * 301, "answer": "a"}, {"question": "q", "answer": "a", "x": 1}, {"id": "nope", "question": "q", "answer": "a"}])
def test_a_faq_over_300_characters_or_not_whole_is_a_422(body: dict[str, Any]) -> None:
    client, trust = world()
    assert call(client, "POST", FAQS, "a_owner", body).status_code == 422
    assert trust.calls == []


def test_exactly_300_and_300_is_fine_and_an_empty_patch_is_a_422() -> None:
    client, trust = world()
    assert call(client, "POST", FAQS, "a_owner", {"question": "q" * 300, "answer": "a" * 300}).status_code == 200
    assert call(client, "PATCH", f"{FAQS}/{FAQ}", "a_owner", {}).status_code == 422
    assert call(client, "PATCH", f"{FAQS}/{FAQ}", "a_owner", {"answer": "a" * 301}).status_code == 422
    assert [c[0] for c in trust.calls] == ["faq_add"]


def test_an_answer_with_a_price_a_discount_or_a_promise_is_422_faq_not_allowed() -> None:
    client, trust = world()
    trust.refuse["faq_add"] = JobsRefused("SM984")
    trust.refuse["faq_update"] = JobsRefused("SM984")
    for method, path, body in (("POST", FAQS, {"question": "q", "answer": "Rs 500 only"}), ("PATCH", f"{FAQS}/{FAQ}", {"answer": "A 10% discount"})):
        r = call(client, method, path, "a_owner", body)
        err = r.json()["error"]
        assert r.status_code == 422 and err["code"] == "faq_not_allowed" and err["message"] == REFUSALS["SM984"][2], (method, r.text)
        assert "500" not in r.text and "discount" not in err["message"].replace("a discount", "")


def test_a_helper_name_refusal_has_its_closed_word_for_the_job_page() -> None:
    assert REFUSALS["SM983"][:2] == (422, "name_invalid")


def test_a_bad_job_or_faq_id_is_a_404_and_an_unknown_job_is_the_databases_404() -> None:
    client, trust = world()
    assert call(client, "GET", f"/v1/tenants/{A}/jobs/nope/faqs").status_code == 404
    assert call(client, "PATCH", f"{FAQS}/nope", "a_owner", {"answer": "a"}).status_code == 404
    assert trust.calls == []
    trust.refuse["faq_add"] = NotFoundError("23503")
    assert call(client, "POST", FAQS, "a_owner", {"question": "q", "answer": "a"}).status_code == 404


def test_the_data_layer_down_is_a_502_without_its_text() -> None:
    from app.tenancy.repository import UpstreamError

    client, trust = world()
    trust.refuse["dnc_list"] = UpstreamError("the data layer said: secret row text")
    r = call(client, "GET", DNC)
    assert r.status_code in (502, 503) and "secret row text" not in r.text


def test_without_a_data_layer_the_routes_say_so() -> None:
    client, _ = make_client(jobs=JobsRuntime(), key_ring=RING)
    r = call(client, "GET", DNC)
    assert r.status_code == 503 and r.json()["error"]["code"] == "jobs_unavailable"


# ------------------------------------------------------------------------------------------------------------------ the store: what goes over the wire
def test_the_store_calls_the_functions_with_the_callers_token_and_maps_the_closed_refusals() -> None:
    seen: list[httpx.Request] = []
    answers: list[httpx.Response] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return answers.pop(0)

    store = TrustStore("http://rest.invalid", "anon-key")
    store._rpc = RpcClient("http://rest.invalid", "anon-key", {code: JobsRefused for code in REFUSALS}, client=httpx.Client(base_url="http://rest.invalid", transport=httpx.MockTransport(handler)))
    answers.append(httpx.Response(200, json={"items": [], "count": 0, "next_cursor": None}))
    assert store.dnc_list("tok", A, q=None, cursor=None, limit=50, include_lifted=False)["count"] == 0
    assert seen[0].url.path == "/rpc/do_not_call_list" and seen[0].headers["authorization"] == "Bearer tok" and seen[0].headers["apikey"] == "anon-key"
    assert json.loads(seen[0].content) == {"p_tenant_id": str(A), "p_q": None, "p_cursor": None, "p_limit": 50, "p_include_lifted": False}
    answers.append(httpx.Response(400, json={"code": "SM985", "message": "stopped by the customer", "details": "a row"}))
    with pytest.raises(JobsRefused) as caught:
        store.dnc_remove("tok", A, uuid.UUID(ENTRY_ID))
    assert caught.value.code == "SM985" and seen[1].url.path == "/rpc/do_not_call_remove"
    answers.append(httpx.Response(400, json={"code": "SM984", "message": "an answer may not state a price"}))
    with pytest.raises(JobsRefused) as caught2:
        store.faq_add("tok", A, uuid.UUID(JOB), uuid.UUID(FAQ), "q", "a")
    assert caught2.value.code == "SM984"
    assert json.loads(seen[2].content) == {"p_tenant_id": str(A), "p_job_id": JOB, "p_question": "q", "p_answer": "a", "p_id": FAQ}
    answers.append(httpx.Response(200, json={"id": FAQ, "removed": True}))
    store.faq_remove("tok", A, uuid.UUID(JOB), uuid.UUID(FAQ))
    assert json.loads(seen[3].content) == {"p_tenant_id": str(A), "p_job_id": JOB, "p_id": FAQ}
    answers.append(httpx.Response(200, json=faq()))
    store.faq_update("tok", A, uuid.UUID(JOB), uuid.UUID(FAQ), None, "new")
    assert json.loads(seen[4].content) == {"p_tenant_id": str(A), "p_job_id": JOB, "p_id": FAQ, "p_question": None, "p_answer": "new"}
    answers.append(httpx.Response(200, json=entry()))
    store.dnc_add("tok", A, "+91 98450 20001", {"version": 1, "phone": "a" * 64})
    assert json.loads(seen[5].content)["p_keys"] == {"version": 1, "phone": "a" * 64}


# ------------------------------------------------------------------------------------------------------------------ the consent tick on lead sources
def lead_world(*, on: bool) -> tuple[Any, FakeLeadSourcesRepository]:
    repo = FakeLeadSourcesRepository()
    service = LeadSourcesService(repo, receiver=Receiver(), inbound_domain="leads.example.test", inbound_secret="fake-inbound-secret-for-tests", public_base_url="https://api.example.test")
    client, _ = make_client(lead_sources=service, jobs=JobsRuntime() if on else None)
    return client, repo


CARD = f"/v1/tenants/{A}/lead-sources/cards"


def test_with_jobs_off_connecting_needs_no_tick_and_stores_none() -> None:
    client, repo = lead_world(on=False)
    r = call(client, "POST", f"{CARD}/website/connect")
    assert r.status_code == 200, r.text
    assert repo.ticks == [] and "consent_tick" not in repo.calls


@pytest.mark.parametrize("body", [None, {}, {"consent_confirmed": False}, {"consent_confirmed": "true"}, {"consent_confirmed": 1}, {"consent_confirmed": None}, {"other": True}])
def test_with_jobs_on_a_missing_or_false_tick_is_422_consent_required_and_nothing_is_connected(body: Any) -> None:
    client, repo = lead_world(on=True)
    r = call(client, "POST", f"{CARD}/website/connect", "a_owner", body)
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "consent_required" and err["fields"] == ["consent_confirmed"], r.text
    assert repo.sources_ == {} and repo.ticks == [], "nothing was connected, nothing stored"


def test_with_jobs_on_a_ticked_connect_stores_who_and_which_wording_on_the_sources_of_the_card() -> None:
    client, repo = lead_world(on=True)
    r = call(client, "POST", f"{CARD}/website/connect", "a_owner", {"consent_confirmed": True})
    assert r.status_code == 200, r.text
    assert repo.ticks == [{"kinds": ["website_form", "webhook"], "version": "lead-tick-1"}]
    assert any(s["kind"] == "website_form" and s["consent_text_version"] == "lead-tick-1" for s in repo.sources_.values())
    mail = call(client, "POST", f"{CARD}/email_forward/connect", "a_admin", {"consent_confirmed": True})
    assert mail.status_code in (200, 409), mail.text
    if mail.status_code == 200:
        assert repo.ticks[-1]["kinds"] == ["email_forward"]


def test_a_member_who_cannot_connect_is_refused_before_the_tick_is_looked_at() -> None:
    client, repo = lead_world(on=True)
    for user in ("a_sales", "a_viewer"):
        assert call(client, "POST", f"{CARD}/website/connect", user, {"consent_confirmed": True}).status_code == 403
    assert call(client, "POST", f"{CARD}/website/connect", None, {"consent_confirmed": True}).status_code == 401
    assert repo.ticks == []


def test_meta_has_no_connect_flow_yet_so_a_ticked_connect_stores_nothing_but_an_unticked_one_is_still_refused_first() -> None:
    client, repo = lead_world(on=True)
    unticked = call(client, "POST", f"{CARD}/meta/connect", "a_owner", {})
    assert unticked.status_code == 422 and unticked.json()["error"]["code"] == "consent_required"
    ticked = call(client, "POST", f"{CARD}/meta/connect", "a_owner", {"consent_confirmed": True})
    assert ticked.status_code == 409 and ticked.json()["error"]["code"] == "not_available"
    assert repo.ticks == []


def test_the_indiamart_key_card_needs_the_tick_next_to_the_key_and_nothing_else() -> None:
    client, repo = lead_world(on=True)
    no_tick = call(client, "POST", f"{CARD}/indiamart/connect", "a_owner", {"key": "k" * 24})
    assert no_tick.status_code == 422 and no_tick.json()["error"]["code"] == "consent_required"
    assert "k" * 24 not in no_tick.text
    extra = call(client, "POST", f"{CARD}/indiamart/connect", "a_owner", {"key": "k" * 24, "consent_confirmed": True, "more": 1})
    assert extra.json()["error"]["code"] != "consent_required", "the tick was given: the refusal is about the key"
    assert repo.ticks == []
