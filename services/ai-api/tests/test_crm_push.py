"""Results into a business's own CRM or sheet (docs/contracts/crm-push.md): the record, the guarded client, every adapter against a fake of the vendor's documented API, the worker pass and the routes (Owner and Admin only, keys
shown never, the kill switch). No test reaches the network: the other tools are fakes."""

# ruff: noqa: E501, S104, S105, S106

from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from app.crm_push.adapters.airtable import Airtable
from app.crm_push.adapters.base import Outcome
from app.crm_push.adapters.bitrix24 import Bitrix24
from app.crm_push.adapters.freshsales import Freshsales
from app.crm_push.adapters.hubspot import HubSpot
from app.crm_push.adapters.kylas import Kylas
from app.crm_push.adapters.leadsquared import LeadSquared
from app.crm_push.adapters.notion import Notion
from app.crm_push.adapters.oauth import Salesforce, ZohoCrm
from app.crm_push.adapters.pipedrive import Pipedrive
from app.crm_push.adapters.selldo import SellDo
from app.crm_push.adapters.sheets import SCRIPT, GoogleSheets
from app.crm_push.fields import NOTE, Record, clean_mapping, has_note, note_text, record_from
from app.crm_push.registry import build_registry
from app.crm_push.runner import CrmPushRunner
from app.crm_push.service import CrmPush, secret_name
from app.crm_push.transport import Answer, GuardedHttp
from app.tenancy.repository import Forbidden
from app.webhooks_out import ssrf
from app.workspace_secrets import FakeSecretStore
from tests.aw_fakes import _uid
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/connectors/crm"
WORKER = "worker-token"
PUBLIC = "93.184.216.34"
KEY = "sekret-key-0123456789"


# ============================================================================ a fake of the other tool
class FakeHttp:
    """Answers by 'METHOD path' (a regex searched in the full address). Records every call. A call nobody expects is a 599 and fails the test."""

    def __init__(self, *routes: tuple[str, Answer | Callable[[dict[str, Any]], Answer]]) -> None:
        self.routes = list(routes)
        self.calls: list[dict[str, Any]] = []

    def request(self, method: str, url: str, *, headers: dict[str, str] | None = None, json_body: Any = None, form: dict[str, str] | None = None, query: dict[str, str] | None = None) -> Answer:
        call = {"method": method, "url": url, "headers": headers or {}, "json": json_body, "form": form, "query": query or {}}
        self.calls.append(call)
        for pattern, answer in self.routes:
            if re.search(pattern, f"{method} {url}"):
                return answer(call) if callable(answer) else answer
        return Answer(status=599)

    def seen(self, pattern: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if re.search(pattern, f"{c['method']} {c['url']}")]


def ok(body: Any = None, status: int = 200) -> Answer:
    return Answer(status=status, body=body)


def call_record(**kw: Any) -> Record:
    base: dict[str, Any] = {"event": "call.completed", "event_id": "evt_abc", "name": "Asha Reddy", "phone": "+919800000001", "email": "asha@example.com", "source": "My website", "outcome": "interested",
                            "summary": "Wants a visit on Saturday.", "captured": {"Budget": "45 lakh"}, "duration_s": 130, "call_id": "call-1", "lead_id": "lead-1"}
    return Record(**{**base, **kw})


def lead_record() -> Record:
    return call_record(event="lead.created", outcome="", summary="", captured={}, duration_s=None, call_id="")


# ============================================================================ the record
def test_a_call_event_becomes_a_record_with_the_leads_own_contact_and_no_transcript() -> None:
    data = {"call": {"id": "c1", "outcome": "interested", "state": "completed", "summary": "Wants a visit.", "duration_seconds": 61, "captured": {"Budget": "45 lakh", "x": {"nested": 1}}, "simulated": False, "sandbox": False, "transcript": "SECRET WORDS"},
            "lead": {"lead_id": "l1", "contact_id": "k1", "name": "Asha Reddy", "phone": "+919800000001", "email": "a@x.in"}, "source": "My website", "lead_id": "l1"}
    rec = record_from("call.completed", "evt_1", data)
    assert (rec.name, rec.phone, rec.email, rec.source, rec.outcome, rec.duration_s, rec.call_id, rec.lead_id) == ("Asha Reddy", "+919800000001", "a@x.in", "My website", "interested", 61, "c1", "l1")
    assert rec.captured == {"Budget": "45 lakh"} and not rec.sandbox
    assert "SECRET WORDS" not in repr(rec)


def test_a_lead_event_reads_the_contact_inside_the_lead_and_a_test_lead_or_sandbox_call_is_flagged() -> None:
    lead = record_from("lead.created", "evt_2", {"lead": {"id": "l1", "status": "new", "source": "Meta", "is_test": True, "contact": {"name": "T", "phone": "+91980", "email": None}}})
    assert (lead.name, lead.source, lead.sandbox) == ("T", "Meta", True)
    sandbox = record_from("call.completed", "evt_3", {"call": {"id": "c", "sandbox": True}, "lead": {"name": "A"}})
    assert sandbox.sandbox
    assert record_from("job.outcome", "evt_4", {"outcome": {"outcome": "won", "reason": "paid", "source_id": "c9"}, "lead": {"name": "B", "phone": "+9199"}}).outcome == "won"


def test_the_note_has_only_what_is_mapped_to_it_and_the_events_reference() -> None:
    mapping = {"outcome": NOTE, "summary": NOTE, "duration": NOTE, "captured": "", "call_id": ""}
    text = note_text(call_record(), mapping)
    assert text.splitlines()[0] == "Stack19: Call answered" and "Result: interested" in text and "Duration: 2 min 10 s" in text and "Details" not in text and text.endswith("Ref: evt_abc")
    assert not has_note(lead_record(), mapping), "a lead event has no note"
    assert has_note(call_record(event="call.missed", outcome="", summary="", captured={}), {}), "a missed call is still a note"


def test_a_mapping_is_checked() -> None:
    allowed = ("name", "phone", "summary")
    assert clean_mapping({"name": "firstname", "summary": NOTE, "phone": ""}, allowed) == {"name": "firstname", "summary": NOTE, "phone": ""}
    for bad in ({"nope": "x"}, {"name": "a;drop"}, {"name": 3}, {"name": "x" * 80}, ["name"], {"name": "<b>"}):
        assert clean_mapping(bad, allowed) is None


# ============================================================================ the guarded client
def _dns(extra: dict[str, list[str]] | None = None) -> ssrf.Resolver:
    table = {"api.example.com": [PUBLIC], **(extra or {})}
    return lambda host, port: table.get(host, [])


