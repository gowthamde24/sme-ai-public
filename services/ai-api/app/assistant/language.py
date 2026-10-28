"""Which language an owner wrote in, and whether a reply is in it. Pure functions, decided by SCRIPT (the Unicode block of the letters), not by a model.

The assistant answers in the language of the owner's message: English, Telugu, Hindi, Kannada, Tamil or Malayalam. A message that mixes English words with an Indian script
(very common) counts as that script's language when at least two fifths of its words are in it. A message in Latin letters only is English (a romanised sentence
gets an English reply: the reply's script is what the check looks at). The code checks the reply too: a reply whose letters are not in the script of its stated
language is refused and asked for again, whatever the model says it wrote in."""

from __future__ import annotations

import unicodedata
from typing import Literal

Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
LANGUAGES: tuple[Language, ...] = ("en", "te", "hi", "kn", "ta", "ml")

_BLOCKS: dict[Language, tuple[int, int]] = {
    "hi": (0x0900, 0x097F),  # Devanagari
    "ta": (0x0B80, 0x0BFF),  # Tamil
    "te": (0x0C00, 0x0C7F),  # Telugu
    "kn": (0x0C80, 0x0CFF),  # Kannada
    "ml": (0x0D00, 0x0D7F),  # Malayalam
}
INDIAN_SHARE = 0.25  # of all the letters of a REPLY (names and product words stay in Latin letters)


def _counts(text: str) -> tuple[dict[Language, int], int]:
    per: dict[Language, int] = {"en": 0, "hi": 0, "ta": 0, "te": 0, "kn": 0, "ml": 0}
    letters = 0
    for ch in text:
        category = unicodedata.category(ch)
        if not (category.startswith("L") or category in ("Mn", "Mc")):
            continue
        code = ord(ch)
        placed = False
        for lang, (low, high) in _BLOCKS.items():
            if low <= code <= high:
                per[lang] += 1
                placed = True
                break
        if not placed and category.startswith("L"):
            per["en"] += 1
        if category.startswith("L") or placed:
            letters += 1
    return per, letters


def _tokens(text: str) -> list[Language]:
    """The script of each word of a text (a word = a run of letters and marks), by the script of most of its letters; digits and punctuation are not words."""
    words: list[Language] = []
    current: list[str] = []

    def flush() -> None:
        if not current:
            return
        per, _ = _counts("".join(current))
        words.append(max(per, key=lambda lang: per[lang]))
        current.clear()

    for ch in text:
        category = unicodedata.category(ch)
        if category.startswith("L") or category in ("Mn", "Mc"):
            current.append(ch)
        else:
            flush()
    flush()
    return words


INDIAN_WORD_SHARE = 0.4  # of all the words


def detect_language(text: str) -> Language:
    """The language of an owner's message, by WORDS: the Indian script that most words are written in, if those words are at least two fifths of all the words, else English.
    (Short questions mix an English product name with a few Indian-language words; counting words, not letters, keeps "Synthetic product ధర ఎంత?" Telugu, while an English
    sentence that merely contains one pasted Telugu name stays English.)"""
    words = _tokens(text)
    if not words:
        return "en"
    best: Language = max(("hi", "ta", "te", "kn", "ml"), key=lambda lang: words.count(lang))
    return best if words.count(best) / len(words) >= INDIAN_WORD_SHARE else "en"


def reply_matches(text: str, language: Language) -> bool:
    """Is a reply really written in `language`? English: letters are (almost) all Latin. An Indian language: its script is at least a quarter of the letters
    (the same share that makes a message count as that language; names and product words stay in Latin letters)."""
    per, letters = _counts(text)
    if letters == 0:
        return False
    if language == "en":
        return per["en"] / letters >= 0.9
    return per[language] / letters >= INDIAN_SHARE


# Fixed phrases, written once, in each language: what the assistant says when it will not guess, cannot do something, or has no answer to show. They are not model output.
NO_ANSWER: dict[Language, str] = {
    "en": "I could not find that in your records, so I will not guess.",
    "te": "ఇది మీ రికార్డుల్లో నాకు కనిపించలేదు, అందుకే ఊహించి చెప్పను.",
    "hi": "यह मुझे आपके रिकॉर्ड में नहीं मिला, इसलिए मैं अंदाज़ा नहीं लगाऊँगा।",
    "kn": "ಇದು ನಿಮ್ಮ ದಾಖಲೆಗಳಲ್ಲಿ ನನಗೆ ಸಿಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ನಾನು ಊಹಿಸುವುದಿಲ್ಲ.",
    "ta": "இது உங்கள் பதிவுகளில் எனக்குக் கிடைக்கவில்லை, அதனால் நான் ஊகிக்க மாட்டேன்.",
    "ml": "ഇത് നിങ്ങളുടെ രേഖകളിൽ എനിക്ക് കണ്ടെത്താനായില്ല, അതിനാൽ ഞാൻ ഊഹിച്ചു പറയില്ല.",
}

