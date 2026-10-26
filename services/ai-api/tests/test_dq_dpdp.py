"""Job DQ part 4 (DPDP): the routes (notice, subprocessors, grievance, waitlist, consent, profile), the captcha, the e-mails and the worker's DPDP steps, the CSV in "download my data", and the erasure warning on the access answer.
The database's own rules are proved in supabase/tests/database/125_dq_dpdp.test.sql. No network, no database."""

# ruff: noqa: E501

from __future__ import annotations

import io
import json
import logging
import uuid
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.billing.mail import FakeEmailSender
from app.dpdp import mail as dpdp_mail
from app.dpdp import runtime as dpdp_runtime
from app.dpdp.captcha import FakeCaptcha, NoCaptcha, TurnstileCaptcha, build_captcha
from app.dpdp.mail import DpdpJobs, IntakeMail, LapseErasure
from app.dpdp.runtime import DpdpRuntime
from app.integrations.policy import PolicyVersions
from app.integrations.ratelimit import SlidingWindow
from app.outbox.adapter import LocalFakeAdapter
from app.privacy.export_builder import _csv_bytes, build_person_export
from app.scheduler.worker import Worker
from tests.dq_fakes import FakeDpdpRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.scheduler_fakes import FakeScheduler
from tests.test_scheduler_tick import FakeSession

VERSIONS = PolicyVersions("2026-10-25", "2026-10-25")
GOOD_GRIEVANCE = {"name": "Ravi Kumar", "contact": "ravi@example.test", "kind": "erasure", "details": "Please delete my data"}
GOOD_WAITLIST = {"name": "Sita Devi", "business_type": "textiles", "city": "Guntur", "phone": "+91 98765 43210", "language": "te", "marketing_opt_in": False, "notice_version": "2026-10-25"}


def world(**kw: Any) -> tuple[Any, FakeDpdpRepository, DpdpRuntime]:
    repo = FakeDpdpRepository()
    runtime = DpdpRuntime(repo, privacy_email="privacy@example.test", hello_email="hello@example.test", **kw)
    client, _ = make_client(dpdp=runtime, policies=VERSIONS)
    return client, repo, runtime


# ============================================================================ public: notice and subprocessors
def test_the_notice_carries_the_versions_the_inboxes_and_the_times() -> None:
    client, _, _ = world()
    body = client.get("/v1/privacy/notice").json()
    assert body["privacy_version"] == "2026-10-25" and body["terms_version"] == "2026-10-25"
    assert body["contact"] == {"privacy_email": "privacy@example.test", "hello_email": "hello@example.test"}
    assert body["grievance"] == {"acknowledged": "at once", "answer_within_days": 30}
    assert body["retention"] == {"lapsed_read_only_days": 90, "erasure_warning_hours": 48, "account_deletion_cancel_days": 7, "security_log_days": 365}
    assert body["purposes"] == [{"purpose": "service", "required": True}, {"purpose": "marketing", "required": False, "default": "off"}]


def test_the_answer_time_in_the_api_is_the_one_the_database_sets() -> None:
    migration = (__import__("pathlib").Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "20261202090200_dq_dpdp.sql").read_text()
    assert f"v_now + interval '{dpdp_runtime.ANSWER_WITHIN_DAYS} days'" in migration


def test_the_subprocessors_are_data_in_a_fixed_order_with_a_country_and_a_purpose() -> None:
    client, _, _ = world()
    body = client.get("/v1/privacy/subprocessors").json()
    assert [s["id"] for s in body["subprocessors"]] == ["google_cloud", "supabase", "resend", "zoho", "anthropic", "meta_whatsapp", "sarvam"]
    assert body["wording"] == "draft" and body["version"]
    for s in body["subprocessors"]:
        assert s["name"] and s["purpose"] and s["country"] and s["data"] and s["link"].startswith("https://"), s["id"]


def test_the_public_routes_need_no_sign_in_and_are_cacheable_only_where_they_are_static() -> None:
    client, _, _ = world()
    assert client.get("/v1/privacy/notice").headers["cache-control"].startswith("public")
    assert client.get("/v1/privacy/subprocessors").status_code == 200
    assert "no-store" in client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).headers["cache-control"]


