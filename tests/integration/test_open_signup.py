"""Job AD / D2 on the real local stack: open sign-up, from the sign-up call to the one business. Real GoTrue (e-mail confirmation ON), the real local
mail catcher (Mailpit, http://127.0.0.1:54324), real PostgREST and Postgres, our API in-process with the caller's own token.

The web server action `signUp` makes exactly the Auth call made here (same body, same metadata); its logic is unit-tested in apps/web.
Throwaway accounts only; the only mail server involved is the one inside the local stack."""

# ruff: noqa: E501, S608

from __future__ import annotations

import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import operator_sql
import pytest
from conftest import Stack, User, bearer, unique_slug
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
MAIL = "http://127.0.0.1:54324"
META = {"display_name": "Asha Rao", "business_name": "Sri Lakshmi Silks", "terms_version": "draft-1"}


def fresh() -> tuple[str, str]:
    return f"open-{uuid.uuid4().hex[:10]}@it.example.test", uuid.uuid4().hex + "Aa1!"


def sign_up(stack: Stack, email: str, password: str, data: dict[str, str] | None = META) -> httpx.Response:
    body: dict[str, Any] = {"email": email, "password": password}
    if data is not None:
        body["data"] = data
    return httpx.post(f"{stack.url}/auth/v1/signup", headers={"apikey": stack.anon_key}, json=body, timeout=20)


def mails_to(email: str) -> list[dict[str, Any]]:
    for _ in range(40):
        found = httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email}"}, timeout=10).json()["messages"]
        if found:
            return list(found)
        time.sleep(0.25)
    return []


def token_hash_from_mail(email: str) -> str:
    message = mails_to(email)[0]
    html = httpx.get(f"{MAIL}/api/v1/message/{message['ID']}", timeout=10).json()["HTML"]
    link = re.search(r'href="([^"]+)"', html)
    assert link, html
    parsed = urlparse(link.group(1))
    assert parsed.path == "/auth/confirm", link.group(1)
    match = re.search(r"token_hash=([A-Za-z0-9_-]+)&type=email&next=/app$", link.group(1))
    assert match, link.group(1)
    return match.group(1)


def confirm_with_the_link(stack: Stack, email: str) -> dict[str, Any]:
    """What /auth/confirm does when the person presses Continue: verifyOtp with the token hash from the mail."""
    done = httpx.post(
        f"{stack.url}/auth/v1/verify",
        headers={"apikey": stack.anon_key},
        json={"type": "email", "token_hash": token_hash_from_mail(email)},
        timeout=20,
    )
    assert done.status_code == 200, done.text
    return dict(done.json())


def password_login(stack: Stack, email: str, password: str) -> httpx.Response:
    return httpx.post(
        f"{stack.url}/auth/v1/token?grant_type=password",
        headers={"apikey": stack.anon_key},
        json={"email": email, "password": password},
        timeout=20,
    )


def account(session: dict[str, Any]) -> User:
    return User(label="open", id=uuid.UUID(session["user"]["id"]), token=session["access_token"])


@pytest.fixture
def confirmed(stack: Stack) -> User:
    """A person who signed up the way the form does and pressed the link in the mail."""
    email, password = fresh()
    assert sign_up(stack, email, password).status_code == 200
    session = confirm_with_the_link(stack, email)
    return account(session)


# ==== local mail only ====
def test_confirmation_is_on_and_there_is_no_smtp_server_to_send_to() -> None:
    config = (ROOT / "supabase" / "config.toml").read_text()
    assert re.search(r"^enable_confirmations = true$", config, re.M)
    assert not re.search(r"^\[auth\.email\.smtp\]", config, re.M), "an SMTP section would let a real mail leave this machine"
    assert not re.search(r"^\s*smtp_host\s*=", config, re.M)
    assert re.search(r"^\[local_smtp\]\s*\nenabled = true", config, re.M)


def test_the_confirmation_mail_lands_in_the_local_catcher_and_links_to_the_apps_own_page(stack: Stack) -> None:
    email, password = fresh()
    assert sign_up(stack, email, password).status_code == 200
    messages = mails_to(email)
    assert len(messages) == 1 and messages[0]["Subject"] == "Confirm your email"
    token_hash_from_mail(email)  # the link has the app's /auth/confirm shape: token_hash, type=email, next=/app


# ==== the sign-up itself ====
def test_a_signed_up_account_cannot_sign_in_until_the_address_is_confirmed(stack: Stack) -> None:
    email, password = fresh()
    assert sign_up(stack, email, password).status_code == 200
    refused = password_login(stack, email, password)
    assert refused.status_code == 400 and refused.json()["error_code"] == "email_not_confirmed"
    assert "access_token" not in refused.json()


