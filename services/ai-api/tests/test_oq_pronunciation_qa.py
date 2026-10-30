"""The round-trip comparison (job pronunciation-quality): what was meant against what the recogniser heard, the ranking, and the report. No network: the speaking and listening are in scripts/pronunciation_qa.py."""

# ruff: noqa: E501

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app.pronunciation import qa

ROOT = Path(__file__).resolve().parents[3]


def test_the_same_words_score_high_and_a_different_word_scores_low() -> None:
    assert qa.similarity("Call from ధర్మవరం today.", "call from ధర్మవరం today") == 1.0
    assert qa.similarity("ధర్మవరం నుంచి", "ధర్మవరం నుంచి") == 1.0
    assert qa.similarity("Kannada", "Canada") < qa.PASS_SCORE
    assert qa.similarity("one lakh twenty thousand rupees", "one lakh twenty thousand rupees") == 1.0
    assert qa.similarity("two thousand six hundred", "twenty six hundred") < 0.95


def test_a_word_is_found_in_any_accepted_spelling() -> None:
    spellings = ["Anantapur", "Ananthapuramu", "అనంతపురం"]
    assert qa.word_heard(spellings, "we are calling from Ananthapuramu today")
    assert qa.word_heard(spellings, "అనంతపురం నుంచి మాట్లాడుతున్నాను")
    assert qa.word_heard(["Parvathipuram Manyam"], "from parvathipuram manyam today")
    assert not qa.word_heard(spellings, "we are calling from Hyderabad today")


def test_a_missed_key_word_fails_a_clip_even_when_the_sentence_scores_high_and_ranks_first() -> None:
    good = qa.score("a", "en", "en-janvi", "lexicon", "x", "This is a call from Dharmavaram.", "This is a call from Dharmavaram.", ["Dharmavaram"])
    missed = qa.score("b", "en", "en-janvi", "lexicon", "x", "This is a call from Dharmavaram.", "This is a call from Dharmapuri.", ["Dharmavaram"])
    lowest = qa.score("c", "en", "en-janvi", "sentence", "x", "Hello how are you", "Yellow cow", [])
    assert good.ok and not missed.ok and not lowest.ok
    assert [r.id for r in qa.rank([good, lowest, missed])][:2] == ["b", "c"], "a word that was not heard comes before a low score"


def test_the_report_lists_what_a_native_listener_should_hear_first() -> None:
    bad = qa.score("te-lex-Dharmavaram", "te", "te-ramya", "lexicon", "w", "ధర్మవరం నుంచి", "తర్మం కంచి", ["Dharmavaram", "ధర్మవరం"])
    ok = qa.score("te-line-1", "te", "te-ramya", "sentence", "w", "నమస్కారం అండీ", "నమస్కారం అండి", [])
    text = qa.report([bad, ok], title="T", chars_sent=42)
    assert "2 clips" in text and "Characters sent to Cartesia: 42" in text and "te-lex-Dharmavaram" in text and "cannot hear accent" in text


def test_the_review_import_moves_a_correction_into_the_lexicon(tmp_path: Path) -> None:
    verdicts = tmp_path / "verdicts.json"
    verdicts.write_text(json.dumps({"language": "en", "verdicts": [{"id": "x", "word": "Dharmavaram", "ok": False, "sounds_like": "Dhar-ma-vah-rum"}, {"id": "y", "word": "Hindupur", "ok": True}, {"id": "z", "word": "Ongole", "ok": None}]}), encoding="utf-8")
    run = subprocess.run([sys.executable, str(ROOT / "scripts" / "pronunciation_review_import.py"), str(verdicts)], capture_output=True, text=True, check=False)  # noqa: S603  (our own script, a path we built)
    assert run.returncode == 0, run.stderr
    assert "Dhar-ma-vah-rum" in run.stdout and "verified: Hindupur" in run.stdout and "not written" in run.stdout and "Ongole" not in run.stdout
