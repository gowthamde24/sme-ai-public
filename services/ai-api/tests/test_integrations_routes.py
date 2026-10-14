"""Job BI: the HTTP side of the integrations against in-memory fakes. The role matrix (and the second factor) of every endpoint, WHAT is sent to the data layer, the file safety of the uploads, the
spreadsheet job flow (preview, the same-file rule, replay, a failed job run again, stock), the calendar feed (hashes only, rotation, revoke, the public read, the rate limits), the policy
acceptance and the voice status. The database rules are pgTAP 83; the real stack is tests/integration/test_bi_integrations_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

import pytest

from app.integrations import routes_calendar
from app.integrations.errors import ExportTooLargeError
from app.integrations.policy import PolicyVersions
from app.integrations.ratelimit import SlidingWindow
from app.integrations.xlsx import write_xlsx
from app.voice.fake import FakeStt, FakeTts
from app.voice.interface import VoiceStack
from tests.fakes import TENANT_A, auth, make_client
from tests.integrations_fakes import FakeIntegrations

T = f"/v1/tenants/{TENANT_A.id}"
ROLES = ("a_owner", "a_admin", "a_sales", "a_viewer")
JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddd01"
EXPORT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
CUSTOMERS = b"Party Name,Mobile,Email,City\nRavi Silks,9876543210,,Hyderabad\nLakshmi Sarees,,l@example.test,Guntur\n"


@pytest.fixture(autouse=True)
def _fresh_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes_calendar, "PER_TOKEN", SlidingWindow(60, 3600))
    monkeypatch.setattr(routes_calendar, "PER_ADDRESS", SlidingWindow(240, 600))
    monkeypatch.setattr(routes_calendar, "UNKNOWN_PER_ADDRESS", SlidingWindow(20, 600))


class World:
    def __init__(self, **kw: Any) -> None:
        self.db = FakeIntegrations()
        self.client, _ = make_client(integrations=self.db, **kw)

    def call(self, method: str, path: str, user: str | None, body: Any = None, **claims: Any) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, path, json=body, headers=headers)

    def upload(self, path: str, user: str | None, data: bytes, content_type: str = "text/csv", **claims: Any) -> Any:
        headers = auth(user, **claims) if user else {}
        headers["Content-Type"] = content_type
        return self.client.post(path, content=data, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


# ------------------------------------------------------------------------------------------------------------------------ accounting export
EXPORT_BODY = {"export_id": EXPORT, "format": "csv", "from_date": "2026-10-01", "to_date": "2026-10-31"}


def test_the_export_is_for_owner_and_admin_with_a_second_factor(w: World) -> None:
    for user in ROLES:
        r = w.call("POST", T + "/exports/accounting", user, EXPORT_BODY)
        assert r.status_code == (200 if user in ("a_owner", "a_admin") else 403), user
    assert w.call("POST", T + "/exports/accounting", "a_owner", EXPORT_BODY, aal="aal1").status_code == 403
    assert w.call("POST", T + "/exports/accounting", None, EXPORT_BODY).status_code == 401
    assert w.call("POST", T + "/exports/accounting", "outsider", EXPORT_BODY).status_code == 404, "another business is not even found"
    assert [c[0] for c in w.db.calls] == ["export_data", "export_data"], "only the two allowed calls reached the data layer"


def test_the_file_comes_back_with_its_headers_and_the_callers_own_token(w: World) -> None:
    for fmt, ctype, ext in (("tally_zip", "application/zip", "zip"), ("tally_vouchers_xml", "application/xml", "xml"), ("vyapar_xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"), ("csv", "text/csv", "csv")):
        r = w.call("POST", T + "/exports/accounting", "a_owner", {**EXPORT_BODY, "format": fmt})
        assert r.status_code == 200 and r.headers["content-type"].startswith(ctype)
        assert r.headers["content-disposition"] == f'attachment; filename="{r.headers["content-disposition"].split(chr(34))[1]}"' and r.headers["content-disposition"].endswith(f'.{ext}"')
        assert r.headers["cache-control"] == "no-store" and r.headers["x-export-id"] == EXPORT and r.headers["x-content-sha256"] == hashlib.sha256(r.content).hexdigest()
    sent = w.db.calls[0][1]
    assert sent[0] == str(TENANT_A.id) and sent[1] == EXPORT and sent[3:] == ("2026-10-01", "2026-10-31")
    assert w.db.tokens[0].count(".") == 2, "the caller's JWT, never a service key"  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "body",
    [
        {**EXPORT_BODY, "to_date": "2026-09-01"}, {**EXPORT_BODY, "from_date": "2025-01-01"}, {**EXPORT_BODY, "format": "pdf"}, {**EXPORT_BODY, "export_id": "nope"},
        {**EXPORT_BODY, "extra": 1}, {"format": "csv"}, {**EXPORT_BODY, "from_date": "05/10/2026"},
    ],
)  # fmt: skip
def test_a_bad_export_request_is_a_422_before_the_data_layer(w: World, body: dict[str, Any]) -> None:
    assert w.call("POST", T + "/exports/accounting", "a_owner", body).status_code == 422
    assert w.db.calls == []


def test_a_window_with_too_much_is_a_fixed_422(w: World) -> None:
    w.db.fail = ExportTooLargeError("SM601")
    r = w.call("POST", T + "/exports/accounting", "a_owner", EXPORT_BODY)
    assert r.status_code == 422 and r.json()["error"]["code"] == "export_too_large" and "SM601" not in r.text


def test_the_formats_list_is_for_the_same_people(w: World) -> None:
    assert w.call("GET", T + "/exports/accounting/formats", "a_sales").status_code == 403
    got = w.call("GET", T + "/exports/accounting/formats", "a_owner").json()["formats"]
    assert [f["format"] for f in got] == ["tally_zip", "tally_masters_xml", "tally_vouchers_xml", "vyapar_xlsx", "csv", "xlsx"]


def test_without_the_data_layer_the_export_says_so() -> None:
    client, _ = make_client()
    r = client.post(T + "/exports/accounting", json=EXPORT_BODY, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "integrations_unavailable"


# ------------------------------------------------------------------------------------------------------------------------ spreadsheet import
S = T + "/imports/spreadsheet"


def test_inspect_suggests_the_columns_and_changes_nothing(w: World) -> None:
    r = w.upload(S + "/inspect?kind=customers", "a_owner", CUSTOMERS)
    assert r.status_code == 200
    body = r.json()
    assert body["suggested_mapping"] == {"company_name": 0, "contact_phone": 1, "contact_email": 2, "city": 3} and body["rows"] == 2 and body["file_kind"] == "csv"
    assert body["file_sha256"] == hashlib.sha256(CUSTOMERS).hexdigest() and body["sample"][0][0] == "Ravi Silks"
    assert [c["suggested_field"] for c in body["columns"]] == ["company_name", "contact_phone", "contact_email", "city"]
    assert {f["field"] for f in body["fields"] if f["required"]} == {"company_name"}
    assert w.db.calls == [], "inspect touches no data"


def test_the_import_is_for_owner_and_admin_only(w: World) -> None:
    for user in ("a_sales", "a_viewer"):
        assert w.upload(S + "/inspect?kind=customers", user, CUSTOMERS).status_code == 403
        assert w.upload(S + f"/preview?kind=customers&job_id={JOB}", user, CUSTOMERS).status_code == 403
        assert w.upload(S + f"/{JOB}/confirm", user, CUSTOMERS).status_code == 403
        assert w.call("GET", S + "/jobs", user).status_code == 403
    assert w.upload(S + "/inspect?kind=customers", "outsider", CUSTOMERS).status_code == 404
    assert w.upload(S + "/inspect?kind=customers", None, CUSTOMERS).status_code == 401
    assert w.db.calls == []


def preview(w: World, data: bytes = CUSTOMERS, kind: str = "customers", mapping: str = "", user: str = "a_owner", **claims: Any) -> Any:
    return w.upload(S + f"/preview?kind={kind}&job_id={JOB}{mapping}", user, data, **claims)


def test_preview_gives_a_verdict_per_row_and_a_job(w: World) -> None:
    r = preview(w)
    assert r.status_code == 200
    body = r.json()
    assert [(x["line"], x["status"], x["label"]) for x in body["rows"]] == [(2, "will_create", "Ravi Silks"), (3, "will_create", "Lakshmi Sarees")]
    assert body["rows"][0]["note"] == "contact_named_after_company" and body["counts"]["rows"] == 2 and body["counts"]["will_create"] == 2
    assert body["job"]["id"] == JOB and body["job"]["status"] == "previewed" and body["job"]["file_sha256"] == hashlib.sha256(CUSTOMERS).hexdigest()
    assert "Ravi" not in json.dumps(w.db.jobs[JOB]), "the stored job holds hashes, numbers and counts, no cell value"


def test_preview_with_a_chosen_mapping_and_bad_mappings(w: World) -> None:
    ok = preview(w, mapping="&mapping=" + json.dumps({"company_name": 0, "city": 3}))
    assert ok.status_code == 200 and ok.json()["mapping"] == {"company_name": 0, "city": 3}
    for bad in ('{"city": 3}', '{"company_name": 9}', "not json", '{"company_name": 0, "city": 0}', '{"nope": 1}'):
        r = preview(w, mapping="&mapping=" + bad)
        assert r.status_code == 422 and r.json()["error"]["code"].startswith("mapping_"), bad


def test_file_problems_are_reported_per_row_by_code_only(w: World) -> None:
    data = b'Party,City\n"=1+1",x\nSafe,Hyd\n,Gnt\n'
    body = preview(w, data).json()
    assert [(i["line"], i["code"], i["field"]) for i in body["issues"]] == [(2, "formula_like", "company_name"), (4, "company_name_missing", "company_name")]
    assert "=1+1" not in json.dumps(body), "no cell is echoed in an issue"
    assert body["counts"]["file_problems"] == 2 and body["counts"]["usable"] == 1


@pytest.mark.parametrize(
    ("data", "ctype", "status", "code"),
    [(b"", "text/csv", 422, "file_empty"), (b"a,b\n\x80\x81,1\n", "text/csv", 422, "file_not_utf8"), (b"x" * 3_100_000, "text/csv", 413, "file_too_large"),
     (b"PK\x03\x04junk", "application/octet-stream", 415, "file_not_xlsx"), (b"n\n" + b"x\n" * 5001, "text/csv", 422, "file_too_many_rows")],
)  # fmt: skip
def test_bad_files_are_refused_with_closed_codes(w: World, data: bytes, ctype: str, status: int, code: str) -> None:
    r = w.upload(S + "/inspect?kind=customers", "a_owner", data, ctype)
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_an_xlsx_upload_works_like_a_csv(w: World) -> None:
    data = write_xlsx([("Sheet1", [["Party Name", "Phone", "City"], ["Ravi Silks", 9876543210, "Hyderabad"]])])
    r = w.upload(S + "/inspect?kind=customers", "a_owner", data, "application/octet-stream")
    assert r.status_code == 200 and r.json()["file_kind"] == "xlsx" and r.json()["sample"] == [["Ravi Silks", "9876543210", "Hyderabad"]]


def confirm(w: World, data: bytes = CUSTOMERS, user: str = "a_owner", **claims: Any) -> Any:
    return w.upload(S + f"/{JOB}/confirm", user, data, **claims)


def test_confirm_needs_a_second_factor_and_the_same_file(w: World) -> None:
    preview(w)
    assert confirm(w, aal="aal1").status_code == 403
    changed = CUSTOMERS.replace(b"Ravi", b"Ravo")
    r = confirm(w, changed)
    assert r.status_code == 409 and r.json()["error"]["code"] == "import_file_changed"
    assert w.db.jobs[JOB]["status"] != "completed"
    assert not any(c[0] == "job_finish" and c[1][0] == "completed" for c in w.db.calls)


def test_confirm_runs_the_import_closes_the_job_and_a_rerun_replays(w: World) -> None:
    preview(w)
    r = confirm(w)
    assert r.status_code == 200
    body = r.json()
    assert body["replay"] is False and body["job"]["status"] == "completed" and body["result"]["counts"]["created"] == 2 and body["result"]["counts"]["rows"] == 2
    assert [x["status"] for x in body["result"]["rows"]] == ["created", "created"] and [x["line"] for x in body["result"]["rows"]] == [2, 3]
    again = confirm(w)
    assert again.status_code == 200 and again.json()["replay"] is True and again.json()["result"] is None
    assert [c[0] for c in w.db.calls].count("job_finish") == 1, "the second run did not import or close anything again"


def test_the_import_uses_the_existing_lead_import_with_the_job_id_as_the_batch() -> None:
    from tests.fakes import FakeLeadsRepository

    leads = FakeLeadsRepository()
    w2 = World(leads=leads)
    preview(w2)
    confirm(w2)
    assert leads.calls == ["import_leads", "import_leads"], "one dry run for the preview, one real run"


def test_an_unknown_job_and_the_job_list(w: World) -> None:
    assert confirm(w).status_code == 404
    preview(w)
    assert w.call("GET", S + "/jobs", "a_admin").json()["jobs"][0]["id"] == JOB
    assert w.call("GET", S + f"/jobs/{JOB}", "a_owner").json()["kind"] == "customers"
    assert w.call("GET", S + "/jobs/not-a-uuid", "a_owner").status_code == 422


def test_a_failed_run_is_recorded_and_may_be_run_again(w: World) -> None:
    from tests.fakes import FakeLeadsRepository

    leads = FakeLeadsRepository()
    w2 = World(leads=leads)
    preview(w2)
    first_calls = len(w2.db.calls)
    leads_calls = leads.calls
    original = leads.import_leads

    def boom(*a: Any, **k: Any) -> Any:
        if not k.get("dry_run"):
            raise RuntimeError("down")
        return original(*a, **k)

    leads.import_leads = boom  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        confirm(w2)
    assert w2.db.jobs[JOB]["status"] == "failed" and len(w2.db.calls) > first_calls
    leads.import_leads = original  # type: ignore[method-assign]
    ok = confirm(w2)
    assert ok.status_code == 200 and ok.json()["job"]["status"] == "completed" and leads_calls


STOCK = b"Design,Status\nMaroon Kanchi pattu,few left\nGreen Dharmavaram,in stock\nNo such saree,in stock\n"


def stock_world() -> World:
    w2 = World()
    w2.db.catalogue = [
        {"id": "11111111-1111-4111-8111-111111111111", "name": "Maroon Kanchi pattu", "stock_status": "in_stock", "active": True},
        {"id": "22222222-2222-4222-8222-222222222222", "name": "Green Dharmavaram", "stock_status": "in_stock", "active": False},
    ]
    return w2


def test_stock_preview_shows_old_and_new_and_changes_nothing() -> None:
    w2 = stock_world()
    body = preview(w2, STOCK, "stock").json()
    assert [(r["status"], r["old_status"], r["new_status"]) for r in body["rows"]] == [("will_change", "in_stock", "few_left"), ("unchanged", "in_stock", "in_stock"), ("not_found", None, "in_stock")]
    assert body["counts"]["will_change"] == 1 and w2.db.applied == []


def test_stock_confirm_applies_only_the_changes() -> None:
    w2 = stock_world()
    preview(w2, STOCK, "stock")
    r = confirm(w2, STOCK)
    assert r.status_code == 200 and r.json()["result"]["counts"]["updated"] == 1 and r.json()["result"]["counts"]["not_found"] == 1
    assert w2.db.applied == [{"id": "11111111-1111-4111-8111-111111111111", "stock_status": "few_left"}]
    assert w2.db.catalogue[1]["stock_status"] == "in_stock"


# ------------------------------------------------------------------------------------------------------------------------ calendar feed
def make_feed(w: World, user: str = "a_owner") -> dict[str, Any]:
    r = w.call("POST", T + "/calendar-feed", user)
    assert r.status_code == 201
    return r.json()  # type: ignore[no-any-return]


def test_every_member_can_make_see_and_revoke_a_feed(w: World) -> None:
    for user in ROLES:
        assert w.call("POST", T + "/calendar-feed", user).status_code == 201, user
        assert w.call("GET", T + "/calendar-feed", user).json()["active"] is True
    assert w.call("POST", T + "/calendar-feed", "outsider").status_code == 404
    assert w.call("POST", T + "/calendar-feed", None).status_code == 401
    assert w.call("POST", T + "/calendar-feed/revoke", "a_sales").json()["revoked"] == 1


def test_the_token_is_shown_once_and_only_its_hash_is_stored(w: World) -> None:
    made = make_feed(w)
    token = made["token"]
    assert len(token) == 43 and made["path"] == f"/v1/calendar/feed/{token}.ics" and made["shown_once"] is True
    stored = [c[1] for c in w.db.calls if c[0] == "calendar_create"]
    assert stored == [hashlib.sha256(token.encode()).hexdigest()] and token not in json.dumps(w.db.calls)
    assert token not in json.dumps(w.call("GET", T + "/calendar-feed", "a_owner").json())


def test_the_public_feed_needs_no_sign_in_and_is_text_calendar(w: World) -> None:
    token = make_feed(w)["token"]
    digest = hashlib.sha256(token.encode()).hexdigest()
    w.db.feeds[digest]["events"] = [{"id": "v1", "starts_at": "2026-10-06T05:30:00+00:00", "ends_at": "2026-10-06T06:00:00+00:00", "status": "booked", "party_size": 3, "label": "Ravi K.", "updated_at": "2026-10-05T08:00:00+00:00"}]
    r = w.client.get(f"/v1/calendar/feed/{token}.ics")
    assert r.status_code == 200 and r.headers["content-type"] == "text/calendar; charset=utf-8" and "private" in r.headers["cache-control"]
    assert "BEGIN:VEVENT" in r.text and "SUMMARY:Visit: Ravi K." in r.text and "DTSTART:20261006T053000Z" in r.text and r.text.endswith("END:VCALENDAR\r\n")
    assert r.headers["x-robots-tag"].startswith("noindex")
    assert w.db.tokens[-1] is None, "the public read carries no person's token"


def test_unknown_malformed_and_revoked_tokens_are_the_same_404(w: World) -> None:
    made = make_feed(w)
    bodies = set()
    for path in ("x" * 43 + ".ics", "short.ics", made["token"], "../etc/passwd.ics", "A" * 44 + ".ics"):
        r = w.client.get(f"/v1/calendar/feed/{path}")
        assert r.status_code in (404, 422) or r.status_code == 404
        bodies.add(r.status_code)
    assert bodies == {404}
    w.call("POST", T + "/calendar-feed/revoke", "a_owner")
    assert w.client.get(f"/v1/calendar/feed/{made['token']}.ics").status_code == 404, "a revoked address stops at once"


def test_rotating_stops_the_old_address(w: World) -> None:
    old = make_feed(w)["token"]
    new = make_feed(w)["token"]
    assert old != new
    assert w.client.get(f"/v1/calendar/feed/{old}.ics").status_code == 404 and w.client.get(f"/v1/calendar/feed/{new}.ics").status_code == 200


def test_the_feed_is_rate_limited_per_token_per_address_and_for_scans(monkeypatch: pytest.MonkeyPatch, w: World) -> None:
    token = make_feed(w)["token"]
    monkeypatch.setattr(routes_calendar, "PER_TOKEN", SlidingWindow(3, 3600))
    codes = [w.client.get(f"/v1/calendar/feed/{token}.ics").status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert w.client.get(f"/v1/calendar/feed/{token}.ics").headers["retry-after"].isdigit()
    monkeypatch.setattr(routes_calendar, "UNKNOWN_PER_ADDRESS", SlidingWindow(2, 600))
    scan = [w.client.get(f"/v1/calendar/feed/{secrets_like(i)}.ics").status_code for i in range(4)]
    assert scan == [404, 404, 429, 429], "a scan for tokens is stopped after a few misses"


def secrets_like(i: int) -> str:
    return (str(i) * 43)[:43]


# ------------------------------------------------------------------------------------------------------------------------ policy
def test_current_versions_need_no_sign_in() -> None:
    client, _ = make_client(integrations=FakeIntegrations(), policies=PolicyVersions("2026-11-01", "2026-10-15"))
    assert client.get("/v1/policies/current").json() == {"terms": {"version": "2026-11-01"}, "privacy": {"version": "2026-10-15"}}
    client2, _ = make_client()
    assert client2.get("/v1/policies/current").json() == {"terms": {"version": "2026-10-01"}, "privacy": {"version": "2026-10-01"}}


def test_accepting_the_current_versions_is_recorded_and_idempotent(w: World) -> None:
    mine = w.call("GET", "/v1/me/policy-acceptances", "a_sales").json()
    assert mine["needs_acceptance"] == {"terms": True, "privacy": True} and mine["accepted"] == []
    r = w.call("POST", "/v1/me/policy-acceptances", "a_sales", {"terms_version": "2026-10-01", "privacy_version": "2026-10-01"})
    assert r.status_code == 200 and r.json()["needs_acceptance"] == {"terms": False, "privacy": False}
    again = w.call("POST", "/v1/me/policy-acceptances", "a_sales", {"terms_version": "2026-10-01"})
    assert again.status_code == 200 and len(again.json()["accepted"]) == 2
    assert all(c[1][2] == "prompt" for c in w.db.calls if c[0] == "policy_accept")


@pytest.mark.parametrize("body", [{"terms_version": "old"}, {"privacy_version": "2025-01-01"}, {"terms_version": "2026-10-01", "privacy_version": "old"}])
def test_an_outdated_version_is_a_409_and_records_nothing(w: World, body: dict[str, str]) -> None:
    r = w.call("POST", "/v1/me/policy-acceptances", "a_sales", body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "policy_version_outdated" and w.db.accepted == []


@pytest.mark.parametrize("body", [{}, {"terms_version": "bad version!"}, {"terms_version": "x" * 40}, {"extra": 1}])
def test_a_bad_acceptance_body_is_a_422(w: World, body: dict[str, Any]) -> None:
    assert w.call("POST", "/v1/me/policy-acceptances", "a_sales", body).status_code == 422


def test_policy_routes_need_a_sign_in(w: World) -> None:
    assert w.call("GET", "/v1/me/policy-acceptances", None).status_code == 401
    assert w.call("POST", "/v1/me/policy-acceptances", None, {"terms_version": "2026-10-01"}).status_code == 401


def test_first_login_setup_records_the_acceptance_first(w: World) -> None:
    body = {"business_type": "textiles", "language": "te", "accepted_terms_version": "2026-10-01", "accepted_privacy_version": "2026-10-01"}
    r = w.call("POST", "/v1/account/setup", "a_sales", body)
    assert r.status_code in (200, 201, 409, 404) and [c[0] for c in w.db.calls][:1] == ["policy_accept"]
    assert w.db.calls[0][1] == ("2026-10-01", "2026-10-01", "setup")
    stale = w.call("POST", "/v1/account/setup", "a_sales", {**body, "accepted_terms_version": "old"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "policy_version_outdated"


def test_setup_without_versions_is_unchanged(w: World) -> None:
    w.call("POST", "/v1/account/setup", "a_sales", {"business_type": "textiles", "language": "en"})
    assert w.db.calls == [], "no versions sent: nothing recorded (the web sends them from JOB BH on)"


# ------------------------------------------------------------------------------------------------------------------------ voice status
def test_voice_status_says_what_is_switched_on_and_touches_no_provider() -> None:
    off, _ = make_client()
    r = off.get(T + "/assistant/voice/status", headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["available"] is False and r.json()["languages"] == [] and r.json()["max_seconds"] == 60
    stt, tts = FakeStt("hello", "en"), FakeTts()
    on, _ = make_client(voice=VoiceStack(stt=stt, tts=tts))
    body = on.get(T + "/assistant/voice/status", headers=auth("a_sales")).json()
    assert body["available"] is True and body["speech_available"] is True and body["languages"] == ["en", "te", "hi", "kn", "ta"] and "audio/webm" in body["content_types"]
    only_stt, _ = make_client(voice=VoiceStack(stt=stt))
    assert only_stt.get(T + "/assistant/voice/status", headers=auth("a_sales")).json()["speech_available"] is False
    assert not stt.calls if hasattr(stt, "calls") else True


def test_voice_status_roles() -> None:
    client, _ = make_client(voice=VoiceStack(stt=FakeStt()))
    for user, status in (("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 403), ("outsider", 404)):
        assert client.get(T + "/assistant/voice/status", headers=auth(user)).status_code == status, user
    assert client.get(T + "/assistant/voice/status").status_code == 401
    assert uuid.UUID(int=1)


def test_the_feed_token_never_reaches_a_log_line() -> None:
    from app.logging_safety import redact_path

    token = "A" * 43
    assert redact_path(f"/v1/calendar/feed/{token}.ics") == "/v1/calendar/feed/<redacted>"
    assert redact_path(f"/v1/calendar/feed/{token}") == "/v1/calendar/feed/<redacted>"
