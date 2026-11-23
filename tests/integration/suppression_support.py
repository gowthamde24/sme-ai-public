"""Shared helpers for tests that touch suppression keys (T010, ADR 0020). The keys here are well-formed FAKES (a sha256 of a word): the database cannot verify an HMAC, only
store and compare it, so a test may make any 64-hex string. All data is synthetic."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
from typing import Any

import httpx
from conftest import User
from crm_support import World
from evidence_support import pg


def fake_hex(word: str) -> str:
    """A well-formed key (64 lower-case hex digits) derived from a word."""
    return hashlib.sha256(word.encode()).hexdigest()


def record_keys(
    w: World, user: User, contact_id: str, keys: dict[str, Any], also: dict[str, Any] | None = None
) -> httpx.Response:
    return httpx.post(
        f"{w.stack.rest}/rpc/record_contact_keys",
        headers=w.stack.headers(user.token),
        json={"p_contact_id": contact_id, "p_keys": keys, "p_also": also or {}},
        timeout=60,
    )


def key_contact(w: World, user: User, contact_id: str, tag: str = "t") -> None:
    """Record fake keys for every identifier the contact holds (so an erasure is the normal path)."""
    row = pg(w.stack, user, "GET", f"/contacts?id=eq.{contact_id}&select=email,phone").json()[0]
    keys: dict[str, Any] = {"version": 1}
    if row["email"]:
        keys["email"] = fake_hex(f"{tag}:{contact_id}:email")
    if row["phone"]:
        keys["phone"] = fake_hex(f"{tag}:{contact_id}:phone")
    if len(keys) > 1:
        r = record_keys(w, user, contact_id, keys)
        assert r.status_code == 200, r.text
