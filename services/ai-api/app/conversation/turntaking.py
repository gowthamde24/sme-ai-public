"""Turn-taking for Live talk (owner standard, 31 Oct 2026, job live-conversation-standard A, B, D). Pure rules: no network, no clock, no model; the session feeds it facts and acts on what it says.

  A1  `completeness(text, language)`: is this partial or final transcript a COMPLETE thought? ("complete" reply after the usual short silence; "unsure" wait a little; "incomplete" wait up to ~2.5-3 s for the rest:
      "2000 sq ft ki...", "నాకు కావాలి...", "और फिर"). A cheap rule classifier for te / en / hi / kn / ta / ml and their romanised forms. The open turn models were checked first (docs/runbooks/live-turn-models.md):
      Pipecat Smart Turn and the LiveKit detector do not cover Telugu, Kannada, Tamil or Malayalam; the community Indic Smart Turn does and is the audio-side upgrade path (an `AudioTurnModel` can overrule this).
  A2  `PauseModel`: the pause THIS speaker takes inside a turn, learned in the session; the silence that ends their turn follows it (people pause longer in Telugu / Kannada while thinking).
  B1/B2/B4  `classify_interruption`: a cough, a click, a TV, "hmm", "haan", "ok", "అవును" do not take the turn; speech of 300 ms or two real words does.
  B3  `spoken_prefix`: the assistant's stored turn is only what was actually spoken before it was cut.
  D3/D4/D5  `silence_action`, `is_goodbye`, `soft_warning_due`: the check-in, the polite end, the session cap's warning.
Everything the caller said is untrusted data: it is only compared with closed word lists."""

# ruff: noqa: E501

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Literal, Protocol

Completeness = Literal["complete", "unsure", "incomplete"]
Interruption = Literal["barge_in", "backchannel", "noise"]

# ---- A1: the classifier ------------------------------------------------------------------------------------------------------------------------

HOLD_COMPLETE_MS = 0        # a complete thought: answer as soon as the line has been quiet for the usual short time
HOLD_UNSURE_MS = 900        # might go on: a little longer
HOLD_INCOMPLETE_MS = 2800   # clearly unfinished: wait for the rest (the standard says 2.5 to 3 s)
MAX_HOLD_PARTS = 4          # a turn is at most this many pieces joined (a speaker who never finishes is answered)

# words a sentence cannot END on (connectives, postpositions, determiners, fillers), per language and romanised
_DANGLING = {
    "en": "and but or so because if when while that which who where with without for to of in on at by from about like my your the a an this these those is are was were am be been have has had do does did will would can could should shall may might not no then also plus um uh er erm hmm ah well actually basically around approximately roughly maybe".split(),
    "te": "మరియు కానీ లేదా అయితే ఎందుకంటే అని అంటే కి కు తో తోపాటు గురించి కోసం లో నుంచి నుండి పై మీద వద్ద ఇంకా పైగా అప్పుడు మరి ఏమో అదేంటంటే".split(),
    "hi": "और लेकिन या तो क्योंकि अगर जब कि के को का की में से पर साथ बारे लिए फिर यानी मतलब जैसे वो ये मेरा मेरी तक भी ही कुछ".split(),
    "kn": "ಮತ್ತು ಆದರೆ ಅಥವಾ ಹಾಗಾದರೆ ಏಕೆಂದರೆ ಎಂದು ಅಂದರೆ ಗೆ ಅನ್ನು ಜೊತೆ ಬಗ್ಗೆ ಕ್ಕೆ ನಲ್ಲಿ ಇಂದ ಮೇಲೆ ಇನ್ನೂ ಆಮೇಲೆ ಮತ್ತೆ ಅಂದ್ರೆ ಅಲ್ಲಿ".split(),
    "ta": "மற்றும் ஆனால் அல்லது என்றால் ஏனெனில் என்று க்கு உடன் பற்றி இல் இருந்து மேல் இன்னும் பிறகு அப்புறம் அதாவது".split(),
    "ml": "ഉം എന്നാൽ പക്ഷേ അല്ലെങ്കിൽ കാരണം എന്ന് ലേക്ക് കൂടെ കുറിച്ച് ഇൽ നിന്ന് പിന്നെ അതായത്".split(),
    # Telugu / Hindi / Kannada typed in English letters
    "rom": "ki ku ni nu tho toh to ni lo nundi nunchi gurinchi kosam mariyu kani leda ante endukante anni inka alage appudu mari aa pai meeda daggara aur lekin ya kyunki agar jab ke ko ka ki mein se par saath liye phir matlab jaise ye woh mera meri tak bhi hi kuch mattu aadare ge alli".split(),
}
_FILLER_ONLY = {"um", "uh", "er", "erm", "hmm", "mm", "ah", "so", "well", "ఆ", "అంటే", "మరి", "ఉమ్", "హ్మ్", "यानी", "मतलब", "अम", "ಅಂದ್ರೆ", "ಉಂ", "அதாவது", "ஆ", "ante", "matlab", "basically"}
_ENDERS = ".?!।॥…"   # (an ellipsis is an unfinished sentence: handled before this)
_TRAIL_OPEN = re.compile(r"(?:\.{2,}|…|[,;:\-–—])\s*$")
_BARE_NUMBER = re.compile(r"(?:^|\s)[\d][\d,.]*\s*$")
_UNIT_TAIL = re.compile(r"(?:^|\s)(?:sq\.?\s?ft|sqft|sq\.?\s?feet|feet|ft|kg|kgs|tons?|pieces?|pcs|nos|bags?|lakhs?|crores?|thousand|hundred|వేలు|లక్షలు|వందలు|हज़ार|लाख|ಸಾವಿರ|ಲಕ್ಷ)\s*$", re.IGNORECASE)
_EDGE = ".,;:!?¿¡…\"'’‘“”()[]{}<>।॥-–—/\\|*_~`"   # what sticks to a word's edges; the vowel signs of the Indian scripts are inside words and stay
_QUESTIONISH = re.compile(r"[?？]\s*$")