# ============================================================================ public: grievance
def test_a_grievance_is_stored_and_answered_with_a_reference() -> None:
    client, repo, _ = world()
    response = client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE)
    assert response.status_code == 201
    body = response.json()
    assert body["reference"] == "GR-2026-000001" and body["status"] == "received" and body["answer_within_days"] == 30 and "replayed" not in body
    sent = repo.calls[0][1][0]
    assert sent["p_kind"] == "erasure" and sent["p_name"] == "Ravi Kumar" and sent["p_id"]


def test_the_same_grievance_again_is_a_200_with_the_same_reference() -> None:
    client, _, _ = world()
    gid = str(uuid.uuid4())
    first = client.post("/v1/privacy/grievance", json={**GOOD_GRIEVANCE, "grievance_id": gid})
    second = client.post("/v1/privacy/grievance", json={**GOOD_GRIEVANCE, "grievance_id": gid})
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["reference"] == second.json()["reference"]


@pytest.mark.parametrize(
    "change",
    [{"kind": "nonsense"}, {"name": ""}, {"contact": "ab"}, {"details": "x" * 4001}, {"language": "fr"}, {"unknown_field": 1}],
)
def test_a_bad_grievance_is_a_422(change: dict[str, Any]) -> None:
    client, repo, _ = world()
    assert client.post("/v1/privacy/grievance", json={**GOOD_GRIEVANCE, **change}).status_code == 422
    assert repo.calls == []


def test_a_grievance_from_one_address_is_limited_to_five_an_hour() -> None:
    client, _, _ = world()
    codes = [client.post("/v1/privacy/grievance", json={**GOOD_GRIEVANCE, "contact": f"p{i}@example.test"}).status_code for i in range(7)]
    assert codes[:5] == [201] * 5 and codes[5:] == [429, 429]


def test_a_grievance_from_one_contact_is_limited_to_three_an_hour() -> None:
    client, _, runtime = world()
    runtime.by_address = SlidingWindow(100, 3600.0)
    codes = [client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).status_code for _ in range(4)]
    assert codes == [201, 201, 201, 429]
    assert client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).json()["error"]["code"] == "rate_limited"


def test_the_database_cap_comes_back_as_a_429() -> None:
    client, repo, _ = world()
    repo.rate_limited = True
    assert client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).status_code == 429


def test_a_grievance_never_puts_the_persons_words_in_a_log(caplog: pytest.LogCaptureFixture) -> None:
    client, _, _ = world()
    with caplog.at_level(logging.INFO):
        client.post("/v1/privacy/grievance", json={**GOOD_GRIEVANCE, "details": "my secret story QXZJ"})
    assert "QXZJ" not in caplog.text and "ravi@example.test" not in caplog.text and "Ravi" not in caplog.text
    assert "grievance received" in caplog.text and "kind=erasure" in caplog.text


# ============================================================================ public: waitlist
def test_the_waitlist_joins_and_a_repeat_is_a_quiet_200() -> None:
    client, repo, _ = world()
    first = client.post("/v1/public/waitlist", json=GOOD_WAITLIST)
    second = client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "marketing_opt_in": True})
    assert (first.status_code, first.json()) == (201, {"status": "joined", "marketing_opt_in": False})
    assert (second.status_code, second.json()["status"]) == (200, "already_joined")
    args = repo.calls[0][1][0]
    assert args["p_notice_version"] == "2026-10-25" and args["p_marketing_opt_in"] is False and args["p_language"] == "te"


def test_marketing_defaults_to_off_when_the_form_does_not_say() -> None:
    client, repo, _ = world()
    body = {k: v for k, v in GOOD_WAITLIST.items() if k != "marketing_opt_in"}
    assert client.post("/v1/public/waitlist", json=body).json()["marketing_opt_in"] is False


@pytest.mark.parametrize(
    "change",
    [
        {"phone": None, "email": None},
        {"phone": None, "email": "not-an-address"},
        {"business_type": "Bad Type!"},
        {"language": "fr"},
        {"city": ""},
        {"notice_version": "bad version!"},
        {"unknown": 1},
    ],
)
def test_a_bad_waitlist_entry_is_a_422(change: dict[str, Any]) -> None:
    client, repo, _ = world()
    assert client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, **change}).status_code == 422
    assert repo.calls == []


