"""Job DS (owner feedback 26 Oct): the assistant talks the way people talk. The register module and the owner's lines, the speaking-style settings route, the prompts that carry the register block, the spoken-register check of the comparison, the sample lines and the sample script (with a fake voice: no network, no key). The database's rules: supabase/tests/database/126_ds_speaking_style.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from app.agents import compare, register
from app.assistant.draft import build_request as draft_request
from app.assistant.language import reply_matches
from app.speaking.service import SpeakingService
from app.voice import spoken
from app.voice.interface import Speech
from app.voice.samples import LINES
from tests.ds_fakes import FakeSpeakingRepository
from tests.fakes import TENANT_A, auth, make_client

OTHER = ("hi", "kn", "ta", "ml")
LATIN_WORDS = re.compile(r"[A-Za-z]{3,}")


# ============================================================================ the owner's lines and the register
def test_every_language_has_the_nine_numbered_lines_and_the_often_used_ones() -> None:
    for lang in register.LANGUAGES:
        lines = register.examples(lang)
        assert len(lines) >= 13, lang
        assert [label for label, _ in lines[:8]] == ["Opening", "Stock + photos", "Price answer", "\"Call me later\"", "\"Not interested\" close", "School admission", "Delivery", "Reminder"], lang


def test_telugu_and_kannada_are_approved_and_the_rest_are_drafts() -> None:
    assert register.status("te") == "approved" and register.status("kn") == "approved"   # Kannada: a native reviewer, 30 Oct 2026
    assert all(register.status(lang) == "draft" for lang in ("en", "hi", "ta", "ml"))
    te = [text for _, text in register.examples("te")]
    assert te[0] == "నమస్కారం అండీ, నేను లక్ష్మి సారీస్ నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    assert "రెండు వేల ఆరు వందలండీ" in te[2], "a price is said the way people say it"
    block = register.register_block("hi")
    assert "drafts for native review" in block and "drafts for native review" not in register.register_block("te")


@pytest.mark.parametrize("lang", ["te", *OTHER])
def test_the_example_lines_are_spoken_not_written_and_still_pass_the_language_checks(lang: str) -> None:
    for label, text in register.examples(lang):
        assert not register.formal_forms_in(lang, text), (lang, label, register.formal_forms_in(lang, text))
        assert reply_matches(text, lang), (lang, label)   # type: ignore[arg-type]
    assert any(LATIN_WORDS.search(text) for _, text in register.examples(lang)), "English words are kept in English"


def test_the_bookish_lines_of_night_3_are_exactly_what_the_check_catches() -> None:
    assert register.formal_forms_in("te", LINES["te"][0]) == ["మాట్లాడవచ్చా", "అసిస్టెంట్‌ని"]
    for lang in OTHER:
        assert any(register.formal_forms_in(lang, line) for line in LINES[lang]), lang
    assert register.formal_forms_in("en", "please kindly do the needful") == ["kindly", "do the needful"]


def test_the_register_block_has_the_rules_the_language_rules_and_a_bounded_set_of_examples() -> None:
    block = register.register_block("te", "everyday_mixed", "telangana")
    assert block.startswith("HOW TO TALK (register):")
    assert "Keep everyday English nouns in English" in block and "Telugu: spoken forms" in block and "Telangana speech" in block
    assert block.count("  * ") == register.EXAMPLES_PER_BLOCK
    assert len(block) < 3200, "a prompt is paid for by the token"
    pure = register.register_block("te", "everyday_pure")
    assert "own everyday word" in pure and "Keep everyday English nouns" not in pure
    formal = register.register_block("te", "formal")
    assert "  * " not in formal and "written-style" in formal, "the formal style shows no spoken examples"


def test_a_region_of_another_language_falls_back_to_neutral_and_an_unknown_style_to_the_default() -> None:
    assert register.register_block("hi", "everyday_mixed", "coastal") == register.register_block("hi")
    assert register.register_block("te", "no-such-style") == register.register_block("te")
    with pytest.raises(ValueError):
        register.register_block("xx")


def test_the_regions_are_the_ones_the_owner_named() -> None:
    assert register.REGIONS["te"] == ("neutral", "coastal", "telangana", "rayalaseema")
    assert register.REGIONS["ta"] == ("neutral", "chennai", "kongu") and register.REGIONS["kn"] == ("neutral", "bengaluru", "north_karnataka")
    assert register.REGIONS["hi"] == register.REGIONS["ml"] == ("neutral",)
    assert register.STYLES == ("everyday_mixed", "everyday_pure", "formal") and register.DEFAULT_STYLE == "everyday_mixed"


# ============================================================================ the settings route
def world(**kw: Any) -> tuple[Any, FakeSpeakingRepository]:
    repo = FakeSpeakingRepository()
    client, _ = make_client(speaking=SpeakingService(repo), **kw)
    return client, repo


URL = f"/v1/tenants/{TENANT_A.id}/speaking-style"


def test_every_member_reads_the_defaults_with_the_options_and_the_state_of_the_examples() -> None:
    client, repo = world()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        body = client.get(URL, headers=auth(user)).json()
        assert body["languages"]["te"] == {"style": "everyday_mixed", "region": "neutral", "saved": False, "examples": "approved"}, user
        assert body["languages"]["ml"]["examples"] == "draft"
    assert body["options"]["styles"] == ["everyday_mixed", "everyday_pure", "formal"] and body["options"]["regions"]["ta"] == ["neutral", "chennai", "kongu"]
    assert set(body["languages"]) == {"en", "te", "hi", "kn", "ta", "ml"}
    assert client.get(URL).status_code == 401
    assert client.get(f"/v1/tenants/{uuid_other()}/speaking-style", headers=auth("a_owner")).status_code == 404


def uuid_other() -> str:
    from tests.fakes import TENANT_B

    return str(TENANT_B.id)


def test_only_the_owner_with_a_second_factor_sets_it_and_a_language_left_out_is_the_default() -> None:
    client, repo = world()
    doc = {"languages": {"te": {"style": "everyday_pure", "region": "telangana"}, "ta": {"style": "formal"}}}
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.put(URL, json=doc, headers=auth(user)).status_code in (403, 404), user
    assert client.put(URL, json=doc, headers=auth("a_owner", aal="aal1")).status_code == 403, "the second factor is needed"
    assert repo.saved == {}
    answer = client.put(URL, json=doc, headers=auth("a_owner")).json()
    assert answer["languages"]["te"] == {"style": "everyday_pure", "region": "telangana", "saved": True, "examples": "approved"}
    assert answer["languages"]["ta"]["style"] == "formal" and answer["languages"]["hi"]["saved"] is False
    assert client.get(URL, headers=auth("a_viewer")).json()["languages"]["te"]["region"] == "telangana"


@pytest.mark.parametrize(
    "doc",
    [
        {"languages": {"te": {"style": "bookish"}}},
        {"languages": {"te": {"style": "formal", "region": "chennai"}}},
        {"languages": {"hi": {"style": "formal", "region": "coastal"}}},
        {"languages": {"xx": {"style": "formal"}}},
        {"languages": {"te": {"style": "formal", "colour": "red"}}},
        {"languages": {"te": {"region": "coastal"}}},
        {"extra": 1, "languages": {}},
        {},
    ],
)
def test_a_bad_document_is_a_422(doc: dict[str, Any]) -> None:
    client, repo = world()
    assert client.put(URL, json=doc, headers=auth("a_owner")).status_code == 422
    assert repo.saved == {}


# ============================================================================ the prompts
def test_the_style_for_a_prompt_is_the_default_when_nothing_is_saved_or_the_setting_cannot_be_read() -> None:
    repo = FakeSpeakingRepository()
    service = SpeakingService(repo)
    assert service.style_for("t", TENANT_A.id, "te") == ("everyday_mixed", "neutral")
    repo.saved = {"te": {"style": "formal", "region": "neutral"}}
    assert service.style_for("t", TENANT_A.id, "te") == ("formal", "neutral") and service.style_for("t", TENANT_A.id, "hi") == ("everyday_mixed", "neutral")
    repo.broken = True
    assert service.style_for("t", TENANT_A.id, "te") == ("everyday_mixed", "neutral"), "a setting that cannot be read never stops a message"


def test_the_whatsapp_draft_prompt_carries_the_register_block_only_when_given() -> None:
    block = register.register_block("te")
    with_block = draft_request("d", "te", ["customer first name: Anu"], False, block)
    texts = [b.text for b in with_block.blocks]
    assert block in texts and texts.index(block) < len(texts) - 1, "the register is trusted instruction, before the customer's data"
    assert block not in [b.text for b in draft_request("d", "te", ["x"], False).blocks]


def test_the_comparison_prompt_has_the_register_block_by_default_and_the_old_prompt_stays_available() -> None:
    conv = compare.conversations()[0]
    new = compare.build_request(conv, "call_turn", 900)
    old = compare.build_request(conv, "call_turn", 900, spoken=False)
    assert len(new.blocks) == len(old.blocks) + 1
    assert any(b.text.startswith("HOW TO TALK (register):") for b in new.blocks) and not any(b.text.startswith("HOW TO TALK") for b in old.blocks)


def test_the_comparison_flags_a_written_form_and_passes_a_spoken_line() -> None:
    conv = next(c for c in compare.conversations() if c.lang == "te")
    bookish = compare.check(conv, "call_turn", "అవును, నేను AI అసిస్టెంట్‌ని. మీతో మాట్లాడవచ్చా?")
    spoken_line = compare.check(conv, "call_turn", "అవునండీ, నేను shop వాళ్ళ AI assistant ని. మీకు ఏం కావాలో చెప్పండి.")
    assert "spoken_register" in compare.RULES
    assert bookish["spoken_register"] is False and spoken_line["spoken_register"] is True


# ============================================================================ the samples
def test_the_spoken_samples_are_thirty_lines_under_the_cap_and_each_old_line_has_its_new_partner() -> None:
    clips = spoken.plan_spoken()
    assert len(clips) == 30 and {c.lang for c in clips} == set(spoken.SPOKEN_LANGS)
    assert sum(len(c.text) for c in clips) <= spoken.SPOKEN_CHAR_CAP == 3000
    kept, added = spoken.spoken_within_cap(clips)
    assert kept == clips and added == sum(len(c.text) for c in clips)
    assert [c.n for c in clips[:5]] == [1] * 5, "line 1 of every language is sent first, so a stop at the cap leaves every language covered"
    assert spoken.spoken_within_cap(clips, already_sent=2900)[0] == [] or sum(len(c.text) for c in spoken.spoken_within_cap(clips, 2900)[0]) <= 100


def test_the_cap_counts_what_earlier_runs_spent() -> None:
    clips = spoken.plan_spoken()
    kept, added = spoken.spoken_within_cap(clips, already_sent=2000)
    assert added <= 1000 and len(kept) < len(clips)
    assert spoken.spoken_within_cap(clips, already_sent=3000)[0] == []


def test_the_page_sets_the_bookish_line_beside_the_spoken_one() -> None:
    page = spoken.compare_html(spoken.plan_spoken(), {"chars_total": 2599})
    assert "before (bookish)" in page and "now (spoken)" in page and "2599 of 3000" in page
    assert LINES["te"][0] in page and spoken.plan_spoken()[0].text in page
    assert "../te/ritu-warm-1.wav" in page and "te/ritu-spoken-1.wav" in page
    assert "(a new line)" in page and "<script" not in page


def load_script() -> Any:
    """The opt-in script, loaded by path (it is not part of the package)."""
    import importlib.util
    import sys

    scripts = Path(__file__).resolve().parents[3] / "scripts"
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location("voice_samples_spoken", scripts / "voice_samples_spoken.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeTts:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, float | None]] = []

    def synthesize(self, text: str, lang: str, **kw: Any) -> Speech:
        self.sent.append((text, lang, kw.get("pace")))
        return Speech(audio=b"RIFFfake", content_type="audio/wav")


def test_the_script_renders_with_a_fake_voice_keeps_the_count_and_never_resends(tmp_path: Path) -> None:
    script = load_script()

    fake = FakeTts()
    assert script.render(tmp_path, True) == 0 and not list(tmp_path.glob("*/*.wav"))
    assert script.render(tmp_path, False, make_tts=lambda: fake) == 30
    assert len(fake.sent) == 30 and {pace for _, _, pace in fake.sent} == {1.08}
    usage = json.loads((tmp_path / "usage.json").read_text())
    assert usage["chars_total"] == sum(len(t) for t, _, _ in fake.sent) <= 3000
    assert (tmp_path / "index.html").exists() and (tmp_path / "te" / "ritu-spoken-1.wav").exists()
    again = FakeTts()
    assert script.render(tmp_path, False, make_tts=lambda: again) == 0 and again.sent == [], "nothing is sent twice"


# ============================================================================ the contract and the A/B summary
def test_the_speaking_style_contract_is_committed_and_fresh() -> None:
    from app.speaking import contracts

    root = Path(__file__).resolve().parents[3] / "packages" / "contracts"
    assert (root / "speaking_style.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (root / "speaking_style.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_register_ab_summary_counts_written_forms_and_kept_english_words() -> None:
    convs = [c for c in compare.conversations() if c.lang == "te"][:2]
    old = compare.Result(convs[0].id, "call_turn", "claude", "అవును, నేను AI అసిస్టెంట్‌ని. మీతో మాట్లాడవచ్చా?", None, 1, 1, 1, 1)
    new = compare.Result(convs[0].id, "call_turn", "claude", "అవునండీ, నేను shop వాళ్ళ AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?", None, 1, 1, 1, 1)
    old.rules = compare.check(convs[0], "call_turn", old.reply)
    new.rules = compare.check(convs[0], "call_turn", new.reply)
    row: Any = compare.register_ab([old], [new])["te"]
    assert row["before"]["written_forms"] == 1 and row["after"]["written_forms"] == 0
    assert row["after"]["latin_words"] >= 2 > row["before"]["latin_words"] - 0 or row["after"]["latin_words"] > row["before"]["latin_words"]
    empty: Any = compare.register_ab([], [])
    assert empty["hi"]["before"]["replies"] == 0
