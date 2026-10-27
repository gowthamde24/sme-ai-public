"""The spoken-style listening samples (job DS, owner feedback 26 Oct): the same lines as people really say them, next to the bookish lines of night 3. Pure functions, no network: `scripts/voice_samples_spoken.py` is the only caller that talks to Sarvam.

Six lines per language (te, hi, kn, ta, ml) from the owner's example files (native_lines/<lang>.md; Telugu is approved, the rest are drafts): the opening with the AI disclosure, the saree follow-up, a price answer, "call me later", "not interested", a school admission reply. HARD CAP: 3,000 characters of text-to-speech in total, counted before anything is sent.
Settings (docs.sarvam.ai, Bulbul v3): the text goes as people write it, English words in Latin letters inside the sentence (v3 reads code-mixed text); `pace` 1.08, the default temperature; numbers over 4 digits with commas (none are needed here: prices are said in words); `enable_preprocessing` is automatic on v3."""

# ruff: noqa: E501

from __future__ import annotations

import html
from dataclasses import dataclass

from app.agents import register
from app.voice.samples import LANG_NAMES, LINES

SPOKEN_LANGS: tuple[str, ...] = ("te", "hi", "kn", "ta", "ml")
SPOKEN_CHAR_CAP = 3000
SPOKEN_VOICE = "ritu"        # the voice of the night-3 "warm" samples, so only the text and the pace differ
SPOKEN_PACE = 1.08
SPOKEN_TEMPERATURE = 0.6     # Sarvam's default
LABELS: tuple[str, ...] = ("Opening (AI disclosure)", "Stock and photos", "Price answer", "Call me later", "Not interested, polite close", "School admission")
# which new line is the same line as night 3's line 1, 2 and 3 (opening, saree follow-up, school admission)
OLD_LINE_OF = {1: 0, 2: 1, 6: 2}


@dataclass(frozen=True)
class SpokenClip:
    lang: str
    n: int      # 1..6
    label: str
    text: str

    @property
    def path(self) -> str:
        return f"{self.lang}/{SPOKEN_VOICE}-spoken-{self.n}.wav"


def plan_spoken() -> list[SpokenClip]:
    """Every clip in the order they are sent: line 1 for all languages, then line 2 ..., so a stop at the cap leaves every language covered as far as it goes."""
    lines = {lang: [text for _, text in register.examples(lang)][:6] for lang in SPOKEN_LANGS}
    return [SpokenClip(lang, n + 1, LABELS[n], lines[lang][n]) for n in range(6) for lang in SPOKEN_LANGS if len(lines[lang]) > n]


def spoken_within_cap(clips: list[SpokenClip], already_sent: int = 0) -> tuple[list[SpokenClip], int]:
    """The clips that fit under the cap (counted in characters, in order, stopping at the first that does not fit), and the characters they add. `already_sent` is what earlier runs spent."""
    used, kept = already_sent, []
    for clip in clips:
        if used + len(clip.text) > SPOKEN_CHAR_CAP:
            break
        used += len(clip.text)
        kept.append(clip)
    return kept, used - already_sent


def compare_html(clips: list[SpokenClip], usage: dict[str, object]) -> str:
    """One static page: for each language the old (bookish) lines of night 3 beside the new (spoken) ones, each with a player. No script, no network, relative links (the old clips are in ../<lang>/)."""
    out = [
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Stack19 spoken samples</title>",
        "<style>body{font:16px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1100px;padding:0 16px}h2{margin-top:32px;border-bottom:2px solid #c2410c}"
        "table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left}.t{font-size:18px}small{color:#555}.old{background:#f6f3ef}.new{background:#fff7ed}</style>",
        "<h1>How Vijaya sounds: the bookish lines vs the everyday spoken lines</h1>",
        "<p>Left, the lines of night 3 (written register). Right, the same lines in everyday spoken language with the English words people use. Telugu follows the owner's approved lines; the other languages are drafts for a native reader. "
        f"Voice <b>{SPOKEN_VOICE}</b> in both; the new lines are a little faster (pace {SPOKEN_PACE}).</p>",
        f"<p><small>Characters sent to the voice service for the new lines: {usage.get('chars_total', 0)} of {SPOKEN_CHAR_CAP}.</small></p>",
    ]
    for lang in SPOKEN_LANGS:
        mine = [c for c in clips if c.lang == lang]
        if not mine:
            continue
        out.append(f"<h2>{html.escape(LANG_NAMES[lang])}</h2><table><tr><th>line</th><th class=old>before (bookish)</th><th class=new>now (spoken)</th></tr>")
        for c in sorted(mine, key=lambda x: x.n):
            old_index = OLD_LINE_OF.get(c.n)
            if old_index is None:
                old = "<small>(a new line)</small>"
            else:
                old = f"<span class=t lang={lang}>{html.escape(LINES[lang][old_index])}</span><br><audio controls preload=none src=\"../{lang}/ritu-warm-{old_index + 1}.wav\"></audio>"
            out.append(
                f"<tr><td><b>{html.escape(c.label)}</b></td><td class=old>{old}</td>"
                f"<td class=new><span class=t lang={lang}>{html.escape(c.text)}</span><br><audio controls preload=none src=\"{html.escape(c.path)}\"></audio></td></tr>"
            )
        out.append("</table>")
    return "\n".join(out)
