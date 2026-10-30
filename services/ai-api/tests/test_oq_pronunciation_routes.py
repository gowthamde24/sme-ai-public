"""The pronunciation words API (contract: contract-pronunciation.md): list with suggestions, upsert by word, the chat's "Mispronounced?" POST, delete by POST, the preview, and who may do what. A fake repository stands in."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant/pronunciation"


class FakeRepo:
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []

    def pronunciation_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return sorted(self.rows.values(), key=lambda r: r["word"].lower())

    def pronunciation_set(self, token: str, tenant_id: uuid.UUID, word: str, sounds_like: str, language: str | None, message_id: uuid.UUID | None) -> dict[str, Any]:
        self.calls.append(("set", (word, sounds_like, language, message_id)))
        row = self.rows.get(word.lower()) or {"id": str(uuid.uuid4())}
        self.rows[word.lower()] = {**row, "word": word, "sounds_like": sounds_like, "language": language, "source": "owner"}
        return self.rows[word.lower()]

    def pronunciation_delete(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        gone = [k for k, v in self.rows.items() if v["id"] == str(item_id)]
        for k in gone:
            del self.rows[k]
        return bool(gone)

    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"name": "Tenant A", "town": "Dharmavaram"}


def world() -> tuple[Any, FakeRepo]:
    repo = FakeRepo()
    client, _ = make_client(workspace=repo)
    return client, repo


def test_any_member_lists_and_gets_suggestions_for_the_business_and_the_town() -> None:
    client, repo = world()
    repo.pronunciation_set("t", TENANT_A.id, "Neelambari", "Neel-um-buh-ree", "en", None)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(BASE, headers=auth(user))
        assert r.status_code == 200, user
    body = r.json()
    assert [i["word"] for i in body["items"]] == ["Neelambari"] and body["items"][0]["source"] == "owner"
    reasons = {s["word"]: (s["reason"], s["sounds_like"]) for s in body["suggestions"]}
    assert reasons["Tenant A"][0] == "business_name" and reasons["Dharmavaram"] == ("city", "Dhar-muh-vuh-rum"), "the lexicon's respelling is offered for a town it knows"
    assert body["shared_count"] >= 200
    assert client.get(BASE, headers=auth("b_owner")).status_code == 404 and client.get(BASE).status_code == 401


def test_a_word_that_is_already_saved_is_not_suggested_again() -> None:
    client, repo = world()
    repo.pronunciation_set("t", TENANT_A.id, "dharmavaram", "Dharma-varam", None, None)
    words = [s["word"] for s in client.get(BASE, headers=auth("a_owner")).json()["suggestions"]]
    assert "Dharmavaram" not in words


def test_owner_and_admin_save_a_word_by_put_or_post_and_it_is_an_upsert() -> None:
    client, repo = world()
    r = client.put(BASE, json={"word": "Neelambari", "sounds_like": "Neel-um-buh-ree", "language": "en"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["word"] == "Neelambari" and r.json()["source"] == "owner"
    first = r.json()["id"]
    message = uuid.uuid4()
    r = client.post(BASE, json={"word": "neelambari", "sounds_like": "Nee-lum-buh-ree", "language": None, "message_id": str(message)}, headers=auth("a_admin"))
    assert r.status_code == 200 and r.json()["id"] == first and r.json()["language"] is None, "the same word (any case) is one row"
    assert repo.calls[-1] == ("set", ("neelambari", "Nee-lum-buh-ree", None, message))
    for user in ("a_sales", "a_viewer"):
        assert client.put(BASE, json={"word": "x", "sounds_like": "y"}, headers=auth(user)).status_code == 403, user


def test_bad_input_is_a_422() -> None:
    client, _ = world()
    for body in ({"word": "", "sounds_like": "y"}, {"word": "w" * 61, "sounds_like": "y"}, {"word": "w", "sounds_like": "y" * 81}, {"word": "w", "sounds_like": "y", "language": "xx"}, {"word": "w", "sounds_like": "y", "other": 1}, {"sounds_like": "y"}):
        assert client.put(BASE, json=body, headers=auth("a_owner")).status_code == 422, body


def test_delete_is_a_post_and_returns_204_for_owner_and_admin_only() -> None:
    client, repo = world()
    item = client.put(BASE, json={"word": "Neelambari", "sounds_like": "Neel-um-buh-ree"}, headers=auth("a_owner")).json()
    assert client.post(f"{BASE}/{item['id']}/delete", headers=auth("a_sales")).status_code == 403
    r = client.post(f"{BASE}/{item['id']}/delete", headers=auth("a_admin"))
    assert r.status_code == 204 and not repo.rows
    assert client.delete(f"{BASE}/{item['id']}", headers=auth("a_owner")).status_code in (404, 405)


def test_the_preview_needs_the_voice_and_is_for_owner_and_admin() -> None:
    client, _ = world()
    r = client.post(f"{BASE}/preview", json={"word": "Neelambari", "sounds_like": "Neel-um-buh-ree", "language": "en"}, headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_sample", "the voice is switched off in this test world"
    assert client.post(f"{BASE}/preview", json={"word": "w", "sounds_like": "y", "language": "en"}, headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/preview", json={"word": "w", "sounds_like": "y", "language": "xx"}, headers=auth("a_owner")).status_code == 422
