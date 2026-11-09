"""The morning stand-up, as TEXT (owner, 9 Nov 2026: the worker makes it at the business's opening time, real data only, no audio because Cartesia stays off).

Made by CODE from the day's numbers (the same `day_out` the AI team page shows, for yesterday and for today), never by a model:
  * Yesterday: the flow strip's counts (leads in, called, interested, quotes, orders; for a school enquiries, called, campus visits, admissions). Zero counts are left out.
  * Now: how many things wait for the Owner.
  * Today: the calls and follow-ups that are due (and the next time), the visits still to come (the first time).
Every number in the text is listed in `numbers` with where it came from, and every sentence names its source in `lines[].source`. No customer's name is ever used: counts and times only.
Languages: en, te, hi, kn. Telugu, Hindi and Kannada are drafts until a native reader marks them reviewed (`draft: true`). Any other language gets English."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))
LANGUAGES = ("en", "te", "hi", "kn")
DRAFT = {"te", "hi", "kn"}
BUSINESS_STEPS = ("leads_in", "called", "interested", "quotes", "orders")
SCHOOL_STEPS = ("enquiries", "called", "campus_visits", "admissions")

WORDS: dict[str, dict[str, str]] = {
    "en": {
        "stop": ".", "intro": "Yesterday: ", "quiet": "Yesterday was quiet: nothing new came in.", "waiting": "{n} things are waiting for you.", "waiting_one": "1 thing is waiting for you.",
        "nothing_waiting": "Nothing is waiting for you.", "calls_due": "{n} calls are due, the next at {time}.", "followups_due": "{n} follow-ups are due.", "first_visit": "The first visit is at {time}.",
        "visits": "{n} visits are booked, the first at {time}.", "today_empty": "Nothing is scheduled yet today.",
        "leads_in": "{n} new leads", "called": "{n} people called", "interested": "{n} interested", "quotes": "{n} quotes", "orders": "{n} orders",
        "enquiries": "{n} enquiries", "campus_visits": "{n} campus visits", "admissions": "{n} admissions",
    },
    "te": {
        "stop": ".", "intro": "నిన్న: ", "quiet": "నిన్న కొత్తగా ఏమీ రాలేదు.", "waiting": "మీ కోసం {n} విషయాలు వేచి ఉన్నాయి.", "waiting_one": "మీ కోసం 1 విషయం వేచి ఉంది.",
        "nothing_waiting": "మీ కోసం ఏమీ వేచి లేదు.", "calls_due": "{n} కాల్స్ చేయాల్సి ఉంది, తర్వాతిది {time} కి.", "followups_due": "{n} ఫాలో-అప్‌లు చేయాల్సి ఉంది.", "first_visit": "మొదటి విజిట్ {time} కి.",
        "visits": "{n} విజిట్స్ ఉన్నాయి, మొదటిది {time} కి.", "today_empty": "ఈ రోజు ఇంకా ఏమీ షెడ్యూల్ కాలేదు.",
        "leads_in": "{n} కొత్త లీడ్స్", "called": "{n} మందికి కాల్ చేశాం", "interested": "{n} మంది ఆసక్తి చూపారు", "quotes": "{n} కోట్స్", "orders": "{n} ఆర్డర్లు",
        "enquiries": "{n} ఎంక్వైరీలు", "campus_visits": "{n} క్యాంపస్ విజిట్స్", "admissions": "{n} అడ్మిషన్లు",
    },
    "hi": {
        "stop": "।", "intro": "कल: ", "quiet": "कल कुछ नया नहीं आया।", "waiting": "आपके लिए {n} चीज़ें इंतज़ार कर रही हैं।", "waiting_one": "आपके लिए 1 चीज़ इंतज़ार कर रही है।",
        "nothing_waiting": "आपके लिए कुछ इंतज़ार नहीं कर रहा।", "calls_due": "{n} कॉल करने हैं, अगला {time} बजे।", "followups_due": "{n} फ़ॉलो-अप करने हैं।", "first_visit": "पहली विज़िट {time} बजे।",
        "visits": "{n} विज़िट हैं, पहली {time} बजे।", "today_empty": "आज अभी कुछ तय नहीं है।",
        "leads_in": "{n} नए लीड", "called": "{n} लोगों को कॉल किया", "interested": "{n} लोगों ने दिलचस्पी दिखाई", "quotes": "{n} कोट", "orders": "{n} ऑर्डर",
        "enquiries": "{n} पूछताछ", "campus_visits": "{n} कैंपस विज़िट", "admissions": "{n} एडमिशन",
    },
    "kn": {
        "stop": ".", "intro": "ನಿನ್ನೆ: ", "quiet": "ನಿನ್ನೆ ಹೊಸದಾಗಿ ಏನೂ ಬರಲಿಲ್ಲ.", "waiting": "ನಿಮಗಾಗಿ {n} ವಿಷಯಗಳು ಕಾಯುತ್ತಿವೆ.", "waiting_one": "ನಿಮಗಾಗಿ 1 ವಿಷಯ ಕಾಯುತ್ತಿದೆ.",
        "nothing_waiting": "ನಿಮಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.", "calls_due": "{n} ಕಾಲ್ ಮಾಡಬೇಕಿದೆ, ಮುಂದಿನದು {time} ಕ್ಕೆ.", "followups_due": "{n} ಫಾಲೋ-ಅಪ್ ಮಾಡಬೇಕಿದೆ.", "first_visit": "ಮೊದಲ ವಿಸಿಟ್ {time} ಕ್ಕೆ.",
        "visits": "{n} ವಿಸಿಟ್ ಇದೆ, ಮೊದಲನೆಯದು {time} ಕ್ಕೆ.", "today_empty": "ಇವತ್ತು ಇನ್ನೂ ಏನೂ ನಿಗದಿಯಾಗಿಲ್ಲ.",
        "leads_in": "{n} ಹೊಸ ಲೀಡ್ಸ್", "called": "{n} ಜನರಿಗೆ ಕಾಲ್ ಮಾಡಿದ್ದೇವೆ", "interested": "{n} ಜನ ಆಸಕ್ತಿ ತೋರಿಸಿದರು", "quotes": "{n} ಕೋಟ್ಸ್", "orders": "{n} ಆರ್ಡರ್",
        "enquiries": "{n} ಎನ್‌ಕ್ವೈರಿ", "campus_visits": "{n} ಕ್ಯಾಂಪಸ್ ವಿಸಿಟ್", "admissions": "{n} ಅಡ್ಮಿಷನ್",
    },
}


def normalise(language: str | None) -> str:
    """The language a stand-up is written (and stored) in: en, te, hi or kn; anything else is English."""
    return language if language in LANGUAGES else "en"


def _clock(iso: str) -> str:
    """An ISO time as India time, HH:MM."""
    return datetime.fromisoformat(iso).astimezone(IST).strftime("%H:%M")


def _lane(day: dict[str, Any], helper: str) -> dict[str, Any]:
    return next((lane for lane in day.get("lanes") or [] if lane.get("helper") == helper), {})


def build(yesterday: dict[str, Any], today: dict[str, Any], language: str, now: datetime) -> dict[str, Any]:
    """The stand-up for `today`, from the AI team day of yesterday and of today (both as `service.day_out` gives them). `now` is an aware time."""
    lang = normalise(language)
    w, stop = WORDS[lang], WORDS[lang]["stop"]
    lines: list[dict[str, str]] = []
    numbers: list[dict[str, Any]] = []

    # ---- yesterday: the flow strip's counts, the ones above zero
    steps = {s["key"]: int(s["count"]) for s in (yesterday.get("flow") or {}).get("steps") or [] if isinstance(s, dict) and "key" in s}
    order = SCHOOL_STEPS if "enquiries" in steps else BUSINESS_STEPS
    clauses = []
    for key in order:
        if steps.get(key, 0) > 0:
            clauses.append(w[key].format(n=steps[key]))
            numbers.append({"key": f"yesterday.{key}", "value": steps[key]})
    lines.append({"text": (w["intro"] + ", ".join(clauses) + stop) if clauses else w["quiet"], "source": "yesterday.flow"})

    # ---- now: what waits for the Owner (today's orange marks)
    waiting = int(today.get("needs_owner_total") or 0)
    if waiting > 0:
        numbers.append({"key": "now.waiting", "value": waiting})
        lines.append({"text": w["waiting_one"] if waiting == 1 else w["waiting"].format(n=waiting), "source": "now.needs_owner"})
    else:
        lines.append({"text": w["nothing_waiting"], "source": "now.needs_owner"})

    # ---- today: what is due, and the visits still to come
    today_lines: list[dict[str, str]] = []
    status = (_lane(today, "caller").get("status_now") or {})
    if status.get("kind") == "due" and int(status.get("count") or 0) > 0 and status.get("at"):
        n = int(status["count"])
        numbers.append({"key": "today.calls_due", "value": n})
        today_lines.append({"text": w["calls_due"].format(n=n, time=_clock(status["at"])), "source": "today.caller_due"})
    status = (_lane(today, "followups").get("status_now") or {})
    if status.get("kind") == "due" and int(status.get("count") or 0) > 0:
        n = int(status["count"])
        numbers.append({"key": "today.followups_due", "value": n})
        today_lines.append({"text": w["followups_due"].format(n=n), "source": "today.followups_due"})
    visits = sorted(m["t"] for m in _lane(today, "caller").get("marks") or [] if m.get("kind") == "visit" and m.get("t") and datetime.fromisoformat(m["t"]) >= now)
    if visits:
        numbers.append({"key": "today.visits", "value": len(visits)})
        today_lines.append({"text": (w["first_visit"] if len(visits) == 1 else w["visits"].format(n=len(visits), time=_clock(visits[0]))).format(time=_clock(visits[0])), "source": "today.visits"})
    lines.extend(today_lines or [{"text": w["today_empty"], "source": "today.schedule"}])

    return {"language": lang, "text": " ".join(line["text"] for line in lines), "lines": lines, "numbers": numbers, "draft": lang in DRAFT}
