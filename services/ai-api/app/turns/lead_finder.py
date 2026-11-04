"""The chat's way into the Lead Finder (ADR 0119, owner 4 Nov 2026: "find new retailers/boutiques/contractors in <place>", typed or spoken, te/en/kn/hi, shows the plan card and runs the search).

  * "find new retailers in Jayanagar"  -> the router's rule 0 (app/turns/intent.py) -> `plan_turn`: the PLAN CARD (nothing is searched yet), as the event `lead_finder` and a sentence in the chat language;
  * the owner's OK                       -> the card's button (POST /lead-finder/searches/{id}/approve) or a bare "yes" / "ok" / "అవును" / "हाँ" in the chat (or by voice) -> `answer_turn`: the search runs,
                                            the RESULT CARD and a sentence of the decision split; "no" cancels it.
No model is called on either turn: what is searched and where is code (app/lead_finder/intent.py), and the sentences are fixed words below. A business type without the Lead Finder (a school) never gets
here: `available` says no and the router answers as it always did. The search has the id of the chat reply that showed it, so a later "yes", a replay and the stored chat find the card again.

The words are drafts for a native reader of each language to check (like app/turns/words.py)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from typing import Any

from app.assistant.language import Language
from app.assistant.runner import AssistantRunner, Outcome, Reply
from app.auth.deps import Runtime, TenantContext
from app.errors import ApiError
from app.lead_finder import intent as lf_intent
from app.lead_finder.errors import NotForThisBusinessError, SearchCapError
from app.lead_finder.models import ChatCardOut, PlanIn, SearchOut
from app.lead_finder.service import LeadFinderService
from app.tenancy.models import Role

logger = logging.getLogger("app.turns.lead_finder")

PLAN_FIXTURE: dict[Language, str] = {
    "en": "I can look for {query} in {area}: up to {n} made-up businesses for the demo. Nobody is called or messaged. Shall I search?",
    "te": "{area} లో {query} కోసం వెతకగలను: demo కోసం తయారు చేసిన {n} వ్యాపారాల వరకు. ఎవరికీ కాల్ లేదా మెసేజ్ చేయను. వెతకమంటారా?",
    "hi": "मैं {area} में {query} ढूँढ सकता हूँ: डेमो के लिए बनाए गए {n} तक व्यवसाय। किसी को कॉल या मैसेज नहीं होगा। ढूँढूँ?",
    "kn": "{area} ನಲ್ಲಿ {query} ಹುಡುಕಬಹುದು: ಡೆಮೊಗಾಗಿ ಮಾಡಿದ {n} ವರೆಗೆ ವ್ಯವಹಾರಗಳು. ಯಾರಿಗೂ ಕರೆ ಅಥವಾ ಮೆಸೇಜ್ ಮಾಡುವುದಿಲ್ಲ. ಹುಡುಕಲೇ?",
    "ta": "{area} பகுதியில் {query} தேடலாம்: டெமோவுக்காக உருவாக்கிய {n} வரை வணிகங்கள். யாருக்கும் அழைப்போ செய்தியோ இல்லை. தேடட்டுமா?",
    "ml": "{area}ൽ {query} തിരയാം: ഡെമോയ്ക്കായി ഉണ്ടാക്കിയ {n} വരെ ബിസിനസുകൾ. ആരെയും വിളിക്കുകയോ സന്ദേശം അയക്കുകയോ ഇല്ല. തിരയട്ടെ?",
}
PLAN_PLACES: dict[Language, str] = {
    "en": "I can look for {query} in {area} on Google Maps: up to {n} businesses, about ₹{cost} for the search. Nobody is called or messaged. Shall I search?",
    "te": "Google Maps లో {area} లో {query} కోసం వెతకగలను: {n} వ్యాపారాల వరకు, ఈ వెతుకుకి సుమారు ₹{cost}. ఎవరికీ కాల్ లేదా మెసేజ్ చేయను. వెతకమంటారా?",
    "hi": "मैं Google Maps पर {area} में {query} ढूँढ सकता हूँ: {n} तक व्यवसाय, इस खोज का लगभग ₹{cost}। किसी को कॉल या मैसेज नहीं होगा। ढूँढूँ?",
    "kn": "Google Maps ನಲ್ಲಿ {area} ನಲ್ಲಿ {query} ಹುಡುಕಬಹುದು: {n} ವರೆಗೆ ವ್ಯವಹಾರಗಳು, ಈ ಹುಡುಕಾಟಕ್ಕೆ ಸುಮಾರು ₹{cost}. ಯಾರಿಗೂ ಕರೆ ಅಥವಾ ಮೆಸೇಜ್ ಮಾಡುವುದಿಲ್ಲ. ಹುಡುಕಲೇ?",
    "ta": "Google Maps-இல் {area} பகுதியில் {query} தேடலாம்: {n} வரை வணிகங்கள், இந்தத் தேடலுக்கு சுமார் ₹{cost}. யாருக்கும் அழைப்போ செய்தியோ இல்லை. தேடட்டுமா?",
    "ml": "Google Maps-ൽ {area}ൽ {query} തിരയാം: {n} വരെ ബിസിനസുകൾ, ഈ തിരച്ചിലിന് ഏകദേശം ₹{cost}. ആരെയും വിളിക്കുകയോ സന്ദേശം അയക്കുകയോ ഇല്ല. തിരയട്ടെ?",
}
SALES_NOTE: dict[Language, str] = {
    "en": "The owner or an admin says OK.", "te": "OK అనేది owner లేదా admin చెప్పాలి.", "hi": "OK मालिक या एडमिन देंगे।", "kn": "OK ಅನ್ನು ಮಾಲೀಕರು ಅಥವಾ ಅಡ್ಮಿನ್ ಹೇಳಬೇಕು.",
    "ta": "OK-ஐ உரிமையாளர் அல்லது நிர்வாகி சொல்ல வேண்டும்.", "ml": "OK ഉടമയോ അഡ്മിനോ പറയണം.",
}
WHERE: dict[Language, str] = {
    "en": "Where should I look? Say the place, for example: find new retailers in Jayanagar.",
    "te": "ఎక్కడ వెతకాలి? ఊరు లేదా ఏరియా పేరు చెప్పండి, ఉదాహరణకు: జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి.",
    "hi": "कहाँ ढूँढूँ? जगह का नाम बताइए, जैसे: जयनगर में नए दुकानदार ढूंढो।",
    "kn": "ಎಲ್ಲಿ ಹುಡುಕಲಿ? ಸ್ಥಳದ ಹೆಸರು ಹೇಳಿ, ಉದಾಹರಣೆಗೆ: ಜಯನಗರದಲ್ಲಿ ಹೊಸ ಅಂಗಡಿಗಳನ್ನು ಹುಡುಕಿ.",
    "ta": "எங்கே தேட வேண்டும்? இடத்தின் பெயரைச் சொல்லுங்கள், உதாரணமாக: find new retailers in Jayanagar.",
    "ml": "എവിടെ തിരയണം? സ്ഥലത്തിന്റെ പേര് പറയൂ, ഉദാഹരണത്തിന്: find new retailers in Jayanagar.",
}
RESULT_HEAD: dict[Language, str] = {
    "en": "Done: I found {found} businesses in {area}.", "te": "అయిపోయింది: {area} లో {found} వ్యాపారాలు దొరికాయి.", "hi": "हो गया: {area} में {found} व्यवसाय मिले।",
    "kn": "ಆಯಿತು: {area} ನಲ್ಲಿ {found} ವ್ಯವಹಾರಗಳು ಸಿಕ್ಕವು.", "ta": "முடிந்தது: {area} பகுதியில் {found} வணிகங்கள் கிடைத்தன.", "ml": "കഴിഞ്ഞു: {area}ൽ {found} ബിസിനസുകൾ കണ്ടെത്തി.",
}
RESULT_NONE: dict[Language, str] = {
    "en": "I found no new businesses in {area}.", "te": "{area} లో కొత్త వ్యాపారాలు ఏవీ దొరకలేదు.", "hi": "{area} में कोई नया व्यवसाय नहीं मिला।",
    "kn": "{area} ನಲ್ಲಿ ಹೊಸ ವ್ಯವಹಾರಗಳು ಸಿಗಲಿಲ್ಲ.", "ta": "{area} பகுதியில் புதிய வணிகங்கள் கிடைக்கவில்லை.", "ml": "{area}ൽ പുതിയ ബിസിനസുകൾ കണ്ടെത്തിയില്ല.",
}
# one part per count that is not zero (a zero is never read out), in this order
RESULT_PARTS: dict[Language, dict[str, str]] = {
    "en": {"call_ready": "{n} ready to call", "needs_owner": "{n} need you", "researching": "{n} waiting for the calling hours", "skipped": "{n} skipped", "duplicates": "{n} you already had"},
    "te": {"call_ready": "{n} కాల్‌కి సిద్ధం", "needs_owner": "{n} మీ నిర్ణయం కోసం", "researching": "{n} కాల్ సమయం కోసం ఆగాయి", "skipped": "{n} వదిలేశాను", "duplicates": "{n} ఇప్పటికే మీ దగ్గర ఉన్నవి"},
    "hi": {"call_ready": "{n} कॉल के लिए तैयार", "needs_owner": "{n} आपके फ़ैसले के लिए", "researching": "{n} कॉल के समय का इंतज़ार", "skipped": "{n} छोड़ दिए", "duplicates": "{n} पहले से आपके पास"},
    "kn": {"call_ready": "{n} ಕರೆಗೆ ಸಿದ್ಧ", "needs_owner": "{n} ನಿಮ್ಮ ನಿರ್ಧಾರಕ್ಕೆ", "researching": "{n} ಕರೆಯ ಸಮಯಕ್ಕಾಗಿ ಕಾಯುತ್ತಿವೆ", "skipped": "{n} ಬಿಟ್ಟಿದ್ದೇನೆ", "duplicates": "{n} ಈಗಾಗಲೇ ನಿಮ್ಮ ಬಳಿ ಇವೆ"},
    "ta": {"call_ready": "{n} அழைக்கத் தயார்", "needs_owner": "{n} உங்கள் முடிவுக்காக", "researching": "{n} அழைப்பு நேரத்திற்காகக் காத்திருக்கின்றன", "skipped": "{n} விடப்பட்டன", "duplicates": "{n} ஏற்கனவே உங்களிடம் உள்ளவை"},
    "ml": {"call_ready": "{n} വിളിക്കാൻ തയ്യാർ", "needs_owner": "{n} നിങ്ങളുടെ തീരുമാനത്തിന്", "researching": "{n} വിളിക്കാനുള്ള സമയം കാത്തിരിക്കുന്നു", "skipped": "{n} ഒഴിവാക്കി", "duplicates": "{n} ഇതിനകം നിങ്ങളുടെ പക്കൽ"},
}
RESULT_TAIL: dict[Language, str] = {
    "en": "They are in Prospects; nobody was called.", "te": "అవి Prospects లో ఉన్నాయి; ఎవరికీ కాల్ చేయలేదు.", "hi": "ये Prospects में हैं; किसी को कॉल नहीं किया।",
    "kn": "ಅವು Prospects ನಲ್ಲಿವೆ; ಯಾರಿಗೂ ಕರೆ ಮಾಡಿಲ್ಲ.", "ta": "அவை Prospects-இல் உள்ளன; யாரையும் அழைக்கவில்லை.", "ml": "അവ Prospects-ൽ ഉണ്ട്; ആരെയും വിളിച്ചിട്ടില്ല.",
}
CANCELLED: dict[Language, str] = {
    "en": "OK, I cancelled the search.", "te": "సరే, వెతుకుట రద్దు చేశాను.", "hi": "ठीक है, खोज रद्द कर दी।", "kn": "ಸರಿ, ಹುಡುಕಾಟ ರದ್ದು ಮಾಡಿದೆ.", "ta": "சரி, தேடலை ரத்து செய்தேன்.", "ml": "ശരി, തിരച്ചിൽ റദ്ദാക്കി.",
}
ONLY_OWNER: dict[Language, str] = {
    "en": "Only the owner or an admin can start a search. I left the plan for them.",
    "te": "వెతుకుట మొదలుపెట్టడం owner లేదా admin మాత్రమే చేయగలరు. ప్లాన్ వారి కోసం ఉంచాను.",
    "hi": "खोज सिर्फ़ मालिक या एडमिन शुरू कर सकते हैं। योजना उनके लिए रखी है।",
    "kn": "ಹುಡುಕಾಟವನ್ನು ಮಾಲೀಕರು ಅಥವಾ ಅಡ್ಮಿನ್ ಮಾತ್ರ ಆರಂಭಿಸಬಹುದು. ಯೋಜನೆಯನ್ನು ಅವರಿಗಾಗಿ ಇಟ್ಟಿದ್ದೇನೆ.",
    "ta": "தேடலை உரிமையாளர் அல்லது நிர்வாகி மட்டுமே தொடங்க முடியும். திட்டத்தை அவர்களுக்காக வைத்துள்ளேன்.",
    "ml": "തിരച്ചിൽ ഉടമയ്ക്കോ അഡ്മിനോ മാത്രമേ തുടങ്ങാനാകൂ. പദ്ധതി അവർക്കായി വെച്ചിട്ടുണ്ട്.",
}
CAP: dict[Language, str] = {
    "en": "Today's searches are used up. Try again tomorrow.", "te": "ఈ రోజు వెతుకులు అయిపోయాయి. రేపు మళ్ళీ ప్రయత్నించండి.", "hi": "आज की खोजें पूरी हो गईं। कल फिर कोशिश करें।",
    "kn": "ಇಂದಿನ ಹುಡುಕಾಟಗಳು ಮುಗಿದಿವೆ. ನಾಳೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", "ta": "இன்றைய தேடல்கள் முடிந்துவிட்டன. நாளை மீண்டும் முயலுங்கள்.", "ml": "ഇന്നത്തെ തിരച്ചിലുകൾ കഴിഞ്ഞു. നാളെ വീണ്ടും ശ്രമിക്കൂ.",
}
FAILED: dict[Language, str] = {
    "en": "The search did not work this time. Try again in a minute.", "te": "ఈసారి వెతుకుట పని చేయలేదు. ఒక నిమిషం తర్వాత మళ్ళీ ప్రయత్నించండి.",
    "hi": "इस बार खोज नहीं हो पाई। एक मिनट बाद फिर कोशिश करें।", "kn": "ಈ ಬಾರಿ ಹುಡುಕಾಟ ಆಗಲಿಲ್ಲ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "ta": "இந்த முறை தேடல் நடக்கவில்லை. ஒரு நிமிடம் கழித்து மீண்டும் முயலுங்கள்.", "ml": "ഇത്തവണ തിരച്ചിൽ നടന്നില്ല. ഒരു മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
}
_NO = frozenset({"no", "nope", "n", "cancel", "don't", "dont", "stop", "kaadu", "vaddu", "nahi", "nahin", "illa", "beda", "వద్దు", "కాదు", "नहीं", "मत", "ಬೇಡ", "ಇಲ್ಲ", "வேண்டாம்", "വേണ്ട"})
_YES_INDIAN = ("అవును", "సరే", "చెయ్యి", "వెతుకు", "హా", "हाँ", "हां", "ठीक", "ढूँढो", "ढूंढो", "ಹೌದು", "ಸರಿ", "ಹುಡುಕಿ", "ஆம்", "சரி", "അതെ", "ശരി")
_NO_INDIAN = ("వద్దు", "కాదు", "నహీ", "नहीं", "मत", "रहने दो", "ಬೇಡ", "ಇಲ್ಲ", "வேண்டாம்", "വേണ്ട")


def card(search: SearchOut, ctx: TenantContext) -> dict[str, Any]:
    return ChatCardOut(search=search, can_approve=ctx.role in (Role.OWNER, Role.ADMIN)).model_dump(mode="json")


def available(runtime: Runtime, ctx: TenantContext) -> LeadFinderService | None:
    """The Lead Finder, when this business has it (never for a school: the module is off and there is no pack data), else None. A failure to tell is a no."""
    service = runtime.lead_finder
    if service is None:
        return None
    try:
        return service if service.availability(ctx.principal.token, ctx.tenant.id).available else None
    except Exception as exc:   # the chat answers as usual
        logger.warning("lead finder availability unknown in the chat: %s", exc.__class__.__name__)
        return None


def not_in_plan(runtime: Runtime, ctx: TenantContext) -> bool:
    """True when this business would have the Lead Finder but its plan (Lead Desk) does not (owner decision 4 Nov 2026). A failure to tell is a no."""
    service = runtime.lead_finder
    if service is None:
        return False
    try:
        return service.availability(ctx.principal.token, ctx.tenant.id).reason == "not_in_plan"
    except Exception:
        return False


UPGRADE: dict[str, str] = {
    "en": "Finding new customers is part of AI Workforce. This workspace is on Lead Desk, and everything else works as it does. The plans are on the Plans page.",
    "te": "కొత్త కస్టమర్లను వెతకడం AI Workforce లో భాగం. ఈ వర్క్‌స్పేస్ Lead Desk లో ఉంది, మిగతావన్నీ ఎప్పటిలాగే పనిచేస్తాయి. ప్లాన్లు Plans పేజీలో ఉన్నాయి.",
    "hi": "नए ग्राहक ढूँढना AI Workforce का हिस्सा है। यह वर्कस्पेस Lead Desk पर है, और बाकी सब पहले जैसा चलता है। प्लान Plans पेज पर हैं।",
    "kn": "ಹೊಸ ಗ್ರಾಹಕರನ್ನು ಹುಡುಕುವುದು AI Workforce ನ ಭಾಗ. ಈ ವರ್ಕ್‌ಸ್ಪೇಸ್ Lead Desk ನಲ್ಲಿದೆ, ಉಳಿದೆಲ್ಲವೂ ಎಂದಿನಂತೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ಪ್ಲಾನ್‌ಗಳು Plans ಪುಟದಲ್ಲಿವೆ.",
    "ta": "புதிய வாடிக்கையாளர்களைத் தேடுவது AI Workforce இன் ஒரு பகுதி. இந்த பணியிடம் Lead Desk இல் உள்ளது; மற்ற அனைத்தும் வழக்கம் போல் இயங்கும். திட்டங்கள் Plans பக்கத்தில் உள்ளன.",
    "ml": "പുതിയ ഉപഭോക്താക്കളെ കണ്ടെത്തുന്നത് AI Workforce ന്റെ ഭാഗമാണ്. ഈ വർക്ക്‌സ്‌പേസ് Lead Desk ലാണ്; ബാക്കിയെല്ലാം പതിവുപോലെ പ്രവർത്തിക്കും. പ്ലാനുകൾ Plans പേജിലുണ്ട്.",
}


def upgrade_card() -> dict[str, Any]:
    """The friendly "part of AI Workforce" card (docs/contracts/assistant-tools.md `cant_do`, reason `not_in_plan`): no price, no charge, the Plans page's link."""
    return {"kind": "cant_do", "id": str(uuid.uuid4()), "reason": "not_in_plan", "what": "Finding new customers (the Lead Finder)", "upgrade_to": "ai_workforce",
            "screen": {"label": "Plans", "href": "/plans"}}