def test_the_client_connects_to_the_checked_address_follows_no_redirect_and_cuts_a_big_answer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/moved":
            return httpx.Response(302, headers={"Location": "https://127.0.0.1/admin"})
        if request.url.path == "/big":
            return httpx.Response(200, content=b'{"a":"' + b"x" * 300_000 + b'"}')
        return httpx.Response(200, json={"id": 7}, headers={"x-secret": "no"})

    http = GuardedHttp(resolver=_dns(), transport=httpx.MockTransport(handler))
    got = http.request("POST", "https://api.example.com/v1/x", headers={"Authorization": "Bearer k"}, json_body={"a": 1}, query={"limit": "1"})
    assert got.ok and got.body == {"id": 7} and seen[0].url.host == PUBLIC and seen[0].url.params["limit"] == "1" and seen[0].headers["host"] == "api.example.com"
    assert json.loads(seen[0].content) == {"a": 1} and seen[0].headers["content-type"] == "application/json"
    moved = http.request("GET", "https://api.example.com/moved")
    assert moved.status == 302 and moved.location == "https://127.0.0.1/admin" and len(seen) == 2, "a redirect is never followed"
    assert http.request("GET", "https://api.example.com/big").body is None, "an answer over 256 KB is cut"
    form = http.request("POST", "https://api.example.com/token", form={"grant_type": "x"})
    assert form.ok and seen[-1].content == b"grant_type=x" and seen[-1].headers["content-type"] == "application/x-www-form-urlencoded"


