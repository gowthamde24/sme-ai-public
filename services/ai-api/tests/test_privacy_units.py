"""Job BN: the pure parts of the privacy rights. The export files (deterministic, paged, honest about what could not be read, bounded), the data-layer error mapping, the worker's housekeeping (what it
asks, what it counts, that a file is marked removed only when storage confirmed it, that one failing step does not stop the rest), its place in the worker's tick, the policy gate's rules and the new
settings. The routes are test_privacy_routes.py; the database rules are pgTAP 85."""

from __future__ import annotations

import io
import json
import logging
import uuid
import zipfile
from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.integrations.policy import PolicyVersions
from app.logging_safety import redact_path
from app.outbox.adapter import LocalFakeAdapter
from app.privacy import export_builder
from app.privacy.errors import (
    ConfirmationError,
    CoolingOffError,
    PrivacyRateError,
    PrivacyStateError,
    SoleOwnerError,
)
from app.privacy.export_builder import ExportTooLarge, build_person_export, build_workspace_export
from app.privacy.housekeeping import Housekeeping
from app.privacy.policy_gate import PolicyGate, needs_acceptance
from app.privacy.repository import PostgrestPrivacyRepository
from app.scheduler.worker import Worker
from app.tenancy.repository import MfaRequired, TokenRejected
from tests.catalogue_fakes import FakeStorage
from tests.privacy_fakes import FakePrivacy
from tests.scheduler_fakes import FakeScheduler
from tests.test_scheduler_tick import FakeSession

NOW = datetime(2026, 10, 5, 8, 30, tzinfo=UTC)
TENANT = uuid.UUID(int=0xA)
TOKEN = "worker-token"


# ------------------------------------------------------------------------------------------------------------------------ the files
def _names(content: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        return z.namelist()


def test_the_person_file_is_the_same_bytes_for_the_same_data() -> None:
    data = FakePrivacy().person
    a, b = build_person_export(data, NOW), build_person_export(json.loads(json.dumps(data)), NOW)
    assert a.content == b.content and a.sha256 == b.sha256 and len(a.sha256) == 64
    assert _names(a.content) == sorted(_names(a.content))
    assert a.manifest["files"]["my_actions.json"] == 1


def test_the_person_file_holds_no_business_record_and_says_so() -> None:
    built = build_person_export(FakePrivacy().person, NOW)
    with zipfile.ZipFile(io.BytesIO(built.content)) as z:
        assert not [n for n in z.namelist() if n.startswith("tables/")]
        readme = z.read("README.txt").decode()
    assert "Backups are outside this file" in readme and "2026-10-05 08:30" in readme


def test_the_workspace_file_pages_through_a_big_table_and_names_the_unreadable_ones() -> None:
    db = FakePrivacy()
    db.tables = {"contacts": [{"id": str(i)} for i in range(2500)]}
    db.unreadable = {"claims"}
    built = build_workspace_export(db, TOKEN, TENANT, "Ravi Silks", NOW)
    with zipfile.ZipFile(io.BytesIO(built.content)) as z:
        assert len(json.loads(z.read("tables/contacts.json"))) == 2500
        manifest = json.loads(z.read("manifest.json"))
        assert "tables/claims.json" not in z.namelist() and manifest["tables"]["claims"] == "not_readable"
        assert manifest["workspace"] == "Ravi Silks" and manifest["tables"]["orders"] == 0
    pages = [c[1] for c in db.calls if c[0] == "read_table_page" and c[1][0] == "contacts"]
    assert [p[2] for p in pages] == [0, 1000, 2000] and all(p[3] == 1000 for p in pages)
    assert all(c[1][1] == "tenant_id" for c in db.calls if c[0] == "read_table_page" and c[1][0] in export_builder.ORDER_BY_TENANT)


def test_a_refused_token_stops_the_export_instead_of_being_called_unreadable() -> None:
    db = FakePrivacy()
    db.fail = TokenRejected("401")
    with pytest.raises(TokenRejected):
        build_workspace_export(db, TOKEN, TENANT, "x", NOW)


def test_a_file_over_the_limit_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(export_builder, "MAX_UNCOMPRESSED_BYTES", 500)
    db = FakePrivacy()
    db.tables = {"contacts": [{"id": str(i), "name": "x" * 50} for i in range(50)]}
    with pytest.raises(ExportTooLarge):
        build_workspace_export(db, TOKEN, TENANT, "x", NOW)
    monkeypatch.setattr(export_builder, "MAX_ZIP_BYTES", 10)
    monkeypatch.setattr(export_builder, "MAX_UNCOMPRESSED_BYTES", 10**9)
    with pytest.raises(ExportTooLarge):
        build_person_export(FakePrivacy().person, NOW)


def test_every_table_in_the_export_list_is_listed_once() -> None:
    names = export_builder.WORKSPACE_TABLES
    assert len(names) == len(set(names)) and export_builder.ORDER_BY_TENANT <= set(names)
    assert "suppression_keys" not in names, "the one-way recognition keys are not data about a person"


# ------------------------------------------------------------------------------------------------------------------------ the data-layer errors
def _repo(status: int, body: Any) -> PostgrestPrivacyRepository:
    transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body))
    return PostgrestPrivacyRepository("http://rest.local", "anon", client=httpx.Client(base_url="http://rest.local", transport=transport))