def test_every_call_and_whatsapp_language_may_join_the_waitlist() -> None:
    client, _, runtime = world()
    runtime.by_address = SlidingWindow(100, 3600.0)
    for i, language in enumerate(("en", "te", "hi", "kn", "ta", "ml")):
        assert client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "phone": f"+91 90000 0000{i}", "language": language}).status_code == 201, language


def test_a_notice_version_that_is_not_the_current_one_is_a_409() -> None:
    client, repo, _ = world()
    response = client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "notice_version": "2026-01-01"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "policy_version_outdated"
    assert repo.calls == []


def test_the_waitlist_is_limited_per_address() -> None:
    client, _, _ = world()
    codes = [client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "phone": f"+91 90000 0000{i}"}).status_code for i in range(7)]
    assert codes[:5] == [201] * 5 and codes[5:] == [429, 429]


# ============================================================================ captcha
def test_with_the_captcha_switched_on_a_missing_or_wrong_token_is_a_400_and_nothing_is_stored() -> None:
    client, repo, _ = world(captcha=FakeCaptcha())
    assert client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).json()["error"]["code"] == "captcha_failed"
    assert client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "captcha_token": "wrong"}).status_code == 400
    assert repo.calls == []
    assert client.post("/v1/public/waitlist", json={**GOOD_WAITLIST, "captcha_token": "pass"}).status_code == 201


def test_with_no_captcha_the_token_is_not_needed() -> None:
    client, _, _ = world()
    assert client.post("/v1/privacy/grievance", json=GOOD_GRIEVANCE).status_code == 201


def test_the_builder_knows_three_providers_and_refuses_a_half_configuration() -> None:
    assert isinstance(build_captcha("none", None), NoCaptcha) and isinstance(build_captcha("fake", None), FakeCaptcha)
    assert isinstance(build_captcha("turnstile", "secret"), TurnstileCaptcha)
    with pytest.raises(ValueError, match="CAPTCHA_SECRET"):
        build_captcha("turnstile", None)
    with pytest.raises(ValueError, match="CAPTCHA_PROVIDER"):
        build_captcha("recaptcha", None)