# job EA: the conversational assistant says this, not the bare NO_ANSWER, when a question about the business's own records found nothing: plainly "no record", then ONE way forward. Not model output.
# A native reader of each language should check these words.
NO_RECORD_HELP: dict[Language, str] = {
    "en": "I could not find a record of that, so I will not guess. Tell me a customer's name, a date or a product and I will look again, or ask me to draft a follow-up.",
    "te": "దీని గురించి మీ రికార్డుల్లో ఏమీ కనిపించలేదు, అందుకే ఊహించి చెప్పను. కస్టమర్ పేరు, తేదీ లేదా వస్తువు చెప్పండి, మళ్ళీ చూస్తాను; లేదా ఫాలో-అప్ డ్రాఫ్ట్ చేయమని అడగండి.",
    "hi": "इसका कोई रिकॉर्ड मुझे नहीं मिला, इसलिए मैं अंदाज़ा नहीं लगाऊँगा। किसी ग्राहक का नाम, तारीख या सामान बताइए, मैं फिर देखता हूँ; या फॉलो-अप ड्राफ़्ट बनाने को कहिए।",
    "kn": "ಇದರ ಬಗ್ಗೆ ನಿಮ್ಮ ದಾಖಲೆಗಳಲ್ಲಿ ಏನೂ ಸಿಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ನಾನು ಊಹಿಸುವುದಿಲ್ಲ. ಗ್ರಾಹಕರ ಹೆಸರು, ದಿನಾಂಕ ಅಥವಾ ವಸ್ತು ಹೇಳಿ, ಮತ್ತೆ ನೋಡುತ್ತೇನೆ; ಅಥವಾ ಫಾಲೋ-ಅಪ್ ಡ್ರಾಫ್ಟ್ ಮಾಡಲು ಹೇಳಿ.",
    "ta": "இதைப் பற்றி உங்கள் பதிவுகளில் எதுவும் கிடைக்கவில்லை, அதனால் நான் ஊகிக்க மாட்டேன். வாடிக்கையாளர் பெயர், தேதி அல்லது பொருளைச் சொல்லுங்கள், மீண்டும் பார்க்கிறேன்; அல்லது பின்தொடர்வு வரைவு செய்யச் சொல்லுங்கள்.",
    "ml": "ഇതിനെക്കുറിച്ച് നിങ്ങളുടെ രേഖകളിൽ ഒന്നും കണ്ടില്ല, അതിനാൽ ഞാൻ ഊഹിച്ചു പറയില്ല. ഉപഭോക്താവിന്റെ പേര്, തീയതി അല്ലെങ്കിൽ ഉൽപ്പന്നം പറയൂ, ഞാൻ വീണ്ടും നോക്കാം; അല്ലെങ്കിൽ ഫോളോ-അപ്പ് ഡ്രാഫ്റ്റ് തയ്യാറാക്കാൻ പറയൂ.",
}