def upgrade_turn(language: Language, runner: AssistantRunner, emit: Callable[[str, dict[str, Any]], None], reply_id: uuid.UUID) -> Outcome:
    return runner.finish_with(Reply(UPGRADE.get(language, UPGRADE["en"]), language, "answer"), reply_id, emit, extra=(("work_card", {"card": upgrade_card()}),))


def is_answer(text: str) -> bool:
    """A bare yes or no to a plan card, in any of the six languages (a short message only)."""
    from app.turns.intent import is_yes_no, normalise

    norm = normalise(text).strip(" .!?।")
    if is_yes_no(norm):
        return True
    return len(norm.split()) <= 3 and (any(w in norm for w in _YES_INDIAN) or any(w in norm for w in _NO_INDIAN))


def polarity(text: str) -> str:
    from app.turns.intent import normalise

    norm = normalise(text).strip(" .!?।")
    words = set(norm.replace(",", " ").split())
    return "no" if words & _NO or any(w in norm for w in _NO_INDIAN) else "yes"


def pending_plan(service: LeadFinderService, ctx: TenantContext, last: dict[str, Any] | None) -> SearchOut | None:
    """The plan card the last reply showed, while it still waits for the OK."""
    if last is None or not last.get("id"):
        return None
    try:
        search = service.search(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(last["id"])))
    except Exception:   # the last reply was not a plan card (the usual case)
        return None
    return search if search.state == "planned" else None