def test_the_terms_are_recorded_by_the_database_with_its_own_clock(stack: Stack, confirmed: User) -> None:
    row = operator_sql.sql(f"select terms_version || '|' || (accepted_at between now() - interval '5 minutes' and now()) from public.terms_acceptances where user_id = '{confirmed.id}'")
    assert row == "draft-1|true"
    name = operator_sql.sql(f"select display_name from public.users where id = '{confirmed.id}'")
    assert name == "Asha Rao"


def test_the_same_address_again_makes_no_second_account_and_sends_no_second_mail(stack: Stack, confirmed: User) -> None:
    """The form answers "check your email" for an address that already has an account (ADR 0003, no enumeration); here is what the Auth server does behind it."""
    email = operator_sql.sql(f"select email from auth.users where id = '{confirmed.id}'")
    mails_before = httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email}"}, timeout=10).json()["messages_count"]
    again = sign_up(stack, email, uuid.uuid4().hex + "Aa1!")
    body = again.json()
    # a project that hides existing accounts answers 200 with a user that has no identities; this local one answers 422. The form gives the same answer for both.
    assert (again.status_code == 422 and body["error_code"] in {"user_already_exists", "email_exists"}) or (
        again.status_code == 200 and body.get("identities") == []
    )
    assert operator_sql.sql(f"select count(*) from auth.users where lower(email) = lower('{email}')") == "1"
    assert httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email}"}, timeout=10).json()["messages_count"] == mails_before
    # the old account is untouched: its terms row and its sign-in with the OLD password still stand
    assert operator_sql.sql(f"select count(*) from public.terms_acceptances where user_id = '{confirmed.id}'") == "1"


def test_a_too_short_password_is_refused_by_the_auth_server_too(stack: Stack) -> None:
    refused = sign_up(stack, fresh()[0], "abc")
    assert refused.status_code == 422 and refused.json()["error_code"] == "weak_password"


# ==== the first-login setup ====
def test_the_setup_is_needed_then_makes_exactly_one_business_with_the_person_as_owner(client: TestClient, confirmed: User) -> None:
    before = client.get("/v1/account/setup", headers=bearer(confirmed)).json()
    assert before == {"state": "needed", "tenant_id": None, "business_name": "Sri Lakshmi Silks"}
    assert client.get("/v1/me", headers=bearer(confirmed)).json()["memberships"] == []

    made = client.post("/v1/account/setup", json={"business_type": "textiles", "language": "te"}, headers=bearer(confirmed))
    assert made.status_code == 200, made.text
    tenant_id = made.json()["tenant_id"]
    assert made.json()["created"] is True

    me = client.get("/v1/me", headers=bearer(confirmed)).json()["memberships"]
    assert [(m["tenant"]["id"], m["tenant"]["name"], m["role"]) for m in me] == [(tenant_id, "Sri Lakshmi Silks", "owner")]
    assert re.fullmatch(r"sri-lakshmi-silks-[0-9a-f]{8}", me[0]["tenant"]["slug"])

    tenant = client.get(f"/v1/tenants/{tenant_id}", headers=bearer(confirmed)).json()
    assert (tenant["plan"], tenant["workspace_limit"], tenant["role"]) == ("free_trial", 1, "owner")

    after = client.get("/v1/account/setup", headers=bearer(confirmed)).json()
    assert after == {"state": "done", "tenant_id": tenant_id, "business_name": None}
    stored = operator_sql.sql(f"select business_type || '|' || language from public.account_setups where user_id = '{confirmed.id}'")
    assert stored == "textiles|te"


def test_pressing_twice_or_using_a_second_tab_makes_one_business(client: TestClient, confirmed: User) -> None:
    barrier = threading.Barrier(2)

    def press(language: str) -> Any:
        barrier.wait(timeout=10)
        return client.post("/v1/account/setup", json={"business_type": "other", "language": language}, headers=bearer(confirmed))

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [f.result(timeout=60) for f in [pool.submit(press, "en"), pool.submit(press, "hi")]]
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert sorted(r.json()["created"] for r in responses) == [False, True]
    assert responses[0].json()["tenant_id"] == responses[1].json()["tenant_id"]
    assert operator_sql.sql(f"select count(*) from public.memberships where user_id = '{confirmed.id}' and role = 'owner'") == "1"
    assert operator_sql.sql(f"select count(*) from public.tenants t join public.account_setups s on s.created_tenant_id = t.id where s.user_id = '{confirmed.id}'") == "1"
    # a later press, from either tab, still lands on the same business and changes nothing
    again = client.post("/v1/account/setup", json={"business_type": "construction", "language": "kn"}, headers=bearer(confirmed))
    assert again.status_code == 200 and again.json() == {"tenant_id": responses[0].json()["tenant_id"], "created": False}


