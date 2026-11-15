"""The assistant's name is its own small setting (owner, 15 Nov 2026): GET/PUT /ai-assistant/name, Owner and Admin, no second factor, null or blank = no name ("your assistant"); and the assistant can change it
by words with a plan card and an Undo (the settings-by-words table)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.assistant_work import settings_actions as sa
from tests.fakes import auth
from tests.test_dm_assistant_settings import B, settings, world


def saved_world() -> tuple[Any, Any]:
    client, repo = world()
    assert client.put(B, json=settings(name="Meera"), headers=auth("a_owner")).status_code == 200
    return client, repo


def test_owner_and_admin_may_change_the_name_without_a_second_factor() -> None:
    for user in ("a_owner", "a_admin"):
        client, repo = saved_world()
        got = client.put(f"{B}/name", json={"name": "Vani"}, headers=auth(user, aal="aal1"))
        assert got.status_code == 200 and got.json() == {"name": "Vani", "saved": True}, user
        assert client.get(f"{B}/name", headers=auth(user)).json() == {"name": "Vani", "saved": True}
    for user in ("a_sales", "a_viewer"):
        client, _ = saved_world()
        assert client.put(f"{B}/name", json={"name": "X"}, headers=auth(user)).status_code == 403, user


def test_null_or_blank_removes_the_name_and_the_settings_still_read() -> None:
    for body in ({"name": None}, {"name": ""}, {"name": "   "}, {}):
        client, repo = saved_world()
        got = client.put(f"{B}/name", json=body, headers=auth("a_owner"))
        assert got.status_code == 200 and got.json() == {"name": None, "saved": True}, body
        assert client.get(f"{B}/name", headers=auth("a_owner")).json() == {"name": None, "saved": True}
        read = client.get(B, headers=auth("a_owner")).json()
        assert read["saved"] is True and read["settings"]["name"] == "", "the full read shows an empty name, never a made-up one"


def test_a_bad_name_is_refused_and_nothing_changes() -> None:
    for bad in ("x" * 25, "<b>Vani</b>", "Va{ni}", "a@b"):
        client, repo = saved_world()
        assert client.put(f"{B}/name", json={"name": bad}, headers=auth("a_owner")).status_code == 422, bad
        assert repo.row is not None and repo.row["name"] == "Meera"


def test_before_the_assistant_is_set_up_a_name_cannot_be_invented() -> None:
    client, repo = world()
    refused = client.put(f"{B}/name", json={"name": "Vani"}, headers=auth("a_owner"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "assistant_not_set_up"
    assert client.put(f"{B}/name", json={"name": None}, headers=auth("a_owner")).json() == {"name": None, "saved": True}, "removing a name that was never saved is a no-op"
    assert repo.row is None


def test_by_words_a_new_name_must_be_the_owners_own_words_and_a_removal_needs_a_removal_word() -> None:
    assert sa.check("assistant_name", {"name": "Vani"}, "call yourself Vani from now on") == {"name": "Vani"}
    assert sa.check("assistant_name", {"name": "Vani"}, "call yourself Asha") == "name", "a name that is not in the words"
    assert sa.check("assistant_name", {"name": None}, "please remove your name Meera") == {"name": None}
    assert sa.check("assistant_name", {"name": None}, "అసిస్టెంట్ పేరు తీసేయి") == {"name": None}
    assert sa.check("assistant_name", {"name": None}, "what is the weather") == "name", "no removal word: asked again, never guessed"
    spec = sa.SETTINGS["assistant_name"]
    assert spec.second_factor is False and spec.put == "ai-assistant.put_name" and spec.get == "ai-assistant.get_name"
    assert sa.summary(spec, {"name": "Meera"}, {"name": None}) == "The assistant's name: Meera -> not set"
    assert sa.body_for(spec, {"name": "Meera"}, {"name": None}) == {"name": None}


def test_undo_can_put_the_read_answer_back() -> None:
    client, _ = saved_world()
    before = client.get(f"{B}/name", headers=auth("a_owner")).json()
    assert client.put(f"{B}/name", json={"name": None}, headers=auth("a_owner")).status_code == 200
    assert client.put(f"{B}/name", json=before, headers=auth("a_owner")).json()["name"] == "Meera"
