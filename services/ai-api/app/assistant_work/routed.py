"""A routed request -> the plan card (job assistant-does-the-work design 2). The step is the screen's own route with the person's token; the card's words are made here by code from the state before
(read through the same routes) and the change. Undo is the route's own (a settings snapshot, pause <-> resume, an import's undo); the routes keep their role and second-factor rules."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging
import uuid
from datetime import timedelta
from typing import Any

from app.assistant.language import Language
from app.assistant_tools import executor
from app.assistant_work import setups
from app.assistant_work.router import Routed
from app.assistant_work.service import FileTurn, PlanRunner, Tools, cant_do, card_of_plan
from app.assistant_work.store import WorkStore

logger = logging.getLogger("app.assistant_work.routed")

_NS = uuid.UUID("2f1d6a8e-61b5-4c1e-9b8f-9d2c4e7a1b30")
SCREENS = {
    "billing": {"label": "Plans", "href": "/plans"},
    "delete_workspace": {"label": "Settings -> Data", "href": "/settings/data"},
    "real_data_gate": {"label": "Settings -> Data", "href": "/settings/data"},
    "erase_person": {"label": "Privacy", "href": "/privacy"},
}
SCREEN_WHAT = {
    "billing": {"en": "changing your plan or payments", "te": "మీ ప్లాన్ లేదా చెల్లింపులు మార్చడం", "hi": "आपका प्लान या भुगतान बदलना", "kn": "ನಿಮ್ಮ ಪ್ಲಾನ್ ಅಥವಾ ಪಾವತಿಗಳನ್ನು ಬದಲಿಸುವುದು"},
    "delete_workspace": {"en": "deleting the workspace", "te": "వర్క్‌స్పేస్‌ను తొలగించడం", "hi": "वर्कस्पेस मिटाना", "kn": "ವರ್ಕ್‌ಸ್ಪೇಸ್ ಅಳಿಸುವುದು"},
    "real_data_gate": {"en": "switching real customer data on", "te": "నిజమైన కస్టమర్ డేటాను ఆన్ చేయడం", "hi": "असली ग्राहक डेटा चालू करना", "kn": "ನಿಜವಾದ ಗ್ರಾಹಕ ಡೇಟಾವನ್ನು ಆನ್ ಮಾಡುವುದು"},
    "erase_person": {"en": "erasing a person's data", "te": "ఒక వ్యక్తి డేటాను పూర్తిగా తొలగించడం", "hi": "किसी व्यक्ति का डेटा मिटाना", "kn": "ಒಬ್ಬ ವ್ಯಕ್ತಿಯ ಡೇಟಾ ಅಳಿಸುವುದು"},
}
WORDS: dict[str, dict[str, str]] = {
    "offer": {
        "en": "Here is the change: {summary}. Shall I make it? Check it on the card.",
        "te": "మార్పు ఇది: {summary}. చేయమంటారా? కార్డులో ఒకసారి చూడండి.",
        "hi": "बदलाव यह है: {summary}। कर दूँ? कार्ड पर एक बार देख लें।",
        "kn": "ಬದಲಾವಣೆ ಇದು: {summary}. ಮಾಡಲೇ? ಕಾರ್ಡ್‌ನಲ್ಲಿ ಒಮ್ಮೆ ನೋಡಿ.",
    },
    "no_rule": {
        "en": "You have no standing rule for {source} yet, so there is no first-call time to change. Make the rule in Leads -> Rules, then tell me the minutes.",
        "te": "{source} కి ఇంకా రూల్ లేదు, కాబట్టి మార్చడానికి మొదటి కాల్ సమయం లేదు. Leads -> Rules లో రూల్ చేయండి, తర్వాత నిమిషాలు చెప్పండి.",
        "hi": "{source} के लिए अभी कोई नियम नहीं है, इसलिए बदलने को पहली कॉल का समय नहीं है। Leads -> Rules में नियम बनाइए, फिर मिनट बताइए।",
        "kn": "{source} ಗೆ ಇನ್ನೂ ನಿಯಮ ಇಲ್ಲ, ಹಾಗಾಗಿ ಬದಲಿಸಲು ಮೊದಲ ಕರೆಯ ಸಮಯ ಇಲ್ಲ. Leads -> Rules ನಲ್ಲಿ ನಿಯಮ ಮಾಡಿ, ನಂತರ ನಿಮಿಷಗಳನ್ನು ಹೇಳಿ.",
    },
    "same": {
        "en": "That is already so: {summary}. Nothing to change.",
        "te": "అది ఇప్పటికే అలానే ఉంది: {summary}. మార్చడానికి ఏమీ లేదు.",
        "hi": "यह पहले से ऐसा ही है: {summary}। बदलने को कुछ नहीं है।",
        "kn": "ಅದು ಈಗಾಗಲೇ ಹಾಗೆಯೇ ಇದೆ: {summary}. ಬದಲಿಸಲು ಏನೂ ಇಲ್ಲ.",
    },
    "screen_only": {
        "en": "Only a person can do that, on its screen: {what}. I've put the link on the card.",
        "te": "అది ఒక వ్యక్తి మాత్రమే, దాని స్క్రీన్‌లో చేయగలరు: {what}. లింక్ కార్డులో పెట్టాను.",
        "hi": "यह सिर्फ़ कोई व्यक्ति, उसकी स्क्रीन पर कर सकता है: {what}। लिंक कार्ड पर है।",
        "kn": "ಅದನ್ನು ಒಬ್ಬ ವ್ಯಕ್ತಿ ಮಾತ್ರ, ಅದರ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಮಾಡಬಹುದು: {what}. ಲಿಂಕ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಇಟ್ಟಿದ್ದೇನೆ.",
    },
    "clarify": {
        "en": "Tell me a little more, please: what exactly should I change?",
        "te": "దయచేసి ఇంకొంచెం చెప్పండి: సరిగ్గా ఏమి మార్చాలి?",
        "hi": "थोड़ा और बताइए: ठीक-ठीक क्या बदलना है?",
        "kn": "ದಯವಿಟ್ಟು ಇನ್ನೂ ಸ್ವಲ್ಪ ಹೇಳಿ: ನಿಖರವಾಗಿ ಏನು ಬದಲಿಸಬೇಕು?",
    },
    "no_source": {
        "en": "I couldn't find a lead source called '{source}'. Your sources: {names}.",
        "te": "'{source}' అనే లీడ్ సోర్స్ కనిపించలేదు. మీ సోర్స్‌లు: {names}.",
        "hi": "'{source}' नाम का लीड सोर्स नहीं मिला। आपके सोर्स: {names}।",
        "kn": "'{source}' ಎಂಬ ಲೀಡ್ ಸೋರ್ಸ್ ಸಿಗಲಿಲ್ಲ. ನಿಮ್ಮ ಸೋರ್ಸ್‌ಗಳು: {names}.",
    },
    "no_example": {
        "en": "There is no example data in this workspace.",
        "te": "ఈ వర్క్‌స్పేస్‌లో ఉదాహరణ డేటా ఏదీ లేదు.",
        "hi": "इस वर्कस्पेस में कोई उदाहरण डेटा नहीं है।",
        "kn": "ಈ ವರ್ಕ್‌ಸ್ಪೇಸ್‌ನಲ್ಲಿ ಉದಾಹರಣೆ ಡೇಟಾ ಇಲ್ಲ.",
    },
    "key_card": {
        "en": "Paste your IndiaMART CRM key on the card below. It goes straight to a locked store: it is never in this chat, never shown again (only its last four), and nobody is messaged.",
        "te": "మీ IndiaMART CRM కీని కింది కార్డులో పేస్ట్ చేయండి. అది నేరుగా లాక్ చేసిన స్టోర్‌కు వెళ్తుంది: ఈ చాట్‌లో ఉండదు, మళ్ళీ చూపించను (చివరి నాలుగు అక్షరాలు మాత్రమే), ఎవరికీ మెసేజ్ వెళ్ళదు.",
        "hi": "अपनी IndiaMART CRM key नीचे के कार्ड में पेस्ट करें। यह सीधे एक बंद स्टोर में जाती है: इस चैट में नहीं आती, दोबारा नहीं दिखती (सिर्फ़ आख़िरी चार अक्षर), और किसी को मैसेज नहीं जाता।",
        "kn": "ನಿಮ್ಮ IndiaMART CRM ಕೀಯನ್ನು ಕೆಳಗಿನ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಪೇಸ್ಟ್ ಮಾಡಿ. ಅದು ನೇರವಾಗಿ ಲಾಕ್ ಮಾಡಿದ ಸ್ಟೋರ್‌ಗೆ ಹೋಗುತ್ತದೆ: ಈ ಚಾಟ್‌ನಲ್ಲಿ ಇರುವುದಿಲ್ಲ, ಮತ್ತೆ ತೋರಿಸುವುದಿಲ್ಲ (ಕೊನೆಯ ನಾಲ್ಕು ಅಕ್ಷರ ಮಾತ್ರ), ಯಾರಿಗೂ ಮೆಸೇಜ್ ಹೋಗುವುದಿಲ್ಲ.",
    },
    "key_owner_only": {
        "en": "Only the owner can add the business's IndiaMART key.",
        "te": "వ్యాపారం IndiaMART కీని యజమాని మాత్రమే చేర్చగలరు.",
        "hi": "बिज़नेस की IndiaMART key सिर्फ़ मालिक जोड़ सकते हैं।",
        "kn": "ವ್ಯಾಪಾರದ IndiaMART ಕೀಯನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ ಸೇರಿಸಬಹುದು.",
    },
    "key_not_yet": {
        "en": "I can't take your own IndiaMART key here yet. Lead sources shows how IndiaMART leads come in now.",
        "te": "మీ సొంత IndiaMART కీని ఇక్కడ ఇంకా తీసుకోలేను. IndiaMART లీడ్స్ ఇప్పుడు ఎలా వస్తాయో లీడ్ సోర్స్‌లలో చూడవచ్చు.",
        "hi": "आपकी अपनी IndiaMART key मैं यहाँ अभी नहीं ले सकती। IndiaMART लीड अभी कैसे आती हैं, यह लीड सोर्स में दिखता है।",
        "kn": "ನಿಮ್ಮ ಸ್ವಂತ IndiaMART ಕೀಯನ್ನು ಇಲ್ಲಿ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳಲಾರೆ. IndiaMART ಲೀಡ್‌ಗಳು ಈಗ ಹೇಗೆ ಬರುತ್ತವೆ ಎಂದು ಲೀಡ್ ಸೋರ್ಸ್‌ಗಳಲ್ಲಿ ನೋಡಬಹುದು.",
    },
    "setup": {
        "en": "Here are the steps for this, on the card. I set up what I can; the rest is a few taps on your side.",
        "te": "దీనికి స్టెప్స్ కార్డులో ఉన్నాయి. నేను చేయగలిగింది చేశాను; మిగతాది మీ వైపు కొన్ని ట్యాప్‌లు మాత్రమే.",
        "hi": "इसके स्टेप कार्ड पर हैं। जो मैं कर सकती थी, कर दिया; बाकी आपकी तरफ़ बस कुछ टैप हैं।",
        "kn": "ಇದಕ್ಕೆ ಹಂತಗಳು ಕಾರ್ಡ್‌ನಲ್ಲಿವೆ. ನಾನು ಮಾಡಬಹುದಾದ್ದನ್ನು ಮಾಡಿದ್ದೇನೆ; ಉಳಿದದ್ದು ನಿಮ್ಮ ಕಡೆ ಕೆಲವು ಟ್ಯಾಪ್‌ಗಳು ಮಾತ್ರ.",
    },
    "setup_screen": {
        "en": "That is done on its screen; the steps and the link are on the card.",
        "te": "అది దాని స్క్రీన్‌లో చేయాలి; స్టెప్స్, లింక్ కార్డులో ఉన్నాయి.",
        "hi": "यह उसकी स्क्रीन पर होता है; स्टेप और लिंक कार्ड पर हैं।",
        "kn": "ಅದು ಅದರ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಆಗುತ್ತದೆ; ಹಂತಗಳು ಮತ್ತು ಲಿಂಕ್ ಕಾರ್ಡ್‌ನಲ್ಲಿವೆ.",
    },
    "setup_manager_only": {
        "en": "Only the owner or an admin can set that up.",
        "te": "దాన్ని యజమాని లేదా అడ్మిన్ మాత్రమే సెటప్ చేయగలరు.",
        "hi": "इसे सिर्फ़ मालिक या एडमिन सेट कर सकते हैं।",
        "kn": "ಅದನ್ನು ಮಾಲೀಕರು ಅಥವಾ ಅಡ್ಮಿನ್ ಮಾತ್ರ ಹೊಂದಿಸಬಹುದು.",
    },
    "no_record": {"en": "I could not find {name} in your records. Tell me who you mean (the number helps), or add them first.", "te": "{name} మీ రికార్డ్స్‌లో కనబడలేదు. ఎవరో చెప్పండి (నంబర్ ఉంటే మంచిది), లేదా ముందు చేర్చండి.", "hi": "{name} आपके रिकॉर्ड में नहीं मिला। बताइए किसकी बात है (नंबर हो तो अच्छा), या पहले जोड़ दीजिए।", "kn": "{name} ನಿಮ್ಮ ರೆಕಾರ್ಡ್‌ನಲ್ಲಿ ಸಿಗಲಿಲ್ಲ. ಯಾರೆಂದು ಹೇಳಿ (ನಂಬರ್ ಇದ್ದರೆ ಒಳ್ಳೆಯದು), ಅಥವಾ ಮೊದಲು ಸೇರಿಸಿ."},
    "no_visit": {"en": "{name} has no open visit to change.", "te": "{name} కి మార్చడానికి ఓపెన్ విజిట్ ఏదీ లేదు.", "hi": "{name} की कोई खुली विज़िट नहीं है।", "kn": "{name} ಅವರಿಗೆ ಬದಲಿಸಲು ತೆರೆದ ಭೇಟಿ ಇಲ್ಲ."},
    "which": {"en": "Which {name}? {options}", "te": "ఏ {name}? {options}", "hi": "कौन से {name}? {options}", "kn": "ಯಾವ {name}? {options}"},
    "done_it": {"en": "Done: {summary}. Tap Undo to put it back.", "te": "అయింది: {summary}. వెనక్కి తీసుకోవాలంటే Undo నొక్కండి.", "hi": "हो गया: {summary}। वापस करना हो तो Undo दबाइए।", "kn": "ಆಯಿತು: {summary}. ಹಿಂದಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳಲು Undo ಒತ್ತಿ."},
    "not_done": {"en": "It did not go through ({summary}). {why}", "te": "అది జరగలేదు ({summary}). {why}", "hi": "यह नहीं हो पाया ({summary})। {why}", "kn": "ಅದು ಆಗಲಿಲ್ಲ ({summary}). {why}"},
    "client_done": {"en": "Done.", "te": "సరే, చేశాను.", "hi": "हो गया।", "kn": "ಆಯಿತು."},
    "period_dropped": {"en": "Showing these leads; the date part is not available yet, so it shows all of them.", "te": "ఈ లీడ్స్ చూపిస్తున్నాను; తేదీ ఫిల్టర్ ఇంకా లేదు, అందుకే అన్నీ కనిపిస్తాయి.",
                       "hi": "ये लीड दिखा रहा हूँ; तारीख का फ़िल्टर अभी नहीं है, इसलिए सभी दिखेंगे।", "kn": "ಈ ಲೀಡ್‌ಗಳನ್ನು ತೋರಿಸುತ್ತಿದ್ದೇನೆ; ದಿನಾಂಕ ಫಿಲ್ಟರ್ ಇನ್ನೂ ಇಲ್ಲ, ಹಾಗಾಗಿ ಎಲ್ಲವೂ ಕಾಣುತ್ತವೆ."},
    "unavailable": {
        "en": "I can't change that from the chat right now. The screen can.",
        "te": "అది ఇప్పుడు చాట్ నుండి మార్చలేను. స్క్రీన్‌లో మార్చవచ్చు.",
        "hi": "यह अभी चैट से नहीं बदल सकती। स्क्रीन पर बदल सकते हैं।",
        "kn": "ಅದನ್ನು ಈಗ ಚಾಟ್‌ನಿಂದ ಬದಲಿಸಲಾರೆ. ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಬದಲಿಸಬಹುದು.",
    },
}
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


WHY: dict[str, dict[str, str]] = {   # why a routed step failed, by the error word the route gave
    "conflict": {"en": "That time is taken, or this person already has a visit then.", "te": "ఆ టైమ్ ఖాళీగా లేదు, లేదా వాళ్ళకి అప్పటికే విజిట్ ఉంది.", "hi": "वह समय भरा हुआ है, या उनकी उस समय पहले से विज़िट है।", "kn": "ಆ ಸಮಯ ಖಾಲಿ ಇಲ್ಲ, ಅಥವಾ ಅವರಿಗೆ ಆಗಲೇ ವಿಸಿಟ್ ಇದೆ."},
    "not_found": {"en": "It could not be found any more.", "te": "ఇది ఇప్పుడు కనిపించలేదు.", "hi": "यह अब नहीं मिला।", "kn": "ಇದು ಈಗ ಸಿಗಲಿಲ್ಲ."},
    "forbidden": {"en": "Only the Owner or an Admin can do this.", "te": "ఇది Owner లేదా Admin మాత్రమే చేయగలరు.", "hi": "यह सिर्फ़ Owner या Admin कर सकते हैं।", "kn": "ಇದನ್ನು Owner ಅಥವಾ Admin ಮಾತ್ರ ಮಾಡಬಹುದು."},
    "limit": {"en": "A limit was reached. Try again later.", "te": "ఒక లిమిట్ దాటింది. కొంచెం తర్వాత ప్రయత్నించండి.", "hi": "एक सीमा पूरी हो गई। थोड़ी देर बाद कोशिश कीजिए।", "kn": "ಒಂದು ಮಿತಿ ಮುಟ್ಟಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ."},
    "invalid": {"en": "The details were not accepted. The screen shows which.", "te": "వివరాలు ఒప్పుకోలేదు. ఏవో స్క్రీన్‌లో కనిపిస్తుంది.", "hi": "जानकारी स्वीकार नहीं हुई। स्क्रीन पर दिखेगा कौन सी।", "kn": "ವಿವರಗಳು ಒಪ್ಪಿಗೆಯಾಗಲಿಲ್ಲ. ಯಾವುದು ಎಂದು ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಕಾಣುತ್ತದೆ."},
    "down": {"en": "The service did not answer. Nothing was changed.", "te": "సర్వీస్ స్పందించలేదు. ఏమీ మారలేదు.", "hi": "सेवा ने जवाब नहीं दिया। कुछ नहीं बदला।", "kn": "ಸೇವೆ ಉತ್ತರಿಸಲಿಲ್ಲ. ಏನೂ ಬದಲಾಗಲಿಲ್ಲ."},
}


def w(key: str, language: Language, **kw: Any) -> str:
    return WORDS[key].get(language, WORDS[key]["en"]).format(**kw)


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def hours_words(hours: dict[str, Any] | None) -> str:
    if not hours:
        return "the assistant's own hours"
    days = sorted(int(d) for d in hours.get("days") or [])
    span = f"{DAY_NAMES[days[0] - 1]}-{DAY_NAMES[days[-1] - 1]}" if days and days == list(range(days[0], days[-1] + 1)) else ", ".join(DAY_NAMES[d - 1] for d in days)
    return f"{span} {hhmm(int(hours['from_minute']))}-{hhmm(int(hours['to_minute']))}"


class RouteTurn:
    """What the assistant answers for a routed request: (the sentence, the card)."""

    def __init__(self, store: WorkStore, tools: Tools, lead_sources: Any, secrets: Any = None) -> None:
        self.store, self.tools, self.lead_sources, self.secrets = store, tools, lead_sources, secrets

    def _read(self, tenant_id: uuid.UUID, token: str, tool: str, message_id: uuid.UUID) -> Any | None:
        got = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=tool), message_id))
        return got.answer if got.ok else None

    def _plan(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, conversation_id: uuid.UUID | None, title: str, step: dict[str, Any] | list[dict[str, Any]], *, sensitive: str | None = None,
              owner_only: bool = False, second_factor: bool = False) -> dict[str, Any]:
        plan_id = uuid.uuid4()
        return self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": None, "title": title[:200],
            "file_name": None, "sensitive": sensitive, "owner_only": owner_only, "needs_second_factor": second_factor, "card": {"kind": "plan", "destination": "settings"},
            "steps": [{"status": "proposed", "error": None, **x} for x in ([step] if isinstance(step, dict) else step)],
        })

    def answer(self, token: str, tenant_id: uuid.UUID, routed: Routed, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language,
               manager: bool = True) -> tuple[str, dict[str, Any] | None]:
        if routed.decision == "clarify":
            return routed.question or w("clarify", language), None
        if routed.decision == "cant_do":
            screen = routed.screen if routed.screen in SCREENS else "billing"
            what = SCREEN_WHAT[screen].get(language, SCREEN_WHAT[screen]["en"])
            return w("screen_only", language, what=what), cant_do("screen_only", what, SCREENS[screen])
        a = routed.action
        if a == "calling_hours":
            return self._calling_hours(token, tenant_id, routed.args, message_id, conversation_id, language)
        if a == "auto_reply":
            return self._auto_reply(token, tenant_id, bool(routed.args["on"]), message_id, conversation_id, language)
        if a in ("pause_source", "resume_source"):
            return self._source(token, tenant_id, a, str(routed.args["source"]), message_id, conversation_id, language)
        if a == "add_lead":
            return self._add_lead(token, tenant_id, routed.args, message_id, conversation_id, language)
        if a == "remove_example_data":
            return self._example(token, tenant_id, message_id, conversation_id, language)
        if a == "source_key":
            return self._source_key(token, tenant_id, message_id, language)
        if a == "setup":
            return self._setup(token, tenant_id, str(routed.args.get("setup") or ""), language, manager=manager)
        if a == "record":
            return self._record(token, tenant_id, str(routed.args["record_action"]), routed.args, message_id, conversation_id, language, manager=manager)
        if a == "client":
            from app.assistant_work import client_actions as ca

            if routed.args["client_action"] == "open_record":
                return self._open_record(token, tenant_id, dict(routed.args["client_args"]), message_id, language)
            if routed.args.get("note") == "period_dropped":
                said = w("period_dropped", language)
                return said, ca.card(str(routed.args["client_action"]), dict(routed.args["client_args"]), said)
            return w("client_done", language), ca.card(str(routed.args["client_action"]), dict(routed.args["client_args"]))
        if a == "setting":
            return self._setting(token, tenant_id, str(routed.args["setting"]), dict(routed.args["changes"]), message_id, conversation_id, language)
        return w("clarify", language), None

    def _setting(self, token: str, tenant_id: uuid.UUID, name: str, changes: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """One saved setting from the table in settings_actions.py: read what is saved through the screen's own route, send only what the owner changed (a PUT keeps the rest), show old -> new, Undo puts it back."""
        from app.assistant_work import settings_actions as sa

        spec = sa.SETTINGS[name]
        if name == "call_speed":
            return self._call_speed(token, tenant_id, changes, message_id, conversation_id, language)
        current = sa.current_of(spec, self._read(tenant_id, token, spec.get, message_id))
        if current is None:
            return w("unavailable", language), None
        current, changes = sa.prepare(name, current, changes)
        if all(current.get(k) == v for k, v in changes.items()):
            return w("same", language, summary=sa.summary(spec, current, changes).split(": ", 1)[-1]), None
        text = sa.summary(spec, current, changes)
        plan = self._plan(token, tenant_id, message_id, conversation_id, text, {"tool": spec.put, "summary": text, "undoable": True, "call": {"path": {}, "body": sa.body_for(spec, current, changes)}},
                          sensitive=spec.sensitive, owner_only=True, second_factor=spec.second_factor)
        return w("offer", language, summary=text), card_of_plan(plan)

    def _call_speed(self, token: str, tenant_id: uuid.UUID, changes: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """"Call new leads from Meta within 5 minutes": the minutes until the first call are a field of the standing rule of each source (`within_minutes`), so the EXISTING rule is saved again with the new number
        (a plan card, the Owner's second factor). A source named = that source's rule; none named ("new leads") = every active call rule, one step each. No rule for the source = it says so: a standing
        rule that starts calling people is made on its screen, never from a number in a sentence."""
        from app.assistant_work import settings_actions as sa

        minutes = changes.get("within_minutes")
        if not isinstance(minutes, int):
            return w("same", language, summary="the first call has no minutes yet"), None
        listed = self._read(tenant_id, token, "outreach.list_rules", message_id)
        raw = listed.get("items") if isinstance(listed, dict) else listed
        rules = [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else None
        if rules is None:
            return w("unavailable", language), None
        asked = str(changes.get("source") or "").strip()
        if asked:
            tag = sa.source_tag(asked)
            chosen = [r for r in rules if tag and r.get("source") == tag]
            if not chosen:
                return w("no_rule", language, source=asked), None
        else:
            chosen = [r for r in rules if r.get("active") and r.get("action") == "call_within_minutes"]
            if not chosen:
                return w("no_rule", language, source="new leads"), None
        steps, parts = [], []
        for r in chosen:
            old = int(r.get("within_minutes") or 0)
            if old == minutes:
                continue
            body = {k: r.get(k) for k in ("source", "action", "goal", "channel", "language", "questions", "wa_first_template", "wa_missed_template", "max_calls_per_day", "max_total_minutes")}
            body["rule_id"] = str(r["id"])
            body["within_minutes"] = minutes
            body["questions"] = r.get("questions") or []
            label = {v: k for k, v in reversed(sa.SOURCE_WORDS)}.get(str(r.get("source")), str(r.get("source"))).title()
            part = f"{label}: first call within {old} -> {minutes} minutes"
            parts.append(part)
            steps.append({"tool": "outreach.save_rule", "summary": part, "undoable": False, "call": {"path": {}, "body": body}})
        if not steps:
            return w("same", language, summary=f"the first call is already within {minutes} minutes"), None
        text = "First call to new leads: " + "; ".join(parts)
        plan = self._plan(token, tenant_id, message_id, conversation_id, text, steps, sensitive="sending", owner_only=True, second_factor=True)
        return w("offer", language, summary=text), card_of_plan(plan)

    # ---- one named record (record_actions.py): find it through the screen's own read route, never guess
    def _read_q(self, tenant_id: uuid.UUID, token: str, tool: str, message_id: uuid.UUID, query: dict[str, str]) -> Any | None:
        got = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=tool, query=query), message_id))
        return got.answer if got.ok else None

    def _find(self, tenant_id: uuid.UUID, token: str, message_id: uuid.UUID, tool: str, asked: str, name_key: str, *, query: dict[str, str] | None = None) -> tuple[list[dict[str, Any]], bool]:
        """(the best matches among the first rows of a list, whether one is clearly the best): the list asked with the name first, then without it (another script or spelling)."""
        from app.assistant_work import record_actions as ra

        for q in ({**(query or {}), "q": asked, "limit": "20"}, {**(query or {}), "limit": "100"}):
            if tool.startswith("catalogue") or tool.startswith("campaigns"):
                q = {k: v for k, v in q.items() if k != "q"}
            listed = self._read_q(tenant_id, token, tool, message_id, q)
            items = [i for i in (listed or {}).get("items") or [] if isinstance(i, dict)] if isinstance(listed, dict) else []
            top, clear = ra.rank(asked, items, name_key)
            if top:
                return top, clear
        return [], False

    def _open_record(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], message_id: uuid.UUID, language: Language) -> tuple[str, dict[str, Any] | None]:
        """"Show Kalyani's chat": the person is FOUND through the screen's own read route (any script or spelling), then the browser is asked to open that record (`open_record {type, id}`; a chat is keyed by the lead id)."""
        from app.assistant_work import client_actions as ca
        from app.assistant_work import record_actions as ra

        kind = str(args["type"])
        asked, details = ra.split_target(str(args["target"]))
        tool, key = ("campaigns.list_campaigns", "name") if kind == "campaign" else ("leads.list_leads", "display_name")
        top, clear = self._find(tenant_id, token, message_id, tool, asked, key)
        if not top:
            return w("no_record", language, name=asked), None
        if not clear:
            narrowed = ra.narrow(top, details, key)
            if len(narrowed) == 1:
                top, clear = narrowed, True
        if not clear:
            options = ra.choice_labels(top[:3], key)
            return w("which", language, name=asked, options="; ".join(options)), {"kind": "choose", "id": str(uuid.uuid4()), "question": w("which", language, name=asked, options="").strip(),
                                                                                  "options": [{"label": o, "value": f"{kind} {o}"} for o in options]}
        return w("client_done", language), ca.card("open_record", {"type": kind, "id": str(top[0]["id"])})

    def _record(self, token: str, tenant_id: uuid.UUID, action: str, args: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language,
                manager: bool = True) -> tuple[str, dict[str, Any] | None]:
        """One named record. A clear instruction is carried out AT ONCE and the card says "Done" with its Undo (owner, 14 Nov 2026): visits, a lead's status or fields, archive, consent, "stop messaging". Money (a
        catalogue price) and sending to many (starting or resuming a campaign) are one card and ONE tap; a second tap only for more than 50 people."""
        from app.assistant_work import prices as pr
        from app.assistant_work import record_actions as ra

        asked = str(args["target"])
        tool, key = ("leads.list_leads", "display_name") if action in ra.NEEDS_PERSON else ("catalogue.list_items", "name") if action == "price_set" else ("campaigns.list_campaigns", "name")
        asked, details = ra.split_target(asked)   # a choose button sends "Name · city · day" back: the name finds the people, the rest picks one of them
        top, clear = self._find(tenant_id, token, message_id, tool, asked, key)
        if not top:
            return w("no_record", language, name=asked), None
        if not clear:
            narrowed = ra.narrow(top, details, key)
            if len(narrowed) == 1:
                top, clear = narrowed, True
        if not clear:
            options = ra.choice_labels(top[:3], key)   # never three identical names: each carries its city, source or day
            return w("which", language, name=asked, options="; ".join(options)), {"kind": "choose", "id": str(uuid.uuid4()), "question": w("which", language, name=asked, options="").strip(),
                                                                                  "options": [{"label": o, "value": o} for o in options]}
        row = top[0]
        name = str(row.get(key) or asked)

        def plan(summary: str, steps: dict[str, Any] | list[dict[str, Any]], *, now: bool = False, **kw: Any) -> tuple[str, dict[str, Any] | None]:
            listed = [steps] if isinstance(steps, dict) else steps
            made = self._plan(token, tenant_id, message_id, conversation_id, summary, [{"summary": summary, **x} for x in listed], **kw)
            if not now:
                return w("offer", language, summary=summary), card_of_plan(made)
            done = asyncio.run(PlanRunner(self.store, self.tools).decide(token, tenant_id, uuid.UUID(str(made["plan_id"])), decision="do", confirmed=True, is_owner=manager))
            if done.get("status") in ("done", "partly_done"):
                return w("done_it", language, summary=summary), card_of_plan(done)
            failed: dict[str, Any] = next((x for x in done.get("steps") or [] if x.get("status") == "failed"), {})
            reasons = WHY.get(str(failed.get("error") or ""), WHY["invalid"])
            return w("not_done", language, summary=summary, why=reasons.get(language, reasons["en"])), card_of_plan(done)

        def call(tool_name: str, path: dict[str, str], body: dict[str, Any] | None = None, undo: dict[str, Any] | None = None) -> dict[str, Any]:
            spec: dict[str, Any] = {"path": path, **({"body": body} if body is not None else {}), **({"undo": undo} if undo else {})}
            return {"tool": tool_name, "undoable": undo is not None, "call": spec}

        if action == "lead_status":
            was = str(row.get("status") or "?")
            if was == args["status"]:
                return w("same", language, summary=f"{name} is already {was}"), None
            return plan(f"{name}: status {was} -> {args['status']}", call("leads.update_leads", {"row_id": str(row["id"])}, {"status": args["status"]},
                                                                           {"tool": "leads.update_leads", "path": {"row_id": str(row["id"])}, "body": {"status": was}}), now=True)
        if action == "lead_edit":
            fields = dict(args["fields"])
            raw_profile = row.get("profile")
            profile: dict[str, Any] = raw_profile if isinstance(raw_profile, dict) else {}
            steps: list[dict[str, Any]] = []
            if "name" in fields:
                steps.append(call("contacts.update_contacts", {"row_id": str(row["contact_id"])}, {"full_name": fields["name"]},
                                  {"tool": "contacts.update_contacts", "path": {"row_id": str(row["contact_id"])}, "body": {"full_name": name}}))
            mapped = {ra.PROFILE_FIELDS[k]: v for k, v in fields.items() if k in ra.PROFILE_FIELDS}
            if mapped.get("notes") and profile.get("notes"):
                mapped["notes"] = (str(profile["notes"]) + "\n" + mapped["notes"])[-2000:]   # a note is ADDED to what is there (the old text is the Undo)
            if mapped:
                steps.append(call("leads.fix_profile", {"lead_id": str(row["id"])}, mapped,
                                  {"tool": "leads.fix_profile", "path": {"lead_id": str(row["id"])}, "body": {k: profile.get(k) for k in mapped}}))
            summary = f"{name}: " + "; ".join(f"{k} -> {v}" for k, v in fields.items())
            return plan(summary, steps, now=True)
        if action == "lead_archive":
            return plan(f"Archive the lead {name}", {"tool": "leads.archive_leads", "undoable": True, "call": {"path": {"row_id": str(row["id"])}}}, now=True)
        if action == "visit_book":
            vid = str(uuid.uuid4())
            body = {"visit_id": vid, "lead_id": str(row["id"]), "date": args["date"], "slot_start": args["time"], "party_size": 1}
            return plan(f"Visit: {name} on {args['date']} at {args['time']} (they get the usual confirmation)", call("visits.book_visit", {}, body, {"tool": "visits.cancel_visit", "path": {"visit_id": vid}, "body": {}}), now=True)
        if action in ("visit_move", "visit_cancel"):
            listed = self._read_q(tenant_id, token, "visits.list_visits", message_id, {"lead_id": str(row["id"]), "open_only": "true", "from": ra.kolkata_today().isoformat(), "to": (ra.kolkata_today() + timedelta(days=60)).isoformat()})   # the list is TODAY only unless a range is asked
            visits = [v for v in (listed or {}).get("items") or [] if isinstance(v, dict)] if isinstance(listed, dict) else []
            if not visits:
                return w("no_visit", language, name=name), None
            if len(visits) > 1 and action == "visit_cancel":   # "cancel X's visit on Saturday at 11": the day and the time the owner named pick the visit (a move's date and time are the NEW ones)
                if args.get("date"):
                    visits = [v for v in visits if str(v.get("date")) == str(args["date"])] or visits
                if args.get("time"):
                    visits = [v for v in visits if ra.local_hhmm(v.get("starts_at")) == str(args["time"])] or visits
            if len(visits) > 1:
                options = [f"{v.get('date')} {ra.local_hhmm(v.get('starts_at'))}".strip() for v in visits[:3]]
                return w("which", language, name=f"visit of {name}", options=", ".join(options)), None
            visit = visits[0]
            old_time = ra.local_hhmm(visit.get("starts_at"))
            if action == "visit_cancel":
                again = {"visit_id": str(uuid.uuid4()), "lead_id": str(row["id"]), "date": str(visit.get("date")), "slot_start": old_time, "party_size": int(visit.get("party_size") or 1)}
                return plan(f"Cancel the visit of {name} on {visit.get('date')}", call("visits.cancel_visit", {"visit_id": str(visit["id"])}, {}, {"tool": "visits.book_visit", "path": {}, "body": again}), now=True)
            return plan(f"Move the visit of {name}: {visit.get('date')} {old_time} -> {args['date']} {args['time']}",
                        call("visits.change_visit", {"visit_id": str(visit["id"])}, {"date": args["date"], "slot_start": args["time"]},
                             {"tool": "visits.change_visit", "path": {"visit_id": str(visit["id"])}, "body": {"date": str(visit.get("date")), "slot_start": old_time}}), now=True)
        if action in ("campaign_pause", "campaign_resume", "campaign_cancel", "campaign_approve"):
            verb = action.split("_", 1)[1]
            tool_name = {"pause": "campaigns.pause", "resume": "campaigns.resume", "cancel": "campaigns.cancel", "approve": "campaigns.approve"}[verb]
            big = int(row.get("recipients") or row.get("approved_recipients") or 0) > ra.BIG_CAMPAIGN
            sentence_summary = f"Campaign {name}: {row.get('status')} -> {verb}"
            step = {"tool": tool_name, "undoable": verb in ("pause", "resume"), "call": {"path": {"campaign_id": str(row["id"])}, "body": {}}}
            if verb in ("pause", "cancel"):
                return plan(sentence_summary, step, now=True)
            return plan(sentence_summary, step, sensitive="sending" if big else None, owner_only=True)
        if action == "price_set":
            got = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool="catalogue.get_item", path={"item_id": str(row["id"])}), message_id))
            item = got.answer if got.ok and isinstance(got.answer, dict) else row
            new = int(args["price"]) * 100
            before = item.get("price_paise")
            if before == new:
                return w("same", language, summary=f"{name} is already {pr.rupees(new)}"), None
            return plan(f"{name}: {pr.rupees(before) if before else 'no price'} -> {pr.rupees(new)}", {"tool": "catalogue.put_item", "undoable": True, "call": {"path": {"item_id": str(row["id"])}, "body": pr.put_body(item, new)}},
                        owner_only=True)   # one card, ONE tap (owner, 14 Nov 2026): no second factor, no second confirm
        if action == "consent_record":
            body = {"channel": args["channel"], "status": "granted", "basis": "explicit_consent", "evidence_type": "verbal", "evidence_ref": "owner:said-in-chat"}
            undo = {"tool": "contacts.record_consent", "path": {"row_id": str(row["contact_id"])}, "body": {"channel": args["channel"], "status": "withdrawn", "evidence_type": "verbal", "evidence_ref": "owner:undid-in-chat"}}
            return plan(f"{name} agreed to {args['channel']} messages (your word, recorded)", call("contacts.record_consent", {"row_id": str(row["contact_id"])}, body, undo), now=True)
        undo_stop = {"tool": "contacts.lift_suppression", "path": {"row_id": str(row["contact_id"])}, "body": {"evidence_type": "verbal", "evidence_ref": "owner:undid-in-chat"}}
        return plan(f"Stop messaging {name}", call("contacts.suppress", {"row_id": str(row["contact_id"])}, {"reason": "opted_out", "evidence_type": "verbal", "evidence_ref": "owner:said-in-chat"}, undo_stop), now=True)

    def _source_key(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, language: Language) -> tuple[str, dict[str, Any] | None]:
        """The secure card (contract section 2, `secret`): a request the Owner's card sends the key to, good for 15 minutes and once. The key never comes back here."""
        sources = {"label": "Lead sources", "href": "/lead-sources"}
        if self.secrets is None:
            return w("key_not_yet", language), cant_do("not_yet", "your own IndiaMART key", sources)
        from app.tenancy.repository import Forbidden

        try:
            opened = self.secrets.open(token, tenant_id, "indiamart_key", message_id)
        except Forbidden:
            return w("key_owner_only", language), None
        saved = opened.get("saved")
        return w("key_card", language), {
            "kind": "secret", "id": str(uuid.uuid4()), "request_id": str(opened["request_id"]), "secret": "indiamart_key", "title": "Your IndiaMART CRM key",
            "hint": "IndiaMART Lead Manager -> Settings -> CRM key (Import/Export Leads)", "expires_at": str(opened.get("expires_at") or ""),
            "saved": {"last4": saved.get("last4")} if isinstance(saved, dict) else None,
            "setup_id": str(setups.setup_id(tenant_id, "indiamart")), "test": "pull_now",   # the guided setup's test, run with POST /assistant/setups/{setup_id}/test once the key is saved
        }

    def _setup(self, token: str, tenant_id: uuid.UUID, kind: str, language: Language, *, manager: bool) -> tuple[str, dict[str, Any] | None]:
        """A guided setup card (contract section 2, `setup`). The two that need something made (the forwarding address, the website form) are made through the Lead sources service, the
        same call as the screen's (made on first use, the same one shown again after); the rest are the steps and the screen's link."""
        from app.errors import ApiError
        from app.tenancy.repository import Forbidden

        if kind not in setups.KINDS or kind == "indiamart":
            return w("clarify", language), None
        screen = setups.SCREENS[kind]
        if kind not in ("email_forward", "website_form"):
            return w("setup_screen", language), setups.card(tenant_id, kind)
        if not manager:   # the screen's own rule (Owner or Admin); the database refuses too
            return w("setup_manager_only", language), None
        if self.lead_sources is None:
            return w("unavailable", language), cant_do("not_yet", setups.TITLES[kind], screen)
        try:
            if kind == "email_forward":
                got = self.lead_sources.email_address(token, tenant_id)
                copy = [{"label": "Your lead address", "value": str(got["address"]), "code": False}]
                confirmation = got.get("gmail_confirmation")
                if isinstance(confirmation, dict) and confirmation.get("code"):
                    copy.append({"label": "Gmail's confirmation code", "value": str(confirmation["code"]), "code": False})
                steps = ["Copy your lead address below and set it as the lead e-mail in your portal account.", *[str(g["text"]) for g in got.get("gmail_filter_guide") or []], "Then press 'Check' after the next lead e-mail."]
                return w("setup", language), setups.card(tenant_id, kind, copy=copy, portals=setups.PORTALS, test="send_test_mail", steps=steps)
            got = self.lead_sources.website(token, tenant_id)
            copy = [{"label": "The form code", "value": str(got["snippet"]), "code": True}, {"label": "The form link (no website needed)", "value": str(got["form_link"]), "code": False},
                    {"label": "For your developer: the webhook address", "value": str(got["webhook_url"]), "code": False}]
            return w("setup", language), setups.card(tenant_id, kind, copy=copy, test="send_test_lead")
        except Forbidden:
            return w("setup_manager_only", language), None
        except ApiError as exc:
            if exc.status_code == 503:
                return w("unavailable", language), cant_do("not_yet", setups.TITLES[kind], screen)
            raise

    def _calling_hours(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        read = self._read(tenant_id, token, "call-settings.get_settings", message_id)
        current = read.get("settings") if isinstance(read, dict) else None   # the read wraps the settings in force (what was saved, or the business type's defaults)
        if not isinstance(current, dict):
            return w("unavailable", language), None
        before = current.get("hours")
        days = args.get("days") or (before or {}).get("days") or [1, 2, 3, 4, 5, 6]
        after = {"days": sorted(int(d) for d in days), "from_minute": int(args["from_minute"]), "to_minute": int(args["to_minute"])}
        summary = f"Calling hours: {hours_words(before)} -> {hours_words(after)}"
        if before == after:
            return w("same", language, summary=hours_words(after)), None
        body = {**current, "hours": after}
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "call-settings.put_settings", "summary": summary, "undoable": True, "call": {"path": {}, "body": body}},
                          owner_only=True, second_factor=True)
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _auto_reply(self, token: str, tenant_id: uuid.UUID, on: bool, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        current = self._read(tenant_id, token, "ai-assistant.get_auto_reply", message_id)
        was = bool(current.get("enabled")) if isinstance(current, dict) else None
        summary = f"Automatic replies: {'on' if was else 'off' if was is not None else '?'} -> {'on' if on else 'off'}"
        if was is on:
            return w("same", language, summary=f"automatic replies {'on' if on else 'off'}"), None
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "ai-assistant.put_auto_reply", "summary": summary, "undoable": True, "call": {"path": {}, "body": {"enabled": on}}},
                          sensitive="sending" if on else None, owner_only=True, second_factor=True)
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _source(self, token: str, tenant_id: uuid.UUID, action: str, source: str, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        listed = self._read(tenant_id, token, "lead-sources.list_sources", message_id)
        items = [i for i in (listed or {}).get("items") or [] if isinstance(i, dict)] if isinstance(listed, dict) else []
        key = "".join(ch for ch in source.casefold() if ch.isalnum())
        found = [i for i in items if key and (key in "".join(ch for ch in str(i.get("label") or "").casefold() if ch.isalnum()) or key == str(i.get("tag") or "").replace("_", ""))]
        if len(found) != 1:
            return w("no_source", language, source=source, names=", ".join(str(i.get("label") or "") for i in items) or "-"), None
        item = found[0]
        pause = action == "pause_source"
        summary = f"{item.get('label')}: {item.get('status')} -> {'paused' if pause else 'active'}"
        if item.get("status") == ("paused" if pause else "active"):
            return w("same", language, summary=f"{item.get('label')} is {item.get('status')}"), None
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary,
                          {"tool": "lead-sources.pause_source" if pause else "lead-sources.resume_source", "summary": summary, "undoable": True, "call": {"path": {"source_id": str(item["id"])}}})
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _add_lead(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """One person, typed: the lead import's own preview and dedupe (a known number is merged, not doubled), the same import card and Undo as a file."""
        out = io.StringIO()
        csv.writer(out).writerows([["Name", "Phone", "Email", "City"], [args["name"], args.get("phone") or "", args.get("email") or "", args.get("city") or ""]])
        sheet_b64 = base64.b64encode(out.getvalue().encode("utf-8")).decode("ascii")
        kept = self.store.file_put(token, tenant_id, "typed lead.csv", "text/csv", "sheet", sheet_b64)
        turn = FileTurn(self.store, self.tools, self.lead_sources)
        return turn._lead_list(token, tenant_id, uuid.UUID(str(kept["file_id"])), f"{args['name']} (typed)", "sheet", sheet_b64, message_id=message_id, conversation_id=conversation_id, language=language)

    def _example(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        status = self._read(tenant_id, token, "example-data.example_status", message_id)
        counts = status.get("counts") if isinstance(status, dict) else None
        total = sum(int(v or 0) for v in counts.values() if isinstance(v, int)) if isinstance(counts, dict) else 0
        if not (isinstance(status, dict) and status.get("loaded")) or not total:
            return w("no_example", language), None
        summary = f"Remove the example data ({total} example rows; your own data stays)"
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "example-data.example_remove", "summary": summary, "undoable": False, "call": {"path": {}}},
                          sensitive="deleting", owner_only=True)
        return w("offer", language, summary=summary), card_of_plan(plan)
