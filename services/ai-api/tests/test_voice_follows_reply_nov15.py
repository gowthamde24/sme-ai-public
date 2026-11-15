"""The voice speaks the language the clause is written in (owner's Telugu test, 15 Nov 2026)."""

from app.conversation.pipeline import voice_language


def test_a_telugu_clause_in_an_english_session_gets_the_telugu_voice() -> None:
    assert voice_language("మీ దగ్గర ఈ రోజు మూడు కొత్త లీడ్స్ ఉన్నాయి", "en") == "te"


def test_the_session_language_stays_when_the_clause_matches_it_or_has_no_script() -> None:
    assert voice_language("You have three new leads today.", "en") == "en"
    assert voice_language("మీ దగ్గర మూడు లీడ్స్ ఉన్నాయి", "te") == "te"
    assert voice_language("Sure, I will check", "te") == "te"  # English words: Telugu voice
    assert voice_language("", "hi") == "hi"


def test_other_scripts_are_found_too() -> None:
    assert voice_language("आपके पास आज तीन नए लीड हैं", "en") == "hi"
    assert voice_language("ನಿಮಗೆ ಇಂದು ಮೂರು ಹೊಸ ಲೀಡ್ ಇವೆ", "te") == "kn"
