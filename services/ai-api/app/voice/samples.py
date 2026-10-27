"""The listening samples and the speech-to-text check of night 3 (ADR 0101), as plain functions with no network: `scripts/voice_samples.py` is the only caller that talks to Sarvam.

What is here is what the tests can prove without a key: the lines (drafts for native review), the order they are sent in, the HARD CAP on characters and on seconds of audio (counted BEFORE anything is
sent), the word accuracy and the listening page. Nothing here reads a key, a file outside what it is given, or the network."""

# ruff: noqa: E501

from __future__ import annotations

import html
import io
import re
import wave
from dataclasses import dataclass

LANGS: tuple[str, ...] = ("en", "te", "hi", "kn", "ta", "ml")
LANG_NAMES = {"en": "English", "te": "తెలుగు (Telugu)", "hi": "हिन्दी (Hindi)", "kn": "ಕನ್ನಡ (Kannada)", "ta": "தமிழ் (Tamil)", "ml": "മലയാളം (Malayalam)"}
# Bulbul v3 speakers (docs.sarvam.ai); a v3 voice speaks any of the languages. Three, chosen by name only.
VOICES: tuple[str, ...] = ("ritu", "kavya", "aditya")
# "styles" are what v3 offers: pace and temperature (it has no style switch)
STYLES: dict[str, dict[str, float]] = {"warm": {"pace": 0.95, "temperature": 0.7}, "crisp": {"pace": 1.1, "temperature": 0.3}}
TTS_CHAR_CAP = 9000
STT_SECOND_CAP = 180.0
STT_CLIPS_PER_LANGUAGE = 2

# line 1 = the opening of a call (the AI disclosure first); line 2 = a saree follow-up; line 3 = a school admission reply (no fees, no marks, no dues: the school's own staff answer those).
# DRAFTS for native review: written to be short and spoken, not checked by a native speaker.
LINES: dict[str, tuple[str, str, str]] = {
    "en": (
        "Namaste, I'm Vijaya, Lakshmi Sarees' AI assistant. Is this a good time to talk?",
        "The green silk saree you liked is still in stock. Shall I send photos on WhatsApp?",
        "Admissions for Class 1 are open at Sunrise School. I will send the form on WhatsApp.",
    ),
    "te": (
        "నమస్తే, నేను విజయ, లక్ష్మి సారీస్ AI అసిస్టెంట్‌ని. ఇప్పుడు మాట్లాడవచ్చా?",
        "మీరు ఇష్టపడిన ఆకుపచ్చ పట్టు చీర ఇంకా స్టాక్‌లో ఉంది. వాట్సాప్‌లో ఫోటోలు పంపనా?",
        "సన్‌రైజ్ స్కూల్‌లో ఒకటో తరగతి అడ్మిషన్లు తెరిచి ఉన్నాయి. ఫారం వాట్సాప్‌లో పంపుతాను.",
    ),
    "hi": (
        "नमस्ते, मैं विजया, लक्ष्मी साड़ीज़ की AI असिस्टेंट हूँ। क्या अभी बात कर सकते हैं?",
        "आपको जो हरी रेशमी साड़ी पसंद आई थी, वह अभी स्टॉक में है। व्हाट्सऐप पर फ़ोटो भेजूँ?",
        "सनराइज़ स्कूल में कक्षा एक के लिए प्रवेश खुले हैं। फ़ॉर्म व्हाट्सऐप पर भेज दूँगी।",
    ),
    "kn": (
        "ನಮಸ್ತೆ, ನಾನು ವಿಜಯ, ಲಕ್ಷ್ಮಿ ಸೀರೀಸ್‌ನ AI ಅಸಿಸ್ಟೆಂಟ್. ಈಗ ಮಾತಾಡಬಹುದಾ?",
        "ನೀವು ಇಷ್ಟಪಟ್ಟ ಹಸಿರು ರೇಷ್ಮೆ ಸೀರೆ ಇನ್ನೂ ಸ್ಟಾಕ್‌ನಲ್ಲಿದೆ. ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಫೋಟೋ ಕಳುಹಿಸಲೇ?",
        "ಸನ್‌ರೈಸ್ ಶಾಲೆಯಲ್ಲಿ ಒಂದನೇ ತರಗತಿಗೆ ಪ್ರವೇಶ ತೆರೆದಿದೆ. ಅರ್ಜಿಯನ್ನು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸುತ್ತೇನೆ.",
    ),
    "ta": (
        "வணக்கம், நான் விஜயா, லட்சுமி சாரீஸின் AI உதவியாளர். இப்போது பேசலாமா?",
        "நீங்கள் விரும்பிய பச்சை பட்டுப்புடவை இன்னும் கையிருப்பில் உள்ளது. வாட்ஸ்அப்பில் படங்கள் அனுப்பவா?",
        "சன்ரைஸ் பள்ளியில் ஒன்றாம் வகுப்பு சேர்க்கை திறந்துள்ளது. விண்ணப்பத்தை வாட்ஸ்அப்பில் அனுப்புகிறேன்.",
    ),
    "ml": (
        "നമസ്കാരം, ഞാൻ വിജയ, ലക്ഷ്മി സാരീസിന്റെ AI അസിസ്റ്റന്റ്. ഇപ്പോൾ സംസാരിക്കാമോ?",
        "നിങ്ങൾക്ക് ഇഷ്ടപ്പെട്ട പച്ച പട്ടുസാരി ഇപ്പോഴും സ്റ്റോക്കിലുണ്ട്. വാട്സാപ്പിൽ ഫോട്ടോ അയയ്ക്കട്ടെ?",
        "സൺറൈസ് സ്കൂളിൽ ഒന്നാം ക്ലാസ് പ്രവേശനം തുറന്നിട്ടുണ്ട്. അപേക്ഷ വാട്സാപ്പിൽ അയയ്ക്കാം.",
    ),
}