def test_turnstile_posts_the_secret_and_the_token_and_fails_closed() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": request.read() != b""} if b"good" in request.read() else {"success": False})

    captcha = TurnstileCaptcha("s3cret", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert captcha.ok("good-token", "1.2.3.4") is True and captcha.ok("bad-token", None) is False and captcha.ok(None, None) is False
    assert b"secret=s3cret" in seen[0].content and b"response=good-token" in seen[0].content and b"remoteip=1.2.3.4" in seen[0].content

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    assert TurnstileCaptcha("s", client=httpx.Client(transport=httpx.MockTransport(down))).ok("good-token", None) is False


# ============================================================================ the person
def test_consents_come_with_the_current_notice_version_and_need_a_sign_in() -> None:
    client, repo, _ = world()
    assert client.get("/v1/me/consents").status_code == 401
    headers = auth("a_owner")
    body = client.get("/v1/me/consents", headers=headers).json()
    assert body["notice_version"] == "2026-10-25" and [c["purpose"] for c in body["consents"]] == ["service", "marketing"]
    assert body["consents"][1]["state"] == "not_given"
    assert repo.calls[0][1][0] == headers["Authorization"].removeprefix("Bearer ")


def test_giving_and_withdrawing_marketing_is_the_same_call() -> None:
    client, repo, _ = world()
    headers = auth("a_owner")
    given = client.put("/v1/me/consents/marketing", json={"given": True}, headers=headers).json()
    assert given["consents"][1]["state"] == "given" and given["history"][0]["via"] == "settings"
    withdrawn = client.put("/v1/me/consents/marketing", json={"given": False, "via": "settings"}, headers=headers).json()
    assert withdrawn["consents"][1]["state"] == "withdrawn" and len(withdrawn["history"]) == 2
    again = client.put("/v1/me/consents/marketing", json={"given": False}, headers=headers).json()
    assert len(again["history"]) == 2, "saying the same again writes nothing"
    # the notice version is the server's, not the browser's
    assert repo.calls[0][1][3] == "2026-10-25"


def test_the_sign_up_screen_may_say_it_came_from_google_or_signup_but_nothing_else() -> None:
    client, _, _ = world()
    headers = auth("a_owner")
    assert client.put("/v1/me/consents/marketing", json={"given": True, "via": "google"}, headers=headers).status_code == 200
    assert client.put("/v1/me/consents/marketing", json={"given": True, "via": "prompt"}, headers=headers).status_code == 422
    assert client.put("/v1/me/consents/marketing", json={"given": True, "notice_version": "x"}, headers=headers).status_code == 422
    assert client.put("/v1/me/consents/marketing", json={}, headers=headers).status_code == 422


def test_the_service_consent_cannot_be_switched_off_through_the_api() -> None:
    client, _, _ = world()
    assert client.put("/v1/me/consents/service", json={"given": False}, headers=auth("a_owner")).status_code in (404, 405)


def test_the_profile_can_be_read_and_corrected() -> None:
    client, repo, _ = world()
    headers = auth("a_viewer")
    assert client.get("/v1/me/profile").status_code == 401
    assert client.get("/v1/me/profile", headers=headers).json()["email"] == "asha@example.test"
    assert client.put("/v1/me/profile", json={"display_name": "  Asha Rao "}, headers=headers).json()["display_name"] == "Asha Rao"
    assert client.put("/v1/me/profile", json={"display_name": ""}, headers=headers).status_code == 422
    assert client.put("/v1/me/profile", json={"display_name": "x" * 101}, headers=headers).status_code == 422
    assert client.put("/v1/me/profile", json={"display_name": "A", "email": "x@y.z"}, headers=headers).status_code == 422


def test_without_the_runtime_the_routes_say_so() -> None:
    client, _ = make_client(policies=VERSIONS)
    assert client.get("/v1/privacy/notice").status_code == 503


# ============================================================================ the e-mails
GRIEVANCE_ITEM = {"id": str(uuid.uuid4()), "reference": "GR-2026-000007", "name": "Ravi Kumar", "contact": "ravi@example.test", "kind": "erasure", "details": "Please delete my data", "language": "te", "received_at": "2026-10-27T10:00:00+00:00", "due_on": "2026-11-26", "need_inbox": True, "need_ack": True}
WAITLIST_ITEM = {"id": str(uuid.uuid4()), "name": "Sita Devi", "business_type": "textiles", "city": "Guntur", "phone": "+919876543210", "email": None, "language": "te", "marketing_opt_in": True, "created_at": "2026-10-27T10:00:00+00:00"}


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn"])
def test_the_acknowledgement_carries_the_reference_and_the_date_and_none_of_the_persons_words(language: str) -> None:
    mail = dpdp_mail.compose_grievance_ack({**GRIEVANCE_ITEM, "language": language}, "ravi@example.test")
    assert "GR-2026-000007" in mail.subject and "2026-11-26" in mail.body and "30" in mail.body
    assert "Please delete" not in mail.body and "Ravi" not in mail.body and mail.html and "<" in mail.html
    assert "{" not in mail.body and "{" not in mail.subject


def test_the_privacy_inbox_gets_the_whole_grievance() -> None:
    mail = dpdp_mail.compose_grievance_inbox(GRIEVANCE_ITEM, "privacy@example.test")
    assert "GR-2026-000007" in mail.subject and "Ravi Kumar" in mail.body and "ravi@example.test" in mail.body and "Please delete my data" in mail.body
    assert mail.idempotency_key == f"grievance-inbox-{GRIEVANCE_ITEM['id']}"


def test_the_hello_inbox_gets_the_waitlist_entry_with_the_marketing_answer() -> None:
    mail = dpdp_mail.compose_waitlist_inbox(WAITLIST_ITEM, "hello@example.test")
    assert "Sita Devi" in mail.body and "+919876543210" in mail.body and "Agreed to marketing: yes" in mail.body


@pytest.mark.parametrize("language", ["en", "te", "hi"])
def test_the_erasure_warning_names_the_workspace_and_the_day(language: str) -> None:
    mail = dpdp_mail.compose_lapse_warning("Demo Silks", "2026-11-05", "owner@example.test", language, "t1")
    assert "Demo Silks" in mail.subject and "2026-11-05" in mail.subject and "2026-11-05" in mail.body and "{" not in mail.body
    assert mail.idempotency_key == "lapse-warning-t1-2026-11-05-owner@example.test"


def test_the_intake_mail_sends_then_marks_and_a_failed_send_is_not_marked() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    repo.due_intake = {"grievances": [GRIEVANCE_ITEM], "waitlist": [WAITLIST_ITEM]}
    sent = IntakeMail(repo, sender, "privacy@example.test", "hello@example.test").run("tok")
    assert sent == 3
    assert [e.to for e in sender.sent] == ["privacy@example.test", "ravi@example.test", "hello@example.test"]
    assert {(k, w) for k, _, w in repo.marks} == {("grievance", "inbox"), ("grievance", "ack"), ("waitlist", "inbox")}

    class Down(FakeEmailSender):
        def send(self, message: Any) -> bool:
            return False

    repo2 = FakeDpdpRepository()
    repo2.due_intake = {"grievances": [GRIEVANCE_ITEM], "waitlist": [WAITLIST_ITEM]}
    assert IntakeMail(repo2, Down(), "privacy@example.test", "hello@example.test").run("tok") == 0
    assert repo2.marks == []


def test_with_no_inbox_configured_nothing_is_sent_or_marked() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    repo.due_intake = {"grievances": [{**GRIEVANCE_ITEM, "need_ack": False}], "waitlist": [WAITLIST_ITEM]}
    IntakeMail(repo, sender, None, None).run("tok")
    assert sender.sent == [] and repo.marks == []


def test_an_acknowledgement_goes_only_to_an_e_mail_contact() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    repo.due_intake = {"grievances": [{**GRIEVANCE_ITEM, "contact": "+91 98765 43210", "need_inbox": False}], "waitlist": []}
    IntakeMail(repo, sender, "privacy@example.test", None).run("tok")
    assert sender.sent == []


# ============================================================================ the lapse erasure and the worker's steps
TENANT = str(uuid.uuid4())


def test_the_warning_is_sent_to_every_owner_then_marked_and_the_erasure_follows_only_when_the_database_offers_it() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    repo.due_lapse = {"warn": [{"tenant_id": TENANT, "tenant_name": "Demo Silks", "erase_on": "2026-11-05", "language": "en", "emails": ["a@example.test", "b@example.test"]}], "erase": [{"tenant_id": str(uuid.uuid4())}]}
    job = LapseErasure(repo, sender)
    assert job.run("tok") == 2
    assert [e.to for e in sender.sent] == ["a@example.test", "b@example.test"]
    assert repo.warned == [uuid.UUID(TENANT)] and len(repo.erased) == 1 and (job.warned, job.erased) == (1, 1)


def test_a_workspace_with_no_owner_address_is_not_marked_warned_so_it_is_never_erased() -> None:
    repo, sender = FakeDpdpRepository(), FakeEmailSender()
    repo.due_lapse = {"warn": [{"tenant_id": TENANT, "tenant_name": "X", "erase_on": "2026-11-05", "language": "en", "emails": []}], "erase": []}
    assert LapseErasure(repo, sender).run("tok") == 0
    assert repo.warned == [] and sender.sent == []


def test_a_failed_warning_e_mail_is_not_marked() -> None:
    class Down(FakeEmailSender):
        def send(self, message: Any) -> bool:
            return False

    repo = FakeDpdpRepository()
    repo.due_lapse = {"warn": [{"tenant_id": TENANT, "tenant_name": "X", "erase_on": "2026-11-05", "language": "en", "emails": ["a@example.test"]}], "erase": []}
    LapseErasure(repo, Down()).run("tok")
    assert repo.warned == []


def test_the_logs_are_purged_at_most_once_an_hour() -> None:
    repo = FakeDpdpRepository()
    clock = [0.0]
    jobs = DpdpJobs(None, None, repo, purge_window=SlidingWindow(1, 3600.0, clock=lambda: clock[0]))
    jobs.run("tok")
    clock[0] = 1800.0
    jobs.run("tok")
    assert repo.purges == 1
    clock[0] = 3601.0
    jobs.run("tok")
    assert repo.purges == 2


def test_the_worker_runs_the_dpdp_steps_in_its_tick_and_a_crash_does_not_fail_it(caplog: pytest.LogCaptureFixture) -> None:
    repo = FakeDpdpRepository()
    worker = Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, dpdp_jobs=DpdpJobs(IntakeMail(repo, FakeEmailSender(), None, None), LapseErasure(repo, FakeEmailSender()), repo))
    assert worker.tick_once() is not None
    assert [c[0] for c in repo.calls] == ["intake_due", "lapse_due", "purge_logs"]
    repo.fail = ValueError("nope")
    with caplog.at_level(logging.ERROR):
        assert worker.tick_once() is not None
    assert "dpdp jobs crashed: ValueError" in caplog.text