def _tokens(text: str) -> list[str]:
    return [t for t in (w.strip(_EDGE) for w in text.casefold().split()) if t]


def completeness(text: str, language: str = "en") -> Completeness:
    """Is `text` (a partial or final transcript) a complete thought? Closed, cheap, conservative: when it cannot tell it says "unsure", never "complete" for something that visibly trails off."""
    stripped = (text or "").strip()
    if not stripped:
        return "incomplete"
    if _TRAIL_OPEN.search(stripped):
        return "incomplete"
    tokens = _tokens(stripped)
    if not tokens:
        return "incomplete"
    last = tokens[-1]
    if len(tokens) == 1 and last in _FILLER_ONLY:
        return "incomplete"
    dangling = set(_DANGLING.get(language, ())) | set(_DANGLING["rom"]) | set(_DANGLING["en"] if language == "en" or stripped.isascii() else ())
    if last in dangling and (last in _DANGLING["en"] or stripped[-1] not in _ENDERS):
        # "to", "and", "ki", "కి": a sentence does not end there (a closing mark from the recogniser on a dangling word is not trusted for English connectives)
        return "incomplete"
    if stripped[-1] in _ENDERS or _QUESTIONISH.search(stripped):
        return "complete"
    if _UNIT_TAIL.search(stripped) and len(tokens) <= 4:
        return "unsure"   # "2000 sq ft": a size on its own, the thing it is a size OF may still be coming
    if _BARE_NUMBER.search(stripped):
        return "unsure"   # a number said last: the digits may still be going on
    if len(tokens) == 1:
        return "complete"   # "hello", "yes", "haan"
    if last in _FILLER_ONLY:
        return "incomplete"
    return "complete"


def hold_ms(state: Completeness, pause: PauseModel | None = None) -> int:
    """How long to wait for a continuation AFTER the line went quiet (on top of the quiet that ended the speech)."""
    if state == "complete":
        return HOLD_COMPLETE_MS
    base = HOLD_UNSURE_MS if state == "unsure" else HOLD_INCOMPLETE_MS
    if pause is not None and state == "incomplete":
        return int(min(HOLD_INCOMPLETE_MS + 400, max(base, 1.4 * pause.typical_ms())))
    return base


# ---- A2: the speaker's own pause ---------------------------------------------------------------------------------------------------------------

@dataclass
class PauseModel:
    """The silences this speaker took INSIDE a turn (they stopped, and then went on). `silence_ms(base)` is the quiet that ends their turn: never below the language's base, longer for someone who pauses more."""

    gaps_ms: list[int] = field(default_factory=list)
    keep: int = 8
    lowest: int = 200
    highest: int = 900

    def observe_gap(self, gap_ms: int) -> None:
        """They paused `gap_ms` and then continued the same turn."""
        if 150 <= gap_ms <= 6000:
            self.gaps_ms = [*self.gaps_ms, int(gap_ms)][-self.keep :]

    def typical_ms(self) -> int:
        return int(statistics.median(self.gaps_ms)) if self.gaps_ms else 600

    def silence_ms(self, base: int) -> int:
        if len(self.gaps_ms) < 2:
            return max(self.lowest, min(self.highest, base))
        wanted = max(base, int(0.85 * self.typical_ms()))
        return max(self.lowest, min(self.highest, wanted))