def _shown_query(service: LeadFinderService, ctx: TenantContext, search: SearchOut, language: Language) -> str:
    """The business type's own words in the chat language when the search used its default English words ("saree shops" -> "చీరల షాపులు"); otherwise what was searched."""
    try:
        data = service.data_for(ctx.principal.token, ctx.tenant.id)
    except Exception:
        return search.query
    if search.query == data.default_query.get("en"):
        return data.default_query.get(language) or search.query
    return search.query


def plan_words(service: LeadFinderService, ctx: TenantContext, search: SearchOut, language: Language) -> str:
    template = (PLAN_PLACES if search.provider == "places" else PLAN_FIXTURE)[language]
    cost = f"{search.est_cost_paise / 100:.0f}" if search.est_cost_paise % 100 == 0 else f"{search.est_cost_paise / 100:.2f}"
    text = (template.replace("{query}", _shown_query(service, ctx, search, language)).replace("{area}", search.area or "")
            .replace("{n}", str(search.max_results)).replace("{cost}", cost))
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        text = f"{text} {SALES_NOTE[language]}"
    return text


def result_words(search: SearchOut, language: Language) -> str:
    counts = search.counts or {}
    area = search.area or ""
    if search.state == "failed":
        return FAILED[language]
    if int(counts.get("new", search.found) or 0) == 0:
        dup = int(counts.get("duplicates", 0) or 0)
        none = RESULT_NONE[language].replace("{area}", area)
        return f"{none} {RESULT_PARTS[language]['duplicates'].replace('{n}', str(dup))}." if dup else none
    parts = [RESULT_PARTS[language][k].replace("{n}", str(int(counts[k]))) for k in ("call_ready", "needs_owner", "researching", "skipped", "duplicates") if int(counts.get(k, 0) or 0) > 0]
    head = RESULT_HEAD[language].replace("{found}", str(int(counts.get("new", search.found)))).replace("{area}", area)
    return f"{head} {', '.join(parts)}. {RESULT_TAIL[language]}" if parts else f"{head} {RESULT_TAIL[language]}"


