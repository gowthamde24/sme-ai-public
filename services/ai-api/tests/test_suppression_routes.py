"""T010 part 1 (ADR 0020), the HTTP side against in-memory fakes: where the keys are computed and recorded (create contact, update, import, erasure), the role matrix and the second factor of
the Owner-only actions, fixed error messages, and the canary: a key, an e-mail or a phone number never appears in a response or in a log record. The database rules are pgTAP 60 and the real
stack is tests/integration/test_suppression_api.py."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import pytest

from app.erasure.repository import KeyMissingError
from app.suppression import service
from app.suppression.keys import KeyRing, KeyVersion
from app.tenancy.repository import Forbidden, UpstreamError
from tests.erasure_fakes import FakeErasureRepository
from tests.fakes import (
    TENANT_A,
    TENANT_B,
    FakeCrmRepository,
    FakeLeadsRepository,
    auth,
    make_client,
)
from tests.suppression_fakes import RING, FakeSuppression

CID = uuid.UUID(int=0xC1)
REQ = uuid.UUID(int=0xE1)
EMAIL = "canary.buyer@example.test"
PHONE = "+91 98765 43210"
HEX64 = re.compile(r"[0-9a-f]{64}")


class World:
    def __init__(self, ring: KeyRing | None = RING, suppression: bool = True) -> None:
        self.crm = FakeCrmRepository()
        self.erasure = FakeErasureRepository()
        self.leads = FakeLeadsRepository()
        self.sup = FakeSuppression()
        self.crm.seed(
            "contacts", TENANT_A.id, CID, full_name="Canary Buyer", email=EMAIL, phone=PHONE
        )
        self.client, _ = make_client(
            crm=self.crm,
            erasure=self.erasure,
            leads=self.leads,
            suppression=self.sup if suppression else None,
            key_ring=ring,
        )

    def url(self, path: str, tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}{path}"

    def create(self, user: str = "a_sales", **over: Any) -> Any:
        body = {
            "id": str(uuid.uuid4()),
            "full_name": "New Person",
            "email": "new.person@example.test",
            "phone": "+00 90000 00001",
            **over,
        }
        return self.client.post(self.url("/contacts"), json=body, headers=auth(user))


@pytest.fixture
def w() -> World:
    return World()


def no_key_in(response: Any) -> None:
    assert not HEX64.search(response.text) and "hmac" not in response.text.lower()


# ------------------------------------------------------------------------------------------ create and update contact
def test_a_created_contact_has_its_keys_computed_and_recorded_with_the_callers_token(
    w: World,
) -> None:
    headers = auth("a_sales")
    token = headers["Authorization"].split()[1]
    cid = str(uuid.uuid4())
    r = w.client.post(
        w.url("/contacts"),
        json={
            "id": cid,
            "full_name": "A B",
            "email": "A.B@Example.test",
            "phone": "+91 98765 43210",
        },
        headers=headers,
    )
    assert r.status_code == 201
    ((contact, keys, also),) = w.sup.recorded
    assert str(contact) == cid and w.sup.tokens == [token]
    assert (
        keys
        == {
            "version": 1,
            "email": RING.key_for("email", "a.b@example.test"),
            "phone": RING.key_for("phone", "9876543210"),
        }
        and also == {}
    )
    no_key_in(r)  # the response is the contact: no key, no hmac field


def test_a_contact_without_identifiers_or_with_ones_that_cannot_be_normalised_records_nothing(
    w: World,
) -> None:
    assert w.create(email=None, phone=None).status_code == 201
    assert w.create(email=None, phone="abcd").status_code == 201
    assert w.sup.recorded == []


def test_a_contact_with_only_one_usable_identifier_records_that_one(w: World) -> None:
    assert w.create(email="only.mail@example.test", phone="abcd").status_code == 201
    ((_, keys, _),) = w.sup.recorded
    assert set(keys) == {"version", "email"}


def test_a_contact_that_arrives_with_a_suppressed_key_is_shown_in_its_fresh_state(w: World) -> None:
    w.sup.flagged = True
    before = len(w.crm.calls)
    r = w.create()
    assert r.status_code == 201
    assert ("get", "contacts") in w.crm.calls[
        before:
    ]  # the database flagged it: the answer is re-read, not the stale row


def test_a_failure_to_record_never_fails_the_request_and_logs_no_value(
    w: World, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    w.sup.record_error = UpstreamError("data layer unreachable")
    r = w.create(email="log.canary@example.test")
    assert r.status_code == 201 and w.sup.recorded == []
    logged = "\n".join(rec.getMessage() for rec in caplog.records)
    assert (
        "suppression keys were not recorded" in logged
        and "log.canary" not in logged
        and not HEX64.search(logged)
    )


def test_without_a_key_ring_or_a_repository_a_contact_is_still_created_unkeyed() -> None:
    for world in (World(ring=None), World(suppression=False)):
        assert world.create().status_code == 201
        assert world.sup.recorded == []


def test_an_update_re_records_the_keys_only_when_an_identifier_changes(w: World) -> None:
    path = w.url(f"/contacts/{CID}")
    assert (
        w.client.patch(path, json={"full_name": "Renamed"}, headers=auth("a_sales")).status_code
        == 200
    )
    assert w.sup.recorded == []
    assert (
        w.client.patch(
            path, json={"email": "changed@example.test"}, headers=auth("a_sales")
        ).status_code
        == 200
    )
    assert (
        w.client.patch(path, json={"phone": "+91 91234 56789"}, headers=auth("a_sales")).status_code
        == 200
    )
    assert [set(k) - {"version"} for _, k, _ in w.sup.recorded] == [
        {"email", "phone"},
        {"email", "phone"},
    ]  # the contact's CURRENT identifiers, both keyed again
    assert w.sup.recorded[0][1]["email"] == RING.key_for("email", "changed@example.test")


def test_a_viewer_cannot_create_so_nothing_is_recorded(w: World) -> None:
    assert w.create("a_viewer").status_code == 403 and w.sup.recorded == []


# ------------------------------------------------------------------------------------------ import
def test_a_committed_import_keys_the_contacts_it_created_from_the_rows_it_was_given(
    w: World,
) -> None:
    rows = [
        {
            "company_name": "Acme One",
            "contact_name": "One",
            "contact_email": "one@example.test",
            "contact_phone": "+00 90000 00011",
        },
        {"company_name": "Acme Two"},
        {
            "company_name": "Acme Three",
            "contact_name": "Three",
            "contact_email": "Three@Example.test",
        },
    ]
    r = w.client.post(
        w.url("/leads/import"),
        json={"batch_id": str(uuid.uuid4()), "rows": rows},
        headers=auth("a_sales"),
    )
    assert r.status_code == 201
    contacts = [o["contact_id"] for o in r.json()["rows"]]
    assert [str(c) for c, _, _ in w.sup.recorded] == [contacts[0], contacts[2]]
    assert w.sup.recorded[0][1] == {
        "version": 1,
        "email": RING.key_for("email", "one@example.test"),
        "phone": RING.key_for("phone", "9000000011"),
    }
    assert set(w.sup.recorded[1][1]) == {"version", "email"} and w.sup.recorded[1][1][
        "email"
    ] == RING.key_for("email", "three@example.test")
    no_key_in(r)


def test_a_preview_records_nothing(w: World) -> None:
    rows = [{"company_name": "Acme", "contact_name": "One", "contact_email": "one@example.test"}]
    assert (
        w.client.post(
            w.url("/leads/import/preview"),
            json={"batch_id": str(uuid.uuid4()), "rows": rows},
            headers=auth("a_sales"),
        ).status_code
        == 200
    )
    assert w.sup.recorded == []


# ------------------------------------------------------------------------------------------ erasure
def request_for(
    w: World, scope: str = "contact", subject: uuid.UUID | None = CID, **over: Any
) -> None:
    w.erasure.seed(TENANT_A.id, REQ, scope=scope, subject_id=subject, **over)


def execute(w: World, user: str = "a_owner", dry_run: bool = False, **claims: Any) -> Any:
    return w.client.post(
        w.url(f"/erasure-requests/{REQ}/execute"),
        json={"dry_run": dry_run},
        headers=auth(user, **claims),
    )


def test_a_contact_erasure_records_the_keys_first_and_then_erases(w: World) -> None:
    request_for(w)
    r = execute(w)
    assert r.status_code == 200
    ((contact, keys, _),) = w.sup.recorded
    assert (
        contact == CID
        and keys["email"] == RING.key_for("email", EMAIL)
        and keys["phone"] == RING.key_for("phone", PHONE)
    )
    assert w.erasure.calls.count("execute") == 1
    no_key_in(r)


def test_a_preview_records_the_keys_too_because_the_database_needs_them_for_the_dry_run(
    w: World,
) -> None:
    request_for(w)
    assert execute(w, dry_run=True).status_code == 200
    assert len(w.sup.recorded) == 1 and w.erasure.dry_runs == [True]


@pytest.mark.parametrize("scope", ["company", "tenant"])
def test_only_a_contact_erasure_records_keys(w: World, scope: str) -> None:
    request_for(w, scope=scope, subject=CID if scope == "company" else None)
    assert execute(w).status_code == 200 and w.sup.recorded == []


def test_an_executed_or_cancelled_request_records_nothing(w: World) -> None:
    for status in ("executed", "cancelled"):
        request_for(w, status=status)
        w.erasure.rows[REQ] = (TENANT_A.id, w.erasure.rows[REQ][1])
        execute(w)
    assert w.sup.recorded == []


def test_erasure_without_a_key_ring_still_reaches_the_database_which_decides() -> None:
    world = World(ring=None)
    request_for(world)
    assert execute(world).status_code == 200 and world.sup.recorded == []


def test_a_missing_key_at_erasure_is_a_fixed_409_that_echoes_nothing(w: World) -> None:
    request_for(w)
    w.erasure.execute_error = KeyMissingError("SM221 canary-row-data " + EMAIL)
    r = execute(w)
    assert r.status_code == 409 and r.json()["error"]["code"] == "erasure_key_missing"
    assert "canary" not in r.text and EMAIL not in r.text
    assert "allow this erasure without a key" in r.json()["error"]["message"]


def test_the_owner_may_allow_an_erasure_without_a_key_nobody_else_may(w: World) -> None:
    request_for(w)
    path = w.url(f"/erasure-requests/{REQ}/allow-without-key")
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert w.client.post(path, headers=auth(user)).status_code == 403, user
    weak = w.client.post(path, headers=auth("a_owner", aal="aal1"))
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert w.sup.allowed == []
    ok = w.client.post(path, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json() == {
        "request_id": str(REQ),
        "without_key": True,
        "replayed": False,
    }
    assert w.client.post(path, headers=auth("a_owner")).json()["replayed"] is True


def test_allowing_without_a_key_is_404_for_an_unknown_foreign_or_malformed_request(
    w: World,
) -> None:
    request_for(w)
    assert (
        w.client.post(
            w.url(f"/erasure-requests/{uuid.uuid4()}/allow-without-key"), headers=auth("a_owner")
        ).status_code
        == 404
    )
    assert (
        w.client.post(
            w.url("/erasure-requests/nope/allow-without-key"), headers=auth("a_owner")
        ).status_code
        == 404
    )
    assert (
        w.client.post(
            w.url(f"/erasure-requests/{REQ}/allow-without-key", TENANT_B.id),
            headers=auth("b_owner"),
        ).status_code
        == 404
    )
    assert w.sup.allowed == []


def test_allowing_without_a_key_when_the_database_refuses_is_a_plain_403(w: World) -> None:
    request_for(w)
    w.sup.error = Forbidden("42501")
    assert (
        w.client.post(
            w.url(f"/erasure-requests/{REQ}/allow-without-key"), headers=auth("a_owner")
        ).status_code
        == 403
    )


def test_allowing_without_a_repository_is_503() -> None:
    world = World(suppression=False)
    request_for(world)
    r = world.client.post(
        world.url(f"/erasure-requests/{REQ}/allow-without-key"), headers=auth("a_owner")
    )
    assert r.status_code == 503 and r.json()["error"]["code"] == "suppression_unavailable"


# ------------------------------------------------------------------------------------------ status and backfill
def test_the_status_is_for_owner_and_admin_and_holds_only_counts_and_flags(w: World) -> None:
    w.sup.count = 7
    for user in ("a_owner", "a_admin"):
        r = w.client.get(w.url("/suppression/status"), headers=auth(user))
        assert r.status_code == 200 and r.json() == {
            "key_configured": True,
            "key_version": 1,
            "unkeyed_contacts": 7,
        }
        no_key_in(r)
    for user in ("a_sales", "a_viewer"):
        assert w.client.get(w.url("/suppression/status"), headers=auth(user)).status_code == 403
    assert w.client.get(w.url("/suppression/status")).status_code == 401
    assert (
        w.client.get(w.url("/suppression/status", TENANT_B.id), headers=auth("a_owner")).status_code
        == 404
    )


def test_the_status_says_when_no_key_is_configured_and_503_when_there_is_no_repository() -> None:
    world = World(ring=None)
    assert world.client.get(world.url("/suppression/status"), headers=auth("a_owner")).json() == {
        "key_configured": False,
        "key_version": None,
        "unkeyed_contacts": 0,
    }
    assert (
        World(suppression=False)
        .client.get(world.url("/suppression/status"), headers=auth("a_owner"))
        .status_code
        == 503
    )


def contacts(n: int, **over: Any) -> list[dict[str, Any]]:
    return [
        {
            "id": str(uuid.UUID(int=0x1000 + i)),
            "email": f"c{i}@example.test",
            "phone": f"+00 90000 {i:05d}",
            **over,
        }
        for i in range(n)
    ]


def test_the_backfill_is_the_owners_with_a_second_factor(w: World) -> None:
    path = w.url("/suppression/backfill")
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert w.client.post(path, headers=auth(user)).status_code == 403, user
    weak = w.client.post(path, headers=auth("a_owner", aal="aal1"))
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert w.client.post(path).status_code == 401
    assert (
        w.client.post(
            w.url("/suppression/backfill", TENANT_B.id), headers=auth("a_owner")
        ).status_code
        == 404
    )
    assert w.sup.backfilled == []


def test_the_backfill_keys_the_contacts_in_batches_and_reports_only_counts(w: World) -> None:
    w.sup.unkeyed = contacts(230)
    w.sup.count = 230
    r = w.client.post(w.url("/suppression/backfill"), headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {
        "recorded": 230,
        "skipped": 0,
        "flagged": 0,
        "unkeyable": 0,
        "remaining": 0,
    }
    assert [len(b) for b in w.sup.backfilled] == [100, 100, 30]
    first = w.sup.backfilled[0][0]
    assert first["keys"]["email"] == RING.key_for("email", "c0@example.test") and set(first) == {
        "contact_id",
        "keys",
        "also",
    }
    no_key_in(r)


def test_one_call_handles_a_bounded_number_of_batches_and_the_owner_calls_again(w: World) -> None:
    w.sup.unkeyed = contacts(service.BATCH * service.MAX_BATCHES + 50)
    w.sup.count = len(w.sup.unkeyed)
    first = w.client.post(w.url("/suppression/backfill"), headers=auth("a_owner")).json()
    assert first["recorded"] == service.BATCH * service.MAX_BATCHES and first["remaining"] == 50
    second = w.client.post(w.url("/suppression/backfill"), headers=auth("a_owner")).json()
    assert second["recorded"] == 50 and second["remaining"] == 0


def test_a_contact_that_cannot_be_keyed_is_counted_and_never_retried_forever(w: World) -> None:
    w.sup.unkeyed = contacts(2) + [
        {"id": str(uuid.UUID(int=0x9999)), "email": "not an address", "phone": "ab"}
    ]
    w.sup.count = 3
    r = w.client.post(w.url("/suppression/backfill"), headers=auth("a_owner")).json()
    assert r["unkeyable"] == 1 and r["recorded"] == 2
    assert len(w.sup.backfilled) == 1 and all(
        i["contact_id"] != str(uuid.UUID(int=0x9999)) for i in w.sup.backfilled[0]
    )


def test_the_backfill_without_a_key_ring_is_503_and_changes_nothing() -> None:
    world = World(ring=None)
    r = world.client.post(world.url("/suppression/backfill"), headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "suppression_key_not_configured"


def test_a_previous_key_is_offered_for_matching_when_a_key_was_rotated() -> None:
    ring = KeyRing(
        KeyVersion(2, b"synthetic-test-key-9876543210"),
        KeyVersion(1, b"synthetic-test-key-0123456789"),
    )
    world = World(ring=ring)
    assert world.create().status_code == 201
    ((_, keys, also),) = world.sup.recorded
    assert (
        keys["version"] == 2
        and set(also) == {"email", "phone"}
        and also["email"][0] != keys["email"]
    )


def test_no_log_record_of_any_flow_holds_a_key_an_address_or_a_number(
    w: World, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    request_for(w)
    w.create(email="flow.canary@example.test", phone="+91 98111 22333")
    execute(w)
    w.sup.unkeyed = contacts(3)
    w.sup.count = 3
    w.client.post(w.url("/suppression/backfill"), headers=auth("a_owner"))
    w.client.get(w.url("/suppression/status"), headers=auth("a_owner"))
    logged = "\n".join(rec.getMessage() + " " + str(rec.args) for rec in caplog.records)
    assert (
        "canary" not in logged.lower()
        and "98111" not in logged
        and "98765" not in logged
        and not HEX64.search(logged)
    )