# ---- B: interruptions --------------------------------------------------------------------------------------------------------------------------

BARGE_IN_MIN_MS = 300     # speech this long counts as the caller talking
BARGE_IN_MIN_WORDS = 2
RESUME_AFTER_MS = 1800    # a false interruption: pick up where we stopped after this much quiet
BACKCHANNELS = {
    "hmm", "hm", "mm", "mmm", "mhm", "uh-huh", "uhhuh", "ok", "okay", "k", "yes", "yeah", "yep", "yup", "right", "sure", "fine", "good", "nice", "cool", "acha", "achha", "accha", "haan", "han", "haa", "ha", "hnn", "ji", "theek", "thik", "hai", "ho",
    "avunu", "avnu", "sare", "saree", "ela", "cheppandi", "cheppu", "oho", "aa", "ah", "oh", "ohh", "hmmm", "arre", "sari", "houdu", "howdu", "sariyagide", "aama", "aamam", "seri", "sollunga", "athe", "shari",
    "అవును", "సరే", "ఆ", "ఓ", "హా", "హూ", "హ్మ్", "ఓకే", "చెప్పండి", "అలాగే", "అవునా", "हाँ", "हां", "जी", "ठीक", "है", "अच्छा", "हूँ", "हम्म", "ओके", "बोलिए", "ಹೌದು", "ಸರಿ", "ಹೂಂ", "ಓಕೆ", "ಹೇಳಿ", "ஆமா", "ஆமாம்", "சரி", "ஹ்ம்", "சொல்லுங்க", "ഉം", "അതെ", "ശരി", "ഹ്മ്", "പറയൂ",
}


def classify_interruption(speech_ms: int, text: str | None = None) -> Interruption:
    """What was that sound while we spoke? `text` is what the recogniser made of it (None = nothing yet / nothing).
    barge_in: stop and listen. backchannel: "hmm", "ok", "haan": they are following, do not stop (or pick up again). noise: a cough, a click, a TV: same."""
    words = _tokens(text or "")
    if words:
        real = [w for w in words if w not in BACKCHANNELS]
        if not real:
            return "backchannel"
        return "barge_in" if (len(real) >= BARGE_IN_MIN_WORDS or speech_ms >= BARGE_IN_MIN_MS) else "backchannel"
    return "barge_in" if speech_ms >= 800 else "noise"   # sound with no words: a long one is still someone talking (the recogniser may be late); a short one is a cough or a click


def should_resume(kind: Interruption, quiet_ms: int) -> bool:
    """After a pause for a possible interruption: pick the reply up again?"""
    return kind != "barge_in" and quiet_ms >= RESUME_AFTER_MS


def spoken_prefix(clauses: list[tuple[str, float]], played_s: float) -> str:
    """What of the reply was actually spoken: `clauses` are (text, seconds of audio), `played_s` how much of the audio the caller heard. A clause cut in the middle keeps the words up to the cut, at a word boundary."""
    out: list[str] = []
    left = max(0.0, played_s)
    for text, seconds in clauses:
        if seconds <= 0:
            break   # no audio of it reached the line yet: it was not spoken
        if left >= seconds - 1e-6:
            out.append(text)
            left -= seconds
            continue
        words = text.split()
        keep = int(len(words) * (left / seconds)) if left > 0 else 0
        if keep:
            out.append(" ".join(words[:keep]) + "…")
        break
    return " ".join(out).strip()


# ---- D: the session ----------------------------------------------------------------------------------------------------------------------------

CHECK_IN_AFTER_S = 8.0
END_AFTER_S = 30.0
SOFT_WARNING_BEFORE_S = 120.0