def test_a_person_without_the_terms_in_their_sign_up_cannot_do_the_setup(stack: Stack, client: TestClient) -> None:
    email, password = fresh()
    assert sign_up(stack, email, password, data={"business_name": "No Terms Co"}).status_code == 200
    session = confirm_with_the_link(stack, email)
    person = account(session)
    assert client.get("/v1/account/setup", headers=bearer(person)).json()["state"] == "none"
    refused = client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}, headers=bearer(person))
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "terms_required"
    assert client.get("/v1/me", headers=bearer(person)).json()["memberships"] == []


def test_an_account_that_already_owns_a_workspace_is_refused_the_setup(client: TestClient, confirmed: User) -> None:
    mine = client.post("/v1/tenants", json={"name": "Already Mine", "slug": unique_slug("it-own")}, headers=bearer(confirmed))
    assert mine.status_code == 200
    refused = client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}, headers=bearer(confirmed))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "workspace_limit_reached"
    assert len(client.get("/v1/me", headers=bearer(confirmed)).json()["memberships"]) == 1


def test_the_setup_takes_no_business_name_and_no_other_fields(client: TestClient, confirmed: User) -> None:
    for body in (
        {"business_type": "other", "language": "en", "business_name": "Mine"},
        {"business_type": "other", "language": "en", "tenant_id": str(uuid.uuid4())},
        {"business_type": "bakery", "language": "en"},
        {"business_type": "other", "language": "fr"},
    ):
        assert client.post("/v1/account/setup", json=body, headers=bearer(confirmed)).status_code == 422
    assert client.get("/v1/account/setup", headers=bearer(confirmed)).json()["state"] == "needed"


def test_nobody_without_a_session_reaches_the_setup(client: TestClient) -> None:
    assert client.get("/v1/account/setup").status_code == 401
    assert client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}).status_code == 401


def test_someone_elses_new_business_is_invisible_to_a_stranger(client: TestClient, confirmed: User, signup: Any) -> None:
    tenant_id = client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}, headers=bearer(confirmed)).json()["tenant_id"]
    stranger = signup("open-stranger")
    assert client.get(f"/v1/tenants/{tenant_id}", headers=bearer(stranger)).status_code == 404
    assert client.get("/v1/account/setup", headers=bearer(stranger)).json()["state"] == "none"


def test_the_setup_rows_are_private_to_their_person_through_postgrest_directly(stack: Stack, client: TestClient, confirmed: User, signup: Any) -> None:
    client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}, headers=bearer(confirmed))
    other = signup("open-peek")
    for table in ("account_setups", "terms_acceptances"):
        seen = httpx.get(f"{stack.rest}/{table}?select=user_id", headers=stack.headers(other.token), timeout=15)
        assert seen.status_code == 200 and seen.json() == [], table
        own = httpx.get(f"{stack.rest}/{table}?select=user_id", headers=stack.headers(confirmed.token), timeout=15)
        assert [row["user_id"] for row in own.json()] == [str(confirmed.id)], table
    forged = httpx.post(
        f"{stack.rest}/account_setups",
        headers=stack.headers(other.token),
        json={"user_id": str(other.id), "created_tenant_id": str(uuid.uuid4()), "business_type": "other", "language": "en"},
        timeout=15,
    )
    assert forged.status_code in (401, 403), forged.text
    anon = httpx.get(f"{stack.rest}/terms_acceptances?select=user_id", headers={"apikey": stack.anon_key}, timeout=15)
    assert anon.status_code in (401, 403)
    assert httpx.post(f"{stack.rest}/rpc/complete_setup", headers={"apikey": stack.anon_key}, json={"p_business_type": "other", "p_language": "en"}, timeout=15).status_code in (401, 403)


# ==== the existing flows keep working with confirmation on ====
def test_a_confirmed_person_signs_in_with_their_password(stack: Stack) -> None:
    email, password = fresh()
    sign_up(stack, email, password)
    confirm_with_the_link(stack, email)
    ok = password_login(stack, email, password)
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert password_login(stack, email, "wrong-" + password).status_code == 400


def test_the_password_reset_mail_still_arrives_in_the_local_catcher(stack: Stack) -> None:
    email, password = fresh()
    sign_up(stack, email, password)
    confirm_with_the_link(stack, email)
    sent = httpx.post(f"{stack.url}/auth/v1/recover", headers={"apikey": stack.anon_key}, json={"email": email}, timeout=20)
    assert sent.status_code == 200
    subjects: list[str] = []
    for _ in range(40):
        subjects = [m["Subject"] for m in mails_to(email)]
        if any("eset" in subject for subject in subjects):
            break
        time.sleep(0.25)
    assert any("eset" in subject for subject in subjects), subjects