def plan_turn(service: LeadFinderService, ctx: TenantContext, text: str, language: Language, runner: AssistantRunner,
              emit: Callable[[str, dict[str, Any]], None], reply_id: uuid.UUID) -> Outcome | None:
    """The plan card for the owner's words, or the question "where?" when they named no place. None = not a search after all (the router answers as usual)."""
    token, tenant = ctx.principal.token, ctx.tenant.id
    if lf_intent.area_of(text) is None:
        return runner.finish_with(Reply(WHERE[language], language, "answer"), reply_id, emit)
    emit("step", {"type": "step", "step": "working"})
    try:
        search = service.plan(token, tenant, PlanIn(text=text[:300], language=language), search_id=reply_id)
    except ApiError as exc:
        if exc.code == "not_a_search":
            return None
        logger.warning("lead finder plan refused in the chat: %s", exc.code)
        return None
    except NotForThisBusinessError:
        return None
    except Exception as exc:
        logger.warning("lead finder plan failed in the chat: %s", exc.__class__.__name__)
        return runner.finish_with(Reply(FAILED[language], language, "answer"), reply_id, emit)
    logger.info("assistant turn: lead finder plan provider=%s language=%s", search.provider, language)
    return runner.finish_with(Reply(plan_words(service, ctx, search, language), language, "answer"), reply_id, emit, extra=(("lead_finder", card(search, ctx)),))