CHECK_IN: dict[str, str] = {
    "en": "Still there?",
    "te": "ఉన్నారా అండీ?",
    "hi": "आप वहाँ हैं, जी?",
    "kn": "ಇದ್ದೀರಾ?",
    "ta": "இருக்கீங்களா?",
    "ml": "അവിടെയുണ്ടോ?",
}
GOODBYE_QUIET: dict[str, str] = {
    "en": "I'll close this now. Tap Live whenever you want to talk again.",
    "te": "సరే అండీ, ఇప్పుడు ముగిస్తున్నాను. మళ్ళీ మాట్లాడాలంటే Live నొక్కండి.",
    "hi": "ठीक है जी, अब बंद कर रही हूँ। फिर बात करनी हो तो Live दबाइए।",
    "kn": "ಸರಿ, ಈಗ ಮುಗಿಸುತ್ತೇನೆ. ಮತ್ತೆ ಮಾತಾಡಲು Live ಒತ್ತಿ.",
    "ta": "சரிங்க, இப்போ முடிக்கிறேன். மறுபடி பேச Live தட்டுங்க.",
    "ml": "ശരി, ഇപ്പോൾ അവസാനിപ്പിക്കുന്നു. വീണ്ടും സംസാരിക്കാൻ Live അമർത്തുക.",
}
GOODBYE_REPLY: dict[str, str] = {
    "en": "Bye, talk soon.",
    "te": "సరే అండీ, మళ్ళీ మాట్లాడదాం.",
    "hi": "ठीक है जी, फिर बात करते हैं।",
    "kn": "ಸರಿ, ಮತ್ತೆ ಮಾತಾಡೋಣ.",
    "ta": "சரிங்க, அப்புறம் பேசலாம்.",
    "ml": "ശരി, പിന്നെ സംസാരിക്കാം.",
}
SOFT_WARNING: dict[str, str] = {
    "en": "We have about two minutes left in this session.",
    "te": "ఈ సెషన్ లో ఇంకా రెండు నిమిషాలే ఉన్నాయి అండీ.",
    "hi": "इस सेशन में करीब दो मिनट बचे हैं जी।",
    "kn": "ಈ ಸೆಷನ್ ನಲ್ಲಿ ಇನ್ನು ಎರಡು ನಿಮಿಷ ಮಾತ್ರ ಇದೆ.",
    "ta": "இந்த செஷன்ல இன்னும் இரண்டு நிமிஷம் தான் இருக்கு.",
    "ml": "ഈ സെഷനിൽ ഏകദേശം രണ്ടു മിനിറ്റ് ബാക്കിയുണ്ട്.",
}
_GOODBYE = [
    r"\bbye\b", r"\bgoodbye\b", r"\bthat'?s all\b", r"\bthat is all\b", r"\bthank(?:s| you),? (?:that'?s|that is) (?:all|it)\b", r"\bwe'?re done\b", r"\bsee you\b", r"\bstop (?:now|listening)\b",
    r"ఇంక చాలు", r"ఇక చాలు", r"చాలు అండీ", r"బై(?=\s|$|[.,!?])", r"ధన్యవాదాలు,? (?:ఇంక|ఇక) చాలు", r"సరే ఉంటాను",
    r"बस इतना ही", r"बस इतना", r"बाय(?=\s|$|[.,!?।])", r"अलविदा", r"ठीक है,? चलता हूँ", r"धन्यवाद,? बस",
    r"ಸಾಕು", r"ಬೈ(?=\s|$|[.,!?])", r"ಮತ್ತೆ ಸಿಗೋಣ", r"போதும்", r"பை(?=\s|$|[.,!?])", r"മതി(?=\s|$|[.,!?])", r"ബൈ(?=\s|$|[.,!?])",
    r"\bbye bye\b", r"\bbaye\b", r"\binka chalu\b", r"\bcalu andi\b", r"\bsaaku\b", r"\bbas itna\b",
]
_GOODBYE_RE = re.compile("|".join(_GOODBYE), re.IGNORECASE)


def is_goodbye(text: str) -> bool:
    """'bye', 'thank you that's all', 'ఇంక చాలు', 'बस इतना ही', 'ಸಾಕು': the caller is done."""
    return bool(text) and len(text) <= 120 and _GOODBYE_RE.search(text) is not None


SilenceAction = Literal["wait", "check_in", "end"]


def silence_action(quiet_s: float, checked_in: bool) -> SilenceAction:
    """The line has been quiet for `quiet_s` seconds (after we finished speaking): after ~8 s one gentle check-in, after ~30 s in all end politely."""
    if quiet_s >= END_AFTER_S:
        return "end"
    if quiet_s >= CHECK_IN_AFTER_S and not checked_in:
        return "check_in"
    return "wait"


def soft_warning_due(elapsed_s: float, cap_s: float, warned: bool) -> bool:
    """Two minutes before the session cap (13 of 15 minutes), once."""
    return not warned and cap_s > SOFT_WARNING_BEFORE_S and elapsed_s >= cap_s - SOFT_WARNING_BEFORE_S


class AudioTurnModel(Protocol):
    """The audio-side upgrade path (Indic Smart Turn: 8 s of 16 kHz audio -> the probability that the turn is over). Not bundled; see docs/runbooks/live-turn-models.md."""

    def probability_complete(self, pcm16_16k: bytes) -> float: ...