@pytest.mark.parametrize(
    ("code", "error"),
    [("SM611", SoleOwnerError), ("SM612", CoolingOffError), ("SM613", PrivacyStateError), ("SM614", PrivacyRateError), ("SM615", ConfirmationError), ("SM306", MfaRequired), ("PGRST301", TokenRejected)],
)
def test_each_dedicated_sqlstate_has_its_own_error(code: str, error: type[Exception]) -> None:
    status = 401 if code.startswith("PGRST3") else 400
    with pytest.raises(error):
        _repo(status, {"code": code, "message": "details that must never be used"}).export_get(TOKEN, uuid.uuid4())


def test_not_found_is_not_found_and_text_is_never_used() -> None:
    from app.crm.repository import NotFoundError

    with pytest.raises(NotFoundError) as caught:
        _repo(400, {"code": "23503", "message": "secret table name"}).deletion_cancel(TOKEN, uuid.uuid4())
    assert "secret" not in str(caught.value)


def test_the_table_read_sends_the_workspace_filter_and_the_callers_token() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": "1"}])

    repo = PostgrestPrivacyRepository("http://rest.local", "anon", client=httpx.Client(base_url="http://rest.local", transport=httpx.MockTransport(handler)))
    assert repo.read_table_page("tok", "orders", TENANT, "id", 1000, 1000) == [{"id": "1"}]
    (request,) = seen
    assert request.method == "GET" and request.url.path == "/orders"
    assert dict(request.url.params) == {"tenant_id": f"eq.{TENANT}", "select": "*", "order": "id", "offset": "1000", "limit": "1000"}
    assert request.headers["authorization"] == "Bearer tok" and request.headers["apikey"] == "anon"


def test_the_bucket_answer_must_be_a_text() -> None:
    from app.tenancy.repository import UpstreamError

    assert _repo(200, "exp-abc").export_bucket(TOKEN) == "exp-abc"
    with pytest.raises(UpstreamError):
        _repo(200, {"x": 1}).export_bucket(TOKEN)


# ------------------------------------------------------------------------------------------------------------------------ housekeeping
def _house(db: FakePrivacy, storage: FakeStorage | None = None, clock: list[float] | None = None) -> Housekeeping:
    ticks = clock if clock is not None else [0.0]
    return Housekeeping(db, storage if storage is not None else FakeStorage(), every_seconds=300, monotonic=lambda: ticks[0])


def test_housekeeping_asks_for_the_three_things_and_counts() -> None:
    db = FakePrivacy()
    db.worker_answers = {"deletions": {"executed": 2, "blocked": 1}, "retention": {"workspaces": 3}}
    e1, e2 = uuid.uuid4(), uuid.uuid4()
    db.expired = [{"id": str(e1), "bucket": "exp-u", "path": f"{e1}.zip"}, {"id": str(e2), "bucket": "exp-u", "path": f"{e2}.zip"}]
    storage = FakeStorage()
    result = _house(db, storage).run(TOKEN)
    assert (result.accounts_deleted, result.accounts_blocked, result.export_files_removed, result.retention_workspaces, result.errors) == (2, 1, 2, 3, 0)
    assert [c[0] for c in db.calls] == ["execute_account_deletions", "expired_exports", "export_cleaned", "export_cleaned", "run_retention", "run_students_retention"]
    assert db.cleaned == [str(e1), str(e2)] and set(db.tokens) == {TOKEN}
    assert [c for c in storage.calls if c[0] == "remove_checked"][0][1:3] == (TOKEN, "exp-u")


