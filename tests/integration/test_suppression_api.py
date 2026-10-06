"""T010 part 1 (ADR 0020) on the real stack: the hard gate end to end through OUR API, and the database attacked straight through PostgREST.

THE GATE: a contact is created (its keys are computed with the server's key and recorded), then ERASED; the same address arriving again, written another way, through the create route AND through
the import, is created FLAGGED (suppressed, `legal`, consent withdrawn). Opt-outs and lifts move the keys; the Owner (aal2) is the only one who lifts; the backfill keys the contacts that have no key;
an erasure is never blocked for good (the Owner's explicit step); another workspace sees none of it.
THE LEAK CHECK: no response, no audit row and no PostgREST read ever holds a key; the keys are reachable only through the definer functions.
KNOWN LIMIT (documented here as a test): the database cannot verify an HMAC, so a member may record a WRONG key for a contact (option A; option B is required before an external customer).
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import re
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import TEST_SUPPRESSION_KEY, aal1_token, bearer
from crm_support import Tenant, World
from evidence_support import code_of, pg, uid
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.suppression.keys import KeyRing, KeyVersion

RING = KeyRing(KeyVersion(1, TEST_SUPPRESSION_KEY.encode()))
HEX64 = re.compile(r"[0-9a-f]{64}")


@pytest.fixture(scope="module")
def w(eval_world: World) -> World:
    return eval_world


def sql(q: str) -> str:
    return operator_sql.sql(q).strip()


def stored(contact: str) -> dict[str, Any]:
    raw = sql(
        f"select row_to_json(k) from (select email_hmac, phone_hmac, key_version from suppression.contact_keys where contact_id = '{contact}') k"
    )
    return dict(json.loads(raw)) if raw else {}


def events(tenant: Tenant, where: str = "true") -> list[dict[str, Any]]:
    raw = sql(
        f"select coalesce(json_agg(e order by seq), '[]') from (select seq, kind, event, reason, source_contact_id from suppression.key_events where tenant_id = '{tenant.id}' and {where}) e"
    )
    return list(json.loads(raw))


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def raw(w: World, token: str, method: str, path: str, **headers: str) -> httpx.Response:
    return httpx.request(
        method, f"{w.stack.rest}{path}", headers=w.stack.headers(token, **headers), timeout=20
    )


def unique_mail(tag: str) -> str:
    return f"{tag}.{uuid.uuid4().hex[:8]}@example.test"


def make_contact(
    client: TestClient,
    t: Tenant,
    email: str | None,
    phone: str | None,
    user: str = "sales",
    **over: Any,
) -> httpx.Response:
    body = {"id": uid(), "full_name": "Synthetic Person", "email": email, "phone": phone, **over}
    r: httpx.Response = client.post(
        url(t, "/contacts"),
        json={k: v for k, v in body.items() if v is not None},
        headers=bearer(t.users[user]),
    )
    assert r.status_code == 201, r.text
    return r


def get_contact(client: TestClient, t: Tenant, cid: str) -> dict[str, Any]:
    r = client.get(url(t, f"/contacts/{cid}"), headers=bearer(t.users["owner"]))
    assert r.status_code == 200, r.text
    return dict(r.json())


def erase(client: TestClient, t: Tenant, cid: str) -> dict[str, Any]:
    rid = uid()
    owner = bearer(t.users["owner"])
    assert (
        client.post(
            url(t, "/erasure-requests"),
            json={"id": rid, "scope": "contact", "subject_id": cid},
            headers=owner,
        ).status_code
        == 201
    )
    done = client.post(url(t, f"/erasure-requests/{rid}/execute"), json={}, headers=owner)
    assert done.status_code == 200, done.text
    return dict(done.json())


def phone_n(n: int) -> str:
    return f"+00 90000 {n:05d}"


COUNTER = iter(range(3000, 90000))


# ============================================================================ the keys are computed on the server, with the server's key
def test_a_created_contact_is_keyed_with_the_servers_hmac(w: World, client: TestClient) -> None:
    mail, phone = unique_mail("keyed"), phone_n(next(COUNTER))
    r = make_contact(client, w.a, mail, phone)
    cid = r.json()["id"]
    row = stored(cid)
    assert row == {
        "email_hmac": RING.key_for("email", mail),
        "phone_hmac": RING.key_for("phone", phone),
        "key_version": 1,
    }
    assert (
        not HEX64.search(r.text) and "hmac" not in r.text.lower()
    )  # the response is the contact, nothing more
    assert HEX64.search(json.dumps(row))  # (control: the pattern does match what is stored)


def test_no_identifier_no_key_and_one_identifier_one_key(w: World, client: TestClient) -> None:
    none = make_contact(client, w.a, None, None).json()["id"]
    assert stored(none) == {}
    only = make_contact(client, w.a, unique_mail("only"), None).json()["id"]
    assert stored(only)["phone_hmac"] is None and stored(only)["email_hmac"] is not None


def test_a_changed_identifier_is_re_keyed_through_the_api(w: World, client: TestClient) -> None:
    mail = unique_mail("before")
    cid = make_contact(client, w.a, mail, phone_n(next(COUNTER))).json()["id"]
    after = unique_mail("after")
    r = client.patch(
        url(w.a, f"/contacts/{cid}"), json={"email": after}, headers=bearer(w.a.users["sales"])
    )
    assert r.status_code == 200
    assert stored(cid)["email_hmac"] == RING.key_for("email", after)
    r2 = client.patch(
        url(w.a, f"/contacts/{cid}"),
        json={"job_title": "Buyer"},
        headers=bearer(w.a.users["sales"]),
    )
    assert r2.status_code == 200 and stored(cid)["email_hmac"] == RING.key_for("email", after)


def test_a_direct_postgrest_change_of_an_identifier_forgets_the_key_it_cannot_re_record(
    w: World, client: TestClient
) -> None:
    mail = unique_mail("direct")
    cid = make_contact(client, w.a, mail, phone_n(next(COUNTER))).json()["id"]
    r = pg(
        w.stack,
        w.a.users["sales"],
        "PATCH",
        f"/contacts?id=eq.{cid}",
        json={"email": unique_mail("sneaky")},
    )
    assert r.status_code in (200, 204)
    row = stored(cid)
    assert (
        row["email_hmac"] is None and row["phone_hmac"] is not None
    )  # the stale key is gone: it never vouches for a new address


# ============================================================================ THE GATE
def test_erasure_then_the_same_address_again_is_flagged_through_the_create_route_and_the_import(
    w: World, client: TestClient
) -> None:
    mail, phone = unique_mail("gate"), phone_n(next(COUNTER))
    cid = make_contact(client, w.a, mail, phone).json()["id"]
    done = erase(client, w.a, cid)
    assert (
        done["counts"]["suppression.keys_written"] == 2
        and "suppression.erased_without_key" not in done["counts"]
    )
    assert not HEX64.search(json.dumps(done))
    assert stored(cid) == {}  # the stored keys went with the contact
    assert [
        (e["kind"], e["event"], e["reason"]) for e in events(w.a, f"source_contact_id = '{cid}'")
    ] == [("email", "suppressed", "erased"), ("phone", "suppressed", "erased")]
    erased = get_contact(client, w.a, cid)
    assert erased["email"] is None and erased["phone"] is None

    # the same person comes back: another e-mail case, the phone written without its spaces
    again = make_contact(client, w.a, mail.upper(), phone.replace(" ", "")).json()
    back = get_contact(client, w.a, again["id"])
    assert back["suppressed_at"] is not None and back["suppression_reason"] == "legal", (
        "the re-created contact is flagged, never contactable"
    )
    assert (back["email_consent"], back["phone_consent"], back["whatsapp_consent"]) == (
        "unknown",
        "unknown",
        "unknown",
    )

    # only the phone repeats (another address): still flagged
    second_mail, second_phone = unique_mail("gate2"), phone_n(next(COUNTER))
    second = make_contact(client, w.a, second_mail, second_phone).json()["id"]
    erase(client, w.a, second)
    only_phone = make_contact(client, w.a, unique_mail("fresh"), second_phone).json()["id"]
    assert get_contact(client, w.a, only_phone)["suppression_reason"] == "legal"
    # ... and a stranger who got a NEW number in the meantime is not
    third = make_contact(client, w.a, unique_mail("stranger"), phone_n(next(COUNTER))).json()["id"]
    assert get_contact(client, w.a, third)["suppressed_at"] is None

    # through the lead import
    imported = client.post(
        url(w.a, "/leads/import"),
        json={
            "batch_id": uid(),
            "rows": [
                {
                    "company_name": f"Gate Co {uuid.uuid4().hex[:6]}",
                    "contact_name": "Back Again",
                    "contact_email": unique_mail("imp"),
                    "contact_phone": phone,
                }
            ],
        },
        headers=bearer(w.a.users["sales"]),
    )
    assert imported.status_code == 201, imported.text
    row = imported.json()["rows"][0]
    assert row["contact_created"] is True
    assert get_contact(client, w.a, row["contact_id"])["suppression_reason"] == "legal", (
        "a re-import of an erased number is flagged"
    )

    # another workspace is untouched
    other = make_contact(client, w.b, mail, phone).json()["id"]
    assert get_contact(client, w.b, other)["suppressed_at"] is None
    assert events(w.b) == []


def test_an_ordinary_new_contact_is_not_flagged(w: World, client: TestClient) -> None:
    cid = make_contact(client, w.a, unique_mail("plain"), phone_n(next(COUNTER))).json()["id"]
    assert get_contact(client, w.a, cid)["suppressed_at"] is None


# ============================================================================ opt-outs and lifting
def test_an_opt_out_suppresses_the_keys_and_only_the_owner_with_aal2_lifts_them(
    w: World, client: TestClient
) -> None:
    mail, phone = unique_mail("optout"), phone_n(next(COUNTER))
    cid = make_contact(client, w.a, mail, phone).json()["id"]
    sales, admin, owner = (bearer(w.a.users[r]) for r in ("sales", "admin", "owner"))
    r = client.post(
        url(w.a, f"/contacts/{cid}/suppress"),
        json={"reason": "opted_out", "evidence_type": "verbal", "evidence_ref": "call:1"},
        headers=sales,
    )
    assert r.status_code == 200
    assert {
        (e["kind"], e["event"], e["reason"]) for e in events(w.a, f"source_contact_id = '{cid}'")
    } == {("email", "suppressed", "opted_out"), ("phone", "suppressed", "opted_out")}
    # the same address arrives as another contact: flagged as an opt-out
    again = make_contact(client, w.a, unique_mail("other"), phone).json()[
        "id"
    ]  # (the address itself is unique per workspace; the number is shared)
    assert get_contact(client, w.a, again)["suppression_reason"] == "opted_out"
    lift = {"evidence_type": "written", "evidence_ref": "letter:1"}
    path = url(w.a, f"/contacts/{cid}/lift-suppression")
    assert client.post(path, json=lift, headers=sales).status_code == 403
    assert client.post(path, json=lift, headers=admin).status_code == 403
    weak = client.post(
        path,
        json=lift,
        headers={"Authorization": f"Bearer {aal1_token(w.stack, w.a.users['owner'])}"},
    )
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert not [e for e in events(w.a, f"source_contact_id = '{cid}'") if e["event"] == "lifted"]
    assert client.post(path, json=lift, headers=owner).status_code == 200
    assert {
        (e["kind"], e["event"])
        for e in events(w.a, f"source_contact_id = '{cid}'")
        if e["event"] == "lifted"
    } == {("email", "lifted"), ("phone", "lifted")}
    fresh = make_contact(client, w.a, unique_mail("after-lift"), phone).json()["id"]
    assert get_contact(client, w.a, fresh)["suppressed_at"] is None, (
        "after the lift the number is no longer suppressed"
    )


# ============================================================================ the status and the backfill
def test_the_backfill_keys_existing_contacts_and_suppresses_those_that_were_already_opted_out(
    w: World, client: TestClient
) -> None:
    owner = w.a.users["owner"]
    mails = [unique_mail("old") for _ in range(3)]
    ids, phones = [], []
    for m in (
        mails
    ):  # contacts created straight through PostgREST: the API never saw them, so they hold no key
        cid, ph = uid(), phone_n(next(COUNTER))
        r = pg(
            w.stack,
            owner,
            "POST",
            "/contacts",
            json={
                "id": cid,
                "tenant_id": w.a.id,
                "full_name": "Old Contact",
                "email": m,
                "phone": ph,
            },
            representation=False,
        )
        assert r.status_code == 201, r.text
        ids.append(cid)
        phones.append(ph)
    assert (
        client.post(
            url(w.a, f"/contacts/{ids[0]}/suppress"),
            json={"reason": "opted_out"},
            headers=bearer(w.a.users["sales"]),
        ).status_code
        == 200
    )
    status = client.get(url(w.a, "/suppression/status"), headers=bearer(w.a.users["admin"]))
    assert (
        status.status_code == 200
        and status.json()["key_configured"] is True
        and status.json()["unkeyed_contacts"] >= 3
    )
    assert not HEX64.search(status.text)
    # who may
    assert (
        client.post(
            url(w.a, "/suppression/backfill"), headers=bearer(w.a.users["admin"])
        ).status_code
        == 403
    )
    assert (
        client.post(
            url(w.a, "/suppression/backfill"), headers=bearer(w.a.users["sales"])
        ).status_code
        == 403
    )
    weak = client.post(
        url(w.a, "/suppression/backfill"),
        headers={"Authorization": f"Bearer {aal1_token(w.stack, owner)}"},
    )
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    done = client.post(url(w.a, "/suppression/backfill"), headers=bearer(owner))
    assert (
        done.status_code == 200 and done.json()["remaining"] == 0 and done.json()["recorded"] >= 3
    ), done.text
    assert set(done.json()) == {
        "recorded",
        "skipped",
        "flagged",
        "unkeyable",
        "remaining",
    } and not HEX64.search(done.text)
    for cid, m in zip(ids, mails, strict=True):
        assert stored(cid)["email_hmac"] == RING.key_for("email", m)
    # the contact that had opted out BEFORE it was keyed now has suppressed keys: the same address arriving again is flagged
    assert any(e["event"] == "suppressed" and e["source_contact_id"] == ids[0] for e in events(w.a))
    again = make_contact(client, w.a, unique_mail("later"), phones[0]).json()["id"]
    assert get_contact(client, w.a, again)["suppression_reason"] == "opted_out"
    # a second run is harmless and the count is zero
    second = client.post(url(w.a, "/suppression/backfill"), headers=bearer(owner)).json()
    assert second["remaining"] == 0 and second["recorded"] == 0
    assert (
        client.get(url(w.a, "/suppression/status"), headers=bearer(owner)).json()[
            "unkeyed_contacts"
        ]
        == 0
    )


# ============================================================================ erasure is never blocked for good
def unkeyed_app(w: World) -> TestClient:
    """An app with NO suppression key (development only): contacts it creates are unkeyed, and its erasure route cannot record keys."""
    settings = Settings(
        _env_file=None,
        api_env="development",
        supabase_url=w.stack.url,
        supabase_anon_key=w.stack.anon_key,
    )  # type: ignore[call-arg]
    return TestClient(create_app(settings))


def test_an_unkeyed_contact_cannot_be_erased_until_the_owner_allows_it(w: World) -> None:
    with unkeyed_app(w) as keyless:
        mail = unique_mail("nokey")
        cid = make_contact(keyless, w.a, mail, phone_n(next(COUNTER))).json()["id"]
        assert stored(cid) == {}
        owner = bearer(w.a.users["owner"])
        rid = uid()
        assert (
            keyless.post(
                url(w.a, "/erasure-requests"),
                json={"id": rid, "scope": "contact", "subject_id": cid},
                headers=owner,
            ).status_code
            == 201
        )
        refused = keyless.post(url(w.a, f"/erasure-requests/{rid}/execute"), json={}, headers=owner)
        assert (
            refused.status_code == 409 and refused.json()["error"]["code"] == "erasure_key_missing"
        )
        assert mail not in refused.text and get_contact(keyless, w.a, cid)["email"] == mail, (
            "nothing was erased"
        )
        # a preview is refused the same way (the database needs the keys to run it)
        assert (
            keyless.post(
                url(w.a, f"/erasure-requests/{rid}/execute"), json={"dry_run": True}, headers=owner
            ).status_code
            == 409
        )
        path = url(w.a, f"/erasure-requests/{rid}/allow-without-key")
        for role in ("admin", "sales", "viewer"):
            assert keyless.post(path, headers=bearer(w.a.users[role])).status_code == 403, role
        weak = keyless.post(
            path, headers={"Authorization": f"Bearer {aal1_token(w.stack, w.a.users['owner'])}"}
        )
        assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
        assert (
            keyless.post(
                url(w.b, f"/erasure-requests/{rid}/allow-without-key"),
                headers=bearer(w.b.users["owner"]),
            ).status_code
            == 404
        )
        allowed = keyless.post(path, headers=owner)
        assert allowed.status_code == 200 and allowed.json() == {
            "request_id": rid,
            "without_key": True,
            "replayed": False,
        }
        done = keyless.post(url(w.a, f"/erasure-requests/{rid}/execute"), json={}, headers=owner)
        assert done.status_code == 200, done.text
        assert (
            done.json()["counts"]["suppression.erased_without_key"] == 1
            and "suppression.keys_written" not in done.json()["counts"]
        )
        assert get_contact(keyless, w.a, cid)["email"] is None
        # audited: the request row records who allowed it and when
        audit = sql(
            f"select count(*) from public.audit_events where entity_type = 'erasure_request' and entity_id = '{rid}' and action = 'erasure_request.update' and new_values->>'without_key_at' is not null and old_values->>'without_key_at' is null"
        )
        assert audit == "1"
        # and it left NO suppression: the address can be imported again and is NOT flagged (the checklist row lists such erasures)
        back = make_contact(keyless, w.a, mail, phone_n(next(COUNTER))).json()["id"]
        assert get_contact(keyless, w.a, back)["suppressed_at"] is None


# ============================================================================ the leak check: no key reaches a client, a read or the audit trail
def test_no_key_is_reachable_by_any_client_read(w: World, client: TestClient) -> None:
    mail = unique_mail("leak")
    cid = make_contact(client, w.a, mail, phone_n(next(COUNTER))).json()["id"]
    key = RING.key_for("email", mail)
    assert key is not None
    for role, user in w.a.users.items():
        for path in (
            f"/contacts?id=eq.{cid}&select=*",
            "/contacts?select=*",
            "/audit_events?select=*",
        ):
            r = pg(w.stack, user, "GET", path)
            assert key not in r.text, (role, path)
            assert "audit" in path or "hmac" not in r.text.lower(), (
                role,
                path,
            )  # the audit trail names a changed field, never its value
        api = client.get(url(w.a, f"/contacts/{cid}"), headers=bearer(user))
        assert key not in api.text and "hmac" not in api.text.lower(), role
        audit = client.get(url(w.a, "/audit-events"), headers=bearer(user))
        assert key not in audit.text and "hmac" not in audit.text.lower(), role
    # the audit trail says that a key field changed, never its value
    rows = sql(
        f"select count(*) from public.audit_events where tenant_id = '{w.a.id}' and entity_type in ('contact_key', 'suppression_key_event') and (new_values::text ~ '[0-9a-f]{{64}}' or old_values::text ~ '[0-9a-f]{{64}}')"
    )
    assert rows == "0"


def test_the_private_tables_and_internal_functions_are_not_exposed(w: World) -> None:
    owner = w.a.users["owner"]
    for table in ("contact_keys", "key_events"):
        assert pg(w.stack, owner, "GET", f"/{table}").status_code in (404, 406)
        assert raw(
            w, owner.token, "GET", f"/{table}", **{"Accept-Profile": "suppression"}
        ).status_code in (403, 404, 406)
    for fn in (
        "key_active",
        "contact_keys_record",
        "suppression_key_add",
        "suppression_keys_ok",
        "contacts_sync_suppression_keys",
    ):
        assert pg(w.stack, owner, "POST", f"/rpc/{fn}", json={}).status_code in (404, 406), fn


# ============================================================================ the functions straight through PostgREST
def rpc(w: World, user: Any, name: str, **args: Any) -> httpx.Response:
    return pg(w.stack, user, "POST", f"/rpc/{name}", json=args)


def fake(word: str) -> str:
    import hashlib

    return hashlib.sha256(word.encode()).hexdigest()


GENERIC = "suppression action not permitted"


def test_record_contact_keys_roles_and_shapes_through_postgrest(
    w: World, client: TestClient
) -> None:
    cid = make_contact(client, w.a, unique_mail("rpc"), phone_n(next(COUNTER))).json()["id"]
    keys = {"version": 1, "email": fake("e1"), "phone": fake("p1")}
    for role in ("owner", "admin", "sales"):
        r = rpc(w, w.a.users[role], "record_contact_keys", p_contact_id=cid, p_keys=keys)
        assert r.status_code == 200 and r.json()["recorded"] is True, role
    for who in (w.a.users["viewer"], w.b.users["owner"], w.b.users["viewer"]):
        r = rpc(w, who, "record_contact_keys", p_contact_id=cid, p_keys=keys)
        assert (
            r.status_code in (401, 403) and code_of(r) == "42501" and r.json()["message"] == GENERIC
        )
    unknown = rpc(w, w.a.users["sales"], "record_contact_keys", p_contact_id=uid(), p_keys=keys)
    assert (unknown.status_code, code_of(unknown), unknown.json()["message"]) == (
        403,
        "42501",
        GENERIC,
    ), "an unknown contact is the same refusal as a foreign one"
    anon = httpx.post(
        f"{w.stack.rest}/rpc/record_contact_keys",
        headers={"apikey": w.stack.anon_key},
        json={"p_contact_id": cid, "p_keys": keys},
        timeout=30,
    )
    assert anon.status_code in (401, 403)
    for bad in (
        {"version": 1},
        {"version": 0, "email": fake("x")},
        {"version": 1, "email": "ABC"},
        {"version": 1, "email": fake("x"), "extra": 1},
        {"version": 1, "phone": fake("x"), "email": None, "x": None},
    ):
        r = rpc(w, w.a.users["sales"], "record_contact_keys", p_contact_id=cid, p_keys=bad)
        assert r.status_code == 400 and code_of(r) == "22023", bad


def test_the_owner_only_functions_refuse_everyone_else_through_postgrest(
    w: World, client: TestClient
) -> None:
    cid = make_contact(client, w.a, unique_mail("own"), phone_n(next(COUNTER))).json()["id"]
    rid = uid()
    pg(
        w.stack,
        w.a.users["owner"],
        "POST",
        "/rpc/request_erasure",
        json={
            "p_request_id": rid,
            "p_tenant_id": w.a.id,
            "p_scope": "contact",
            "p_subject_id": cid,
        },
    )
    calls: list[tuple[str, dict[str, Any]]] = [
        ("backfill_contact_keys", {"p_tenant_id": w.a.id, "p_items": []}),
        ("unkeyed_contacts", {"p_tenant_id": w.a.id, "p_limit": 5}),
        ("allow_erasure_without_key", {"p_request_id": rid}),
    ]
    for fn, args in calls:
        for who in (
            w.a.users["admin"],
            w.a.users["sales"],
            w.a.users["viewer"],
            w.b.users["owner"],
        ):
            r = rpc(w, who, fn, **args)
            assert r.status_code in (401, 403) and code_of(r) == "42501", (fn, who.label)
        weak = httpx.post(
            f"{w.stack.rest}/rpc/{fn}",
            json=args,
            headers=w.stack.headers(aal1_token(w.stack, w.a.users["owner"])),
            timeout=20,
        )
        assert code_of(weak) == "SM306", fn
        assert rpc(w, w.a.users["owner"], fn, **args).status_code == 200, fn
    for fn, args in (("unkeyed_contact_count", {"p_tenant_id": w.a.id}),):
        assert rpc(w, w.a.users["admin"], fn, **args).status_code == 200
        for who in (w.a.users["sales"], w.a.users["viewer"], w.b.users["owner"]):
            assert code_of(rpc(w, who, fn, **args)) == "42501"


def test_check_suppression_tells_a_member_which_kind_and_nothing_more(
    w: World, client: TestClient
) -> None:
    mail, phone = unique_mail("chk"), phone_n(next(COUNTER))
    cid = make_contact(client, w.a, mail, phone).json()["id"]
    client.post(
        url(w.a, f"/contacts/{cid}/suppress"),
        json={"reason": "complained"},
        headers=bearer(w.a.users["sales"]),
    )
    ask = {"email": [RING.key_for("email", mail)], "phone": [fake("nobody")]}
    r = rpc(w, w.a.users["sales"], "check_suppression", p_tenant_id=w.a.id, p_keys=ask)
    assert r.status_code == 200 and r.json() == {"email": True, "phone": False, "suppressed": True}
    assert rpc(
        w, w.b.users["owner"], "check_suppression", p_tenant_id=w.b.id, p_keys=ask
    ).json() == {"email": False, "phone": False, "suppressed": False}
    assert (
        code_of(rpc(w, w.a.users["viewer"], "check_suppression", p_tenant_id=w.a.id, p_keys=ask))
        == "42501"
    )
    assert (
        code_of(rpc(w, w.b.users["owner"], "check_suppression", p_tenant_id=w.a.id, p_keys=ask))
        == "42501"
    )


def test_known_limit_a_member_can_record_a_wrong_key_because_the_database_cannot_verify_an_hmac(
    w: World, client: TestClient
) -> None:
    """Option A (ADR 0013 / 0020): the VALUE is the API's word. A Sales user who talks to PostgREST directly can record any well-formed key for a contact. The checklist row 'Option B
    before an external customer for key recording' closes this with a service principal. This test fails the day the limit is closed (and then it is deleted)."""
    mail = unique_mail("wrong")
    cid = make_contact(client, w.a, mail, None).json()["id"]
    r = rpc(
        w,
        w.a.users["sales"],
        "record_contact_keys",
        p_contact_id=cid,
        p_keys={"version": 1, "email": fake("not-the-real-key")},
    )
    assert r.status_code == 200 and stored(cid)["email_hmac"] == fake(
        "not-the-real-key"
    ) != RING.key_for("email", mail)


