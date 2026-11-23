"""The assistant's small listening sounds while the caller talks ("hmm", "avunu andi", "haan ji", "achha", "okay"): sparse, short, never over the caller (owner and planner, 21 Nov 2026; reports/call-humanness-audit.md item 1).

Two pure parts, no network and no line:
  * `Planner`  decides WHEN, from the caller's voiced / quiet 20 ms frames: only after the caller has talked for MIN_TALK_MS, in a small pause (GAP_MS) of that same turn, at most one per MIN_SPACING_MS, never while we
               are speaking, never while a person has taken the call over, never when the live words look like a question. Pauses longer than TURN_END_MS end the caller's turn: the assistant's real answer is next.
  * `Clips`    keeps the few short clips (rendered once per call by the call's own voice, so the same voice and the same loudness) and hands them out in turn, never the same one twice in a row.
A clip is a few characters of speech, so its cost is a few paise a call, spent only on a real call (the opening-line rule of app/telephony/greeting_audio.py)."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass, field

# the words, per call language (drafts for a native read; short, spoken, no honorific that a tone could forbid)
WORDS: dict[str, tuple[str, ...]] = {
    "en": ("Hmm.", "Okay.", "I see."),
    "te": ("హ్మ్.", "అవును.", "సరే."),
    "hi": ("हम्म.", "हाँ जी.", "अच्छा."),
    "kn": ("ಹ್ಮ್.", "ಹೌದು.", "ಸರಿ."),
    "ta": ("ம்ம்.", "சரி.", "ஆமாம்."),
    "ml": ("ഉം.", "ശരി.", "അതെ."),
    "mr": ("हम्म.", "हो.", "बरं."),
}
FRAME_MS = 20
MIN_TALK_MS = 2500       # the caller has been talking this long (pauses up to GAP tolerance inside it do not break it)
GAP_MS = 320             # a pause this long, inside the turn, is the moment
TURN_END_MS = 1400       # a pause this long ends the turn: no sound, the answer is next
MIN_SPACING_MS = 7000    # at most one every 7 seconds of the call
QUESTION_MARKS = ("?", "？", "؟", "¿")


def words_of(language: str) -> tuple[str, ...]:
    return WORDS.get(language, WORDS["en"])


@dataclass
class Planner:
    """Fed every 20 ms frame of the caller's audio while we are NOT speaking; `feed` answers True when one listening sound may go now."""

    enabled: bool = True
    talk_ms: int = 0
    quiet_ms: int = 0
    since_last_ms: int = MIN_SPACING_MS   # the first one may come as soon as the caller has talked long enough
    fired_in_gap: bool = False
    _frames_since: int = field(default=0, repr=False)

    def reset_turn(self) -> None:
        self.talk_ms = self.quiet_ms = 0
        self.fired_in_gap = False

    def feed(self, voiced: bool, *, speaking: bool, caller_text: str = "", taken_over: bool = False) -> bool:
        """One 20 ms frame. `speaking`: our own audio is playing (never a backchannel then, and the caller's run is not ours to read)."""
        self.since_last_ms = min(self.since_last_ms + FRAME_MS, 10 * MIN_SPACING_MS)
        if speaking or taken_over or not self.enabled:
            self.reset_turn()
            return False
        if voiced:
            self.talk_ms += FRAME_MS
            self.quiet_ms = 0
            self.fired_in_gap = False
            return False
        self.quiet_ms += FRAME_MS
        if self.quiet_ms >= TURN_END_MS:
            self.reset_turn()
            return False
        if self.quiet_ms >= GAP_MS and not self.fired_in_gap and self.talk_ms >= MIN_TALK_MS and self.since_last_ms >= MIN_SPACING_MS:
            self.fired_in_gap = True   # one per pause, however long it lasts
            if caller_text.rstrip().endswith(QUESTION_MARKS):
                return False   # they are asking something: our answer is next, not a "hmm"
            self.since_last_ms = 0
            self.talk_ms = 0   # a new stretch of talking has to build up again
            return True
        return False


class Clips:
    """The call's few clips (24 kHz 16-bit mono PCM, what the voice speaks), handed out in turn; empty until `put` is called, and then `next()` is None while there are none (no clip, no sound: never a failed call)."""

    def __init__(self) -> None:
        self._clips: list[bytes] = []
        self._at = 0

    def put(self, pcm: bytes) -> None:
        if pcm and len(pcm) >= 640 and len(self._clips) < 6:
            self._clips.append(bytes(pcm))

    def __len__(self) -> int:
        return len(self._clips)

    def next(self) -> bytes | None:
        if not self._clips:
            return None
        clip = self._clips[self._at % len(self._clips)]
        self._at += 1
        return clip
