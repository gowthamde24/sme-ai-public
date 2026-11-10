"""The live take-over safety switch (job 1, 10 Nov 2026). The lawyer's answer that an owner may listen in on or take over a live call was VERBAL on 10 Nov 2026 and is not confirmed in writing; the safeguards stay on
whatever the switch says: it is OFF by default, only the Owner turns it on, every change and every session event is audited (who, when, old and new), nothing is recorded, and no word that was said is ever in the trail.

Proven: the setting (default off, Owner-only change, readable by the people who see calls); `can_take_over` and the take-over socket honour it; the audit entries of start, whisper, hang_up and end carry numbers only; a
whisper is audited BEFORE it is done (no entry, no whisper) and a hang-up is never held up by the trail; the announcement to the caller is an option behind a flag that is OFF; and NO AUDIO IS STORED while a person has the
call: the telephony code has no path that writes a file or uploads, and a whole take-over leaves nothing behind."""

# ruff: noqa: E501

from __future__ import annotations

import ast
import asyncio
import os
import uuid
from pathlib import Path
from typing import Any

from app.telephony import persona
from app.telephony.line import PhoneLine
from app.telephony.live import LiveCalls
from app.telephony.pcm import tone
from app.telephony.service import CallsService
from app.telephony.simulator import QueueWire, SimulatedExotel
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dv_browser_voice import arun
from tests.test_ph_calls_api import LIVE_ID, NOW, FakeCallsRepo

URL = f"/v1/tenants/{TENANT_A.id}/calls"
SETTING = f"{URL}/take-over-setting"
TOKEN = auth("a_owner")["Authorization"].split(" ", 1)[1]


def client(repo: FakeCallsRepo, live: LiveCalls | None = None, *, announce: bool = False) -> Any:
    c, _ = make_client(calls=CallsService(repo, clock=lambda: NOW, announce_takeover=announce), live_calls=live or LiveCalls())
    return c


class Line:
    """A live call's line, as far as the routes see it."""

    def __init__(self) -> None:
        self.taken_over, self._closed = False, False
        self.whispers: list[str] = []
        self.transcript: list[dict[str, Any]] = []
        self.heard: list[bytes] = []
        self.order: list[str] = []
        self.hung_up: list[str] = []
        self.q: asyncio.Queue[bytes] = asyncio.Queue()

    def take_over(self) -> Any:
        self.taken_over = True
        self.order.append("take_over")
        self.q.put_nowait(b"\x01\x00" * 160)
        return self.q

    def hand_back(self) -> None:
        self.taken_over = False

    async def announce(self) -> bool:
        self.order.append("announce")
        return True

    async def send_owner_audio(self, pcm: bytes) -> None:
        self.heard.append(pcm)

    def closed(self) -> bool:
        return self._closed

    async def hang_up(self, reason: str) -> None:
        self.hung_up.append(reason)


def live_with(line: Line) -> LiveCalls:
    live = LiveCalls()
    live.add(TENANT_A.id, LIVE_ID, line)  # type: ignore[arg-type]
    return live


# ---------------------------------------------------------------------------------------------------------------------------------- the setting
def test_take_over_is_off_by_default_only_the_owner_turns_it_on_and_the_people_who_see_calls_read_it() -> None:
    repo = FakeCallsRepo()
    c = client(repo)
    got = c.get(SETTING, headers=auth("a_owner"))
    assert got.status_code == 200 and got.json() == {"enabled": False, "updated_at": None, "announces": False}
    assert got.headers["cache-control"] == "no-store"
    for role in ("a_admin", "a_sales"):
        assert c.get(SETTING, headers=auth(role)).status_code == 200, role
    assert c.get(SETTING, headers=auth("a_viewer")).status_code == 403
    for role in ("a_admin", "a_sales", "a_viewer"):
        assert c.put(SETTING, json={"enabled": True}, headers=auth(role)).status_code == 403, role
    assert repo.set_by == [], "nobody but the Owner changed it"
    on = c.put(SETTING, json={"enabled": True}, headers=auth("a_owner"))
    assert on.status_code == 200 and on.json()["enabled"] is True and repo.set_by == [True]
    assert c.get(SETTING, headers=auth("a_admin")).json()["enabled"] is True
    assert c.put(SETTING, json={"enabled": False}, headers=auth("a_owner")).json()["enabled"] is False