# ============================================================================ races
def run_threads(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)

    def go(i: int) -> Any:
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(go, range(n)))


def test_recording_the_same_keys_concurrently_is_idempotent(w: World, client: TestClient) -> None:
    cid = make_contact(client, w.a, unique_mail("race"), phone_n(next(COUNTER))).json()["id"]
    keys = {"version": 1, "email": fake("race-e"), "phone": fake("race-p")}
    results = run_threads(
        8,
        lambda i: rpc(w, w.a.users["sales"], "record_contact_keys", p_contact_id=cid, p_keys=keys),
    )
    assert all(r.status_code == 200 for r in results), [
        r.text for r in results if r.status_code != 200
    ]
    assert sql(f"select count(*) from suppression.contact_keys where contact_id = '{cid}'") == "1"


def test_suppressing_one_contact_from_many_requests_writes_each_key_event_once(
    w: World, client: TestClient
) -> None:
    cid = make_contact(client, w.a, unique_mail("many"), phone_n(next(COUNTER))).json()["id"]
    results = run_threads(
        6,
        lambda i: client.post(
            url(w.a, f"/contacts/{cid}/suppress"),
            json={"reason": "opted_out", "evidence_type": "verbal", "evidence_ref": f"call:{i}"},
            headers=bearer(w.a.users["sales"]),
        ),
    )
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert [(e["kind"], e["event"]) for e in events(w.a, f"source_contact_id = '{cid}'")] == [
        ("email", "suppressed"),
        ("phone", "suppressed"),
    ]


def test_two_contacts_sharing_a_number_erased_together_leave_one_suppressed_key(
    w: World, client: TestClient
) -> None:
    shared = phone_n(next(COUNTER))
    a = make_contact(client, w.a, unique_mail("sh1"), shared).json()["id"]
    b = make_contact(client, w.a, unique_mail("sh2"), shared).json()["id"]
    results = run_threads(2, lambda i: erase(client, w.a, (a, b)[i]))
    assert all(r["counts"]["suppression.keys_written"] >= 1 for r in results)
    phone_events = [
        e for e in events(w.a) if e["kind"] == "phone" and e["source_contact_id"] in (a, b)
    ]
    assert len(phone_events) == 1 and phone_events[0]["event"] == "suppressed", (
        "the shared number is suppressed once, not twice"
    )
    assert (
        SecretStr("x").get_secret_value() == "x"
    )  # (keeps the SecretStr import honest for the type checker)