def test_a_file_is_marked_removed_only_when_storage_confirmed_it() -> None:
    db = FakePrivacy()
    e1 = uuid.uuid4()
    db.expired = [{"id": str(e1), "bucket": "exp-u", "path": f"{e1}.zip"}]
    storage = FakeStorage()
    storage.fail_remove = True  # type: ignore[attr-defined]
    result = _house(db, storage).run(TOKEN)
    assert result.export_files_failed == 1 and result.export_files_removed == 0 and db.cleaned == []


def test_one_failing_step_does_not_stop_the_others_and_is_logged_by_class_only(caplog: pytest.LogCaptureFixture) -> None:
    db = FakePrivacy()
    db.fail_step = "accounts"
    db.worker_answers["retention"] = {"workspaces": 1}
    with caplog.at_level(logging.INFO):
        result = _house(db).run(TOKEN)
    assert result.errors == 1 and result.retention_workspaces == 1
    assert "RepositoryError" in caplog.text and "boom" not in caplog.text


def test_a_refused_token_ends_the_pass() -> None:
    db = FakePrivacy()
    db.fail = TokenRejected("401")
    with pytest.raises(TokenRejected):
        _house(db).run(TOKEN)


def test_housekeeping_runs_at_most_every_five_minutes() -> None:
    db = FakePrivacy()
    clock = [0.0]
    house = _house(db, clock=clock)
    assert house.run_if_due(TOKEN) is not None
    n = len(db.calls)
    clock[0] = 299.0
    assert house.run_if_due(TOKEN) is None and len(db.calls) == n
    clock[0] = 300.0
    assert house.run_if_due(TOKEN) is not None


def test_a_quiet_pass_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        _house(FakePrivacy()).run(TOKEN)
    assert "privacy housekeeping" not in caplog.text


# ------------------------------------------------------------------------------------------------------------------------ the worker
def _worker(db: FakeScheduler, house: Housekeeping | None) -> Worker:
    return Worker(db, LocalFakeAdapter(), FakeSession(), interval_seconds=60, housekeeping=house)


def test_the_worker_does_the_housekeeping_after_its_tick_even_with_nothing_to_send() -> None:
    privacy = FakePrivacy()
    result = _worker(FakeScheduler(), _house(privacy)).tick_once()
    assert result is not None
    assert [c[0] for c in privacy.calls] == ["execute_account_deletions", "expired_exports", "run_retention", "run_students_retention"]


def test_a_housekeeping_crash_does_not_fail_the_tick(caplog: pytest.LogCaptureFixture) -> None:
    class Boom(Housekeeping):
        def run_if_due(self, token: str) -> Any:
            raise ValueError("nope")

    with caplog.at_level(logging.ERROR):
        result = _worker(FakeScheduler(), Boom(FakePrivacy(), None)).tick_once()
    assert result is not None and "privacy housekeeping crashed: ValueError" in caplog.text


def test_a_refused_token_in_housekeeping_makes_the_worker_sign_in_again() -> None:
    privacy = FakePrivacy()
    privacy.fail = TokenRejected("401")
    session = FakeSession()
    worker = Worker(FakeScheduler(), LocalFakeAdapter(), session, interval_seconds=60, housekeeping=_house(privacy))
    assert worker.tick_once() is None and session.invalidated == 1


# ------------------------------------------------------------------------------------------------------------------------ the gate and the settings
V = PolicyVersions("2026-11-01", "2026-10-01")


def test_the_gate_rules() -> None:
    today = date(2026, 11, 2)
    both = [{"kind": "terms", "version": "2026-11-01"}, {"kind": "privacy", "version": "2026-10-01"}]
    assert needs_acceptance(V, both, today) == {"terms": False, "privacy": False}
    assert needs_acceptance(V, both[1:], today) == {"terms": True, "privacy": False}
    assert needs_acceptance(V, [], today) == {"terms": True, "privacy": True}
    later = PolicyVersions("2026-11-01", "2026-10-01", date(2026, 11, 10), None)
    assert needs_acceptance(later, [], today) == {"terms": False, "privacy": True}, "a version that does not bind yet needs nothing"
    assert needs_acceptance(later, [], date(2026, 11, 10))["terms"] is True