# job EA: a school's assistant does not discuss fees, marks, results or dues, and a child's details never go to a model. Said in place of any answer to such a turn. Not model output.
SCHOOL_REFUSAL: dict[Language, str] = {
    "en": "I do not talk about fees, marks, results or dues here, and a child's details never go to the AI. Please use the school's own screens for those.",
    "te": "ఫీజులు, మార్కులు, ఫలితాలు, బకాయిల గురించి నేను ఇక్కడ మాట్లాడను, పిల్లల వివరాలు AI కి వెళ్లవు. వాటికి స్కూల్ స్క్రీన్లనే వాడండి.",
    "hi": "मैं यहाँ फीस, अंकों, नतीजों या बकाया के बारे में बात नहीं करता, और बच्चे की जानकारी AI को नहीं जाती। इनके लिए स्कूल की अपनी स्क्रीन देखिए।",
    "kn": "ಶುಲ್ಕ, ಅಂಕ, ಫಲಿತಾಂಶ ಅಥವಾ ಬಾಕಿಯ ಬಗ್ಗೆ ನಾನು ಇಲ್ಲಿ ಮಾತನಾಡುವುದಿಲ್ಲ, ಮಕ್ಕಳ ವಿವರಗಳು AI ಗೆ ಹೋಗುವುದಿಲ್ಲ. ಅವಕ್ಕೆ ಶಾಲೆಯ ಸ್ವಂತ ಪರದೆಗಳನ್ನು ಬಳಸಿ.",
    "ta": "கட்டணம், மதிப்பெண், முடிவுகள், நிலுவை பற்றி நான் இங்கே பேசமாட்டேன்; குழந்தையின் விவரங்கள் AI க்குச் செல்லாது. அவற்றுக்கு பள்ளியின் சொந்தத் திரைகளைப் பயன்படுத்துங்கள்.",
    "ml": "ഫീസ്, മാർക്ക്, ഫലം, കുടിശ്ശിക എന്നിവയെക്കുറിച്ച് ഞാൻ ഇവിടെ സംസാരിക്കില്ല, കുട്ടിയുടെ വിവരങ്ങൾ AI ക്ക് പോകില്ല. അതിന് സ്കൂളിന്റെ സ്വന്തം സ്ക്രീനുകൾ ഉപയോഗിക്കൂ.",
}

# What the assistant says in place of an answer that named a tool, a function or an internal field (see hygiene.py). Not model output.
PLAIN_WORDS: dict[Language, str] = {
    "en": "I could not put that into clear words. Please ask me again, in other words.",
    "te": "నేను దీన్ని స్పష్టంగా చెప్పలేకపోయాను. దయచేసి వేరే మాటల్లో మళ్ళీ అడగండి.",
    "hi": "मैं इसे साफ़ शब्दों में नहीं कह पाया। कृपया दूसरे शब्दों में फिर से पूछिए।",
    "kn": "ನನಗೆ ಇದನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಹೇಳಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ಮಾತುಗಳಲ್ಲಿ ಮತ್ತೆ ಕೇಳಿ.",
    "ta": "இதை எனக்குத் தெளிவாகச் சொல்ல முடியவில்லை. தயவுசெய்து வேறு வார்த்தைகளில் மீண்டும் கேளுங்கள்.",
    "ml": "ഇത് വ്യക്തമായി പറയാൻ എനിക്ക് കഴിഞ്ഞില്ല. ദയവായി മറ്റു വാക്കുകളിൽ വീണ്ടും ചോദിക്കൂ.",
}

# job BP: said before the web pages an answer rests on (the answer's text is stored; a web page's address is what lets the owner check it later), and in place of a shop's name or address on the map,
# which Google's terms do not let us keep (the owner sees them on the cards of the answer). Not model output. A native reader of each language should check these words.
WEB_SOURCES: dict[Language, str] = {
    "en": "From the web:",
    "te": "వెబ్ నుండి:",
    "hi": "वेब से:",
    "kn": "ವೆಬ್‌ನಿಂದ:",
    "ta": "இணையத்திலிருந்து:",
    "ml": "വെബിൽ നിന്ന്:",
}
SEE_CARDS: dict[Language, str] = {
    "en": "(see the cards)",
    "te": "(కార్డులు చూడండి)",
    "hi": "(कार्ड देखें)",
    "kn": "(ಕಾರ್ಡ್‌ಗಳನ್ನು ನೋಡಿ)",
    "ta": "(அட்டைகளைப் பாருங்கள்)",
    "ml": "(കാർഡുകൾ കാണുക)",
}

# Said before the items an answer about "what is waiting for me" left out, which the code then adds from the tool's own list (see runner.py, job AO). Not model output.
WAITING_ALSO: dict[Language, str] = {
    "en": "Also waiting for you:",
    "te": "మీ కోసం ఇవి కూడా ఉన్నాయి:",
    "hi": "आपके लिए ये भी इंतज़ार कर रहे हैं:",
    "kn": "ನಿಮಗಾಗಿ ಇವು ಕೂಡ ಕಾಯುತ್ತಿವೆ:",
    "ta": "உங்களுக்காக இவையும் காத்திருக்கின்றன:",
    "ml": "നിങ്ങൾക്കായി ഇവയും കാത്തിരിക്കുന്നു:",
}