# ============================================================================ "download my data": JSON and CSV
def test_the_csv_has_the_keys_in_first_seen_order_a_byte_order_mark_and_one_row_per_record() -> None:
    raw = _csv_bytes([{"id": 1, "name": "Zoë"}, {"id": 2, "city": "Pune"}])
    assert raw.startswith(b"\xef\xbb\xbf")
    lines = raw.decode("utf-8-sig").splitlines()
    assert lines == ["id,name,city", "1,Zoë,", "2,,Pune"]


def test_an_object_is_one_row_and_nested_values_are_json() -> None:
    lines = _csv_bytes({"a": {"b": 1}, "c": [1, 2], "d": None, "e": True}).decode("utf-8-sig").splitlines()
    assert lines[0] == "a,c,d,e" and lines[1] == '"{""b"": 1}","[1, 2]",,true'


@pytest.mark.parametrize("text", ["=SUM(A1)", "+1 call me", "-cmd", "@home", "\tx"])
def test_a_text_that_a_spreadsheet_would_run_as_a_formula_gets_an_apostrophe(text: str) -> None:
    cell = _csv_bytes([{"v": text}]).decode("utf-8-sig").splitlines()[1]
    assert cell.startswith("'") or cell.startswith('"\'')


def test_a_plain_negative_number_stays_a_number() -> None:
    assert _csv_bytes([{"v": -5}, {"v": "-12.5"}, {"v": "+91"}]).decode("utf-8-sig").splitlines()[1:] == ["-5", "-12.5", "+91"]


