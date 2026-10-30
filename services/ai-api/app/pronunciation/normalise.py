"""Text normalisation before speech (job pronunciation-quality, the biggest source of wrong sounds): what is WRITTEN for the screen becomes what is SAID, per language.

Numbers, money (₹1,20,000), percentages, dates, times, phone numbers and other long digit runs, units and sizes (60mm, 2000 sq ft), ranges (10-15), ordinals, abbreviations (GST, EMI, UPI), and the things that are never read aloud:
emoji, markdown marks, web addresses and e-mail addresses (a short word stands for them). English words inside a Telugu or Kannada sentence stay as they are: the engines read Latin letters in English.

Pure text in, text out: no network, no key, no clock. The captions and the chat keep the written text; only the engine hears this. The words are DRAFTS for a native reader (weekly review)."""

# ruff: noqa: E501

from __future__ import annotations

import re

from app.pronunciation import numbers

RUPEES = {"en": "rupees", "te": "రూపాయలు", "hi": "रुपये", "kn": "ರೂಪಾಯಿ", "ta": "ரூபாய்", "ml": "രൂപ"}
PERCENT = {"en": "percent", "te": "శాతం", "hi": "प्रतिशत", "kn": "ಶೇಕಡಾ", "ta": "சதவீதம்", "ml": "ശതമാനം"}
LINK = {"en": "link", "te": "లింక్", "hi": "लिंक", "kn": "ಲಿಂಕ್", "ta": "லிங்க்", "ml": "ലിങ്ക്"}
MAIL = {"en": "email", "te": "ఈమెయిల్", "hi": "ईमेल", "kn": "ಇಮೇಲ್", "ta": "மின்னஞ்சல்", "ml": "ഇമെയിൽ"}
TO = {"en": ("", "to"), "te": ("", "నుండి"), "hi": ("", "से"), "kn": ("", "ರಿಂದ"), "ta": ("", "முதல்"), "ml": ("", "മുതൽ")}
MONTHS = {
    "en": "January February March April May June July August September October November December".split(),
    "te": "జనవరి ఫిబ్రవరి మార్చి ఏప్రిల్ మే జూన్ జూలై ఆగస్టు సెప్టెంబర్ అక్టోబర్ నవంబర్ డిసెంబర్".split(),
    "hi": "जनवरी फ़रवरी मार्च अप्रैल मई जून जुलाई अगस्त सितंबर अक्तूबर नवंबर दिसंबर".split(),
    "kn": "ಜನವರಿ ಫೆಬ್ರವರಿ ಮಾರ್ಚ್ ಏಪ್ರಿಲ್ ಮೇ ಜೂನ್ ಜುಲೈ ಆಗಸ್ಟ್ ಸೆಪ್ಟೆಂಬರ್ ಅಕ್ಟೋಬರ್ ನವೆಂಬರ್ ಡಿಸೆಂಬರ್".split(),
    "ta": "ஜனவரி பிப்ரவரி மார்ச் ஏப்ரல் மே ஜூன் ஜூலை ஆகஸ்ட் செப்டம்பர் அக்டோபர் நவம்பர் டிசம்பர்".split(),
    "ml": "ജനുവരി ഫെബ്രുവരി മാർച്ച് ഏപ്രിൽ മേയ് ജൂൺ ജൂലൈ ഓഗസ്റ്റ് സെപ്റ്റംബർ ഒക്ടോബർ നവംബർ ഡിസംബർ".split(),
}
# morning, afternoon, evening, night
PERIODS = {
    "en": ("in the morning", "in the afternoon", "in the evening", "at night"),
    "te": ("ఉదయం", "మధ్యాహ్నం", "సాయంత్రం", "రాత్రి"),
    "hi": ("सुबह", "दोपहर", "शाम", "रात"),
    "kn": ("ಬೆಳಿಗ್ಗೆ", "ಮಧ್ಯಾಹ್ನ", "ಸಂಜೆ", "ರಾತ್ರಿ"),
    "ta": ("காலை", "மதியம்", "மாலை", "இரவு"),
    "ml": ("രാവിലെ", "ഉച്ചയ്ക്ക്", "വൈകുന്നേരം", "രാത്രി"),
}
# unit key -> words per language (the plural/measure word as it is said after a number)
UNITS: dict[str, dict[str, str]] = {
    "sqft": {"en": "square feet", "te": "చదరపు అడుగులు", "hi": "वर्ग फ़ुट", "kn": "ಚದರ ಅಡಿ", "ta": "சதுர அடி", "ml": "ചതുരശ്ര അടി"},
    "sqm": {"en": "square metres", "te": "చదరపు మీటర్లు", "hi": "वर्ग मीटर", "kn": "ಚದರ ಮೀಟರ್", "ta": "சதுர மீட்டர்", "ml": "ചതുരശ്ര മീറ്റർ"},
    "mm": {"en": "millimetre", "te": "మిల్లీమీటర్లు", "hi": "मिलीमीटर", "kn": "ಮಿಲಿಮೀಟರ್", "ta": "மில்லிமீட்டர்", "ml": "മില്ലിമീറ്റർ"},
    "cm": {"en": "centimetres", "te": "సెంటీమీటర్లు", "hi": "सेंटीमीटर", "kn": "ಸೆಂಟಿಮೀಟರ್", "ta": "சென்டிமீட்டர்", "ml": "സെന്റിമീറ്റർ"},
    "km": {"en": "kilometres", "te": "కిలోమీటర్లు", "hi": "किलोमीटर", "kn": "ಕಿಲೋಮೀಟರ್", "ta": "கிலோமீட்டர்", "ml": "കിലോമീറ്റർ"},
    "kg": {"en": "kilos", "te": "కిలోలు", "hi": "किलो", "kn": "ಕಿಲೋ", "ta": "கிலோ", "ml": "കിലോ"},
    "g": {"en": "grams", "te": "గ్రాములు", "hi": "ग्राम", "kn": "ಗ್ರಾಂ", "ta": "கிராம்", "ml": "ഗ്രാം"},
    "l": {"en": "litres", "te": "లీటర్లు", "hi": "लीटर", "kn": "ಲೀಟರ್", "ta": "லிட்டர்", "ml": "ലിറ്റർ"},
    "m": {"en": "metres", "te": "మీటర్లు", "hi": "मीटर", "kn": "ಮೀಟರ್", "ta": "மீட்டர்", "ml": "മീറ്റർ"},
    "ft": {"en": "feet", "te": "అడుగులు", "hi": "फ़ुट", "kn": "ಅಡಿ", "ta": "அடி", "ml": "അടി"},
    "inch": {"en": "inches", "te": "అంగుళాలు", "hi": "इंच", "kn": "ಇಂಚು", "ta": "அங்குலம்", "ml": "ഇഞ്ച്"},
}
_UNIT_SPELLINGS = {
    "sqft": r"sq\.?\s?ft|sqft|sq\.?\s?feet|ft²|square feet", "sqm": r"sq\.?\s?m|sqm|m²|square metres?", "mm": r"mm", "cm": r"cm", "km": r"km", "kg": r"kgs?|kilos?", "g": r"gms?|grams?",
    "l": r"ltrs?|litres?|liters?", "m": r"m|metres?|meters?", "ft": r"ft|feet|foot", "inch": r"inch(?:es)?|in",
}
# abbreviations said letter by letter in English letter names (the engines read Latin letters in English); a few are words
LETTERS = {"GST", "EMI", "UPI", "AC", "CBSE", "ICSE", "LKG", "UKG", "KYC", "PAN", "OTP", "ID", "PDF", "SMS", "CCTV", "TV", "GPS", "FAQ", "VIP", "ATM", "MRP", "COD", "NEFT", "RTGS", "IMPS", "SSC", "HSC", "NRI", "GSM", "LED", "UPS", "CRM"}
WORDS = {"OK": "okay", "PIN": "pin", "RERA": "rera", "WIFI": "wi-fi", "WHATSAPP": "WhatsApp"}

_EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF‍️⭐⬆⬇⤴⤵〰〽㊗㊙]+")
_MARKDOWN = re.compile(r"(\*\*|__|`+|^#{1,6}\s*|^\s*[-*•]\s+|^\s*>\s?|~~)", re.MULTILINE)
_URL = re.compile(r"(?:https?://|www\.)[^\s<>()\[\]]{1,200}", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}")
_NUM = r"\d(?:[\d,]{0,15}\d)?(?:\.\d{1,6})?"
_MONEY = re.compile(rf"(?:₹|\bRs\.?|\bINR)\s?({_NUM})(?:\s?(lakhs?|lacs?|crores?|cr|k|thousand|million))?(?:\s?/-)?|({_NUM})(?:\s?(lakhs?|lacs?|crores?|cr|k))?\s?(?:rupees?\b|rs\b)", re.IGNORECASE)
_MULT = {"lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000, "crore": 10_000_000, "crores": 10_000_000, "cr": 10_000_000, "k": 1000, "thousand": 1000, "million": 1_000_000}
_PERCENT = re.compile(rf"({_NUM})\s?%")
_DATE_NUMERIC = re.compile(r"(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?![\d/])")
_DATE_ISO = re.compile(r"(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])")
_MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
_DATE_TEXT = re.compile(rf"(?<!\d)(\d{{1,2}})(?:st|nd|rd|th)?\s(?:of\s)?({_MONTH_NAMES})\.?(?:,?\s(\d{{4}}))?\b", re.IGNORECASE)
_TIME = re.compile(r"(?<![\d:])(\d{1,2}):(\d{2})(?:\s?([ap])\.?m\.?)?(?![\d:])|(?<![\d:])(\d{1,2})\s?([ap])\.?m\.?(?![a-z])", re.IGNORECASE)
_PHONE = re.compile(r"(?<![\d])(\+91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})(?![\d])")
_LONG_DIGITS = re.compile(r"(?<![\d.,])\d{6,}(?!\d)(?![.,]\d)")
_UNIT = re.compile(rf"(?<![\w.])({_NUM})\s?(" + "|".join(f"(?P<{k}>{v})" for k, v in _UNIT_SPELLINGS.items()) + r")(?![\w²])", re.IGNORECASE)
_RANGE = re.compile(rf"(?<![\w.,/-])({_NUM})\s?[-–—]\s?({_NUM})(?![\w.,/-])")
_ORDINAL = re.compile(r"\b(\d{1,3})(st|nd|rd|th)\b", re.IGNORECASE)
_ACRONYM = re.compile(r"\b[A-Z]{2,6}\b")
_NUMBER = re.compile(rf"(?<![\w.]){_NUM}(?![\w])")
_EN_ORD = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth"}


def _en_ordinal(n: int) -> str:
    if n in _EN_ORD:
        return _EN_ORD[n]
    if n < 20:
        return numbers.words(n, "en") + "th"
    tens, unit = divmod(n, 10)
    if not unit:
        return numbers.words(n, "en").replace("y", "ieth") if numbers.words(n, "en").endswith("y") else numbers.words(n, "en") + "th"
    return f"{numbers.words(tens * 10, 'en')} {_en_ordinal(unit)}"


def _year(year: int, lang: str) -> str:
    if lang == "en" and 2010 <= year <= 2099:
        return f"{numbers.words(year // 100, 'en')} {numbers.words(year % 100, 'en')}"
    return numbers.words(year, lang)


def _amount(raw: str, mult: str | None) -> int | float:
    value = float(raw.replace(",", ""))
    if mult:
        value *= _MULT[mult.lower()]
    return int(value) if value == int(value) else value


def _say_amount(value: float, lang: str) -> str:
    if value == int(value):
        return numbers.words(int(value), lang)
    return numbers.spoken(f"{value:.2f}".rstrip("0"), lang)


def _money(m: re.Match[str], lang: str) -> str:
    raw, mult = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    return f"{_say_amount(_amount(raw, mult), lang)} {RUPEES[lang]}"


def _date(day: int, month: int, year: int | None, lang: str) -> str:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return f"{day}/{month}" + (f"/{year}" if year else "")
    if lang == "en":
        out = f"{_en_ordinal(day)} of {MONTHS['en'][month - 1]}"
    else:
        out = f"{numbers.words(day, lang)} {MONTHS[lang][month - 1]}"
    return out + (f" {_year(year, lang)}" if year else "")


def _month_number(name: str) -> int:
    return [m.lower()[:3] for m in MONTHS["en"]].index(name.lower()[:3]) + 1


def _period(hour24: int) -> int:
    return 0 if 4 <= hour24 < 12 else 1 if 12 <= hour24 < 16 else 2 if 16 <= hour24 < 20 else 3


def _time(m: re.Match[str], lang: str) -> str:
    if m.group(1) is not None:
        hour, minute, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    else:
        hour, minute, ap = int(m.group(4)), 0, m.group(5)
    if hour > 24 or minute > 59:
        return m.group(0)
    if ap:
        hour24 = hour % 12 + (12 if ap.lower() == "p" else 0)
    else:
        hour24 = hour % 24
    hour12 = hour24 % 12 or 12
    minutes = f" {'oh ' if lang == 'en' and minute < 10 else ''}{numbers.words(minute, lang)}" if minute else ""
    spoken = numbers.words(hour12, lang) + minutes
    period = PERIODS[lang][_period(hour24)]
    return f"{spoken} {period}" if lang == "en" else f"{period} {spoken}"


def _unit(m: re.Match[str], lang: str) -> str:
    key = next(k for k in UNITS if m.group(k) is not None)
    amount = _amount(m.group(1), None)
    word = UNITS[key][lang]
    if lang == "en" and amount == 1:
        word = word.removesuffix("s").replace("feet", "foot").replace("inches", "inch")
    return f"{_say_amount(amount, lang)} {word}"


def _acronym(m: re.Match[str]) -> str:
    token = m.group(0)
    if token in WORDS:
        return WORDS[token]
    return " ".join(token) if token in LETTERS else token


def normalise(text: str, language: str) -> str:
    """The text as it is to be SAID in `language` (en, te, hi, kn, ta, ml). An unknown language gets English."""
    lang = language if language in numbers.LANGS else "en"
    out = _EMOJI.sub(" ", text)
    out = _MARKDOWN.sub("", out)
    out = _URL.sub(f" {LINK[lang]} ", out)
    out = _EMAIL.sub(f" {MAIL[lang]} ", out)
    out = _MONEY.sub(lambda m: _money(m, lang), out)
    out = _PERCENT.sub(lambda m: f"{_say_amount(_amount(m.group(1), None), lang)} {PERCENT[lang]}", out)
    out = _DATE_ISO.sub(lambda m: _date(int(m.group(3)), int(m.group(2)), int(m.group(1)), lang), out)
    out = _DATE_NUMERIC.sub(lambda m: _date(int(m.group(1)), int(m.group(2)), int(m.group(3)), lang), out)
    out = _DATE_TEXT.sub(lambda m: _date(int(m.group(1)), _month_number(m.group(2)), int(m.group(3)) if m.group(3) else None, lang), out)
    out = _TIME.sub(lambda m: _time(m, lang), out)
    out = _PHONE.sub(lambda m: ("plus nine one, " if m.group(1) and lang == "en" else "") + f"{numbers.digits(m.group(2), lang)}, {numbers.digits(m.group(3), lang)}", out)
    out = _LONG_DIGITS.sub(lambda m: numbers.digits(m.group(0), lang), out)
    out = _UNIT.sub(lambda m: _unit(m, lang), out)
    out = _RANGE.sub(lambda m: f"{_say_amount(_amount(m.group(1), None), lang)} {TO[lang][1]} {_say_amount(_amount(m.group(2), None), lang)}", out)
    out = _ORDINAL.sub(lambda m: _en_ordinal(int(m.group(1))) if lang == "en" else numbers.words(int(m.group(1)), lang), out)
    out = _ACRONYM.sub(_acronym, out)
    out = _NUMBER.sub(lambda m: numbers.spoken(m.group(0), lang) if _plain_ok(m.group(0)) else m.group(0), out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def _plain_ok(raw: str) -> bool:
    return len(raw.replace(",", "").split(".")[0]) <= 15
