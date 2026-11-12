"""The never-say list as a HARD rule (owner, 5 Nov 2026): every line the assistant is about to speak is checked by code before it reaches the voice. A line that holds a never-say phrase is not spoken;
a short safe line is said instead and the block is counted (never the phrase or the line in the log)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import AsyncIterator, Sequence
from typing import Any

logger = logging.getLogger("app.talk_training.guard")

SAFE = {
    "en": "Let me check that with the team and get back to you.",
    "te": "దాని గురించి మా టీమ్‌తో కనుక్కుని మీకు చెప్తానండీ.",
    "hi": "इसके बारे में मैं टीम से पूछकर आपको बताती हूँ।",
    "kn": "ಅದರ ಬಗ್ಗೆ ಟೀಮ್ ಜೊತೆ ಕೇಳಿ ನಿಮಗೆ ಹೇಳುತ್ತೇನೆ.",
    "ta": "அதைப் பற்றி டீமிடம் கேட்டு உங்களுக்குச் சொல்கிறேன்.",
    "ml": "അതിനെക്കുറിച്ച് ടീമിനോട് ചോദിച്ച് നിങ്ങളോട് പറയാം.",
    "mr": "याबद्दल मी टीमला विचारून तुम्हाला सांगते.",   # job M1: a draft for a native reader
}


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"[^\w%₹]+", " ", text)
    return f" {' '.join(text.split())} "


def violates(text: str, never_say: Sequence[str]) -> bool:
    """True when the line holds a never-say phrase as whole words (case, spaces and punctuation do not matter)."""
    line = _norm(text)
    return any(p.strip() and _norm(p) in line for p in never_say)


def safe_line(text: str, never_say: Sequence[str], language: str) -> str:
    if never_say and violates(text, never_say):
        logger.info("never_say blocked a line: language=%s", language)
        return SAFE.get(language, SAFE["en"])
    return text


TAG = re.compile(r"\{q_[a-z0-9_]{1,30}\}\s*")   # a topic tag the model puts before a question: {q_parent}
LOOSE_TAG = re.compile(r"\{q_[a-z0-9_]*\}?|\{q_[a-z0-9_]*$")   # a tag cut in pieces (never spoken)


async def _silence() -> AsyncIterator[bytes]:
    """Nothing to say (a sentence that only repeated a question): an empty stream."""
    return
    yield b""


def _words(sentence: str) -> frozenset[str]:
    """The words of a sentence, letters and marks and digits only (Telugu vowel signs are marks, not letters: they stay inside their word), lower case."""
    text = "".join(c if unicodedata.category(c)[0] in "LMN" else " " for c in unicodedata.normalize("NFC", sentence).casefold())
    return frozenset(w for w in text.split() if len(w) > 1)


class GuardedTts:
    """The voice, with the never-say check in front of it: each sentence sent to be spoken is checked first."""

    def __init__(self, inner: Any, never_say: Sequence[str], *, goal_tone: str | None = None, addressed_name: str | None = None, titles_gender: str | None = None) -> None:
        self._inner, self._never = inner, list(never_say)
        self._goal_tone = goal_tone   # set on an OUTBOUND goal call: no promise is spoken, and the tone's particles are taken out (app/telephony/promises.py, tone.py)
        self._addressed_name = addressed_name  # the called person's own name (Lead Desk): the only name "గారు" may follow, and only in Respectful
        self._titles_gender = titles_gender    # "male" / "female" when the name is unknown and the gender is known: Respectful may use sir / madam, at most twice in the call
        self._titles_used = 0
        self.sample_rate = getattr(inner, "sample_rate", 24000)
        self.blocked = 0
        self.promises_blocked = 0
        self.repeats_blocked = 0
        self.honorifics_stripped = 0            # honorifics (గారు, గారి, గారికి ...) taken out of what the voice was about to say on this goal call: a metric
        self.bookish_words: list[str] = []      # the written words (app/agents/register/data/bookish.json) the voice was given on this goal call: a metric, nothing is swapped
        self.child_terms: list[str] = []        # words that must never name a child in a Respectful call (వాడు, పిల్లవాడి ...), spoken on this goal call: a metric
        self.said_lines: list[str] = []         # every line the voice was really given on a goal call, in order (after the guards): the call's transcript shows THESE, not the model's raw reply (12 Nov 2026)
        self.particles = 0                      # the polite particle (అండి / అండీ) spoken, and the sentences it was spoken in: particles per sentence
        self.sentences = 0
        self._asked: list[frozenset[str]] = []   # the questions already spoken on a goal call (as word sets): the same question is never spoken twice
        self._tags: set[str] = set()             # the topic tags of the questions already asked ({q_parent}): the same POINT is never asked twice, in whatever words

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def _without_repeats(self, text: str) -> str:
        """Owner, 11 Nov 2026: "do not ask the same question twice". Two ways to catch it. (1) TAGS: the model puts a topic tag in curly braces at the start of every question ({q_parent}); a question whose tag was already used is the same
        point asked again, in other words, and is not spoken. The tags are removed from everything spoken. (2) WORDS: a question of three words or more, three quarters of whose words (of the shorter one) are in a question
        already spoken on this call, is not spoken again."""
        kept: list[str] = []
        for sentence in re.split(r"(?<=[.?!])\s+", text.strip()):
            tags = TAG.findall(sentence)
            sentence = TAG.sub("", sentence).strip()
            if tags and any(t in self._tags for t in tags):
                self.repeats_blocked += 1
                logger.info("repeat blocked: a point already asked on this call (same tag)")   # no text in the log
                continue
            if "?" in sentence:
                words = _words(sentence)
                if len(words) >= 3 and any(len(old) >= 3 and len(words & old) / min(len(words), len(old)) >= 0.75 for old in self._asked):
                    self.repeats_blocked += 1
                    logger.info("repeat blocked: a question already asked on this call")   # no text in the log
                    continue
                self._asked.append(words)
            self._tags.update(tags)
            if sentence:
                kept.append(sentence)
        return " ".join(kept)

    def _titles(self, said: str) -> str:
        """sir / madam (the 30 Oct 2026 removal applies outside Respectful): Respectful may use them when the name is unknown and the gender is known, at most twice in the call; everywhere else they are taken out."""
        from app.agents.register import address

        found = address.gendered_words(said)
        if not found:
            return said
        if self._goal_tone == "respectful" and self._titles_gender and len(found) + self._titles_used <= 2:
            self._titles_used += len(found)
            return said
        return address.clean(said)

    def _goal_line(self, text: str, language: str) -> str:
        """What a goal call's voice is really given: no promise, no giving up, no honorific, no repeated point, no tag; and the metrics of what was said. "" = nothing to say."""
        from app.agents import register
        from app.telephony import promises, tone

        assert self._goal_tone is not None  # noqa: S101 - the caller checks
        plain = TAG.sub("", text)
        word = promises.find(plain)
        if word == "gives_up":
            self.promises_blocked += 1
            logger.info("goal dropped blocked: kind=gives_up language=%s tone=%s", language, self._goal_tone)
            return tone.ACK_LINE_TE.get(self._goal_tone, tone.ACK_LINE_TE["friendly"]) if language == "te" else promises.safe_line(language, self._goal_tone)
        if word is not None:
            self.promises_blocked += 1
            logger.info("promise blocked: kind=%s language=%s tone=%s", word, language, self._goal_tone)   # the closed word only, never the line
            return promises.safe_line(language, self._goal_tone)
        n_honorifics = tone.honorifics_in(plain, self._goal_tone, language, self._addressed_name)   # exactly what soften() takes out: the count a call reports is what was really removed
        if n_honorifics:
            self.honorifics_stripped += n_honorifics
            logger.info("honorific stripped: n=%d", n_honorifics)   # a count, never the line
        said = self._without_repeats(tone.soften(text, self._goal_tone, language, self._addressed_name))
        said = LOOSE_TAG.sub("", said).strip()
        said = self._titles(said)
        if said:
            self.particles += tone.particles_in(said)
            self.sentences += tone.sentences_in(said)
            found = register.bookish_in(language, said)
            if found:
                self.bookish_words.extend(found)
                logger.info("bookish words spoken: n=%d words=%s", len(found), ",".join(found))   # list words only, never the line
            kids = register.child_terms_in(language, said)
            if kids:
                self.child_terms.extend(kids)
                logger.info("child terms spoken: n=%d words=%s", len(kids), ",".join(kids))
        return said

    def stream(self, text: str, language: str, *args: Any, **kwargs: Any) -> AsyncIterator[bytes]:
        said = safe_line(text, self._never, language)
        if said != text:
            self.blocked += 1
            if self._goal_tone is not None:   # (the usual safe line says "I will check with the team and get back to you": a promise a goal call cannot keep)
                from app.telephony import promises

                said = promises.safe_line(language, self._goal_tone)
        elif self._goal_tone is not None:
            said = self._goal_line(text, language)
            if not said:
                return _silence()
        if self._goal_tone is not None and said:
            self.said_lines.append(said)
        result: AsyncIterator[bytes] = self._inner.stream(said, language, *args, **kwargs)
        return result

    def as_said(self, text: str, language: str) -> str:
        """A piece of the model's reply (for example what was heard of it before a barge-in) the way the guards would have spoken it: no honorific where it is not allowed, no topic tag. No counter moves."""
        if self._goal_tone is None:
            return text
        from app.telephony import tone

        return " ".join(LOOSE_TAG.sub("", TAG.sub("", tone.soften(text, self._goal_tone, language, self._addressed_name))).split()) or text
