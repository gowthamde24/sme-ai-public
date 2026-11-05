"""Numbers as people SAY them, in the seven languages (job pronunciation-quality; Marathi job M1). Indian grouping (thousand, lakh, crore). Pure text in, text out: no network, no key.

English uses the words of app/conversation/pronounce.py. The other five are written out from small tables: the words 0 to 19, the tens, the hundreds, and the names of the places (thousand, lakh, crore). The lines are
DRAFTS for a native reader (the weekly review, app/pronunciation/README in the job notes); the nightly round trip (speech -> Sarvam -> text) catches the gross errors."""

# ruff: noqa: E501

from __future__ import annotations

from app.conversation.pronounce import indian_words

LANGS = ("en", "te", "hi", "kn", "ta", "ml", "mr")

_TE_UNITS = ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది", "పది", "పదకొండు", "పన్నెండు", "పదమూడు", "పద్నాలుగు", "పదిహేను", "పదహారు", "పదిహేడు", "పద్దెనిమిది", "పంతొమ్మిది"]
_TE_TENS = {2: "ఇరవై", 3: "ముప్పై", 4: "నలభై", 5: "యాభై", 6: "అరవై", 7: "డెబ్బై", 8: "ఎనభై", 9: "తొంభై"}
_KN_UNITS = ["ಸೊನ್ನೆ", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು", "ಹತ್ತು", "ಹನ್ನೊಂದು", "ಹನ್ನೆರಡು", "ಹದಿಮೂರು", "ಹದಿನಾಲ್ಕು", "ಹದಿನೈದು", "ಹದಿನಾರು", "ಹದಿನೇಳು", "ಹದಿನೆಂಟು", "ಹತ್ತೊಂಬತ್ತು"]
_KN_TENS = {2: "ಇಪ್ಪತ್ತು", 3: "ಮೂವತ್ತು", 4: "ನಲವತ್ತು", 5: "ಐವತ್ತು", 6: "ಅರವತ್ತು", 7: "ಎಪ್ಪತ್ತು", 8: "ಎಂಭತ್ತು", 9: "ತೊಂಬತ್ತು"}
_TA_UNITS = ["பூஜ்ஜியம்", "ஒன்று", "இரண்டு", "மூன்று", "நான்கு", "ஐந்து", "ஆறு", "ஏழு", "எட்டு", "ஒன்பது", "பத்து", "பதினொன்று", "பன்னிரண்டு", "பதிமூன்று", "பதினான்கு", "பதினைந்து", "பதினாறு", "பதினேழு", "பதினெட்டு", "பத்தொன்பது"]
_TA_TENS = {2: "இருபது", 3: "முப்பது", 4: "நாற்பது", 5: "ஐம்பது", 6: "அறுபது", 7: "எழுபது", 8: "எண்பது", 9: "தொண்ணூறு"}
_TA_STEM = {2: "இருபத்தி", 3: "முப்பத்தி", 4: "நாற்பத்தி", 5: "ஐம்பத்தி", 6: "அறுபத்தி", 7: "எழுபத்தி", 8: "எண்பத்தி", 9: "தொண்ணூற்றி"}
_ML_UNITS = ["പൂജ്യം", "ഒന്ന്", "രണ്ട്", "മൂന്ന്", "നാല്", "അഞ്ച്", "ആറ്", "ഏഴ്", "എട്ട്", "ഒമ്പത്", "പത്ത്", "പതിനൊന്ന്", "പന്ത്രണ്ട്", "പതിമൂന്ന്", "പതിനാല്", "പതിനഞ്ച്", "പതിനാറ്", "പതിനേഴ്", "പതിനെട്ട്", "പത്തൊമ്പത്"]
_ML_TENS = {2: "ഇരുപത്", 3: "മുപ്പത്", 4: "നാല്പത്", 5: "അമ്പത്", 6: "അറുപത്", 7: "എഴുപത്", 8: "എൺപത്", 9: "തൊണ്ണൂറ്"}
_ML_STEM = {2: "ഇരുപത്തി", 3: "മുപ്പത്തി", 4: "നാല്പത്തി", 5: "അമ്പത്തി", 6: "അറുപത്തി", 7: "എഴുപത്തി", 8: "എൺപത്തി", 9: "തൊണ്ണൂറ്റി"}
_HI = (
    "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस "
    "चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर "
    "सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे"
).split()
if len(_HI) != 100:
    raise RuntimeError("the Hindi number table must have 100 words")
# Marathi (job M1): like Hindi, every number to 99 is its own word. A DRAFT for a native reader.
_MR = (
    "शून्य एक दोन तीन चार पाच सहा सात आठ नऊ दहा अकरा बारा तेरा चौदा पंधरा सोळा सतरा अठरा एकोणीस वीस एकवीस बावीस तेवीस चोवीस पंचवीस सव्वीस सत्तावीस अठ्ठावीस एकोणतीस "
    "तीस एकतीस बत्तीस तेहेतीस चौतीस पस्तीस छत्तीस सदतीस अडतीस एकोणचाळीस चाळीस एक्केचाळीस बेचाळीस त्रेचाळीस चव्वेचाळीस पंचेचाळीस सेहेचाळीस सत्तेचाळीस अठ्ठेचाळीस एकोणपन्नास "
    "पन्नास एक्कावन्न बावन्न त्रेपन्न चोपन्न पंचावन्न छप्पन्न सत्तावन्न अठ्ठावन्न एकोणसाठ साठ एकसष्ठ बासष्ठ त्रेसष्ठ चौसष्ठ पासष्ठ सहासष्ठ सदुसष्ठ अडुसष्ठ एकोणसत्तर "
    "सत्तर एक्काहत्तर बाहत्तर त्र्याहत्तर चौऱ्याहत्तर पंच्याहत्तर शहात्तर सत्याहत्तर अठ्ठ्याहत्तर एकोणऐंशी ऐंशी एक्क्याऐंशी ब्याऐंशी त्र्याऐंशी चौऱ्याऐंशी पंच्याऐंशी शहाऐंशी सत्त्याऐंशी अठ्ठ्याऐंशी एकोणनव्वद "
    "नव्वद एक्क्याण्णव ब्याण्णव त्र्याण्णव चौऱ्याण्णव पंच्याण्णव शहाण्णव सत्त्याण्णव अठ्ठ्याण्णव नव्याण्णव"
).split()
if len(_MR) != 100:
    raise RuntimeError("the Marathi number table must have 100 words")

# the words for 100 to 900 where the language joins them into one word (Kannada, Tamil, Malayalam, Marathi); Telugu and Hindi say "<n> hundreds"
_HUNDREDS: dict[str, list[str]] = {
    "kn": ["", "ನೂರು", "ಇನ್ನೂರು", "ಮುನ್ನೂರು", "ನಾನೂರು", "ಐನೂರು", "ಆರುನೂರು", "ಏಳುನೂರು", "ಎಂಟುನೂರು", "ಒಂಬೈನೂರು"],
    "ta": ["", "நூறு", "இருநூறு", "முந்நூறு", "நானூறு", "ஐந்நூறு", "அறுநூறு", "எழுநூறு", "எண்ணூறு", "தொளாயிரம்"],
    "ml": ["", "നൂറ്", "ഇരുന്നൂറ്", "മുന്നൂറ്", "നാനൂറ്", "അഞ്ഞൂറ്", "അറുനൂറ്", "എഴുനൂറ്", "എണ്ണൂറ്", "തൊള്ളായിരം"],
    "mr": ["", "शंभर", "दोनशे", "तीनशे", "चारशे", "पाचशे", "सहाशे", "सातशे", "आठशे", "नऊशे"],   # 150 is "एकशे पन्नास" (_MR_ONE_HUNDRED_BEFORE_MORE)
}
_MR_ONE_HUNDRED_BEFORE_MORE = "एकशे"
# (word for 1, word for more than 1) of thousand, lakh, crore; hundred for the two languages that count hundreds
_PLACES: dict[str, dict[str, tuple[str, str]]] = {
    "te": {"hundred": ("వంద", "వందలు"), "thousand": ("వెయ్యి", "వేలు"), "lakh": ("లక్ష", "లక్షలు"), "crore": ("కోటి", "కోట్లు")},
    "hi": {"hundred": ("सौ", "सौ"), "thousand": ("हज़ार", "हज़ार"), "lakh": ("लाख", "लाख"), "crore": ("करोड़", "करोड़")},
    "kn": {"thousand": ("ಸಾವಿರ", "ಸಾವಿರ"), "lakh": ("ಲಕ್ಷ", "ಲಕ್ಷ"), "crore": ("ಕೋಟಿ", "ಕೋಟಿ")},
    "ta": {"thousand": ("ஆயிரம்", "ஆயிரம்"), "lakh": ("லட்சம்", "லட்சம்"), "crore": ("கோடி", "கோடி")},
    "ml": {"thousand": ("ആയിരം", "ആയിരം"), "lakh": ("ലക്ഷം", "ലക്ഷം"), "crore": ("കോടി", "കോടി")},
    "mr": {"thousand": ("हजार", "हजार"), "lakh": ("लाख", "लाख"), "crore": ("कोटी", "कोटी")},
}
_ONE_WORD = {"ta": "ஒரு", "ml": "ഒരു"}   # the "a/one" that goes before a place name
# Telugu puts the name of a place in the genitive when more of the number follows: "రెండు వేల ఆరు వందలు", "రెండు వందల యాభై"
_TE_BEFORE_MORE = {"వందలు": "వందల", "వేలు": "వేల", "లక్షలు": "లక్షల", "కోట్లు": "కోట్ల"}
POINT = {"en": "point", "te": "పాయింట్", "hi": "दशमलव", "kn": "ಪಾಯಿಂಟ್", "ta": "புள்ளி", "ml": "പോയിന്റ്", "mr": "पूर्णांक"}


def _under_100(n: int, lang: str) -> str:
    if lang == "hi":
        return _HI[n]
    if lang == "mr":
        return _MR[n]
    units = {"te": _TE_UNITS, "kn": _KN_UNITS, "ta": _TA_UNITS, "ml": _ML_UNITS}[lang]
    if n < 20:
        return units[n]
    tens, unit = divmod(n, 10)
    table = {"te": _TE_TENS, "kn": _KN_TENS, "ta": _TA_TENS, "ml": _ML_TENS}[lang]
    if not unit:
        return table[tens]
    stem = {"ta": _TA_STEM, "ml": _ML_STEM}.get(lang, table)[tens]
    return f"{stem} {units[unit]}"


def _under_1000(n: int, lang: str, more: bool = False) -> str:
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        if lang == "mr" and hundreds == 1 and rest:
            parts.append(_MR_ONE_HUNDRED_BEFORE_MORE)
        elif lang in _HUNDREDS:
            parts.append(_HUNDREDS[lang][hundreds])
        else:
            one, many = _PLACES[lang]["hundred"]
            if lang == "te" and (rest or more):
                many = _TE_BEFORE_MORE[many]
            parts.append(one if hundreds == 1 and lang == "te" else f"{_under_100(hundreds, lang)} {many}")
    if rest or not parts:
        parts.append(_under_100(rest, lang))
    return " ".join(parts)


def _place(count: int, name: str, lang: str, more: bool = False) -> str:
    one, many = _PLACES[lang][name]
    if count == 1 and lang == "te":
        return one
    if lang == "te" and more:
        many = _TE_BEFORE_MORE[many]
    if count == 1 and lang in _ONE_WORD:
        return one if name == "thousand" else f"{_ONE_WORD[lang]} {one}"   # "ஆயிரம்" but "ஒரு லட்சம்"
    return f"{words(count, lang)} {one if count == 1 else many}"


def words(n: int, lang: str) -> str:
    """12500 -> 'twelve thousand five hundred' (and the same in the other languages). Negative numbers and a fraction are not handled here (`spoken`)."""
    if lang == "en":
        return indian_words(n)
    if lang not in _PLACES:
        raise ValueError("unknown language")
    if n < 1000:
        return _under_1000(n, lang)
    parts = []
    crore, rest = divmod(n, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1000)
    placed = [(count, name) for count, name in ((crore, "crore"), (lakh, "lakh"), (thousand, "thousand")) if count]
    for i, (count, name) in enumerate(placed):
        parts.append(_place(count, name, lang, more=i < len(placed) - 1 or bool(rest)))
    if rest:
        parts.append(_under_1000(rest, lang))
    return " ".join(parts)


def digits(text: str, lang: str) -> str:
    """'98765' -> nine eight seven six five (a phone number, an OTP): one word per digit."""
    table = [words(d, lang) for d in range(10)]
    return " ".join(table[int(c)] for c in text if c.isdigit())


def spoken(raw: str, lang: str) -> str:
    """'1,20,000' -> one lakh twenty thousand; '2.5' -> two point five. Anything with a leading zero is read digit by digit (a code, not an amount)."""
    clean = raw.replace(",", "")
    if "." in clean:
        whole, frac = clean.split(".", 1)
        return f"{words(int(whole or '0'), lang)} {POINT[lang]} {digits(frac, lang)}"
    if len(clean) > 1 and clean.startswith("0"):
        return digits(clean, lang)
    return words(int(clean), lang)
