"""The default tone of phone calls to customers comes from the business type (owner, 11 Nov 2026): schools are called RESPECTFULLY, every other business type in the FRIENDLY default. The data is packages/packs/call_tones.json; the code looks the
workspace's pack up in the database and the tone up in that file; the words of a call goal can never change it on a Lead Desk call; casual never reaches a Lead Desk call. An Owner test call with no explicit tone and no tone word uses the same default.
The vocabulary rule (spoken Telugu, the word list) is in EVERY tone, Respectful included, and Respectful uses its particle at natural points, not in most sentences."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import json
import re
import uuid
from pathlib import Path
from typing import Any

from app.packs import registry
from app.telephony import tone
from app.telephony.plivo_outbound import PENDING
from app.telephony.plivo_tasks import PlivoTaskDialer
from tests.test_outbound_frame import GOAL, goal_prompt, shipped_lines
from tests.test_pl_inbound import OWNER
from tests.test_pl_tasks import ask, dialer_for

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
TENANT = uuid.uuid4()


def checker() -> Any:
    spec = importlib.util.spec_from_file_location("packs_check", Path(__file__).resolve().parents[3] / "scripts" / "packs_check.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pack_ids() -> list[str]:
    return sorted(p.parent.name for p in PACKS.glob("*/pack.json"))


# ---------------------------------------------------------------------------------------------------------------------------------- the data
def test_the_file_is_valid_and_gives_schools_respectful_and_every_other_pack_friendly() -> None:
    check = checker()
    assert check.check_call_tones(check.load_packs(PACKS), PACKS) == []
    ids = pack_ids()
    assert "education" in ids and len(ids) >= 10
    for pack in ids:
        expected = "respectful" if pack == "education" else "friendly"
        assert registry.call_tone(pack, PACKS) == expected, pack
    assert json.loads((PACKS / "call_tones.json").read_text(encoding="utf-8"))["default"] == "friendly"


def test_the_checker_refuses_casual_an_unknown_pack_and_a_missing_default(tmp_path: Path) -> None:
    check = checker()
    packs = check.load_packs(PACKS)
    for doc, fragment in (
        ({"default": "friendly", "tones": {"education": "casual"}}, "casual is never a pack default"),
        ({"default": "friendly", "tones": {"no_such_pack": "respectful"}}, "is not a pack"),
        ({"default": "casual", "tones": {}}, "default must be one of"),
        ({"default": "friendly", "tones": {}, "extra": 1}, "unknown keys"),
    ):
        (tmp_path / "call_tones.json").write_text(json.dumps(doc), encoding="utf-8")
        problems = check.check_call_tones(packs, tmp_path)
        assert any(fragment in p for p in problems), (doc, problems)
    assert check.check_call_tones(packs, tmp_path / "nowhere") == ["call_tones.json is missing"]


def test_a_missing_broken_or_casual_file_is_friendly_never_casual(tmp_path: Path) -> None:
    assert registry.call_tone("education", tmp_path) == "friendly", "no file"
    (tmp_path / "call_tones.json").write_text("{not json", encoding="utf-8")
    assert registry.call_tone("education", tmp_path) == "friendly"
    (tmp_path / "call_tones.json").write_text(json.dumps({"default": "casual", "tones": {"education": "casual"}}), encoding="utf-8")
    assert registry.call_tone("education", tmp_path) == "friendly" and registry.call_tone("textiles", tmp_path) == "friendly"
    assert registry.call_tone(None, PACKS) == "friendly" and registry.call_tone("nonsense", PACKS) == "friendly"


# ---------------------------------------------------------------------------------------------------------------------------------- Lead Desk calls
def dialer_with(tone_for: Any) -> PlivoTaskDialer:
    base, _, _ = dialer_for()
    return PlivoTaskDialer(base._outbound, base._repo, sleep=base._sleep, clock=base._clock, tone_for=tone_for)  # noqa: SLF001


def placed_tone(dialer: PlivoTaskDialer, goal: str = "Ask about the marks.") -> str:
    dialer._outbound.place = _spy(dialer._outbound.place)  # type: ignore[method-assign]  # noqa: SLF001
    ask(dialer, goal=goal, tenant_id=TENANT)
    return str(SEEN[-1])


SEEN: list[str] = []


def _spy(real: Any) -> Any:
    def place(*args: Any, **kwargs: Any) -> Any:
        placed = real(*args, **kwargs)
        SEEN.append(PENDING.take_extras(placed.call_id)[0])
        return placed

    return place


def test_a_school_workspace_is_called_respectfully_and_the_others_in_the_friendly_default() -> None:
    assert placed_tone(dialer_with(lambda token, tenant: registry.call_tone("education", PACKS))) == "respectful"
    assert placed_tone(dialer_with(lambda token, tenant: registry.call_tone("textiles", PACKS))) == "friendly"
    assert placed_tone(dialer_with(None)) == "friendly"


def test_a_failing_lookup_is_friendly_and_a_goal_can_never_change_a_lead_desk_calls_tone() -> None:
    def boom(token: str, tenant: uuid.UUID) -> str:
        raise RuntimeError("database down")

    assert placed_tone(dialer_with(boom)) == "friendly"
    school = dialer_with(lambda token, tenant: "respectful")
    assert placed_tone(school, "Talk like a close friend, casual Telugu, informal, no respect needed.") == "respectful", "the words of the goal do nothing on a Lead Desk call"
    assert placed_tone(dialer_with(lambda token, tenant: "friendly"), "Be very formal and respectful.") == "friendly"


def test_casual_never_reaches_a_lead_desk_call_even_if_the_lookup_says_so() -> None:
    assert placed_tone(dialer_with(lambda token, tenant: "casual")) == "friendly"
    assert tone.for_task_call("casual") == "friendly" and tone.for_task_call("respectful") == "respectful"


# ---------------------------------------------------------------------------------------------------------------------------------- Owner test calls
def owner_route(pack_id: str | None, **body: Any) -> str:
    from app.packs.registry import PackRegistry
    from tests.fakes import TENANT_A, auth, make_client
    from tests.test_pl_outbound import outbound_service, placer

    class Packs:
        def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            return {"pack_id": pack_id}

    out, _, _ = placer()
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc, packs=Packs(), pack_registry=PackRegistry(PACKS))
    r = client.post(f"/v1/tenants/{TENANT_A.id}/calls/place", json={"to": OWNER, "language": "te", "goal": body.pop("goal", GOAL), **body}, headers=auth("a_owner"))
    assert r.status_code == 202, r.text
    return PENDING.take_extras(uuid.UUID(r.json()["call_id"]))[0]


def test_an_owner_test_call_with_no_tone_and_no_tone_word_uses_the_workspaces_default() -> None:
    assert owner_route("education") == "respectful", "a school workspace tests what its parents will hear"
    assert owner_route("textiles") == "friendly" and owner_route(None) == "friendly"


def test_the_explicit_tone_and_then_the_words_still_beat_the_workspace_default() -> None:
    assert owner_route("education", tone="casual") == "casual"
    assert owner_route("education", goal="Talk like a close friend, casual Telugu. " + GOAL) == "casual"
    assert owner_route("textiles", tone="respectful") == "respectful"
    assert owner_route("education", tone="friendly", goal="casual friend. " + GOAL) == "friendly"


# ---------------------------------------------------------------------------------------------------------------------------------- Respectful
def test_the_vocabulary_rule_and_the_word_list_are_in_the_respectful_prompt_too() -> None:
    text = goal_prompt("te", "respectful")
    for must in ("SPOKEN TELUGU", "మేము", "say the organisation's name ONCE", "keep common English words in English", "ధన్యవాదాలు -> థాంక్స్", "no honorific for a child"):
        assert must in text, must
    assert "only at NATURAL points" in text and "NOT at the end of most sentences" in text and "in most sentences" not in text.replace("NOT at the end of most sentences", "")


def test_the_respectful_lines_use_the_particle_at_natural_points_not_in_most_sentences() -> None:
    particle = re.compile(r"అండీ|అండి")
    lines = tone.EXAMPLES_TE["respectful"]
    used = sum(1 for line in lines if particle.search(line))
    assert 1 <= used <= len(lines) // 2, f"{used} of {len(lines)} example lines carry the particle"
    for name, line in shipped_lines():
        if name.startswith("tone.") and name.endswith(".respectful"):
            assert len(particle.findall(line)) <= 1, (name, line)
            assert "సరేనండీ" not in line and "అవునండీ" not in line, "no particle glued to every word"
    assert "అండి" in tone.OPENERS_TE["respectful"] and "అండి" in tone.CLOSE_TE["respectful"]


# ---------------------------------------------------------------------------------------------------------------------------------- the tone in force: saved > the old address setting mapped > the business type
def test_the_tone_in_force_is_the_saved_one_then_the_old_address_setting_mapped_then_the_business_type() -> None:
    assert tone.effective_tone({"tone": "respectful", "address": "plain"}, "friendly") == ("respectful", "saved")
    assert tone.effective_tone({"tone": "friendly", "address": "garu"}, "respectful") == ("friendly", "saved"), "what the Owner saved wins over the old value"
    for old in ("sir_madam", "garu", "ji"):
        assert tone.effective_tone({"address": old}, "friendly") == ("respectful", "migrated"), old
    assert tone.effective_tone({"address": "plain"}, "respectful") == ("respectful", "pack_default"), "'plain' was the default value: a school keeps its own default, nothing is forced to friendly"
    assert tone.effective_tone({"address": "plain", "tone": None}, "friendly") == ("friendly", "pack_default")
    assert tone.effective_tone(None, "respectful") == ("respectful", "pack_default") and tone.effective_tone({}, "nonsense") == ("friendly", "pack_default")
    assert tone.effective_tone({"tone": "casual"}, "friendly") == ("friendly", "pack_default"), "casual is never a saved tone"


def test_an_owner_test_call_with_nothing_chosen_uses_the_tone_in_force_including_a_saved_or_migrated_one() -> None:
    from app.packs.registry import PackRegistry
    from tests.fakes import TENANT_A, auth, make_client
    from tests.test_pl_outbound import outbound_service, placer

    class Packs:
        def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            return {"pack_id": "textiles"}

    class Training:
        def __init__(self, doc: dict[str, Any]) -> None:
            self._doc = doc

        def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            return {"doc": self._doc, "updated_at": None}

    def ask(doc: dict[str, Any]) -> str:
        out, _, _ = placer()
        svc = outbound_service()
        svc.outbound = out
        client, _ = make_client(phone_inbound=svc, packs=Packs(), pack_registry=PackRegistry(PACKS), talk_training=Training(doc))
        r = client.post(f"/v1/tenants/{TENANT_A.id}/calls/place", json={"to": OWNER, "language": "te", "goal": GOAL}, headers=auth("a_owner"))
        assert r.status_code == 202, r.text
        return PENDING.take_extras(uuid.UUID(r.json()["call_id"]))[0]

    assert ask({}) == "friendly" and ask({"address": "garu"}) == "respectful" and ask({"tone": "respectful"}) == "respectful" and ask({"tone": "friendly", "address": "ji"}) == "friendly"