def answer_turn(service: LeadFinderService, ctx: TenantContext, search: SearchOut, text: str, language: Language, runner: AssistantRunner,
                emit: Callable[[str, dict[str, Any]], None], reply_id: uuid.UUID) -> Outcome:
    """The owner's yes or no to the plan card the last reply showed. Yes runs the search exactly as the card's OK does (Owner or Admin); no cancels it."""
    token, tenant = ctx.principal.token, ctx.tenant.id
    decision = polarity(text)
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        return runner.finish_with(Reply(ONLY_OWNER[language], language, "answer"), reply_id, emit, extra=(("lead_finder", card(search, ctx)),))
    emit("step", {"type": "step", "step": "working"})
    try:
        out = service.cancel(token, tenant, search.id) if decision == "no" else service.approve(token, tenant, search.id)
    except SearchCapError:
        return runner.finish_with(Reply(CAP[language], language, "answer"), reply_id, emit, extra=(("lead_finder", card(search, ctx)),))
    except Exception as exc:
        logger.warning("lead finder %s failed in the chat: %s", decision, getattr(exc, "code", exc.__class__.__name__))
        return runner.finish_with(Reply(FAILED[language], language, "answer"), reply_id, emit)
    logger.info("assistant turn: lead finder %s -> %s", decision, out.state)
    words = CANCELLED[language] if out.state == "cancelled" else result_words(out, language)
    return runner.finish_with(Reply(words, language, "answer"), reply_id, emit, extra=(("lead_finder", card(out, ctx)),))


def cards_for(runtime: Runtime, ctx: TenantContext, message_ids: list[str]) -> dict[str, dict[str, Any]]:
    """The cards of a stored chat, by reply id (one read of the latest searches; a business without the Lead Finder: none)."""
    service = available(runtime, ctx) if message_ids else None
    if service is None:
        return {}
    try:
        rows = service.searches(ctx.principal.token, ctx.tenant.id, 100).items
    except Exception as exc:
        logger.warning("lead finder cards of a chat could not be read: %s", exc.__class__.__name__)
        return {}
    wanted = set(message_ids)
    return {str(s.id): card(s, ctx) for s in rows if str(s.id) in wanted}


__all__ = ["answer_turn", "available", "cards_for", "is_answer", "pending_plan", "plan_turn", "polarity", "result_words"]