@dataclass(frozen=True)
class Clip:
    lang: str
    voice: str
    style: str
    n: int   # 1..3
    text: str

    @property
    def path(self) -> str:
        return f"{self.lang}/{self.voice}-{self.style}-{self.n}.wav"


def plan() -> list[Clip]:
    """Every clip, in the order they are sent: the first voice in the first style for ALL languages and lines before anything else, so a stop at the cap leaves every language covered."""
    return [
        Clip(lang, voice, style, n + 1, LINES[lang][n])
        for voice in VOICES
        for style in STYLES
        for n in range(3)
        for lang in LANGS
    ]


def within_cap(clips: list[Clip], cap: int = TTS_CHAR_CAP, already_sent: int = 0) -> tuple[list[Clip], int]:
    """The clips that fit under the cap (counted in characters, in order, stopping at the first that does not fit), and the characters they add. `already_sent` is what earlier runs spent."""
    used, kept = already_sent, []
    for clip in clips:
        if used + len(clip.text) > cap:
            break
        used += len(clip.text)
        kept.append(clip)
    return kept, used - already_sent


def wav_seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio)) as w:
        return float(w.getnframes()) / float(w.getframerate())


def stt_picks(available: list[Clip], per_language: int = STT_CLIPS_PER_LANGUAGE) -> list[Clip]:
    """Two short clips per language for the check: the first voice and style, lines 1 and 2."""
    picks: list[Clip] = []
    for lang in LANGS:
        mine = [c for c in available if c.lang == lang and c.voice == VOICES[0] and c.style == "warm" and c.n <= per_language]
        picks.extend(sorted(mine, key=lambda c: c.n))
    return picks


def _words(text: str) -> list[str]:
    cleaned = re.sub(r"[^\w\s]|_", " ", text.lower().replace("‌", "").replace("‍", ""))
    return cleaned.split()


def word_accuracy(reference: str, heard: str) -> float:
    """1 - (word edit distance / reference words), never below 0: the usual word error rate, reported as the share right. Case, punctuation and the zero-width joiners are ignored."""
    ref, hyp = _words(reference), _words(heard)
    if not ref:
        return 1.0 if not hyp else 0.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return max(0.0, 1.0 - prev[-1] / len(ref))


def index_html(clips: list[Clip], usage: dict[str, object]) -> str:
    """One static page: each clip with its text and a player. No script, no network, relative links."""
    out = [
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Stack19 voice samples</title>",
        "<style>body{font:16px/1.5 system-ui,sans-serif;margin:24px auto;max-width:900px;padding:0 16px}h2{margin-top:32px;border-bottom:2px solid #c2410c}"
        "table{border-collapse:collapse;width:100%}td{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}.t{font-size:18px}small{color:#555}</style>",
        "<h1>Stack19 voice samples (Sarvam Bulbul v3)</h1>",
        "<p>Drafts for native review. Each line is the opening of a call (with the AI disclosure), a saree follow-up and a school admission reply. "
        "Voices: " + ", ".join(VOICES) + ". Styles: warm (slower, more varied) and crisp (faster, steadier).</p>",
        f"<p><small>Characters sent to the voice service in total: {usage.get('chars_total', 0)} of {TTS_CHAR_CAP}.</small></p>",
    ]
    for lang in LANGS:
        mine = [c for c in clips if c.lang == lang]
        if not mine:
            continue
        out.append(f"<h2>{html.escape(LANG_NAMES[lang])}</h2><table>")
        for c in mine:
            out.append(
                f"<tr><td><b>{html.escape(c.voice)}</b><br><small>{html.escape(c.style)}, line {c.n}</small></td>"
                f"<td class=t lang={c.lang}>{html.escape(c.text)}<br><audio controls preload=none src=\"{html.escape(c.path)}\"></audio></td></tr>"
            )
        out.append("</table>")
    return "\n".join(out)
