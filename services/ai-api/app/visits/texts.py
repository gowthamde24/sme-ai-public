"""The fixed words of the messages a visit makes (job AS, ADR 0067): a confirmation, a reminder and "we would be happy to see you" (the offer on a call request).

These are TEMPLATES, not model output: the same visit gives the same words. The money rule is not here: the outbox policy (job AT) decides what happens to the words, and a message that
mentions an amount (an advance) is held for a person by it. English is the shop's own; te, hi, kn and ta are MACHINE DRAFTS that no native reader has checked yet, so they are marked
`unchecked` and the outbox is told the words are uncertain: such a message waits for a person (reason `uncertain`) until a native reader has read the templates and the language is added to
CHECKED_LANGUAGES. Dates are written in the language's own weekday and month names; the time is 12-hour in English and 24-hour (HH:MM) elsewhere."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from app.today.service import format_rupees

IST = timezone(timedelta(hours=5, minutes=30))
Language = Literal["en", "te", "hi", "kn", "ta"]
Kind = Literal["confirmation", "reminder", "offer"]

# languages whose templates a native reader has read. Empty until the owner's family has: every non-English message waits for a person.
CHECKED_LANGUAGES: frozenset[str] = frozenset({"en"})

WEEKDAYS: dict[str, tuple[str, ...]] = {  # Monday first (datetime.weekday())
    "en": ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"),
    "te": ("సోమవారం", "మంగళవారం", "బుధవారం", "గురువారం", "శుక్రవారం", "శనివారం", "ఆదివారం"),
    "hi": ("सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"),
    "kn": ("ಸೋಮವಾರ", "ಮಂಗಳವಾರ", "ಬುಧವಾರ", "ಗುರುವಾರ", "ಶುಕ್ರವಾರ", "ಶನಿವಾರ", "ಭಾನುವಾರ"),
    "ta": ("திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி", "ஞாயிறு"),
}
MONTHS: dict[str, tuple[str, ...]] = {
    "en": ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
    "te": ("జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జూలై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"),
    "hi": ("जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"),
    "kn": ("ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"),
    "ta": ("ஜனவரி", "பிப்ரவரி", "மார்ச்", "ஏப்ரல்", "மே", "ஜூன்", "ஜூலை", "ஆகஸ்ட்", "செப்டம்பர்", "அக்டோபர்", "நவம்பர்", "டிசம்பர்"),
}  # fmt: skip

# {when} = "<weekday>, <day> <month> at <time>" in the language's order; {amount} = "₹500.00".
# The word lists of the outbox policy match Indic words as substrings, so a template can trip them by accident (Tamil "உறுதி", "confirmed", holds the word for a guarantee; the Tamil months ஜனவரி and
# பிப்ரவரி end in "வரி", tax; Kannada "ಬದಲಾದರೆ", "if it changes", holds "ದರ", rate). Those words are avoided here (Tamil dates are numbers), and tests/integration/test_visits_api.py runs every
# template, in every language and for many dates, through the database's own word check and requires that none is flagged.
TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "confirmation": "Your visit is confirmed for {when}. We look forward to seeing you at our shop. If your plans change, please let us know.",
        "reminder": "A reminder: your visit to our shop is on {when}. We look forward to seeing you.",
        "offer": "Thank you for your interest. We would be happy to welcome you at our shop. Please tell us a day and time that suits you.",
        "advance": " An advance of {amount} is requested to hold the slot.",
        "when": "{weekday}, {day} {month} at {time}",
    },
    "te": {
        "confirmation": "మీ సందర్శన {when} నిర్ధారించబడింది. మా షాపులో మిమ్మల్ని కలవడానికి ఎదురుచూస్తున్నాము. మీ ప్లాన్లు మారితే దయచేసి మాకు తెలియజేయండి.",
        "reminder": "గుర్తుచేస్తున్నాము: మీరు {when} మా షాపుకు రావాల్సి ఉంది. మిమ్మల్ని కలవడానికి ఎదురుచూస్తున్నాము.",
        "offer": "మీ ఆసక్తికి ధన్యవాదాలు. మా షాపుకు మిమ్మల్ని స్వాగతించడానికి సంతోషిస్తాము. మీకు అనుకూలమైన రోజు, సమయం మాకు చెప్పండి.",
        "advance": " స్లాట్ కోసం {amount} అడ్వాన్స్ అవసరం.",
        "when": "{weekday}, {day} {month}, సమయం {time}",
    },
    "hi": {
        "confirmation": "आपकी विज़िट {when} के लिए पक्की हो गई है। हमें अपनी दुकान पर आपका इंतज़ार रहेगा। अगर आपका कार्यक्रम बदले तो कृपया हमें बताएँ।",
        "reminder": "याद दिलाना: आपकी विज़िट {when} है। हमें आपका इंतज़ार रहेगा।",
        "offer": "आपकी रुचि के लिए धन्यवाद। हमें अपनी दुकान पर आपका स्वागत करके खुशी होगी। कृपया बताएँ कि आपके लिए कौन सा दिन और समय ठीक रहेगा।",
        "advance": " स्लॉट के लिए {amount} एडवांस चाहिए।",
        "when": "{weekday}, {day} {month}, समय {time}",
    },
    "kn": {
        "confirmation": "ನಿಮ್ಮ ಭೇಟಿ {when} ದೃಢಪಟ್ಟಿದೆ. ನಮ್ಮ ಅಂಗಡಿಯಲ್ಲಿ ನಿಮ್ಮನ್ನು ಭೇಟಿಯಾಗಲು ಕಾಯುತ್ತಿದ್ದೇವೆ. ನಿಮ್ಮ ಭೇಟಿಯಲ್ಲಿ ಬದಲಾವಣೆ ಇದ್ದಲ್ಲಿ ದಯವಿಟ್ಟು ನಮಗೆ ತಿಳಿಸಿ.",
        "reminder": "ಜ್ಞಾಪನೆ: ನಿಮ್ಮ ಭೇಟಿ {when} ಇದೆ. ನಿಮ್ಮನ್ನು ನಿರೀಕ್ಷಿಸುತ್ತಿದ್ದೇವೆ.",
        "offer": "ನಿಮ್ಮ ಆಸಕ್ತಿಗೆ ಧನ್ಯವಾದಗಳು. ನಮ್ಮ ಅಂಗಡಿಗೆ ನಿಮ್ಮನ್ನು ಸ್ವಾಗತಿಸಲು ಸಂತೋಷ. ನಿಮಗೆ ಅನುಕೂಲವಾದ ದಿನ ಮತ್ತು ಸಮಯವನ್ನು ತಿಳಿಸಿ.",
        "advance": " ಸ್ಲಾಟ್‌ಗಾಗಿ {amount} ಮುಂಗಡ ಬೇಕು.",
        "when": "{weekday}, {day} {month}, ಸಮಯ {time}",
    },
    "ta": {
        "confirmation": "உங்கள் வருகை {when} பதிவு செய்யப்பட்டுள்ளது. எங்கள் கடையில் உங்களை சந்திக்க காத்திருக்கிறோம். உங்கள் திட்டம் மாறினால் தயவுசெய்து எங்களுக்குத் தெரிவிக்கவும்.",
        "reminder": "நினைவூட்டல்: உங்கள் வருகை {when}. உங்களை எதிர்பார்க்கிறோம்.",
        "offer": "உங்கள் ஆர்வத்திற்கு நன்றி. எங்கள் கடைக்கு உங்களை வரவேற்க மகிழ்ச்சி. உங்களுக்கு வசதியான நாள் மற்றும் நேரத்தை தெரிவிக்கவும்.",
        "advance": " இடத்திற்காக {amount} முன்பணம் தேவை.",
        "when": "{weekday}, {day}-{monthnum}-{year}, நேரம் {time}",
    },
}  # fmt: skip


def is_checked(language: str) -> bool:
    return language in CHECKED_LANGUAGES


def _time(language: str, at: datetime) -> str:
    if language == "en":
        hour = at.hour % 12 or 12
        return f"{hour}:{at.minute:02d} {'am' if at.hour < 12 else 'pm'}"
    return f"{at.hour:02d}:{at.minute:02d}"


def render(
    kind: Kind, language: str, starts_at: datetime | None = None, advance_paise: int | None = None
) -> str:
    """The words. A confirmation and a reminder need the visit's start; the offer does not. An advance (confirmation only) adds the amount, which makes the outbox hold the message."""
    words = TEMPLATES[language]
    if kind == "offer":
        return words["offer"]
    if starts_at is None:
        raise ValueError("a confirmation or a reminder needs the visit's start")
    local = starts_at.astimezone(IST)
    when = words["when"].format(
        weekday=WEEKDAYS[language][local.weekday()],
        day=local.day,
        month=MONTHS[language][local.month - 1],
        monthnum=f"{local.month:02d}",
        year=local.year,
        time=_time(language, local),
    )
    text = words[kind].format(when=when)
    if kind == "confirmation" and advance_paise:
        text += words["advance"].format(amount=format_rupees(advance_paise))
    return text
