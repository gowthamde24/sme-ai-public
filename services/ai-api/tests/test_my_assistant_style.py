"""GET/PUT /v1/me/assistant-style (docs/contracts/voice-styles.md section 1B): a person's own style, any signed-in person, never anybody else's. A fake of the database's two functions."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from app.how_speaks import styles
from tests.fakes import auth, make_client

URL = "/v1/me/assistant-style"
SEVEN = ["friendly", "respectful", "quick", "professional", "calm_caring", "cheerful", "confident"]


def person(token: str) -> str:
    """Who the database sees behind a token: its `sub` claim (every request mints a new token for the same person)."""
    payload = token.split(".")[1]
    return str(json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"])


class OwnStyles:
    """What the database keeps: one value per person."""

    def __init__(self) -> None:
        self.rows: dict[str, str] = {}

    def my_style_get(self, token: str) -> dict[str, Any]:
        who = person(token)
        return {"value": self.rows.get(who), "saved": who in self.rows}

    def my_style_set(self, token: str, style: str | None) -> dict[str, Any]:
        if style is None:
            self.rows.pop(person(token), None)
        else:
            self.rows[person(token)] = style
        return self.my_style_get(token)


def world() -> tuple[Any, OwnStyles]:
    store = OwnStyles()
    client, _ = make_client(talk_training=store)
    return client, store


def test_nothing_chosen_shows_the_default_and_the_seven_options() -> None:
    client, _ = world()
    body = client.get(URL, headers=auth("a_owner")).json()
    assert body["value"] == "friendly" and body["saved"] is False
    assert [o["id"] for o in body["options"]] == SEVEN and body["options"] == styles.options()


def test_a_choice_is_kept_per_person_and_never_seen_by_another() -> None:
    client, store = world()
    done = client.put(URL, json={"value": "calm_caring"}, headers=auth("a_owner")).json()
    assert done["value"] == "calm_caring" and done["saved"] is True
    assert client.get(URL, headers=auth("a_owner")).json()["value"] == "calm_caring"
    assert client.get(URL, headers=auth("a_viewer")).json() | {"options": None} == {"value": "friendly", "saved": False, "options": None}
    assert client.put(URL, json={"value": "cheerful"}, headers=auth("a_viewer")).json()["value"] == "cheerful", "any member sets their own"
    assert client.get(URL, headers=auth("a_owner")).json()["value"] == "calm_caring" and len(store.rows) == 2


def test_null_clears_it() -> None:
    client, _ = world()
    client.put(URL, json={"value": "quick"}, headers=auth("a_owner"))
    cleared = client.put(URL, json={"value": None}, headers=auth("a_owner")).json()
    assert cleared["value"] == "friendly" and cleared["saved"] is False


@pytest.mark.parametrize("bad", ["casual", "Friendly", "", "loud", 7, ["quick"]])
def test_only_the_seven_words_are_accepted(bad: Any) -> None:
    client, store = world()
    r = client.put(URL, json={"value": bad}, headers=auth("a_owner"))
    assert r.status_code == 422 and store.rows == {}


def test_a_missing_value_or_an_extra_key_is_422() -> None:
    client, _ = world()
    assert client.put(URL, json={}, headers=auth("a_owner")).status_code == 422
    assert client.put(URL, json={"value": "quick", "tenant_id": "x"}, headers=auth("a_owner")).status_code == 422


def test_nobody_signed_out_reads_or_writes_and_nothing_is_cached() -> None:
    client, store = world()
    assert client.get(URL).status_code == 401 and client.put(URL, json={"value": "quick"}).status_code == 401 and store.rows == {}
    assert client.get(URL, headers=auth("a_owner")).headers["cache-control"] == "no-store"