def test_the_gate_remembers_yes_for_a_minute_and_never_no() -> None:
    from tests.integrations_fakes import FakeIntegrations

    integrations = FakeIntegrations()
    clock = [0.0]
    gate = PolicyGate(V, enforce=True, monotonic=lambda: clock[0], today=lambda: date(2026, 11, 2))
    integrations.accepted = []
    from app.errors import ApiError

    for _ in range(2):
        with pytest.raises(ApiError):
            gate.check(integrations, "t", "u1")
    assert len(integrations.calls) == 2, "a no is asked again every time"
    integrations.accepted = [{"kind": "terms", "version": "2026-11-01"}, {"kind": "privacy", "version": "2026-10-01"}]
    gate.check(integrations, "t", "u1")
    n = len(integrations.calls)
    gate.check(integrations, "t", "u1")
    assert len(integrations.calls) == n
    clock[0] = 61.0
    gate.check(integrations, "t", "u1")
    assert len(integrations.calls) == n + 1
    gate.forget("u1")
    gate.check(integrations, "t", "u1")
    assert len(integrations.calls) == n + 2


def test_a_gate_that_is_off_never_calls_the_data_layer() -> None:
    from tests.integrations_fakes import FakeIntegrations

    integrations = FakeIntegrations()
    PolicyGate(V, enforce=False).check(integrations, "t", "u")
    PolicyGate(V, enforce=True).check(None, "t", "u")
    assert integrations.calls == []


def test_the_effective_dates_are_settings_and_an_empty_one_means_at_once() -> None:
    s = Settings(_env_file=None, api_env="development", terms_effective_from="", privacy_effective_from="2026-12-01")  # type: ignore[call-arg,arg-type]
    assert s.terms_effective_from is None and s.privacy_effective_from == date(2026, 12, 1) and s.policy_enforce is False
    assert PolicyVersions("a", "b", None, date(2026, 12, 1)).current()["privacy"] == {"version": "b", "effective_from": "2026-12-01"}
    assert PolicyVersions().current() == {"terms": {"version": "2026-10-01"}, "privacy": {"version": "2026-10-01"}}


def test_the_new_route_words_are_logged_and_ids_are_not() -> None:
    uid = "33333333-3333-4333-8333-333333333333"
    assert redact_path(f"/v1/me/data-exports/{uid}/link") == f"/v1/me/data-exports/{uid}/link"
    assert redact_path(f"/v1/tenants/{uid}/grievances/{uid}/status") == f"/v1/tenants/{uid}/grievances/{uid}/status"
    assert redact_path("/v1/me/data-exports/secret-token/link") == "/v1/me/data-exports/<redacted>/link"
    assert redact_path(f"/v1/tenants/{uid}/retention/preview").endswith("/retention/preview")
    assert redact_path(f"/v1/tenants/{uid}/deletion-requests/{uid}/execute").endswith("/execute")


# ------------------------------------------------------------------------------------------------------------------------ storage: removal that is confirmed
def _storage(handler: Any) -> Any:
    from app.catalogue.storage import HttpStorageClient

    return HttpStorageClient("http://storage.local/storage/v1", "anon", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_remove_checked_is_true_when_storage_lists_the_file_as_deleted() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"name": "a.zip"}])

    assert _storage(handler).remove_checked("tok", "exp-u", ["a.zip"]) is True
    assert len(seen) == 1 and seen[0].method == "DELETE" and seen[0].headers["authorization"] == "Bearer tok"


def test_an_empty_answer_for_a_file_that_is_still_there_is_not_removal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[]) if request.method == "DELETE" else httpx.Response(200, json={"name": "a.zip"})

    assert _storage(handler).remove_checked("tok", "exp-u", ["a.zip"]) is False


def test_an_empty_answer_for_a_file_that_is_not_there_counts_as_gone() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[]) if request.method == "DELETE" else httpx.Response(404, json={"error": "not_found"})

    assert _storage(handler).remove_checked("tok", "exp-u", ["a.zip"]) is True


def test_a_refused_or_unreachable_delete_is_false_and_logs_no_text(caplog: pytest.LogCaptureFixture) -> None:
    assert _storage(lambda r: httpx.Response(500, text="secret internals")).remove_checked("tok", "b", ["a"]) is False

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused with secret detail")

    with caplog.at_level(logging.WARNING):
        assert _storage(down).remove_checked("tok", "b", ["a"]) is False
    assert "secret" not in caplog.text and "ConnectError" in caplog.text
    assert _storage(down).remove_checked("tok", "b", []) is True
