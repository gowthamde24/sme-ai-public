"""The words the assistant says when it books a visit for a customer in a chat (appointment booking, 14 Nov 2026). Fixed templates, like app/visits/texts.py: the same situation gives the same words, so
nothing a model wrote reaches a customer about a time or a date. They name no place and no price. English is the business's own; Telugu, Hindi and Kannada are MACHINE DRAFTS no native reader has
checked, so they are sent as uncertain and the outbox holds them for a person (texts.CHECKED_LANGUAGES says which are checked). Another language gets the English words.
{list} is one line per free time: "1) Tuesday, 3 November, 11:00 am"; {when} is one time written the same way (texts.render's own `when`)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.visits import texts

Kind = Literal["offer", "booked", "moved", "cancelled", "taken", "none", "no_visit", "have_visit"]

TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "offer": "These times are free:\n{list}\nReply with the number to book (for example 1).",
        "booked": "Done. Your visit is booked for {when}. We will confirm it by message. To change it reply RESCHEDULE, to cancel reply CANCEL.",
        "moved": "Done. Your visit is moved to {when}. We will confirm it by message.",
        "cancelled": "Your visit is cancelled. To book another time just say you would like to book.",
        "taken": "Sorry, that time was just taken. These times are free:\n{list}\nReply with the number to book.",
        "none": "Sorry, there is no free time in the next few days. Someone will message you to find a time.",
        "no_visit": "I could not find a visit to change. Say you would like to book and I will show the free times.",
        "have_visit": "You already have a visit on {when}. To change it reply RESCHEDULE, to cancel reply CANCEL.",
    },
    "te": {
        "offer": "ఈ సమయాలు ఖాళీగా ఉన్నాయి:\n{list}\nబుక్ చేయడానికి నంబర్‌తో జవాబు ఇవ్వండి (ఉదాహరణకు 1).",
        "booked": "అయింది. మీ సందర్శన {when} కి బుక్ అయింది. సందేశం ద్వారా నిర్ధారిస్తాము. మార్చడానికి RESCHEDULE, రద్దు చేయడానికి CANCEL అని జవాబు ఇవ్వండి.",
        "moved": "అయింది. మీ సందర్శన {when} కి మార్చబడింది. సందేశం ద్వారా నిర్ధారిస్తాము.",
        "cancelled": "మీ సందర్శన రద్దు అయింది. మరొక సమయం బుక్ చేయాలంటే బుక్ చేయాలని చెప్పండి.",
        "taken": "క్షమించండి, ఆ సమయం ఇప్పుడే తీసుకోబడింది. ఈ సమయాలు ఖాళీగా ఉన్నాయి:\n{list}\nబుక్ చేయడానికి నంబర్‌తో జవాబు ఇవ్వండి.",
        "none": "క్షమించండి, రాబోయే కొన్ని రోజుల్లో ఖాళీ సమయం లేదు. సమయం కుదుర్చుకోవడానికి మా వాళ్ళు మీకు సందేశం పంపుతారు.",
        "no_visit": "మార్చడానికి మీ సందర్శన కనిపించలేదు. బుక్ చేయాలని చెప్పండి, ఖాళీ సమయాలు చూపిస్తాను.",
        "have_visit": "మీకు {when} కి సందర్శన ఉంది. మార్చడానికి RESCHEDULE, రద్దు చేయడానికి CANCEL అని జవాబు ఇవ్వండి.",
    },
    "hi": {
        "offer": "ये समय खाली हैं:\n{list}\nबुक करने के लिए नंबर लिखकर जवाब दें (जैसे 1)।",
        "booked": "हो गया। आपकी विज़िट {when} के लिए बुक हो गई है। हम संदेश से पक्का करेंगे। बदलने के लिए RESCHEDULE, रद्द करने के लिए CANCEL लिखें।",
        "moved": "हो गया। आपकी विज़िट {when} पर कर दी गई है। हम संदेश से पक्का करेंगे।",
        "cancelled": "आपकी विज़िट रद्द हो गई है। दूसरा समय बुक करना हो तो बस बुक करना बताइए।",
        "taken": "माफ़ कीजिए, वह समय अभी भर गया। ये समय खाली हैं:\n{list}\nबुक करने के लिए नंबर लिखकर जवाब दें।",
        "none": "माफ़ कीजिए, अगले कुछ दिनों में कोई समय खाली नहीं है। समय तय करने के लिए कोई आपको संदेश करेगा।",
        "no_visit": "बदलने के लिए आपकी कोई विज़िट नहीं मिली। बुक करना बताइए, मैं खाली समय दिखाऊँगा।",
        "have_visit": "आपकी विज़िट {when} पर है। बदलने के लिए RESCHEDULE, रद्द करने के लिए CANCEL लिखें।",
    },
    "kn": {
        "offer": "ಈ ಸಮಯಗಳು ಖಾಲಿ ಇವೆ:\n{list}\nಬುಕ್ ಮಾಡಲು ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ (ಉದಾ. 1).",
        "booked": "ಆಯಿತು. ನಿಮ್ಮ ಭೇಟಿ {when} ಕ್ಕೆ ಬುಕ್ ಆಗಿದೆ. ಸಂದೇಶದ ಮೂಲಕ ದೃಢಪಡಿಸುತ್ತೇವೆ. ಬದಲಿಸಲು RESCHEDULE, ರದ್ದುಮಾಡಲು CANCEL ಎಂದು ಉತ್ತರಿಸಿ.",
        "moved": "ಆಯಿತು. ನಿಮ್ಮ ಭೇಟಿಯನ್ನು {when} ಕ್ಕೆ ಬದಲಿಸಲಾಗಿದೆ. ಸಂದೇಶದ ಮೂಲಕ ದೃಢಪಡಿಸುತ್ತೇವೆ.",
        "cancelled": "ನಿಮ್ಮ ಭೇಟಿ ರದ್ದಾಗಿದೆ. ಇನ್ನೊಂದು ಸಮಯ ಬುಕ್ ಮಾಡಲು ಬುಕ್ ಮಾಡಬೇಕು ಎಂದು ಹೇಳಿ.",
        "taken": "ಕ್ಷಮಿಸಿ, ಆ ಸಮಯ ಈಗಷ್ಟೇ ಆಗಿದೆ. ಈ ಸಮಯಗಳು ಖಾಲಿ ಇವೆ:\n{list}\nಬುಕ್ ಮಾಡಲು ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ.",
        "none": "ಕ್ಷಮಿಸಿ, ಮುಂದಿನ ಕೆಲವು ದಿನಗಳಲ್ಲಿ ಖಾಲಿ ಸಮಯ ಇಲ್ಲ. ಸಮಯ ನಿಗದಿಪಡಿಸಲು ಯಾರಾದರೂ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
        "no_visit": "ಬದಲಿಸಲು ನಿಮ್ಮ ಭೇಟಿ ಕಾಣಲಿಲ್ಲ. ಬುಕ್ ಮಾಡಬೇಕು ಎಂದು ಹೇಳಿ, ಖಾಲಿ ಸಮಯಗಳನ್ನು ತೋರಿಸುತ್ತೇನೆ.",
        "have_visit": "ನಿಮಗೆ {when} ಕ್ಕೆ ಭೇಟಿ ಇದೆ. ಬದಲಿಸಲು RESCHEDULE, ರದ್ದುಮಾಡಲು CANCEL ಎಂದು ಉತ್ತರಿಸಿ.",
    },
}  # fmt: skip


def language_of(language: str) -> str:
    return language if language in TEMPLATES else "en"


def is_checked(language: str) -> bool:
    return texts.is_checked(language_of(language))


def when_text(language: str, starts_at: datetime) -> str:
    """One time in the language's own order: "Tuesday, 3 November, 11:00 am" (the same words the confirmation uses)."""
    language = language if language in texts.TEMPLATES else "en"
    local = starts_at.astimezone(texts.IST)
    return texts.TEMPLATES[language]["when"].format(
        weekday=texts.WEEKDAYS[language][local.weekday()],
        day=local.day,
        month=texts.MONTHS[language][local.month - 1],
        monthnum=f"{local.month:02d}",
        year=local.year,
        time=texts._time(language, local),  # noqa: SLF001 - the same clock words as the confirmation
    )


def render(kind: Kind, language: str, *, starts_at: datetime | None = None, slots: list[datetime] | None = None) -> str:
    language = language_of(language)
    template = TEMPLATES[language][kind]
    when = when_text(language, starts_at) if starts_at is not None else ""
    lines = "\n".join(f"{n}) {when_text(language, at)}" for n, at in enumerate(slots or [], start=1))
    return template.format(when=when, list=lines)
