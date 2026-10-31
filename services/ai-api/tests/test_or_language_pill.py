"""The language pill (owner, 31 Oct 2026): the language a person chose before speaking is kept per person and pins every typed, dictated and live turn: the reply, the recogniser, the voice and the fillers; "auto" is the old behaviour."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic import ValidationError

from app.turns.models import TurnIn
from app.turns.service import language_of
from app.workspace.business import MePatch
from tests.by_fakes import FakeWorkspace
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dv_browser_voice import FakeSocket, arun, fake_parts, session_of, until

ENGLISH_HEAVY = "Please send the price list for the silk sarees and tell me the delivery time to Dharmavaram"
TELUGU_WITH_ENGLISH = "ఈ silk saree price list ఇంకా delivery time చెప్పండి please"
MSG = "6b9c7e9c-6f7a-4b1c-8f0e-3d2a1b0c9d8e"


def turn(text: str, **kw: Any) -> TurnIn:
    return TurnIn.model_validate({"message_id": MSG, "text": text, **kw})


# ---- the typed turn -------------------------------------------------------------------------------------------------------------------------------


def test_a_chosen_language_decides_the_reply_whatever_the_words_inside_are() -> None:
    assert language_of(turn(ENGLISH_HEAVY, language="te")) == "te", "English words, Telugu chosen: the reply is Telugu"
    assert language_of(turn(TELUGU_WITH_ENGLISH, language="te")) == "te"
    assert language_of(turn("ఈ నెల సేల్స్ ఎంత", language="en")) == "en", "…and English chosen means English"
    for code in ("hi", "kn", "ta", "ml"):
        assert language_of(turn(ENGLISH_HEAVY, language=code)) == code


def test_auto_and_no_choice_are_the_old_detection_unchanged() -> None:
    assert language_of(turn(ENGLISH_HEAVY)) == "en"
    assert language_of(turn(ENGLISH_HEAVY, language="auto")) == "en"
    assert language_of(turn("ఈ నెల సేల్స్ ఎంత", language="auto")) == "te"
    assert language_of(turn("ok", language_hint="te")) == "te", "the screen's language still decides a very short message"
    assert language_of(turn("ok", language="auto", language_hint="hi")) == "hi"


def test_an_unknown_language_is_refused_like_any_unknown_field() -> None:
    with pytest.raises(ValidationError):
        turn("hello", language="xx")
    with pytest.raises(ValidationError):
        turn("hello", mode="pinned")


# ---- the person's preference ------------------------------------------------------------------------------------------------------------------------


def test_the_profile_takes_and_gives_the_preferred_chat_language() -> None:
    assert MePatch.model_validate({"preferred_chat_language": "te"}).preferred_chat_language == "te"
    assert MePatch.model_validate({"preferred_chat_language": "auto"}).preferred_chat_language == "auto"
    with pytest.raises(ValidationError):
        MePatch.model_validate({"preferred_chat_language": "xx"})
    ws = FakeWorkspace()
    saved: list[dict[str, Any]] = []

    def save(token: str, tenant: Any, patch: dict[str, Any]) -> dict[str, Any]:
        saved.append(patch)
        return {"display_name": "A", "language": "en", "avatar_path": None, "google_picture": None, "address_as": None, "preferred_chat_language": patch.get("preferred_chat_language")}

    ws.save_my_profile = save   # type: ignore[attr-defined]
    ws.my_profile = lambda token, tenant: {"display_name": "A", "language": "en", "avatar_path": None, "google_picture": None, "address_as": None, "preferred_chat_language": "te"}   # type: ignore[attr-defined]
    client, _ = make_client(workspace=ws)
    url = f"/v1/tenants/{TENANT_A.id}/me/profile"
    assert client.get(url, headers=auth("a_sales")).json()["preferred_chat_language"] == "te"
    r = client.patch(url, json={"preferred_chat_language": "kn"}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["preferred_chat_language"] == "kn" and saved == [{"preferred_chat_language": "kn"}]
    assert client.patch(url, json={"preferred_chat_language": "xx"}, headers=auth("a_sales")).status_code == 422


# ---- live ----------------------------------------------------------------------------------------------------------------------------------------


def pinned_parts(pin: str | None) -> Any:
    box: dict[str, str | None] = {"lang": pin}
    parts = fake_parts()
    parts.pinned_language = lambda: box["lang"]
    parts.set_pin = lambda lang: box.__setitem__("lang", lang)
    parts.box = box   # type: ignore[attr-defined]
    return parts


@arun
async def test_a_pinned_session_never_follows_the_caller_into_another_language() -> None:
    parts = pinned_parts("te")
    session = session_of(FakeSocket(), parts)
    session.language = "te"
    await session._follow_language("Please send the price list for the silk sarees and tell me the delivery time")   # noqa: SLF001
    assert session.language == "te"
    auto = session_of(FakeSocket(), pinned_parts(None))
    auto.language = "te"
    await auto._follow_language("Please send the price list for the silk sarees and tell me the delivery time")   # noqa: SLF001
    assert auto.language == "en", "auto: the old behaviour, the session follows the caller"


@arun
async def test_the_pill_pins_a_language_mid_session_and_auto_lets_go() -> None:
    sock = FakeSocket()
    parts = pinned_parts(None)
    asked: list[str] = []
    original = parts.stt_for

    def watching(language: str) -> Any:
        asked.append(f"{language}/{parts.box['lang']}")
        return original(language)

    parts.stt_for = watching
    session = session_of(sock, parts)
    run = asyncio.ensure_future(session.run())
    await until(lambda: "ready" in sock.types())
    assert next(m for m in sock.json if m["type"] == "ready")["pinned"] is False
    sock.inbox.put_nowait(("text", {"type": "set_language", "language": "te"}))
    await until(lambda: any(m.get("type") == "language" and m.get("pinned") is True for m in sock.json))
    assert parts.box["lang"] == "te" and asked[-1] == "te/te", "the recogniser was opened again, pinned"
    sock.inbox.put_nowait(("text", {"type": "set_language", "language": "auto"}))
    await until(lambda: any(m.get("type") == "language" and m.get("pinned") is False for m in sock.json))
    assert parts.box["lang"] is None and asked[-1].endswith("/None")
    sock.inbox.put_nowait(("text", {"type": "set_language", "language": "xx"}))
    sock.inbox.put_nowait(("close", None))
    await run
    assert parts.box["lang"] is None, "an unknown language changes nothing"


@arun
async def test_a_session_started_with_an_stt_language_is_pinned() -> None:
    sock = FakeSocket()
    session = session_of(sock, pinned_parts("te"))
    run = asyncio.ensure_future(session.run())
    await until(lambda: "ready" in sock.types())
    assert next(m for m in sock.json if m["type"] == "ready")["pinned"] is True
    sock.inbox.put_nowait(("close", None))
    await run