def test_the_body_is_one_boolean_and_nothing_else() -> None:
    c = client(FakeCallsRepo())
    for body in ({}, {"enabled": "yes"}, {"enabled": 1}, {"enabled": "true"}, {"enabled": None}, {"enabled": True, "announce": True}, {"on": True}):
        r = c.put(SETTING, json=body, headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", body


def test_the_setting_says_whether_the_deployment_announces_to_the_caller() -> None:
    assert client(FakeCallsRepo(), announce=True).get(SETTING, headers=auth("a_owner")).json()["announces"] is True
    assert client(FakeCallsRepo()).get(SETTING, headers=auth("a_owner")).json()["announces"] is False


def test_can_take_over_follows_the_switch_and_a_setting_that_cannot_be_read_means_no() -> None:
    line = Line()
    repo = FakeCallsRepo()
    c = client(repo, live_with(line))
    assert c.get(f"{URL}/{LIVE_ID}", headers=auth("a_owner")).json()["can_take_over"] is False, "live, answered, here, an Owner: and still no while the business has it off"
    repo.takeover = True
    assert c.get(f"{URL}/{LIVE_ID}", headers=auth("a_owner")).json()["can_take_over"] is True
    repo.takeover = False
    assert {i["id"]: i["can_take_over"] for i in c.get(f"{URL}?state=live", headers=auth("a_owner")).json()["items"]}[str(LIVE_ID)] is False

    class Unreadable(FakeCallsRepo):
        def takeover_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            raise RuntimeError("database down")

    broken = Unreadable()
    assert client(broken, live_with(Line())).get(f"{URL}/{LIVE_ID}", headers=auth("a_owner")).json()["can_take_over"] is False, "fails closed"


# ---------------------------------------------------------------------------------------------------------------------------------- the socket and its audit trail
def run_socket(c: Any, line: Line) -> list[Any]:
    url = f"{URL}/{LIVE_ID}/take-over"
    got: list[Any] = []
    with c.websocket_connect(url) as ws:
        ws.send_json({"type": "start", "access_token": TOKEN})
        first = ws.receive_json()
        got.append(first)
        if first.get("type") == "ready":
            got.append(ws.receive_bytes())
            ws.send_bytes(b"\x02\x00" * 320)
            ws.send_json({"type": "hand_back"})
    return got


def test_the_socket_refuses_while_the_business_has_take_over_off_and_audits_nothing() -> None:
    line, repo = Line(), FakeCallsRepo()
    got = run_socket(client(repo, live_with(line)), line)
    assert got == [{"type": "error", "code": "takeover_off"}] and not line.taken_over and line.order == [] and repo.events == []


def test_a_take_over_is_audited_at_its_start_and_its_end_with_numbers_only() -> None:
    line, repo = Line(), FakeCallsRepo()
    repo.takeover = True
    got = run_socket(client(repo, live_with(line)), line)
    assert got[0]["type"] == "ready" and line.heard == [b"\x02\x00" * 320] and not line.taken_over, "the person talked, then handed back"
    assert [e for e, _ in repo.events] == ["start", "end"]
    start, end = repo.events[0][1], repo.events[1][1]
    assert start == {} and list(end) == ["duration_s"] and isinstance(end["duration_s"], int) and 0 <= end["duration_s"] < 30


def test_no_audit_entry_for_the_start_means_no_take_over() -> None:
    line, repo = Line(), FakeCallsRepo()
    repo.takeover, repo.events_fail = True, True
    got = run_socket(client(repo, live_with(line)), line)
    assert got == [{"type": "error", "code": "unavailable"}] and not line.taken_over and line.order == []


def test_the_announcement_is_spoken_before_the_person_only_when_the_flag_is_on() -> None:
    off, on = Line(), Line()
    repo = FakeCallsRepo()
    repo.takeover = True
    run_socket(client(repo, live_with(off)), off)
    run_socket(client(repo, live_with(on), announce=True), on)
    assert off.order == ["take_over"], "default: nothing is said to the caller"
    assert on.order == ["take_over", "announce"], "flag on: the fixed line is spoken as the person takes over"


# ---------------------------------------------------------------------------------------------------------------------------------- whisper and hang-up
def test_a_whisper_is_audited_by_its_length_before_it_is_done_and_its_words_never_reach_the_trail() -> None:
    line, repo = Line(), FakeCallsRepo()
    c = client(repo, live_with(line))
    note = "offer the Saturday visit"
    r = c.post(f"{URL}/{LIVE_ID}/whisper", json={"text": note}, headers=auth("a_owner"))
    assert r.status_code == 202 and line.whispers == [note]
    assert repo.events == [("whisper", {"text_chars": len(note)})]
    assert note not in repr(repo.events)


def test_no_audit_entry_no_whisper() -> None:
    line, repo = Line(), FakeCallsRepo()
    repo.events_fail = True
    r = client(repo, live_with(line)).post(f"{URL}/{LIVE_ID}/whisper", json={"text": "offer the Saturday visit"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "calls_unavailable" and line.whispers == []


def test_a_call_that_is_not_here_is_a_409_and_audits_nothing() -> None:
    repo = FakeCallsRepo()
    c = client(repo)
    assert c.post(f"{URL}/{LIVE_ID}/whisper", json={"text": "hello"}, headers=auth("a_owner")).status_code == 409
    assert c.post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_owner")).status_code == 409
    assert repo.events == []


def test_a_hang_up_is_audited_after_the_fact_and_is_never_held_up_by_the_trail() -> None:
    line, repo = Line(), FakeCallsRepo()
    assert client(repo, live_with(line)).post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_owner")).status_code == 202
    assert line.hung_up == ["stopped"] and repo.events == [("hang_up", {})]
    broken_line, broken = Line(), FakeCallsRepo()
    broken.events_fail = True
    assert client(broken, live_with(broken_line)).post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_owner")).status_code == 202
    assert broken_line.hung_up == ["stopped"], "the call still ended"


def test_only_numbers_ever_go_to_the_audit_trail() -> None:
    line, repo = Line(), FakeCallsRepo()
    repo.takeover = True
    c = client(repo, live_with(line))
    run_socket(c, line)
    c.post(f"{URL}/{LIVE_ID}/whisper", json={"text": "offer the Saturday visit"}, headers=auth("a_owner"))
    c.post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_owner"))
    for event, detail in repo.events:
        assert event in {"start", "whisper", "hang_up", "end"} and set(detail) <= {"duration_s", "text_chars"} and all(type(v) is int for v in detail.values()), (event, detail)


# ---------------------------------------------------------------------------------------------------------------------------------- the announcement hook
@arun
async def test_the_line_speaks_the_announcement_through_the_call_sessions_voice_and_never_fails_the_person() -> None:
    ours, theirs = QueueWire.pair()
    line = PhoneLine(ours)
    assert await line.announce() is False, "no speaker given: nothing is said"
    spoken: list[str] = []

    async def speak() -> None:
        spoken.append("notice")

    line.notice_speaker = speak
    assert await line.announce() is True and spoken == ["notice"]

    async def broken() -> None:
        raise RuntimeError("voice down")

    line.notice_speaker = broken
    assert await line.announce() is False, "a failed announcement never blocks the person"
    await theirs.receive_text() if False else None


def test_the_announcement_is_a_short_fixed_english_line_and_an_unknown_language_falls_back_to_it() -> None:
    assert persona.TAKE_OVER_NOTICE["en"] == "A team member is now joining this call."
    assert persona.TAKE_OVER_NOTICE.get("te", persona.TAKE_OVER_NOTICE["en"]) == persona.TAKE_OVER_NOTICE["en"], "no other language until a native reader has approved it"


# ---------------------------------------------------------------------------------------------------------------------------------- nothing is recorded
APP = Path(__file__).resolve().parents[1] / "app"
FORBIDDEN_CALLS = {"open", "write_bytes", "write_text", "upload", "put_object", "mkstemp", "NamedTemporaryFile", "TemporaryFile", "dump", "dumps_to_file"}
ALLOWED = {"opening_store.py"}   # our OWN voice's greeting audio (never a caller's or a person's sound), kept for the next call (docs/runbooks/phone-inbound-sandbox.md)


def test_the_telephony_code_has_no_path_that_writes_a_file_or_uploads_audio() -> None:
    """A tripwire, not a proof: a new write path in app/telephony must be argued for here."""
    bad: list[str] = []
    for path in sorted((APP / "telephony").glob("*.py")):
        if path.name in ALLOWED:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
                if name in FORBIDDEN_CALLS and not (name == "open" and isinstance(node.func, ast.Attribute)):
                    bad.append(f"{path.name}:{node.lineno} {name}")
    assert bad == [], bad


def test_a_call_is_never_recorded_whatever_the_row_says() -> None:
    from app.telephony.service import shape

    row = {"id": str(uuid.uuid4()), "direction": "inbound", "state": "in_progress", "created_at": NOW.isoformat(), "answered_at": NOW.isoformat(), "recorded": True, "provider": "plivo"}
    assert shape(row, NOW)["recorded"] is False


@arun
async def test_a_whole_take_over_stores_no_audio_anywhere() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as folder:
        here = os.getcwd()
        os.chdir(folder)
        try:
            ours, theirs = QueueWire.pair()
            sim = SimulatedExotel(theirs, rate=16000, pace=0)
            line = PhoneLine(ours)
            await sim.connect()
            assert await line.open(2.0) is not None
            caller = line.take_over()
            await sim.speak_for(400)
            await asyncio.sleep(0.05)
            assert not caller.empty(), "the caller's sound reached the person"
            await line.send_owner_audio(tone(300.0, 600, 16000))
            await asyncio.sleep(0.05)
            line.hand_back()
            assert line._owner_q is None and not line._owner_pending, "nothing of the person's microphone is kept"
            assert os.listdir(folder) == [], "no file was written"
            assert len(line._sent) <= int(line.rate * 1.0) * 2 + line.chunk, "only the last second of OUR OWN voice is kept in memory, to fade it"
            assert not hasattr(line, "recording") and not hasattr(line, "audio_log")
            await sim.close()
        finally:
            os.chdir(here)
