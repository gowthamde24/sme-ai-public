"""Natural fillers while the model is still thinking (job natural-voice): when no reply audio is ready 600 ms after the caller finished, the assistant says a short "హా…" or "ఒక్క నిమిషం అండీ" in the SAME
voice, from a set rendered BEFORE the call (so it costs no latency and no characters during it). Never a beep. At most one filler per turn, and not the same one twice in a row.

Hindi, Kannada, Tamil and Malayalam lines are drafts for a native reader; the Telugu ones follow native-lines/te.md ("ఒక్క నిమిషం అండీ, check చేసి చెప్తాను" is the approved wording)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import random
from collections.abc import Awaitable, Callable
from pathlib import Path

FILLER_AFTER_MS = 600

FILLERS: dict[str, tuple[str, ...]] = {
    "te": ("హా…", "ఒక్క నిమిషం అండీ"),
    "hi": ("हाँ जी…", "एक मिनट जी"),
    "kn": ("ಹೌದು…", "ಒಂದು ನಿಮಿಷ ಸರ್"),
    "ta": ("ஆமாங்க…", "ஒரு நிமிஷம் சார்"),
    "ml": ("ഹാ…", "ഒരു മിനിറ്റ് സർ"),
    "en": ("Hmm…", "One moment, sir"),
}

# The browser voice (job DV follow-up): 3 to 4 short lines per language, rendered ONCE per catalogue voice by scripts/voice_filler_bank.py into data/fillers/ and played when Ask is still checking after
# 700 ms. The Telugu first line is the approved wording of native-lines/te.md; the others are drafts for a native reader, like every non-Telugu line here.
BANK_LINES: dict[str, tuple[str, ...]] = {
    "en": ("One moment, let me check.", "Sure, let me look that up.", "Hmm, one second.", "Just a moment."),
    "te": ("ఒక్క నిమిషం అండీ, check చేసి చెప్తాను.", "హా అండీ, ఒక్క నిమిషం.", "ఒక్క క్షణం అండీ, చూస్తాను."),
    "hi": ("एक मिनट जी, मैं चेक करती हूँ।", "जी, एक सेकंड।", "हाँ जी, अभी देखती हूँ।"),
    "kn": ("ಒಂದು ನಿಮಿಷ ಸರ್, ನೋಡ್ತೀನಿ.", "ಹೌದು ಸರ್, ಒಂದು ಕ್ಷಣ.", "ಸ್ವಲ್ಪ ಇರಿ ಸರ್, ಚೆಕ್ ಮಾಡ್ತೀನಿ."),
}
BANK_DIR = Path(__file__).parent / "data" / "fillers"
BANK_INDEX = BANK_DIR / "index.json"
BROWSER_FILLER_AFTER_MS = 700


class FillerBank:
    """Pre-rendered filler audio per (language, voice)."""

    def __init__(self, seed: int | None = None) -> None:
        self._audio: dict[tuple[str, str], dict[str, bytes]] = {}
        self._last: dict[tuple[str, str], str] = {}
        self._rng = random.Random(seed)  # noqa: S311  (which filler to say is not a secret)

    async def prepare(self, language: str, voice: str, render: Callable[[str], Awaitable[bytes]]) -> int:
        """Render the set once (before the call); returns how many characters were spoken, for the usage log."""
        done: dict[str, bytes] = {}
        chars = 0
        for text in FILLERS.get(language, FILLERS["en"]):
            done[text] = await render(text)
            chars += len(text)
        self._audio[(language, voice)] = done
        return chars

    def pick(self, language: str, voice: str) -> tuple[str, bytes] | None:
        """A filler to say now, or None when none was prepared."""
        bank = self._audio.get((language, voice))
        if not bank:
            return None
        last = self._last.get((language, voice))
        options = [t for t in bank if t != last] or list(bank)
        choice = self._rng.choice(options)
        self._last[(language, voice)] = choice
        return choice, bank[choice]

    @classmethod
    def from_disk(cls, directory: Path = BANK_DIR, seed: int | None = None) -> FillerBank:
        """The bank rendered by scripts/voice_filler_bank.py: index.json maps a catalogue voice id to its language and lines, each line to a raw 16-bit 24 kHz mono PCM file. A missing folder is an empty bank (no filler is said)."""
        bank = cls(seed)
        index = directory / "index.json"
        if not index.is_file():
            return bank
        data = json.loads(index.read_text(encoding="utf-8"))
        for voice_id, entry in data.items():
            audio = {line["text"]: (directory / line["file"]).read_bytes() for line in entry["lines"] if (directory / line["file"]).is_file()}
            if audio:
                bank._audio[(entry["language"], voice_id)] = audio
        return bank
