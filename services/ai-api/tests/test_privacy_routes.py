"""Job BN: the HTTP side of the privacy rights against in-memory fakes. The role matrix (and the second factor) of every endpoint, WHAT reaches the data layer and with whose token, the export's
background run end to end (begin, build, upload, finish), the short-lived link, deletion with its confirmations and refusals, retention, grievances, and the re-accept gate. The database rules are
pgTAP 85; the real stack is tests/integration/test_bn_privacy_rights.py."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date
from typing import Any

import pytest

from app.integrations.policy import PolicyVersions
from app.privacy.policy_gate import PolicyGate
from tests.catalogue_fakes import FakeStorage
from tests.fakes import TENANT_A, auth, make_client
from tests.integrations_fakes import FakeIntegrations
from tests.privacy_fakes import FakePrivacy

T = f"/v1/tenants/{TENANT_A.id}"
X1 = "11111111-1111-4111-8111-111111111111"
X2 = "22222222-2222-4222-8222-222222222222"
D1 = "33333333-3333-4333-8333-333333333333"
G1 = "44444444-4444-4444-8444-444444444444"
ROLES = ("a_owner", "a_admin", "a_sales", "a_viewer")


class World:
    def __init__(self, **kw: Any) -> None:
        self.db = FakePrivacy()
        self.storage = FakeStorage()
        self.client, _ = make_client(privacy=self.db, catalogue_storage=self.storage, **kw)

    def call(self, method: str, path: str, user: str | None, body: Any = None, **claims: Any) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, path, json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


# ------------------------------------------------------------------------------------------------------------------------ my data export
def test_a_person_asks_for_their_data_and_the_file_is_made_and_stored(w: World) -> None:
    r = w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    assert r.status_code == 202 and r.json()["export"]["scope"] == "person"
    # TestClient runs the background task before returning: the whole run happened
    names = [c[0] for c in w.db.calls]
    assert names[:2] == ["export_request", "export_begin"] and names[-1] == "export_finish"
    assert "person_data" in names and "export_bucket" in names
    (upload,) = [c for c in w.storage.calls if c[0] == "upload"]
    assert upload[2].startswith("exp-") and upload[3][0] == f"{X1}.zip" and upload[3][1] == "application/zip"
    assert len(set(w.db.tokens)) == 1, "every call used the person's own token"
    assert all(c[1] == w.db.tokens[0] for c in w.storage.calls), "...and storage got the same token"
    got = w.call("GET", f"/v1/me/data-exports/{X1}", "a_sales").json()["export"]
    assert got["status"] == "ready" and got["size_bytes"] > 100 and len(got["sha256"]) == 64
    data = w.storage.objects[(upload[2], f"{X1}.zip")]
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert {"README.txt", "manifest.json", "profile.json", "my_actions.json", "my_assistant_chat.json"} <= set(z.namelist())
        assert json.loads(z.read("profile.json"))["email"] == "a_owner@test.local"


def test_asking_twice_with_the_same_id_does_not_run_it_twice(w: World) -> None:
    w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    before = len(w.storage.calls)
    r = w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    assert r.status_code == 202 and r.json()["export"]["status"] == "ready"
    assert len(w.storage.calls) == before, "a replay of a finished export builds nothing"


def test_another_export_while_one_is_open_is_a_409(w: World) -> None:
    w.db.exports[X1] = {"id": X1, "scope": "person", "tenant_id": None, "status": "running"}
    r = w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X2})
    assert r.status_code == 409 and r.json()["error"]["code"] == "privacy_state"


def test_no_sign_in_is_a_401_and_a_bad_body_a_422(w: World) -> None:
    assert w.call("POST", "/v1/me/data-exports", None, {"export_id": X1}).status_code == 401
    assert w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": "nope"}).status_code == 422
    assert w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1, "tenant": "x"}).status_code == 422
    assert w.call("GET", "/v1/me/data-exports/not-a-uuid", "a_sales").status_code == 404


def test_the_link_is_short_lived_and_signed_for_the_person(w: World) -> None:
    w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    r = w.call("POST", f"/v1/me/data-exports/{X1}/link", "a_sales")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["link_valid_seconds"] == 300 and body["url"].startswith("http://storage.local/object/sign/exp-") and body["sha256"]
    assert w.storage.expires == [300], "storage was asked for a five-minute link"
    assert w.db.exports[X1]["downloads"] == 1


def test_no_link_before_the_file_is_ready_and_none_for_someone_elses(w: World) -> None:
    w.db.exports[X1] = {"id": X1, "scope": "person", "tenant_id": None, "status": "running", "downloads": 0}
    assert w.call("POST", f"/v1/me/data-exports/{X1}/link", "a_sales").status_code == 409
    assert w.call("POST", f"/v1/me/data-exports/{X2}/link", "a_sales").status_code == 404


def test_a_failed_signature_is_a_502_not_a_leak(w: World) -> None:
    w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    w.storage.fail_sign = True
    r = w.call("POST", f"/v1/me/data-exports/{X1}/link", "a_sales")
    assert r.status_code == 502 and "storage" not in json.dumps(r.json()).lower().replace("storage_unavailable", "")


def test_a_failure_while_making_the_file_marks_the_export_failed_and_removes_a_partial_file(w: World) -> None:
    w.db.tables = {}
    w.db.unreadable = set()

    def boom(*_: Any, **__: Any) -> Any:
        raise RuntimeError("secret detail")

    w.db.person_data = boom  # type: ignore[method-assign]
    r = w.call("POST", "/v1/me/data-exports", "a_sales", {"export_id": X1})
    assert r.status_code == 202
    got = w.db.exports[X1]
    assert got["status"] == "failed" and got["error_code"] == "internal"
    assert not [c for c in w.storage.calls if c[0] == "upload"]


# ------------------------------------------------------------------------------------------------------------------------ workspace export
def test_the_workspace_export_is_the_owners_with_a_second_factor(w: World) -> None:
    for user in ROLES:
        r = w.call("POST", T + "/data-exports", user, {"export_id": X1})
        assert r.status_code == (202 if user == "a_owner" else 403), user
    assert w.call("POST", T + "/data-exports", "a_owner", {"export_id": X2}, aal="aal1").status_code == 403
    assert w.call("POST", T + "/data-exports", "outsider", {"export_id": X2}).status_code == 404
    assert [c[0] for c in w.db.calls if c[0] == "export_request"] == ["export_request"], "only the Owner's call reached the data layer"


def test_the_workspace_zip_holds_one_file_per_table_read_with_the_owners_token(w: World) -> None:
    w.db.tables = {"companies": [{"id": "c1", "name": "Ravi Silks"}], "orders": []}
    w.db.unreadable = {"audit_events"}
    r = w.call("POST", T + "/data-exports", "a_owner", {"export_id": X1})
    assert r.status_code == 202
    reads = [c for c in w.db.calls if c[0] == "read_table_page"]
    assert reads and all(c[1][1] in ("id", "tenant_id", "language", "ref_id") for c in reads)
    (upload,) = [c for c in w.storage.calls if c[0] == "upload"]
    with zipfile.ZipFile(io.BytesIO(w.storage.objects[(upload[2], f"{X1}.zip")])) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["tables"]["companies"] == 1 and manifest["tables"]["audit_events"] == "not_readable"
        assert "tables/audit_events.json" not in z.namelist()
        assert json.loads(z.read("tables/companies.json"))[0]["name"] == "Ravi Silks"


# ------------------------------------------------------------------------------------------------------------------------ deletion
def test_account_deletion_needs_the_right_email_and_refuses_a_sole_owner(w: World) -> None:
    body = {"request_id": D1, "confirm_email": "a_owner@test.local"}
    r = w.call("POST", "/v1/me/deletion-requests", "a_sales", body)
    assert r.status_code == 201 and r.json()["deletion"]["status"] == "scheduled"
    bad = w.call("POST", "/v1/me/deletion-requests", "a_sales", {"request_id": X2, "confirm_email": "other@test.local"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "confirmation_mismatch"
    w.db.sole_owner = True
    sole = w.call("POST", "/v1/me/deletion-requests", "a_sales", {"request_id": X1, "confirm_email": "a_owner@test.local"})
    assert sole.status_code == 409 and sole.json()["error"]["code"] == "sole_owner"
    assert w.call("POST", f"/v1/me/deletion-requests/{D1}/cancel", "a_sales").json()["deletion"]["status"] == "cancelled"
    assert len(w.call("GET", "/v1/me/deletion-requests", "a_sales").json()["deletions"]) == 1


def test_workspace_deletion_is_the_owners_with_a_second_factor_and_the_name(w: World) -> None:
    body = {"request_id": D1, "confirm_name": "Tenant A"}
    for user in ROLES:
        r = w.call("POST", T + "/deletion-requests", user, {**body, "request_id": X1 if user != "a_owner" else D1})
        assert r.status_code == (201 if user == "a_owner" else 403), user
    assert w.call("POST", T + "/deletion-requests", "a_owner", {"request_id": X2, "confirm_name": "Tenant A"}, aal="aal1").status_code == 403
    wrong = w.call("POST", T + "/deletion-requests", "a_owner", {"request_id": X2, "confirm_name": "tenant"})
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "confirmation_mismatch"
    assert w.call("GET", T + "/deletion-requests", "a_admin").status_code == 200
    assert w.call("GET", T + "/deletion-requests", "a_sales").status_code == 403
    assert w.call("POST", T + f"/deletion-requests/{D1}/execute", "a_admin").status_code == 403
    assert w.call("POST", T + f"/deletion-requests/{D1}/execute", "a_owner", aal="aal1").status_code == 403
    done = w.call("POST", T + f"/deletion-requests/{D1}/execute", "a_owner")
    assert done.status_code == 200 and done.json()["deletion"]["status"] == "executed" and "erasure" in done.json()
    assert w.call("POST", T + f"/deletion-requests/{D1}/cancel", "a_admin").status_code == 403


def test_the_cooling_off_is_a_409_with_its_own_code(w: World) -> None:
    from app.privacy.errors import CoolingOffError

    w.db.fail = CoolingOffError("SM612")
    r = w.call("POST", T + f"/deletion-requests/{D1}/execute", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "cooling_off"


# ------------------------------------------------------------------------------------------------------------------------ retention
def test_retention_roles_validation_and_what_is_sent(w: World) -> None:
    assert w.call("GET", T + "/retention", "a_admin").status_code == 200
    assert w.call("GET", T + "/retention", "a_sales").status_code == 403
    ok = {"chats_days": 90, "voice_days": 30, "enquiries_days": 180, "scheduler_days": 60, "audit_days": 730}
    assert w.call("PUT", T + "/retention", "a_admin", ok).status_code == 403
    assert w.call("PUT", T + "/retention", "a_owner", ok, aal="aal1").status_code == 403
    r = w.call("PUT", T + "/retention", "a_owner", ok)
    assert r.status_code == 200 and r.json()["voice_days"] == 30
    assert w.db.calls[-1] == ("retention_set", ok)
    for bad in ({"chats_days": 5}, {"audit_days": 100}, {"chats_days": 60, "voice_days": 90}, {"chats_days": "90"}, {"chats_days": 90.5}, {"nope": 1}):
        assert w.call("PUT", T + "/retention", "a_owner", bad).status_code == 422, bad
    nothing = w.call("PUT", T + "/retention", "a_owner", {})
    assert nothing.status_code == 200 and w.db.calls[-1][1] == {"chats_days": None, "voice_days": None, "enquiries_days": None, "scheduler_days": None, "audit_days": None}


def test_retention_preview_counts_for_a_given_or_the_saved_setting(w: World) -> None:
    r = w.call("POST", T + "/retention/preview", "a_admin", {"chats_days": 90})
    assert r.status_code == 200 and r.json()["counts"]["chat_messages"] == 2
    assert w.db.calls[-1][1]["chats_days"] == 90
    r2 = w.call("POST", T + "/retention/preview", "a_admin")
    assert r2.status_code == 200 and w.db.calls[-1][1] is None
    assert w.call("POST", T + "/retention/preview", "a_sales", {}).status_code == 403


# ------------------------------------------------------------------------------------------------------------------------ grievances
BODY = {"grievance_id": G1, "kind": "access", "subject": "Please send my data", "details": "x"}


def test_grievances_who_may_submit_see_and_work_them(w: World) -> None:
    for user in ("a_owner", "a_admin", "a_sales"):
        assert w.call("POST", T + "/grievances", user, {**BODY, "grievance_id": G1}).status_code == 201, user
    assert w.call("POST", T + "/grievances", "a_viewer", BODY).status_code == 403
    assert w.call("POST", T + "/grievances", "outsider", BODY).status_code == 404
    assert w.call("POST", T + "/grievances", "a_sales", {**BODY, "kind": "rumour"}).status_code == 422
    assert w.call("POST", T + "/grievances", "a_sales", {**BODY, "subject": "   "}).status_code == 422
    assert w.call("GET", T + "/grievances", "a_sales").status_code == 200
    assert w.call("GET", T + "/grievances?status=bogus", "a_sales").status_code == 422
    assert w.call("GET", T + "/grievances?status=open", "a_admin").status_code == 200
    assert w.call("GET", T + f"/grievances/{G1}", "a_sales").status_code == 200
    assert w.call("POST", T + f"/grievances/{G1}/status", "a_sales", {"status": "acknowledged"}).status_code == 403
    up = w.call("POST", T + f"/grievances/{G1}/status", "a_admin", {"status": "resolved", "note": "done"})
    assert up.status_code == 200 and up.json()["grievance"]["status"] == "resolved"
    assert w.call("POST", T + f"/grievances/{G1}/status", "a_admin", {"status": "received"}).status_code == 422


def test_a_grievance_of_another_workspace_is_not_found_here(w: World) -> None:
    w.call("POST", T + "/grievances", "a_sales", BODY)
    w.db.grievances[G1]["tenant_id"] = "99999999-9999-4999-8999-999999999999"
    assert w.call("GET", T + f"/grievances/{G1}", "a_admin").status_code == 404
    assert w.call("POST", T + f"/grievances/{G1}/status", "a_admin", {"status": "acknowledged"}).status_code == 404


def test_the_rate_limit_is_a_429(w: World) -> None:
    from app.privacy.errors import PrivacyRateError

    w.db.fail = PrivacyRateError("SM614")
    r = w.call("POST", T + "/grievances", "a_sales", BODY)
    assert r.status_code == 429 and r.json()["error"]["code"] == "privacy_rate_limited"


def test_everything_is_503_when_the_feature_is_not_wired() -> None:
    client, _ = make_client()
    assert client.get("/v1/me/data-exports", headers=auth("a_owner")).status_code == 503
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 503


# ------------------------------------------------------------------------------------------------------------------------ the re-accept gate
def _gated(enforce: bool, accepted: list[dict[str, str]], today: date = date(2026, 11, 2), terms_from: date | None = None) -> tuple[Any, FakeIntegrations]:
    integrations = FakeIntegrations()
    integrations.accepted = accepted
    versions = PolicyVersions("2026-11-01", "2026-10-01", terms_from, None)
    gate = PolicyGate(versions, enforce=enforce, today=lambda: today)
    client, _ = make_client(integrations=integrations, policies=versions, policy_gate=gate, privacy=FakePrivacy(), catalogue_storage=FakeStorage())
    return client, integrations


def _mine(integrations: FakeIntegrations) -> list[dict[str, str]]:
    return integrations.accepted


OLD = [{"kind": "terms", "version": "2026-10-01"}, {"kind": "privacy", "version": "2026-10-01"}]
NEW = [{"kind": "terms", "version": "2026-11-01"}, {"kind": "privacy", "version": "2026-10-01"}]


def test_the_gate_is_off_by_default_and_blocks_only_when_enforced() -> None:
    client, _ = _gated(False, OLD)
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 200
    client, _ = _gated(True, OLD)
    r = client.get(T + "/retention", headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "policy_acceptance_required"
    assert r.json()["error"]["terms"] == "required" and r.json()["error"]["privacy"] == "accepted"


def test_the_gate_lets_a_person_who_accepted_in_and_remembers_it() -> None:
    client, integrations = _gated(True, NEW)
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 200
    calls = len(integrations.calls)
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 200
    assert len(integrations.calls) == calls, "a yes is remembered for a minute"


def test_the_gate_never_hides_a_workspace_from_a_stranger_or_a_role_from_a_member() -> None:
    client, _ = _gated(True, OLD)
    assert client.get(T + "/retention", headers=auth("outsider")).status_code == 404
    assert client.get(T + "/retention", headers=auth("a_sales")).status_code == 403
    assert client.get(T + "/retention", headers=auth("a_sales")).json()["error"]["code"] != "policy_acceptance_required"


def test_a_version_binds_from_its_effective_date() -> None:
    client, _ = _gated(True, OLD, today=date(2026, 10, 30), terms_from=date(2026, 11, 1))
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 200
    client, _ = _gated(True, OLD, today=date(2026, 11, 1), terms_from=date(2026, 11, 1))
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 403


def test_the_acceptance_routes_are_never_gated_and_accepting_opens_the_gate() -> None:
    client, integrations = _gated(True, OLD)
    assert client.get("/v1/me/policy-acceptances", headers=auth("a_owner")).json()["blocking"] is True
    assert client.get("/v1/me/data-exports", headers=auth("a_owner")).status_code == 200, "my own data is never behind the gate"
    r = client.post("/v1/me/policy-acceptances", headers=auth("a_owner"), json={"terms_version": "2026-11-01"})
    assert r.status_code == 200
    integrations.accepted = NEW
    assert client.get(T + "/retention", headers=auth("a_owner")).status_code == 200
    assert client.get("/v1/policies/current").json()["terms"] == {"version": "2026-11-01"}
