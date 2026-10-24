"""Job DE on the real local stack: the Auth e-mails (Confirm, Reset password, Magic link) are the repository's templates (supabase/templates/*.html, subjects in supabase/config.toml) and each carries a token that the
app's confirm page can use: the page runs verifyOtp(type, token_hash), which is the /auth/v1/verify call made here. The Invite mail needs an admin key to be sent, and this suite holds none (by design), so it is covered
by the static test services/ai-api/tests/test_auth_templates.py. Real GoTrue and the stack's own mail catcher (Mailpit); throwaway accounts only."""

# ruff: noqa: E501

from __future__ import annotations

import re
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx
import stack_env
from conftest import Stack

MAIL = f"http://127.0.0.1:{stack_env.current().mail_port}"


def fresh() -> tuple[str, str]:
    return f"tpl-{uuid.uuid4().hex[:10]}@it.example.test", uuid.uuid4().hex + "Aa1!"


def post(stack: Stack, path: str, body: dict[str, Any]) -> httpx.Response:
    return httpx.post(f"{stack.url}/auth/v1/{path}", headers={"apikey": stack.anon_key}, json=body, timeout=20)


def newest_mail(email: str, subject: str) -> dict[str, Any]:
    """The mail to `email` with this subject (the stack's mail catcher is shared by everything that runs on it, so search by recipient)."""
    for _ in range(60):
        found = httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email} subject:\"{subject}\""}, timeout=10).json()["messages"]
        if found:
            return dict(httpx.get(f"{MAIL}/api/v1/message/{found[0]['ID']}", timeout=10).json())
        time.sleep(0.25)
    raise AssertionError(f"no mail to {email} with the subject {subject!r}")


def link_of(message: dict[str, Any]) -> str:
    link = re.search(r'href="([^"]+)"', message["HTML"])
    assert link, message["HTML"]
    return link.group(1).replace("&amp;", "&")


def verify(stack: Stack, link: str, expected_type: str) -> dict[str, Any]:
    parsed = urlparse(link)
    assert parsed.path == "/auth/confirm", link
    match = re.search(rf"\?token_hash=([A-Za-z0-9_-]+)&type={expected_type}(&next=/app)?$", link)
    assert match, link
    done = post(stack, "verify", {"type": expected_type, "token_hash": match.group(1)})
    assert done.status_code == 200, done.text
    return dict(done.json())


def confirmed_account(stack: Stack) -> tuple[str, str]:
    email, password = fresh()
    assert post(stack, "signup", {"email": email, "password": password, "data": {"terms_version": "draft-1"}}).status_code == 200
    verify(stack, link_of(newest_mail(email, "Confirm your Stack19 email")), "email")
    return email, password


def test_the_confirm_mail_is_the_stack19_one_and_its_link_works(stack: Stack) -> None:
    email, password = fresh()
    assert post(stack, "signup", {"email": email, "password": password}).status_code == 200
    message = newest_mail(email, "Confirm your Stack19 email")
    assert "Stack19" in message["HTML"] and "{{" not in message["HTML"]
    assert "access_token" in verify(stack, link_of(message), "email")


def test_the_reset_mail_links_to_the_apps_page_with_type_recovery_and_its_token_works(stack: Stack) -> None:
    email, _ = confirmed_account(stack)
    assert post(stack, "recover", {"email": email}).status_code == 200
    message = newest_mail(email, "Reset your Stack19 password")
    assert "Stack19" in message["HTML"] and "{{" not in message["HTML"]
    assert "access_token" in verify(stack, link_of(message), "recovery")


def test_the_magic_link_mail_links_to_the_apps_page_and_is_verified_as_type_email(stack: Stack) -> None:
    email, _ = confirmed_account(stack)
    assert post(stack, "otp", {"email": email, "create_user": False}).status_code == 200
    message = newest_mail(email, "Your Stack19 sign-in link")
    assert "Stack19" in message["HTML"] and "{{" not in message["HTML"]
    # the confirm page accepts invite, recovery and email only: a magic link's token is verified as type=email
    assert "access_token" in verify(stack, link_of(message), "email")