def _record(seen: list[httpx.Request]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    return handler


def test_a_private_name_or_address_is_blocked_without_a_request_and_failures_are_closed_words() -> None:
    seen: list[httpx.Request] = []
    http = GuardedHttp(resolver=_dns({"evil.example.com": ["10.0.0.7"], "ghost.example.com": []}), transport=httpx.MockTransport(_record(seen)))
    assert http.request("GET", "https://evil.example.com/x").error == "blocked"
    assert http.request("GET", "https://ghost.example.com/x").error == "dns"
    assert http.request("GET", "https://127.0.0.1/x").error == "blocked"
    assert http.request("GET", "http://api.example.com/x").error == "blocked"
    assert http.request("POST", "https://api.example.com/x", json_body={"a": "x" * 300_000}).error == "too_large"
    assert seen == []
    for exc, word in ((httpx.ConnectTimeout("t"), "timeout"), (httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED]"), "tls"), (httpx.ConnectError("refused 1.2.3.4"), "refused")):
        def boom(_r: httpx.Request, _e: Exception = exc) -> httpx.Response:
            raise _e

        got = GuardedHttp(resolver=_dns(), transport=httpx.MockTransport(boom)).request("GET", "https://api.example.com/x")
        assert got.error == word and "1.2.3.4" not in repr(got)


# ============================================================================ the adapters
MAPS = {k: a.spec.default_mapping for k, a in build_registry().items()}


def test_every_connector_has_a_spec_with_docs_and_the_two_oauth_ones_say_needs_setup() -> None:
    reg = build_registry()
    assert set(reg) == {"hubspot", "zoho_crm", "leadsquared", "selldo", "pipedrive", "freshsales", "kylas", "bitrix24", "salesforce", "google_sheets", "airtable", "notion"}
    for key, a in reg.items():
        assert a.spec.key == key and a.spec.docs and all(d.startswith("https://") for d in a.spec.docs), key
        assert set(a.spec.default_mapping) <= set(a.spec.our_fields), key
        assert (a.spec.kind == "oauth") == bool(a.spec.needs_setup), key


def test_hubspot_creates_a_contact_and_a_note_and_updates_an_existing_one() -> None:
    creds, mapping = {"token": KEY}, MAPS["hubspot"]
    http = FakeHttp((r"POST .*/contacts/search", ok({"total": 0, "results": []})), (r"POST .*/crm/v3/objects/contacts$", ok({"id": "501"}, 201)), (r"POST .*/objects/notes", ok({"id": "9"}, 201)))
    out = HubSpot().push(http, creds, {}, mapping, call_record())
    assert out == Outcome(True, "noted", 201)
    create = http.seen(r"POST .*/objects/contacts$")[0]
    assert create["json"]["properties"] == {"firstname": "Asha", "lastname": "Reddy", "phone": "+919800000001", "email": "asha@example.com"} and create["headers"]["Authorization"] == f"Bearer {KEY}"
    search = http.seen("search")[0]["json"]["filterGroups"]
    assert search[0]["filters"][0] == {"propertyName": "email", "operator": "EQ", "value": "asha@example.com"} and search[1]["filters"][0]["value"] == "9800000001"
    note = http.seen("notes")[0]["json"]
    assert note["associations"][0]["to"] == {"id": 501} and note["associations"][0]["types"][0]["associationTypeId"] == 202 and "Result: interested" in note["properties"]["hs_note_body"] and "Ref: evt_abc" in note["properties"]["hs_note_body"]
    http2 = FakeHttp((r"POST .*/contacts/search", ok({"total": 1, "results": [{"id": "77"}]})), (r"PATCH .*/contacts/77", ok({"id": "77"})))
    assert HubSpot().push(http2, creds, {}, mapping, lead_record()) == Outcome(True, "updated", 200) and not http2.seen("notes")


def test_hubspot_test_and_failures_are_closed_words() -> None:
    assert HubSpot().test(FakeHttp((r"GET .*/contacts", ok({"results": []}))), {"token": KEY}, {}, {}).ok
    for status, word in ((401, "auth"), (403, "auth"), (429, "rate_limited"), (500, "server"), (400, "rejected"), (404, "not_found")):
        out = HubSpot().test(FakeHttp((r".*", Answer(status=status, body={"message": "the other side's words"}))), {"token": KEY}, {}, {})
        assert (out.ok, out.word) == (False, word) and "words" not in repr(out)
    assert HubSpot().push(FakeHttp(), {"token": KEY}, {}, MAPS["hubspot"], call_record(phone="", email="")) == Outcome(True, "skipped"), "no way to find the person: nothing is sent"


def test_an_outcome_that_cannot_be_retried_is_not_retried() -> None:
    assert Outcome(False, "rejected", 400).retry is False and Outcome(False, "too_large").retry is False and Outcome(False, "config").retry is False
    assert Outcome(False, "auth", 401).retry and Outcome(False, "timeout").retry and Outcome(True, "created").retry is False


def test_leadsquared_creates_or_updates_the_lead_by_phone_then_adds_a_note() -> None:
    cfg, creds = {"host": "api-in21.leadsquared.com"}, {"access_key": "AK", "secret_key": "SK"}
    http = FakeHttp((r"POST .*Lead.CreateOrUpdate", ok({"Status": "Success", "Message": {"Id": "guid-1", "AffectedRows": 1}})), (r"POST .*CreateNote", ok({"Status": "Success", "Message": {"Id": "n1"}})))
    a = LeadSquared()
    assert a.check(creds, cfg) is None and a.check(creds, {"host": "evil.example.com"}) == "config" and a.check(creds, {"host": "api.leadsquared.com.evil.com"}) == "config"
    assert a.push(http, creds, cfg, MAPS["leadsquared"], call_record()) == Outcome(True, "noted", 200)
    body = http.seen("CreateOrUpdate")[0]
    attrs = {x["Attribute"]: x["Value"] for x in body["json"]}
    assert attrs["FirstName"] == "Asha" and attrs["LastName"] == "Reddy" and attrs["SearchBy"] == "Phone" and attrs["Source"] == "My website" and body["headers"]["x-LSQ-AccessKey"] == "AK" and body["headers"]["x-LSQ-SecretKey"] == "SK"
    assert http.seen("CreateNote")[0]["json"]["RelatedProspectId"] == "guid-1"
    assert a.push(FakeHttp((r".*", ok({"Status": "Error"}))), creds, cfg, MAPS["leadsquared"], call_record()).word == "rejected"
    assert a.test(FakeHttp((r"LeadsMetaData", ok([]))), creds, cfg, {}).ok


def test_selldo_follows_the_vendors_public_example_and_only_for_a_sell_do_host() -> None:
    cfg, creds = {"host": "app.sell.do"}, {"api_key": KEY}
    a = SellDo()
    assert a.check(creds, cfg) is None and a.check(creds, {"host": "example.com"}) == "config"
    http = FakeHttp((r"POST .*/api/v1/leads$", ok({"lead_id": "L1"}, 201)), (r"POST .*/notes", ok({}, 201)))
    assert a.push(http, creds, cfg, MAPS["selldo"], call_record()).word == "noted"
    assert http.seen("leads$")[0]["json"]["name"] == "Asha Reddy" and http.seen("leads$")[0]["headers"]["Authorization"] == f"Bearer {KEY}"


def test_pipedrive_searches_then_creates_or_updates_the_person_and_adds_an_html_safe_note() -> None:
    cfg, creds = {"domain": "myshop"}, {"api_token": KEY}
    a = Pipedrive()
    assert a.check(creds, cfg) is None and a.check(creds, {"domain": "my.shop/evil"}) == "config"
    http = FakeHttp((r"GET .*persons/search", ok({"data": {"items": []}})), (r"POST .*/v2/persons$", ok({"data": {"id": 31}})), (r"POST .*/v1/notes", ok({"success": True})))
    assert a.push(http, creds, cfg, MAPS["pipedrive"], call_record(summary="<script>x</script>")).word == "noted"
    person = http.seen("v2/persons$")[0]["json"]
    assert person["name"] == "Asha Reddy" and person["emails"][0]["value"] == "asha@example.com" and person["phones"][0]["value"] == "+919800000001"
    assert http.seen("search")[0]["headers"]["x-api-token"] == KEY and http.seen("myshop.pipedrive.com")
    note = http.seen("v1/notes")[0]["json"]
    assert note["person_id"] == 31 and "<script>" not in note["content"] and "&lt;script&gt;" in note["content"]
    http2 = FakeHttp((r"GET .*persons/search", ok({"data": {"items": [{"item": {"id": 9}}]}})), (r"PATCH .*/persons/9", ok({"data": {"id": 9}})))
    assert a.push(http2, creds, cfg, MAPS["pipedrive"], lead_record()).word == "updated"


def test_freshsales_upserts_the_contact_and_adds_a_note_and_only_for_a_freshworks_host() -> None:
    cfg, creds = {"host": "myshop.myfreshworks.com"}, {"api_key": KEY}
    a = Freshsales()
    assert a.check(creds, cfg) is None and a.check(creds, {"host": "myshop.example.com"}) == "config" and a.check(creds, {"host": "127.0.0.1"}) == "config"
    http = FakeHttp((r"POST .*contacts/upsert", ok({"contact": {"id": 4}}, 201)), (r"POST .*/notes", ok({"note": {"id": 1}}, 201)))
    assert a.push(http, creds, cfg, MAPS["freshsales"], call_record()).word == "noted"
    up = http.seen("upsert")[0]
    assert up["json"]["unique_identifier"] == {"emails": "asha@example.com"} and up["json"]["contact"]["first_name"] == "Asha" and up["headers"]["Authorization"] == f"Token token={KEY}"
    assert http.seen("/notes")[0]["json"]["note"]["targetable_id"] == 4
    assert a.push(FakeHttp((r"upsert", ok({"contact": {"id": 4}}, 200))), creds, cfg, MAPS["freshsales"], lead_record()).word == "updated"


def test_kylas_creates_a_lead_only_when_none_matches_and_never_overwrites_one() -> None:
    creds = {"api_key": KEY}
    a = Kylas()
    http = FakeHttp((r"POST .*search/lead", ok({"content": []})), (r"POST .*/v1/leads/$", ok({"id": 88}, 201)), (r"POST .*notes/relation", ok({"id": 5}, 201)))
    assert a.push(http, creds, {}, MAPS["kylas"], call_record()).word == "noted"
    lead = http.seen("leads/$")[0]["json"]
    assert lead["phoneNumbers"][0] == {"type": "MOBILE", "code": "IN", "dialCode": "+91", "value": "9800000001", "primary": True} and lead["firstName"] == "Asha" and http.seen("leads/$")[0]["headers"]["api-key"] == KEY
    assert http.seen("relation")[0]["json"]["targetEntityId"] == 88 and http.seen("relation")[0]["json"]["targetEntityType"] == "LEAD"
    found = FakeHttp((r"search/lead", ok({"content": [{"id": 3}]})))
    assert a.push(found, creds, {}, MAPS["kylas"], lead_record()) == Outcome(True, "skipped"), "an existing lead and nothing to add: nothing changes"
    assert [c["method"] for c in found.calls] == ["POST"]
    assert a.test(FakeHttp((r"users/me", Answer(status=400))), creds, {}, {}).word == "auth"


def test_bitrix24_checks_the_webhook_address_finds_by_phone_and_adds_a_timeline_comment() -> None:
    url = "https://myshop.bitrix24.in/rest/1/abcd1234efgh/"
    creds = {"webhook_url": url}
    a = Bitrix24()
    assert a.check(creds, {}) is None
    for bad in ("https://myshop.example.com/rest/1/abcd1234efgh/", "https://myshop.bitrix24.in/rest/1/abcd1234efgh/?x=1", "https://127.0.0.1/rest/1/abcd1234efgh/", "https://myshop.bitrix24.in/other/path/", "http://myshop.bitrix24.in/rest/1/abcd1234efgh/"):
        assert a.check({"webhook_url": bad}, {}) == "config", bad
    http = FakeHttp((r"crm.duplicate.findbycomm", ok({"result": []})), (r"crm.lead.add", ok({"result": 12})), (r"crm.timeline.comment.add", ok({"result": 3})))
    assert a.push(http, creds, {}, MAPS["bitrix24"], call_record()).word == "noted"
    add = http.seen("lead.add")[0]["json"]["fields"]
    assert add["NAME"] == "Asha" and add["LAST_NAME"] == "Reddy" and add["PHONE"] == [{"VALUE": "+919800000001", "VALUE_TYPE": "WORK"}] and add["TITLE"] == "Asha Reddy"
    assert http.seen("comment.add")[0]["json"]["fields"]["ENTITY_ID"] == 12 and http.seen("comment.add")[0]["url"] == url + "crm.timeline.comment.add.json"
    upd = FakeHttp((r"findbycomm", ok({"result": {"LEAD": [45]}})), (r"crm.lead.update", ok({"result": True})))
    assert a.push(upd, creds, {}, MAPS["bitrix24"], lead_record()).word == "updated" and upd.seen("lead.update")[0]["json"]["id"] == 45
    assert a.test(FakeHttp((r"profile", ok({"result": {"ID": "1"}}))), creds, {}, {}).ok


SHEET_URL = "https://script.google.com/macros/s/" + "A" * 40 + "/exec"
ECHO = "https://script.googleusercontent.com/macros/echo?user_content_key=abc"


def test_the_sheet_script_is_given_as_data_and_the_address_must_be_a_google_web_app() -> None:
    assert "doPost" in SCRIPT and "change-this-word" in SCRIPT and "refColumn" in SCRIPT
    a = GoogleSheets()
    assert a.check({"script_url": SHEET_URL, "word": "w"}, {}) is None
    for bad in ("https://evil.example.com/macros/s/" + "A" * 40 + "/exec", "https://script.google.com/macros/s/short/exec", SHEET_URL + "?x=1", "http://script.google.com/macros/s/" + "A" * 40 + "/exec"):
        assert a.check({"script_url": bad, "word": "w"}, {}) == "config", bad


def test_a_row_is_sent_once_the_documented_302_is_read_with_one_get_and_a_duplicate_is_not_a_second_row() -> None:
    a, creds = GoogleSheets(), {"script_url": SHEET_URL, "word": "w0rd"}
    http = FakeHttp((r"POST .*/exec", Answer(status=302, location=ECHO)), (r"GET https://script.googleusercontent.com", ok({"ok": True})))
    assert a.push(http, creds, {}, MAPS["google_sheets"], call_record()) == Outcome(True, "appended", 200)
    sent = http.seen("POST")[0]["json"]
    assert sent["token"] == "w0rd" and sent["ref"] == "evt_abc" and sent["refColumn"] == "Stack19 ref" and sent["values"]["Name"] == "Asha Reddy" and sent["values"]["Duration (seconds)"] == "130" and sent["values"]["Details"] == "Budget: 45 lakh"
    dup = FakeHttp((r"POST", Answer(status=302, location=ECHO)), (r"GET", ok({"ok": True, "duplicate": True})))
    assert a.push(dup, creds, {}, MAPS["google_sheets"], call_record()).word == "skipped"
    assert a.push(FakeHttp((r"POST", Answer(status=302, location=ECHO)), (r"GET", ok({"ok": False, "error": "word"}))), creds, {}, MAPS["google_sheets"], call_record()).word == "auth"
    assert a.push(FakeHttp((r"POST", Answer(status=302, location="https://evil.example.com/x"))), creds, {}, MAPS["google_sheets"], call_record()).word == "redirect"
    long_loc = "https://script.googleusercontent.com/" + "a" * 600
    assert a.push(FakeHttp((r"POST", Answer(status=302, location=long_loc))), creds, {}, MAPS["google_sheets"], call_record()).word == "appended", "too long to check again: the 302 alone counts"
    assert a.test(FakeHttp((r"POST", ok({"ok": True, "test": True}))), creds, {}, {}).ok


def test_airtable_upserts_on_the_ref_column_so_the_same_event_is_one_row_and_checks_the_columns_when_testing() -> None:
    cfg, creds = {"base_id": "appABCDEFGHIJKLMN", "table": "Leads"}, {"token": KEY}
    a = Airtable()
    assert a.check(creds, cfg) is None and a.check(creds, {"base_id": "x", "table": "Leads"}) == "config" and a.check(creds, {"base_id": cfg["base_id"], "table": "../x/y;"}) == "config"
    http = FakeHttp((r"PATCH .*/v0/appABCDEFGHIJKLMN/Leads", ok({"records": [{"id": "r1"}], "createdRecords": ["r1"], "updatedRecords": []})))
    out = a.push(http, creds, cfg, MAPS["airtable"], call_record())
    assert out.word == "created"
    body = http.seen("PATCH")[0]["json"]
    assert body["performUpsert"] == {"fieldsToMergeOn": ["Stack19 ref"]} and body["typecast"] is True and body["records"][0]["fields"]["Stack19 ref"] == "evt_abc" and body["records"][0]["fields"]["Phone"] == "+919800000001"
    assert a.push(FakeHttp((r"PATCH", ok({"records": [{"id": "r1"}], "createdRecords": [], "updatedRecords": ["r1"]}))), creds, cfg, MAPS["airtable"], call_record()).word == "updated"
    no_ref = {k: v for k, v in MAPS["airtable"].items() if k != "ref"}
    plain = FakeHttp((r"POST .*/Leads", ok({"records": [{"id": "r2"}]}, 200)))
    assert a.push(plain, creds, cfg, no_ref, call_record()).word == "created" and plain.seen("POST")
    schema = {"tables": [{"id": "tbl1", "name": "Leads", "fields": [{"name": v} for v in MAPS["airtable"].values()]}]}
    assert a.test(FakeHttp((r"meta/bases", ok(schema))), creds, cfg, MAPS["airtable"]).ok
    short = {"tables": [{"id": "tbl1", "name": "Leads", "fields": [{"name": "Name"}]}]}
    assert a.test(FakeHttp((r"meta/bases", ok(short))), creds, cfg, MAPS["airtable"]).word == "config"
    assert a.test(FakeHttp((r"meta/bases", ok({"tables": []}))), creds, cfg, MAPS["airtable"]).word == "not_found"


NOTION_PROPS = {"Name": {"type": "title"}, "Phone": {"type": "phone_number"}, "Email": {"type": "email"}, "Source": {"type": "select"}, "Result": {"type": "rich_text"}, "Summary": {"type": "rich_text"}, "Details": {"type": "rich_text"},
                "Duration (seconds)": {"type": "number"}, "Call": {"type": "rich_text"}, "Event": {"type": "select"}, "Stack19 ref": {"type": "rich_text"}, "Created": {"type": "created_time"}}


def test_notion_writes_each_property_in_its_own_type_and_never_writes_the_same_event_twice() -> None:
    cfg, creds = {"database_id": "0123456789abcdef0123456789abcdef"}, {"token": KEY}
    a = Notion()
    assert a.check(creds, cfg) is None and a.check(creds, {"database_id": "nope"}) == "config"
    routes = [(r"GET .*/databases/", ok({"data_sources": [{"id": "ds-1"}]})), (r"GET .*/data_sources/ds-1$", ok({"properties": NOTION_PROPS})),
              (r"POST .*/data_sources/ds-1/query", ok({"results": []})), (r"POST .*/v1/pages", ok({"id": "p1"}))]
    http = FakeHttp(*routes)
    assert a.push(http, creds, cfg, MAPS["notion"], call_record()).word == "created"
    page = http.seen("v1/pages")[0]
    assert page["json"]["parent"] == {"type": "data_source_id", "data_source_id": "ds-1"} and page["headers"]["Notion-Version"] == "2025-09-03"
    props = page["json"]["properties"]
    assert props["Name"] == {"title": [{"type": "text", "text": {"content": "Asha Reddy"}}]} and props["Phone"] == {"phone_number": "+919800000001"} and props["Duration (seconds)"] == {"number": 130} and props["Source"] == {"select": {"name": "My website"}}
    assert http.seen("query")[0]["json"]["filter"] == {"property": "Stack19 ref", "rich_text": {"equals": "evt_abc"}}
    again = FakeHttp(routes[0], routes[1], (r"query", ok({"results": [{"id": "p1"}]})))
    assert a.push(again, creds, cfg, MAPS["notion"], call_record()) == Outcome(True, "skipped", 200) and not again.seen("v1/pages")
    assert a.test(FakeHttp(*routes), creds, cfg, MAPS["notion"]).ok
    assert a.test(FakeHttp(routes[0], (r"data_sources/ds-1$", ok({"properties": {"Name": {"type": "title"}}}))), creds, cfg, MAPS["notion"]).word == "config"
    assert a.test(FakeHttp((r"databases", Answer(status=404))), creds, cfg, {}).word == "not_found"


def test_zoho_refreshes_a_token_once_upserts_the_lead_and_adds_a_note() -> None:
    clock = [1000.0]
    a = ZohoCrm("cid", "csecret", clock=lambda: clock[0])
    creds = {"refresh_token": "rt-" + uuid.uuid4().hex, "accounts_server": "accounts.zoho.in", "api_domain": "https://www.zohoapis.in"}
    http = FakeHttp((r"POST https://accounts.zoho.in/oauth/v2/token", ok({"access_token": "AT", "expires_in": 3600})),
                    (r"POST .*Leads/upsert", ok({"data": [{"code": "SUCCESS", "action": "insert", "details": {"id": "z1"}}]}, 201)), (r"POST .*Leads/z1/Notes", ok({"data": [{"code": "SUCCESS"}]}, 201)))
    assert a.push(http, creds, {}, MAPS["zoho_crm"], call_record()).word == "noted"
    assert http.seen("oauth/v2/token")[0]["form"]["grant_type"] == "refresh_token" and http.seen("upsert")[0]["headers"]["Authorization"] == "Zoho-oauthtoken AT"
    up = http.seen("upsert")[0]["json"]
    assert up["data"][0]["Last_Name"] == "Reddy" and up["data"][0]["First_Name"] == "Asha" and up["duplicate_check_fields"] == ["Email"]
    a.push(http, creds, {}, MAPS["zoho_crm"], lead_record())
    assert len(http.seen("oauth/v2/token")) == 1, "the access token is kept for its life"
    assert a.test(FakeHttp((r"oauth", ok({"access_token": "AT2"})), (r"GET .*/Leads", Answer(status=204))), {**creds, "refresh_token": "other-rt-" + uuid.uuid4().hex}, {}, {}).ok
    assert a.push(FakeHttp(), {**creds, "accounts_server": "evil.example.com"}, {}, MAPS["zoho_crm"], call_record()).word == "config"
    assert ZohoCrm().push(FakeHttp(), creds, {}, MAPS["zoho_crm"], call_record()).word == "config", "without our client nothing is asked"


def test_salesforce_finds_a_lead_by_soql_creates_or_updates_it_and_adds_a_task() -> None:
    a = Salesforce("cid", "csecret", clock=lambda: 5.0)
    creds = {"refresh_token": "rt-" + uuid.uuid4().hex, "instance_url": "https://myshop.my.salesforce.com", "login_host": "login.salesforce.com"}
    http = FakeHttp((r"POST https://login.salesforce.com/services/oauth2/token", ok({"access_token": "SF"})), (r"GET .*/query", ok({"records": []})), (r"POST .*sobjects/Lead$", ok({"id": "00Q1", "success": True}, 201)), (r"POST .*sobjects/Task", ok({"id": "T"}, 201)))
    assert a.push(http, creds, {}, MAPS["salesforce"], call_record(email="o'brien@x.in")).word == "noted"
    q = http.seen("/query")[0]["query"]["q"]
    assert q == "SELECT Id FROM Lead WHERE Email = 'obrien@x.in' LIMIT 1" and "services/data/v68.0" in http.seen("/query")[0]["url"]
    lead = http.seen("sobjects/Lead$")[0]["json"]
    assert lead["LastName"] == "Reddy" and lead["FirstName"] == "Asha" and lead["Company"] == "[not provided]" and http.seen("sobjects/Task")[0]["json"]["WhoId"] == "00Q1"
    upd = FakeHttp((r"oauth2/token", ok({"access_token": "SF"})), (r"GET .*/query", ok({"records": [{"Id": "00Q9"}]})), (r"PATCH .*/Lead/00Q9", Answer(status=204)))
    assert Salesforce("cid", "csecret").push(upd, {**creds, "refresh_token": "rt2-" + uuid.uuid4().hex}, {}, MAPS["salesforce"], lead_record()).word == "updated"
    assert "Company" not in upd.seen("PATCH")[0]["json"]
    assert a.push(FakeHttp(), {**creds, "instance_url": "https://evil.example.com"}, {}, MAPS["salesforce"], call_record()).word == "config"


# ============================================================================ the worker pass
class FakeRepo:
    """The migration's functions in memory (the people's calls need Owner or Admin; the worker's need the worker's token)."""

    def __init__(self) -> None:
        self.conns: dict[str, dict[str, Any]] = {}
        self.deliveries: list[dict[str, Any]] = []
        self.recorded: list[tuple[uuid.UUID, bool, int | None, str | None, int | None, str | None]] = []
        self.tested: list[tuple[str, bool, str | None]] = []
        self.purged = 0

    @staticmethod
    def _manager(token: str) -> None:
        if _uid(token) not in ("a_owner", "a_admin"):
            raise Forbidden("42501")

    def connections_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._manager(token)
        return [{k: v for k, v in c.items() if k != "tenant"} for c in self.conns.values() if c["tenant"] == tenant_id]

    def connection_save(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, type_: str, config: dict[str, str], mapping: dict[str, str], events: list[str]) -> dict[str, Any]:
        self._manager(token)
        old = self.conns.get(type_)
        self.conns[type_] = {"tenant": tenant_id, "id": str(old["id"] if old else connection_id), "type": type_, "config": config, "mapping": mapping, "events": events, "active": True, "secret_version": (old["secret_version"] + 1) if old else 1,
                             "health": {"status": "ok"}, "last_test": None}
        return {k: v for k, v in self.conns[type_].items() if k != "tenant"}

    def connection_update(self, token: str, tenant_id: uuid.UUID, type_: str, mapping: dict[str, str] | None, events: list[str] | None, active: bool | None) -> dict[str, Any] | None:
        self._manager(token)
        c = self.conns.get(type_)
        if c is None or c["tenant"] != tenant_id:
            return None
        c.update({k: v for k, v in (("mapping", mapping), ("events", events), ("active", active)) if v is not None})
        return {k: v for k, v in c.items() if k != "tenant"}

    def connection_delete(self, token: str, tenant_id: uuid.UUID, type_: str) -> uuid.UUID | None:
        self._manager(token)
        c = self.conns.pop(type_, None)
        return uuid.UUID(c["id"]) if c else None

    def connection_tested(self, token: str, tenant_id: uuid.UUID, type_: str, ok: bool, reason: str | None) -> dict[str, Any] | None:
        self._manager(token)
        self.tested.append((type_, ok, reason))
        return {}

    def deliveries_list(self, token: str, tenant_id: uuid.UUID, type_: str | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        self._manager(token)
        return [{"id": d["id"], "type": type_, "event": d["event"], "status": "pending", "attempts": 0, "created_at": d["created_at"]} for d in self.deliveries][:limit]

    def deliveries_retry(self, token: str, tenant_id: uuid.UUID, type_: str) -> dict[str, Any] | None:
        self._manager(token)
        return {"requeued": 2} if type_ in self.conns else None

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        assert worker == WORKER
        out, self.deliveries = self.deliveries[:limit], self.deliveries[limit:]
        return out

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None, result: str | None) -> dict[str, Any]:
        assert worker == WORKER
        self.recorded.append((delivery_id, ok, status, error, retry_in_s, result))
        return {"state": "x"}

    def purge(self, worker: str) -> dict[str, Any]:
        self.purged += 1
        return {"deliveries": 0}

    def queue(self, *, type_: str = "hubspot", event: str = "call.completed", attempts: int = 0, data: dict[str, Any] | None = None, version: int = 1, config: dict[str, str] | None = None) -> dict[str, Any]:
        conn = self.conns[type_]
        row = {"id": str(uuid.uuid4()), "tenant_id": str(conn["tenant"]), "connection_id": conn["id"], "type": type_, "event": event, "event_id": str(uuid.uuid4()), "attempts": attempts, "created_at": "2026-11-25T10:00:00+00:00",
               "config": config if config is not None else conn["config"], "mapping": conn["mapping"], "secret_version": version,
               "data": data if data is not None else {"call": {"id": "c1", "outcome": "interested", "summary": "Wants a visit.", "duration_seconds": 61, "captured": {}}, "lead": {"name": "Asha Reddy", "phone": "+919800000001", "email": "a@x.in"}, "source": "My website"}}
        self.deliveries.append(row)
        return row


def runner_world(http: FakeHttp | None = None, *, keys: bool = True) -> tuple[CrmPushRunner, FakeRepo, FakeSecretStore, FakeHttp, list[float]]:
    repo, store = FakeRepo(), FakeSecretStore()
    http = http or FakeHttp((r"POST .*/contacts/search", ok({"results": []})), (r"POST .*/objects/contacts$", ok({"id": "5"}, 201)), (r"POST .*/notes", ok({"id": "1"}, 201)))
    cid = uuid.uuid4()
    repo.conns["hubspot"] = {"tenant": TENANT_A.id, "id": str(cid), "type": "hubspot", "config": {}, "mapping": MAPS["hubspot"], "events": ["call.completed"], "active": True, "secret_version": 1}
    if keys:
        store.put(secret_name(TENANT_A.id, cid), json.dumps({"token": KEY}))
    now = [1000.0]
    return CrmPushRunner(repo, store, build_registry(), http, monotonic=lambda: now[0]), repo, store, http, now


def test_a_push_is_built_from_the_row_sent_through_the_adapter_and_recorded() -> None:
    runner, repo, _, http, _ = runner_world()
    row = repo.queue()
    assert runner.run(WORKER) == 1
    assert repo.recorded == [(uuid.UUID(row["id"]), True, 201, None, None, "noted")]
    assert http.seen("objects/contacts$")[0]["json"]["properties"]["firstname"] == "Asha" and http.seen("notes")[0]["json"]["properties"]["hs_note_body"].endswith("Ref: evt_" + row["event_id"].replace("-", ""))


def test_a_test_lead_a_sandbox_call_and_a_person_who_is_gone_are_skipped_never_sent() -> None:
    runner, repo, _, http, _ = runner_world()
    repo.queue(data={"call": {"id": "c1", "sandbox": True}, "lead": {"name": "T", "phone": "+91980"}})
    repo.queue(event="lead.created", data={"lead": {"id": "l", "is_test": True, "contact": {"name": "T", "phone": "+91981"}}})
    repo.queue(data={"gone": True})
    runner.run(WORKER)
    assert [r[1:] for r in repo.recorded] == [(True, None, None, None, "skipped")] * 3 and http.calls == []


def test_failures_walk_the_backoff_and_a_rejected_record_dies_at_once() -> None:
    runner, repo, _, _, _ = runner_world(FakeHttp((r".*", Answer(status=500))))
    for attempts in range(6):
        repo.queue(attempts=attempts)
    runner.run(WORKER)
    assert [r[4] for r in repo.recorded] == [60, 300, 1800, 7200, 21600, None] and all(r[3] == "server" and r[1] is False for r in repo.recorded)
    runner2, repo2, _, _, _ = runner_world(FakeHttp((r".*", Answer(status=422))))
    repo2.queue()
    runner2.run(WORKER)
    assert repo2.recorded[0][3] == "rejected" and repo2.recorded[0][4] is None, "a bad record is not made better by waiting"


def test_without_its_key_or_with_settings_that_do_not_check_the_push_fails_with_a_closed_word_and_sends_nothing() -> None:
    runner, repo, _, http, _ = runner_world(keys=False)
    repo.queue()
    runner.run(WORKER)
    assert repo.recorded[0][3] == "no_secret" and http.calls == []
    runner2, repo2, store2, http2, _ = runner_world()
    repo2.conns["bitrix24"] = {**repo2.conns["hubspot"], "type": "bitrix24", "mapping": MAPS["bitrix24"]}
    store2.put(secret_name(TENANT_A.id, uuid.UUID(repo2.conns["bitrix24"]["id"])), json.dumps({"webhook_url": "https://127.0.0.1/rest/1/abcd1234efgh/"}))
    repo2.queue(type_="bitrix24")
    runner2.run(WORKER)
    assert repo2.recorded[0][3] == "config" and repo2.recorded[0][4] is None and http2.calls == []


def test_a_key_is_never_in_the_logs_or_the_runners_repr_and_a_replaced_key_is_read_again() -> None:
    runner, repo, store, _, now = runner_world(FakeHttp((r".*", Answer(status=401))))
    records: list[logging.LogRecord] = []

    class Catch(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = Catch()
    logging.getLogger("app.crm_push").addHandler(handler)
    try:
        repo.queue()
        runner.run(WORKER)
    finally:
        logging.getLogger("app.crm_push").removeHandler(handler)
    assert KEY not in repr(runner) and all(KEY not in r.getMessage() for r in records) and repo.recorded[0][3] == "auth"
    cid = uuid.UUID(repo.conns["hubspot"]["id"])
    store.put(secret_name(TENANT_A.id, cid), json.dumps({"token": "new-key-0123456789"}))
    repo.conns["hubspot"]["secret_version"] = 2
    repo.queue(version=2)
    runner.run(WORKER)
    assert runner._http.calls[-1]["headers"]["Authorization"] == "Bearer new-key-0123456789"   # type: ignore[attr-defined]


def test_the_purge_runs_at_most_once_an_hour() -> None:
    runner, repo, _, _, now = runner_world()
    runner.run(WORKER)
    runner.run(WORKER)
    assert repo.purged == 1
    now[0] += 3601
    runner.run(WORKER)
    assert repo.purged == 2


# ============================================================================ the routes
def world(on: bool = True, store: bool = True, http: FakeHttp | None = None) -> tuple[Any, FakeRepo, FakeSecretStore, FakeHttp]:
    repo, secrets_store, http = FakeRepo(), FakeSecretStore(), http or FakeHttp((r"GET .*/contacts", ok({"results": []})))
    service = CrmPush(repo, secrets_store if store else None, build_registry(), http=http) if on else None
    client, _ = make_client(crm_push=service)
    return client, repo, secrets_store, http


def connect(client: Any, type_: str = "hubspot", **extra: Any) -> Any:
    body = {"credentials": {"token": KEY}, **extra}
    return client.put(f"{BASE}/{type_}", json=body, headers=auth("a_owner"))


def test_the_switch_off_makes_every_route_a_404() -> None:
    client, _, _, _ = world(on=False)
    for call in (client.get(BASE, headers=auth("a_owner")), client.put(f"{BASE}/hubspot", json={"credentials": {}}, headers=auth("a_owner")), client.post(f"{BASE}/hubspot/test", headers=auth("a_owner")),
                 client.get(f"{BASE}/hubspot/deliveries", headers=auth("a_owner")), client.delete(f"{BASE}/hubspot", headers=auth("a_owner"))):
        assert call.status_code == 404


def test_the_page_lists_every_connector_with_its_state_and_never_a_key() -> None:
    client, repo, store, _ = world()
    first = client.get(BASE, headers=auth("a_owner")).json()
    states = {c["type"]: c["state"] for c in first["items"]}
    assert states["hubspot"] == "not_connected" and states["zoho_crm"] == "needs_setup" and states["salesforce"] == "needs_setup" and len(states) == 12 and first["available"] is True
    assert [e["event"] for e in first["events"]] == ["call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome"]
    sheets = next(c for c in first["items"] if c["type"] == "google_sheets")
    assert "doPost" in sheets["script"] and sheets["uses_notes"] is False and [c["key"] for c in sheets["credentials"]] == ["script_url", "word"]
    got = connect(client)
    assert got.status_code == 200 and KEY not in got.text
    after = client.get(BASE, headers=auth("a_owner"))
    hub = next(c for c in after.json()["items"] if c["type"] == "hubspot")
    assert hub["state"] == "connected" and hub["connection"]["mapping"] == MAPS["hubspot"] and KEY not in after.text
    assert KEY not in json.dumps(list(repo.conns.values()), default=str), "the key is not in the database"
    assert json.loads(store.access(secret_name(TENANT_A.id, uuid.UUID(hub["connection"]["id"]))) or "{}") == {"token": KEY}, "it is in the secret store"


def test_an_admin_may_and_sales_viewers_and_other_workspaces_may_not() -> None:
    client, _, _, _ = world()
    assert client.put(f"{BASE}/hubspot", json={"credentials": {"token": KEY}}, headers=auth("a_admin")).status_code == 200
    for user in ("a_sales", "a_viewer", "b_owner", "outsider"):
        assert client.put(f"{BASE}/hubspot", json={"credentials": {"token": KEY}}, headers=auth(user)).status_code in (403, 404), user
        assert client.get(BASE, headers=auth(user)).status_code in (403, 404), user
    assert client.get(BASE).status_code == 401


def test_the_connect_form_is_checked_and_an_oauth_tool_says_needs_setup_by_us() -> None:
    client, repo, store, _ = world()
    assert client.put(f"{BASE}/nope", json={"credentials": {}}, headers=auth("a_owner")).status_code == 404
    bodies: list[dict[str, Any]] = [{"credentials": {}}, {"credentials": {"token": "has space"}}, {"credentials": {"token": KEY, "extra": "x"}}, {"credentials": {"token": KEY}, "mapping": {"name": "bad;name"}},
                 {"credentials": {"token": KEY}, "mapping": {"unknown": "x"}}, {"credentials": {"token": KEY}, "events": ["bogus"]}, {"credentials": {"token": KEY}, "settings": {"x": "y"}}, {"credentials": {"token": KEY}, "bogus": 1}]
    for body in bodies:
        assert client.put(f"{BASE}/hubspot", json=body, headers=auth("a_owner")).status_code == 422, body
    assert repo.conns == {} and store.secrets == {}, "nothing is stored for a form that did not pass"
    for oauth in ("zoho_crm", "salesforce"):
        got = client.put(f"{BASE}/{oauth}", json={"credentials": {}}, headers=auth("a_owner"))
        assert got.status_code == 409 and got.json()["error"]["code"] == "needs_setup_by_us" and "register" in got.json()["error"]["message"]
    bad = client.put(f"{BASE}/bitrix24", json={"credentials": {"webhook_url": "https://127.0.0.1/rest/1/abcd1234efgh/"}}, headers=auth("a_owner"))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "settings_invalid" and "127.0.0.1" not in bad.text
    assert client.put(f"{BASE}/pipedrive", json={"credentials": {"api_token": KEY}, "settings": {"domain": "my shop"}}, headers=auth("a_owner")).status_code == 422
    assert store.secrets == {}


def test_connecting_again_replaces_the_key_under_the_same_connection() -> None:
    client, repo, store, _ = world()
    first = connect(client).json()["connection"]
    second = client.put(f"{BASE}/hubspot", json={"credentials": {"token": "another-key-0123456789"}}, headers=auth("a_owner")).json()["connection"]
    assert first["id"] == second["id"] and second["secret_version"] == 2 and len(store.secrets) == 1
    assert json.loads(store.access(secret_name(TENANT_A.id, uuid.UUID(first["id"]))) or "{}")["token"] == "another-key-0123456789"


def test_test_connection_reads_the_other_tool_and_keeps_a_closed_word() -> None:
    client, repo, _, http = world()
    assert client.post(f"{BASE}/hubspot/test", headers=auth("a_owner")).status_code == 404
    connect(client)
    got = client.post(f"{BASE}/hubspot/test", headers=auth("a_owner"))
    assert got.json() == {"ok": True, "reason": None} and list(repo.tested[-1]) == ["hubspot", True, None] and http.calls[-1]["method"] == "GET" and http.calls[-1]["headers"]["Authorization"] == f"Bearer {KEY}"
    http.routes = [(r".*", Answer(status=401, body={"message": "bad key words"}))]
    bad = client.post(f"{BASE}/hubspot/test", headers=auth("a_owner"))
    assert bad.json() == {"ok": False, "reason": "auth"} and "words" not in bad.text and list(repo.tested[-1]) == ["hubspot", False, "auth"]


def test_the_mapping_events_and_pause_can_be_changed_and_the_connection_removed_with_its_key() -> None:
    client, repo, store, _ = world()
    connect(client)
    cid = repo.conns["hubspot"]["id"]
    got = client.patch(f"{BASE}/hubspot", json={"mapping": {"name": "firstname", "phone": "mobilephone", "summary": NOTE}, "events": ["lead.created"], "active": False}, headers=auth("a_owner"))
    assert got.status_code == 200 and got.json()["connection"]["mapping"]["phone"] == "mobilephone" and got.json()["connection"]["active"] is False and got.json()["connection"]["events"] == ["lead.created"]
    assert client.patch(f"{BASE}/hubspot", json={"mapping": {"name": "x;y"}}, headers=auth("a_owner")).status_code == 422
    assert client.patch(f"{BASE}/pipedrive", json={"active": True}, headers=auth("a_owner")).status_code == 404
    assert client.delete(f"{BASE}/hubspot", headers=auth("a_owner")).json() == {"deleted": True} and repo.conns == {} and store.access(secret_name(TENANT_A.id, uuid.UUID(cid))) is None
    assert client.delete(f"{BASE}/hubspot", headers=auth("a_owner")).status_code == 404


def test_the_log_and_try_again() -> None:
    client, repo, _, _ = world()
    connect(client)
    repo.queue()
    got = client.get(f"{BASE}/hubspot/deliveries", headers=auth("a_owner")).json()
    assert len(got["items"]) == 1 and got["next_before"] is None and "data" not in got["items"][0]
    assert client.get(f"{BASE}/hubspot/deliveries?before=junk", headers=auth("a_owner")).status_code == 400
    assert client.post(f"{BASE}/hubspot/retry", headers=auth("a_owner")).json() == {"requeued": 2}
    assert client.get(f"{BASE}/nope/deliveries", headers=auth("a_owner")).status_code == 404


def test_without_a_secret_store_the_page_says_so_and_nothing_is_saved() -> None:
    client, repo, _, _ = world(store=False)
    assert client.get(BASE, headers=auth("a_owner")).json()["available"] is False
    got = connect(client)
    assert got.status_code == 503 and got.json()["error"]["code"] == "crm_push_unavailable" and repo.conns == {}


def test_a_secret_store_that_fails_saves_nothing() -> None:
    from app.workspace_secrets import SecretStoreError

    class Broken(FakeSecretStore):
        def put(self, name: str, value: str) -> None:
            raise SecretStoreError("write_refused")

    repo = FakeRepo()
    client, _ = make_client(crm_push=CrmPush(repo, Broken(), build_registry(), http=FakeHttp()))
    assert connect(client).status_code == 503 and repo.conns == {}


_ = (UTC, pytest)
