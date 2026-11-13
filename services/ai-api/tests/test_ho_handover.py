"""Hand over to a person (owner, 5 Nov 2026; job calls-like-a-pro part 4): a caller who asks for a person (in en, te, hi, kn, ta, ml) hears the fixed "someone from the team will call you back", the
call ends as a hand-over, and Today shows it until a member marks it handled (POST /calls/{id}/handled). A3: every simulated "talk to a person" goes to the callback path."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.crm.repository import NotFoundError
from app.telephony import persona
from app.telephony.phone_llm import PhoneLlm
from app.telephony.service import CallsService
from app.telephony.triggers import person_requested, stop_requested
from app.today.service import needs_item
from tests.fakes import TENANT_A, auth, make_client
from tests.test_ph_calls_api import DONE_ID, NOW, FakeCallsRepo

ASKS = [
    ("en", "Can I talk to a real person please?"), ("en", "Connect me to the owner."), ("en", "I want to speak with someone from your team"), ("en", "Give me the manager"),
    ("en", "put me through to a human"), ("te", "మేనేజర్‌తో మాట్లాడాలి"), ("te", "ఎవరైనా మనిషి ఉన్నారా?"), ("te", "మీ ఓనర్ కి ఇవ్వండి"), ("te", "manishi tho matladali"),
    ("hi", "मालिक से बात कराइए"), ("hi", "किसी इंसान से बात करनी है"), ("hi", "manager se baat karni hai"), ("kn", "ಮ್ಯಾನೇಜರ್ ಜೊತೆ ಮಾತಾಡಬೇಕು"), ("ta", "மேனேஜரிடம் பேச வேண்டும்"), ("ml", "മാനേജരോട് സംസാരിക്കണം"),
]
NOT_ASKS = ["Are you a robot or a real person?", "I am a person who likes silk", "What is the price of this saree?", "The owner told me last week it was in stock", "Please call me back tomorrow", "Who am I speaking to?"]


@pytest.mark.parametrize(("language", "text"), ASKS)
def test_every_way_of_asking_for_a_person_is_heard(language: str, text: str) -> None:
    assert person_requested(text), text


@pytest.mark.parametrize("text", NOT_ASKS)
def test_ordinary_sentences_are_not_a_hand_over(text: str) -> None:
    events: list[str] = []
    llm = PhoneLlm(Model(), "Lakshmi Silks", lambda: "en", on_event=events.append)

    async def reply() -> str:
        return "".join([p async for p in llm.stream("system", [{"role": "user", "content": text}], "m")])

    asyncio.run(reply())
    assert events == [] and not stop_requested(text), "the identity question is answered honestly, not handed over"


class Model:
    def __init__(self) -> None:
        self.asked = 0

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.asked += 1
        yield "The model's own answer."


def test_a3_every_simulated_talk_to_a_person_goes_to_the_callback_path() -> None:
    for language, text in ASKS:
        events: list[str] = []
        model = Model()
        llm = PhoneLlm(model, "Lakshmi Silks", (lambda lang: lambda: lang)(language), on_event=events.append)

        async def reply(phone: PhoneLlm = llm, said: str = text) -> str:
            return "".join([p async for p in phone.stream("system", [{"role": "assistant", "content": "Hello"}, {"role": "user", "content": said}], "m")])

        said = asyncio.run(reply())
        assert events == ["handover"] and model.asked == 0, text
        assert said == persona.HANDOVER_ACK.get(language, persona.HANDOVER_ACK["en"]), "the fixed line, never the model's"


class HandledRepo(FakeCallsRepo):
    def handled(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        if call_id not in self.rows:
            raise NotFoundError("23503")
        return {"call_id": call_id, "handled_at": NOW.isoformat()}


def test_a_member_marks_a_hand_over_call_handled() -> None:
    c, _ = make_client(calls=CallsService(HandledRepo(), clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}/calls"
    got = c.post(f"{url}/{DONE_ID}/handled", headers=auth("a_sales"))
    assert got.status_code == 200 and got.json()["call_id"] == str(DONE_ID), got.text
    assert c.post(f"{url}/{uuid.uuid4()}/handled", headers=auth("a_owner")).status_code == 404
    assert c.post(f"{url}/{DONE_ID}/handled", headers=auth("a_viewer")).status_code == 403


def test_today_says_it_plainly() -> None:
    item = needs_item({"kind": "person_requested", "id": str(uuid.uuid4()), "customer": "A caller", "city": None, "agent": "followup_desk", "ref": "call", "amount_paise": None,
                       "at": NOW.isoformat(), "target": {"type": "phone_call", "id": str(uuid.uuid4())}})
    assert item.kind == "person_requested" and "asked to talk to a person" in item.summary and item.target.type == "phone_call"


# ---- Whisper during a live call (app v4) and the live call reachable by its real id ------------------------------------------------------

def test_a_live_call_is_reachable_by_its_row_id_and_a_whisper_reaches_its_line() -> None:
    from app.telephony.live import LiveCalls

    class Line:
        def __init__(self) -> None:
            self.whispers: list[str] = []

    live, line, temp, real = LiveCalls(), Line(), uuid.uuid4(), uuid.uuid4()
    live.add(TENANT_A.id, temp, line)  # type: ignore[arg-type]
    live.also_known_as(temp, real)
    assert live.whisper(TENANT_A.id, real, "Offer the Saturday visit") and line.whispers == ["Offer the Saturday visit"]
    assert not live.whisper(uuid.uuid4(), real, "x"), "another workspace never reaches it"
    live.remove(temp)
    live.remove(real)
    assert not live.whisper(TENANT_A.id, real, "x") and live.count() == 0


def test_the_ai_follows_a_whisper_from_its_next_reply_even_after_a_language_switch() -> None:
    from app.telephony.call_session import CallVoiceSession

    session: Any = CallVoiceSession.__new__(CallVoiceSession)
    line = type("L", (), {"whispers": ["Offer the Saturday visit"]})()
    session.socket = type("S", (), {"_line": line})()
    session.language = "te"
    session.parts = type("P", (), {"system_for": lambda self, lang: f"BASE-{lang}"})()
    session.conv = type("C", (), {"session": type("X", (), {"system": "BASE-te"})()})()
    session._apply_whispers()
    assert session.conv.session.system.startswith("BASE-te") and "- Offer the Saturday visit" in session.conv.session.system and "caller cannot hear" in session.conv.session.system
    assert line.whispers == [], "taken from the line once"
    session.language = "en"
    session.conv.session.system = "BASE-en"
    session._apply_whispers()
    assert session.conv.session.system.startswith("BASE-en") and "- Offer the Saturday visit" in session.conv.session.system, "kept after a switch"


def test_the_whisper_route() -> None:
    from app.telephony.live import LiveCalls

    live = LiveCalls()
    line = type("L", (), {"whispers": []})()
    live.add(TENANT_A.id, DONE_ID, line)
    c, _ = make_client(calls=CallsService(FakeCallsRepo(), clock=lambda: NOW), live_calls=live)
    url = f"/v1/tenants/{TENANT_A.id}/calls/{DONE_ID}/whisper"
    assert c.post(url, json={"text": "Offer the Saturday visit"}, headers=auth("a_admin")).status_code == 202 and line.whispers == ["Offer the Saturday visit"]
    assert c.post(url, json={"text": "x"}, headers=auth("a_sales")).status_code == 403, "Owner and Admin only"
    assert c.post(url, json={"text": ""}, headers=auth("a_owner")).status_code == 422
    live.remove(DONE_ID)
    assert c.post(url, json={"text": "x"}, headers=auth("a_owner")).json()["error"]["code"] == "call_not_here"


def test_while_a_person_has_the_call_the_ai_neither_answers_nor_hangs_up_for_silence() -> None:
    from app.telephony.call_session import CallVoiceSession

    session: Any = CallVoiceSession.__new__(CallVoiceSession)
    line = type("L", (), {"taken_over": True, "whispers": []})()
    session.socket = type("S", (), {"_line": line})()
    assert session.silence_s == (1e9, 1e9)
    asked: list[str] = []

    async def base(self: Any, text: str, tm: Any) -> None:
        asked.append(text)

    import app.browser_voice.session as S

    saved = S.VoiceSession._answer
    S.VoiceSession._answer = base  # type: ignore[method-assign]
    try:
        asyncio.run(session._answer("hello?", None))
        line.taken_over = False
        asyncio.run(session._answer("hello again", None))
    finally:
        S.VoiceSession._answer = saved  # type: ignore[method-assign]
    assert asked == ["hello again"] and session.silence_s == (4.0, 8.0)


def test_the_take_over_socket_checks_the_sign_in_the_role_and_that_the_call_is_here() -> None:
    from app.telephony.live import LiveCalls

    class Line:
        def __init__(self) -> None:
            self.taken_over, self._closed = False, False
            self.heard: list[bytes] = []
            import asyncio as aio

            self.q: aio.Queue[bytes] = aio.Queue()

        def take_over(self) -> Any:
            self.taken_over = True
            self.q.put_nowait(b"\x01\x00" * 160)
            return self.q

        def hand_back(self) -> None:
            self.taken_over = False

        async def send_owner_audio(self, pcm: bytes) -> None:
            self.heard.append(pcm)

        def closed(self) -> bool:
            return self._closed

    live, line = LiveCalls(), Line()
    live.add(TENANT_A.id, DONE_ID, line)  # type: ignore[arg-type]
    repo = FakeCallsRepo()
    repo.takeover = True   # job 1: the business has switched take-over on (default OFF: tests/test_to_takeover_switch.py)
    c, _ = make_client(calls=CallsService(repo, clock=lambda: NOW), live_calls=live)
    url = f"/v1/tenants/{TENANT_A.id}/calls/{DONE_ID}/take-over"
    token = auth("a_owner")["Authorization"].split(" ", 1)[1]
    with c.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": token})
        assert ws.receive_json()["type"] == "ready" and line.taken_over
        assert ws.receive_bytes() == b"\x01\x00" * 160, "the caller's audio"
        ws.send_bytes(b"\x02\x00" * 320)
        ws.send_json({"type": "hand_back"})
    assert line.heard == [b"\x02\x00" * 320] and not line.taken_over, "the person's audio went to the call, then the call was handed back"
    sales = auth("a_sales")["Authorization"].split(" ", 1)[1]
    with c.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": sales})
        assert ws.receive_json() == {"type": "error", "code": "forbidden"}
    live.remove(DONE_ID)
    with c.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": token})
        assert ws.receive_json() == {"type": "error", "code": "call_not_here"}


# ---- "Correct it" after a call (app v4, migration 20261231330000) -----------------------------------------------------------------------

class CorrectingRepo(FakeCallsRepo):
    def __init__(self) -> None:
        super().__init__()
        self.fixed: dict[uuid.UUID, dict[str, Any]] = {}

    def correct(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, summary: str | None, captured: dict[str, str] | None, note: str | None) -> dict[str, Any]:
        from app.telephony.repository import CorrectionInvalid

        if call_id not in self.rows:
            raise NotFoundError("23503")
        if note and "@" in note:
            raise CorrectionInvalid("23514")
        row = self.fixed.setdefault(call_id, {})
        for key, value in (("summary", summary), ("captured", captured), ("note", note)):
            if value is not None:
                row[key] = value or None
        return {**row, "corrected_at": NOW.isoformat()}


def test_a_member_corrects_a_call_and_the_note_must_not_hold_a_contact() -> None:
    c, _ = make_client(calls=CallsService(CorrectingRepo(), clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}/calls/{DONE_ID}/correction"
    got = c.post(url, json={"summary": "Wants a red Kanchi silk, visiting Saturday", "note": "Kanchi pattu means Kanchipuram silk"}, headers=auth("a_sales"))
    assert got.status_code == 200 and got.json()["summary"] == "Wants a red Kanchi silk, visiting Saturday" and got.json()["note"] == "Kanchi pattu means Kanchipuram silk"
    bad = c.post(url, json={"note": "mail me at ramesh@example.com"}, headers=auth("a_owner"))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "correction_invalid"
    assert c.post(url, json={}, headers=auth("a_owner")).json()["error"]["code"] == "validation_error", "say what to correct"
    assert c.post(url, json={"note": "x"}, headers=auth("a_viewer")).status_code == 403
    assert c.post(f"/v1/tenants/{TENANT_A.id}/calls/{uuid.uuid4()}/correction", json={"note": "Pattu means silk"}, headers=auth("a_owner")).status_code == 404


def test_the_owners_notes_reach_the_next_calls_instructions() -> None:
    prompt = persona.system_prompt(business="Padma Silks", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None,
                                   corrections=["Kanchi pattu means Kanchipuram silk, not cotton", "  "])
    assert "THE OWNER'S CORRECTIONS FROM RECENT CALLS" in prompt and "- Kanchi pattu means Kanchipuram silk, not cotton" in prompt
    assert "THE OWNER'S CORRECTIONS" not in persona.system_prompt(business="Padma Silks", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None)


# ---- "Start demo" (13 Nov 2026): a labelled simulated live call in a demo workspace ----------------------------------------------------------

class DemoRepo(FakeCallsRepo):
    def __init__(self, demo: bool) -> None:
        super().__init__()
        self.demo = demo
        self.live_call: uuid.UUID | None = None

    def demo_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        from app.tenancy.repository import Forbidden

        if not self.demo:
            raise Forbidden("42501")
        started = self.live_call is None
        self.live_call = self.live_call or uuid.uuid4()
        return {"call_id": self.live_call, "started": started}

    def demo_end(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        from app.tenancy.repository import Forbidden

        if not self.demo:
            raise Forbidden("42501")
        ended, self.live_call = (1 if self.live_call else 0), None
        return {"ended": ended}


def test_start_demo_is_for_owner_and_admin_of_a_demo_workspace_only() -> None:
    c, _ = make_client(calls=CallsService(DemoRepo(demo=True), clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}/calls/demo"
    first = c.post(f"{url}/start", headers=auth("a_owner"))
    assert first.status_code == 200 and first.json()["started"] is True, first.text
    again = c.post(f"{url}/start", headers=auth("a_admin"))
    assert again.json()["started"] is False and again.json()["call_id"] == first.json()["call_id"], "one at a time"
    assert c.post(f"{url}/start", headers=auth("a_sales")).status_code == 403 and c.post(f"{url}/start", headers=auth("a_viewer")).status_code == 403
    assert c.post(f"{url}/end", headers=auth("a_owner")).json() == {"ended": 1}
    assert c.post(f"{url}/end", headers=auth("a_owner")).json() == {"ended": 0}


def test_start_demo_in_a_workspace_that_is_not_a_demo_says_not_found() -> None:
    c, _ = make_client(calls=CallsService(DemoRepo(demo=False), clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}/calls/demo"
    assert c.post(f"{url}/start", headers=auth("a_owner")).status_code == 404
    assert c.post(f"{url}/end", headers=auth("a_owner")).status_code == 404
