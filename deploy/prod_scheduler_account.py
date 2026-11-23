#!/usr/bin/env python3
# ruff: noqa: E501
"""Creates the production SCHEDULER sign-in account already confirmed (no mailbox, no mail ever sent): Supabase Auth admin API, `email_confirm: true`. Reads ONE JSON object from stdin
({"ref", "key", "email", "password"}) so the service key and the password never appear on a command line; prints only a word: created | exists | refused. Called by deploy/prod-secrets-prompt.sh in the owner's terminal."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any


def post(url: str, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, str]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**headers, "Content-Type": "application/json"}, method="POST")  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            return r.status, r.read().decode()[:400]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def create(ref: str, key: str, email: str, password: str, send: Callable[[str, dict[str, str], dict[str, Any]], tuple[int, str]] = post) -> str:
    """created | exists | refused. Never returns or logs the key or the password."""
    if not ref.isalnum() or not email or len(password) < 12:
        return "refused"
    status, text = send(f"https://{ref}.supabase.co/auth/v1/admin/users", {"apikey": key, "Authorization": f"Bearer {key}"}, {"email": email, "password": password, "email_confirm": True})
    if status in (200, 201):
        return "created"
    if status == 422 and ("already" in text.lower() or "exists" in text.lower() or "registered" in text.lower()):
        return "exists"
    return "refused"


def main() -> int:
    if "--env" in sys.argv[1:]:   # the caller put the four values in its environment (never on a command line)
        data = {"ref": os.environ.get("SCH_REF", ""), "key": os.environ.get("SCH_KEY", ""), "email": os.environ.get("SCH_EMAIL", ""), "password": os.environ.get("SCH_PW", "")}
    else:
        data = json.loads(sys.stdin.read())
    word = create(str(data.get("ref", "")), str(data.get("key", "")), str(data.get("email", "")), str(data.get("password", "")))
    print(word)
    return 0 if word in ("created", "exists") else 1


if __name__ == "__main__":
    raise SystemExit(main())