def test_the_person_file_holds_every_json_file_as_csv_too_and_the_consents() -> None:
    data = {"account": {"id": "u1", "email": "a@example.test"}, "memberships": [], "consents": [{"purpose": "marketing", "action": "given", "at": "2026-10-27", "notice_version": "2026-10-25", "via": "settings"}]}
    built = build_person_export(data, datetime(2026, 10, 27, 12, 0, tzinfo=UTC))
    names = set(zipfile.ZipFile(io.BytesIO(built.content)).namelist())
    assert {"consents.json", "consents.csv", "profile.json", "profile.csv", "workspaces.csv", "manifest.json", "README.txt"} <= names
    zf = zipfile.ZipFile(io.BytesIO(built.content))
    assert json.loads(zf.read("consents.json"))[0]["purpose"] == "marketing"
    assert "marketing,given" in zf.read("consents.csv").decode("utf-8-sig")
    assert "consents.json" in zf.read("README.txt").decode() and ".csv" in zf.read("README.txt").decode()


# ============================================================================ the erasure warning on the access answer
ACCESS = {"access": "read_only", "read_only_since": "2026-07-01", "delete_on": "2026-09-29", "data_days_left": 1, "can_resume": True, "sending": "off", "waiting_for": None}


def test_a_read_only_workspace_shows_when_the_erasure_warning_went() -> None:
    repo = FakeDpdpRepository()
    repo.warning_sent_at = "2026-09-27T12:00:01+00:00"
    client, _ = make_client(dpdp=DpdpRuntime(repo), billing=SimpleNamespace(access=lambda token, tenant: dict(ACCESS), ensure=lambda *a, **k: None))
    body = client.get(f"/v1/tenants/{TENANT_A.id}/billing/access", headers=auth("a_viewer")).json()
    assert body["erasure_warning_sent_at"].startswith("2026-09-27")


def test_a_full_workspace_has_no_warning_and_costs_no_extra_call() -> None:
    repo = FakeDpdpRepository()
    client, _ = make_client(dpdp=DpdpRuntime(repo), billing=SimpleNamespace(access=lambda token, tenant: {**ACCESS, "access": "full", "can_resume": False, "sending": "on"}, ensure=lambda *a, **k: None))
    body = client.get(f"/v1/tenants/{TENANT_A.id}/billing/access", headers=auth("a_viewer")).json()
    assert body["erasure_warning_sent_at"] is None and repo.calls == []
