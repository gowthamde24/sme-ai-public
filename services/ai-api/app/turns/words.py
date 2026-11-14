"""The fixed words of the conversational assistant (job EA): the sentence that goes with a plan, its short steps, and the failures of the action path. Not model output; a native reader of each
language should check them (they are drafts)."""

from __future__ import annotations

from app.assistant.language import Language

PEOPLE: dict[Language, str] = {
    "en": "{n} people", "te": "{n} మంది", "hi": "{n} लोग", "kn": "{n} ಜನ", "ta": "{n} பேர்", "ml": "{n} പേർ", "mr": "{n} लोक",
}
HOW: dict[Language, dict[str, str]] = {
    "en": {"call": "by phone call", "whatsapp": "by WhatsApp message", "both": "by phone call and WhatsApp message"},
    "te": {"call": "కాల్ చేసి", "whatsapp": "WhatsApp మెసేజ్ పంపి", "both": "కాల్ చేసి, WhatsApp మెసేజ్ పంపి"},
    "hi": {"call": "फ़ोन कॉल से", "whatsapp": "व्हाट्सऐप मैसेज से", "both": "फ़ोन कॉल और व्हाट्सऐप मैसेज से"},
    "kn": {"call": "ಫೋನ್ ಕರೆ ಮೂಲಕ", "whatsapp": "ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ", "both": "ಫೋನ್ ಕರೆ ಮತ್ತು ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ"},
    "ta": {"call": "தொலைபேசி அழைப்பு மூலம்", "whatsapp": "வாட்ஸ்அப் செய்தி மூலம்", "both": "தொலைபேசி அழைப்பு மற்றும் வாட்ஸ்அப் செய்தி மூலம்"},
    "ml": {"call": "ഫോൺ കോൾ വഴി", "whatsapp": "വാട്സാപ്പ് സന്ദേശം വഴി", "both": "ഫോൺ കോളും വാട്സാപ്പ് സന്ദേശവും വഴി"},
    "mr": {"call": "फोन कॉलने", "whatsapp": "WhatsApp मेसेजने", "both": "फोन कॉल आणि WhatsApp मेसेजने"},
}
# the short title of a plan card ("Call 28 people"): what is done and to how many. The goal sentence (long, the model's) stays in the summary.
TITLE: dict[Language, dict[str, str]] = {
    "en": {"call": "Call {people}", "whatsapp": "Message {people}", "both": "Call and message {people}"},
    "te": {"call": "{people}కి కాల్", "whatsapp": "{people}కి మెసేజ్", "both": "{people}కి కాల్, మెసేజ్"},
    "hi": {"call": "{people} को कॉल", "whatsapp": "{people} को मैसेज", "both": "{people} को कॉल और मैसेज"},
    "kn": {"call": "{people}ಗೆ ಕರೆ", "whatsapp": "{people}ಗೆ ಸಂದೇಶ", "both": "{people}ಗೆ ಕರೆ ಮತ್ತು ಸಂದೇಶ"},
    "ta": {"call": "{people} பேருக்கு அழைப்பு", "whatsapp": "{people} பேருக்கு செய்தி", "both": "{people} பேருக்கு அழைப்பு, செய்தி"},
    "ml": {"call": "{people}ക്ക് കോൾ", "whatsapp": "{people}ക്ക് സന്ദേശം", "both": "{people}ക്ക് കോൾ, സന്ദേശം"},
    "mr": {"call": "{people}ना कॉल", "whatsapp": "{people}ना मेसेज", "both": "{people}ना कॉल आणि मेसेज"},
}
# "{goal}" is the plan's goal sentence (written in the owner's language); nothing else about the plan is said in words the model chose
PLAN_SENTENCE: dict[Language, str] = {
    "en": "{goal} That is {people}, {how}. Shall I go ahead?",
    "te": "{goal} {people}కి {how}. చెయ్యనా?",   # (Telugu has its own, per channel: PLAN_ASK below; the owner's rule is spoken words, 14 Nov 2026)
    "hi": "{goal} {people} को, {how}। आगे बढ़ूँ?",
    "kn": "{goal} {people}ಗೆ, {how}. ಮುಂದುವರಿಯಲೇ?",
    "ta": "{goal} {people} பேருக்கு, {how}. தொடரலாமா?",
    "ml": "{goal} {people}ക്ക്, {how}. തുടരട്ടെ?",
    "mr": "{goal} {people}ना, {how}. पुढे जाऊ का?",
}
# the question at the end of a plan card, per channel, in the words people say ("కాల్ చెయ్యనా?", not "కొనసాగించమంటారా?"; owner, 14 Nov 2026); a language not listed uses PLAN_SENTENCE
PLAN_ASK: dict[Language, dict[str, str]] = {
    "te": {"call": "{goal} {people}కి కాల్ చెయ్యనా?", "whatsapp": "{goal} {people}కి మెసేజ్ పంపనా?", "both": "{goal} {people}కి కాల్ చేసి మెసేజ్ పంపనా?"},
    "hi": {"call": "{goal} {people} को कॉल करूँ?", "whatsapp": "{goal} {people} को मैसेज भेजूँ?", "both": "{goal} {people} को कॉल करके मैसेज भेजूँ?"},
    "kn": {"call": "{goal} {people}ಗೆ ಕಾಲ್ ಮಾಡಲೇ?", "whatsapp": "{goal} {people}ಗೆ ಮೆಸೇಜ್ ಕಳಿಸಲೇ?", "both": "{goal} {people}ಗೆ ಕಾಲ್ ಮಾಡಿ ಮೆಸೇಜ್ ಕಳಿಸಲೇ?"},
}
# a plan with MORE than this many people needs a second, plainer question before it starts (the people, the count, one more yes)
BIG_BATCH = 50
SECOND_CONFIRM: dict[Language, dict[str, str]] = {
    "te": {"call": "నిజంగా {people}కి కాల్ చెయ్యనా?", "whatsapp": "నిజంగా {people}కి మెసేజ్ పంపనా?", "both": "నిజంగా {people}కి కాల్ చేసి మెసేజ్ పంపనా?"},
    "hi": {"call": "सच में {people} को कॉल करूँ?", "whatsapp": "सच में {people} को मैसेज भेजूँ?", "both": "सच में {people} को कॉल करके मैसेज भेजूँ?"},
    "kn": {"call": "ನಿಜವಾಗಿ {people}ಗೆ ಕಾಲ್ ಮಾಡಲೇ?", "whatsapp": "ನಿಜವಾಗಿ {people}ಗೆ ಮೆಸೇಜ್ ಕಳಿಸಲೇ?", "both": "ನಿಜವಾಗಿ {people}ಗೆ ಕಾಲ್ ಮಾಡಿ ಮೆಸೇಜ್ ಕಳಿಸಲೇ?"},
    "en": {"call": "Do you really want me to call {people}?", "whatsapp": "Do you really want me to message {people}?", "both": "Do you really want me to call and message {people}?"},
}
# WHICH group the plan is for: said on the card so "72 new enquiries" and "255 calls" never look like a mistake
AUDIENCE: dict[Language, dict[str, str]] = {
    "te": {"new_enquiries": "కొత్త enquiries", "all_leads": "అందరూ leads", "recent_leads": "ఈ వారం leads", "old_leads": "పాత leads", "list": "మీరు ఇచ్చిన లిస్ట్", "one": "ఒక్కరు", "mixed": "మీరు చెప్పిన వాళ్ళు"},
    "hi": {"new_enquiries": "नई enquiries", "all_leads": "सभी leads", "recent_leads": "इस हफ़्ते की leads", "old_leads": "पुरानी leads", "list": "आपकी दी हुई list", "one": "एक व्यक्ति", "mixed": "आपके बताए लोग"},
    "kn": {"new_enquiries": "ಹೊಸ enquiries", "all_leads": "ಎಲ್ಲಾ leads", "recent_leads": "ಈ ವಾರದ leads", "old_leads": "ಹಳೆಯ leads", "list": "ನೀವು ಕೊಟ್ಟ list", "one": "ಒಬ್ಬರು", "mixed": "ನೀವು ಹೇಳಿದವರು"},
    "en": {"new_enquiries": "new enquiries", "all_leads": "all leads", "recent_leads": "this week's leads", "old_leads": "older leads", "list": "the list you gave", "one": "one person", "mixed": "the people you named"},
}
# what the plan does, when the model's own goal sentence is not in the conversation's language (or an old plan has none): fixed, spoken, per template; `custom` says only the channel
GOAL: dict[Language, dict[str, str]] = {
    "te": {
        "call_new_leads": "మనమెవరో చెప్పి, ఇంకా interest ఉందేమో అడిగి, వాళ్ళకి ఏం కావాలో నోట్ చేస్తాను.",
        "reengage_old_leads": "పాత leads కి మళ్ళీ కాల్ చేసి, ఇంకా కావాలో లేదో అడుగుతాను.",
        "confirm_appointments": "visit confirm అయ్యిందో లేదో అడుగుతాను.",
        "collect_feedback": "ఎలా ఉందో feedback అడిగి నోట్ చేస్తాను.",
        "payment_reminder": "పేమెంట్ గురించి మెల్లగా గుర్తు చేస్తాను.",
        "supplier_price_enquiry": "రేట్ ఎంతో అడిగి నోట్ చేస్తాను.",
        "offer_invite": "ఆఫర్ గురించి చెప్పి invite చేస్తాను.",
        "custom": "మీరు చెప్పినట్టు చేస్తాను.",
    },
    "hi": {
        "call_new_leads": "बताऊँगा कि कौन बोल रहा है, पूछूँगा कि अब भी interest है या नहीं, और जो चाहिए वो note करूँगा।",
        "reengage_old_leads": "पुरानी leads को फिर से फ़ोन करके पूछूँगा कि अब भी चाहिए या नहीं।",
        "confirm_appointments": "पूछूँगा कि visit पक्की है या नहीं।",
        "collect_feedback": "पूछूँगा कि कैसा लगा और feedback note करूँगा।",
        "payment_reminder": "payment की हल्की याद दिलाऊँगा।",
        "supplier_price_enquiry": "rate पूछकर note करूँगा।",
        "offer_invite": "offer बताकर invite करूँगा।",
        "custom": "जैसा आपने कहा वैसा करूँगा।",
    },
    "kn": {
        "call_new_leads": "ನಾವು ಯಾರು ಅಂತ ಹೇಳಿ, ಇನ್ನೂ interest ಇದೆಯಾ ಅಂತ ಕೇಳಿ, ಅವರಿಗೆ ಏನು ಬೇಕು ಅಂತ note ಮಾಡ್ತೀನಿ.",
        "reengage_old_leads": "ಹಳೆಯ leads ಗೆ ಮತ್ತೆ ಕಾಲ್ ಮಾಡಿ, ಇನ್ನೂ ಬೇಕಾ ಅಂತ ಕೇಳ್ತೀನಿ.",
        "confirm_appointments": "visit confirm ಆಗಿದೆಯಾ ಅಂತ ಕೇಳ್ತೀನಿ.",
        "collect_feedback": "ಹೇಗಿತ್ತು ಅಂತ feedback ಕೇಳಿ note ಮಾಡ್ತೀನಿ.",
        "payment_reminder": "payment ಬಗ್ಗೆ ಮೆಲ್ಲಗೆ ನೆನಪಿಸ್ತೀನಿ.",
        "supplier_price_enquiry": "rate ಎಷ್ಟು ಅಂತ ಕೇಳಿ note ಮಾಡ್ತೀನಿ.",
        "offer_invite": "offer ಬಗ್ಗೆ ಹೇಳಿ invite ಮಾಡ್ತೀನಿ.",
        "custom": "ನೀವು ಹೇಳಿದಂತೆ ಮಾಡ್ತೀನಿ.",
    },
}
# the plan's closed notes (codes), said in the conversation's language on the card; a language not listed keeps the English sentence
NOTE: dict[Language, dict[str, str]] = {
    "te": {
        "promotional_calls_off": "ప్రమోషన్ కాల్స్ ఆఫ్, WhatsApp మెసేజ్ మాత్రమే.",
        "unmatched_numbers": "మీరిచ్చిన కొన్ని నంబర్లు మీ contacts లో లేవు, వాళ్ళకి చేయను.",
        "capped_at_500": "ఒక టాస్క్ లో 500 మంది వరకే, మొదటి 500 మందే ఉన్నారు.",
        "some_skipped": "కొందరిని skip చేస్తాను (STOP చెప్పినవాళ్ళు, ఫోన్ లేనివాళ్ళు, consent లేనివాళ్ళు).",
        "nobody_found": "ఇంకా ఎవరూ దొరకలేదు. ఎవరికో చెప్పండి, లేదా నంబర్ల లిస్ట్ ఇవ్వండి.",
        "big_batch": "చాలా మంది కాబట్టి ఇంకోసారి అడుగుతాను.",
    },
    "hi": {
        "promotional_calls_off": "प्रमोशन कॉल बंद हैं, सिर्फ़ WhatsApp।",
        "unmatched_numbers": "आपके दिए कुछ नंबर आपके contacts में नहीं हैं, उन्हें नहीं करूँगा।",
        "capped_at_500": "एक task में ज़्यादा से ज़्यादा 500 लोग, पहले 500 ही हैं।",
        "some_skipped": "कुछ लोगों को skip करूँगा (STOP कहने वाले, बिना फ़ोन वाले, बिना consent वाले)।",
        "nobody_found": "अभी कोई नहीं मिला। बताइए किसे करना है, या नंबरों की list दीजिए।",
        "big_batch": "लोग बहुत हैं, इसलिए एक बार और पूछूँगा।",
    },
    "kn": {
        "promotional_calls_off": "ಪ್ರಮೋಷನ್ ಕಾಲ್ಸ್ ಆಫ್, WhatsApp ಮಾತ್ರ.",
        "unmatched_numbers": "ನೀವು ಕೊಟ್ಟ ಕೆಲವು ನಂಬರ್ ನಿಮ್ಮ contacts ನಲ್ಲಿ ಇಲ್ಲ, ಅವರಿಗೆ ಮಾಡಲ್ಲ.",
        "capped_at_500": "ಒಂದು ಟಾಸ್ಕ್ ಗೆ ಗರಿಷ್ಠ 500 ಜನ, ಮೊದಲ 500 ಮಾತ್ರ ಇದ್ದಾರೆ.",
        "some_skipped": "ಕೆಲವರನ್ನು skip ಮಾಡ್ತೀನಿ (STOP ಹೇಳಿದವರು, ಫೋನ್ ಇಲ್ಲದವರು, consent ಇಲ್ಲದವರು).",
        "nobody_found": "ಇನ್ನೂ ಯಾರೂ ಸಿಕ್ಕಿಲ್ಲ. ಯಾರಿಗೆ ಅಂತ ಹೇಳಿ, ಅಥವಾ ನಂಬರ್ ಲಿಸ್ಟ್ ಕೊಡಿ.",
        "big_batch": "ತುಂಬಾ ಜನ ಇರುವುದರಿಂದ ಇನ್ನೊಮ್ಮೆ ಕೇಳ್ತೀನಿ.",
    },
}
STEP_WHO: dict[Language, str] = {"en": "Who: {people}", "te": "ఎవరికి: {people}", "hi": "किसे: {people}", "kn": "ಯಾರಿಗೆ: {people}", "ta": "யாருக்கு: {people}", "ml": "ആർക്ക്: {people}", "mr": "कोणाला: {people}"}
STEP_HOW: dict[Language, str] = {"en": "How: {how}", "te": "ఎలా: {how}", "hi": "कैसे: {how}", "kn": "ಹೇಗೆ: {how}", "ta": "எப்படி: {how}", "ml": "എങ്ങനെ: {how}", "mr": "कसं: {how}"}
STEP_WHEN: dict[Language, str] = {"en": "When: {when}", "te": "ఎప్పుడు: {when}", "hi": "कब: {when}", "kn": "ಯಾವಾಗ: {when}", "ta": "எப்போது: {when}", "ml": "എപ്പോൾ: {when}", "mr": "कधी: {when}"}
DAY: dict[Language, dict[str, str]] = {
    "en": {"today": "today", "tomorrow": "tomorrow"}, "te": {"today": "ఈరోజు", "tomorrow": "రేపు"}, "hi": {"today": "आज", "tomorrow": "कल"}, "kn": {"today": "ಇಂದು", "tomorrow": "ನಾಳೆ"},
    "ta": {"today": "இன்று", "tomorrow": "நாளை"}, "ml": {"today": "ഇന്ന്", "tomorrow": "നാളെ"}, "mr": {"today": "आज", "tomorrow": "उद्या"},
}
CANNOT_PLAN: dict[Language, str] = {
    "en": "I could not make a plan for that just now. Tell me who to reach and what to say, in one line, and I will try again.",
    "te": "ఇప్పుడు దీనికి ప్లాన్ చేయలేకపోయాను. ఎవరిని, ఏమి చెప్పాలో ఒక లైన్‌లో చెప్పండి, మళ్ళీ ప్రయత్నిస్తాను.",
    "hi": "अभी इसकी योजना नहीं बना पाया। किसे और क्या कहना है, एक लाइन में बताइए, मैं फिर कोशिश करता हूँ।",
    "kn": "ಈಗ ಇದಕ್ಕೆ ಯೋಜನೆ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ಯಾರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕು, ಏನು ಹೇಳಬೇಕು ಎಂದು ಒಂದು ಸಾಲಿನಲ್ಲಿ ಹೇಳಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತೇನೆ.",
    "ta": "இப்போது இதற்கு திட்டம் போட முடியவில்லை. யாரைத் தொடர்பு கொள்ள வேண்டும், என்ன சொல்ல வேண்டும் என்பதை ஒரு வரியில் சொல்லுங்கள், மீண்டும் முயல்கிறேன்.",
    "ml": "ഇപ്പോൾ ഇതിന് പദ്ധതി ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല. ആരെ ബന്ധപ്പെടണം, എന്ത് പറയണം എന്ന് ഒറ്റ വരിയിൽ പറയൂ, ഞാൻ വീണ്ടും ശ്രമിക്കാം.",
    "mr": "आत्ता याचा plan करता आला नाही. कोणाला संपर्क करायचा आणि काय सांगायचं ते एका ओळीत सांगा, मी पुन्हा प्रयत्न करतो.",
}

# "What can you do?" (13 Nov 2026): answered at once from this fixed, accurate text (no model call: nothing to wait for, nothing to get wrong, nothing to cut off). It names only what the product does today:
# answers from the owner's own records, drafts that wait for the owner's OK, and plans that start only after "yes". About 400 characters, so Talk live speaks all of it. Drafts: a native reader should check them.
ABOUT_ASSISTANT: dict[Language, str] = {
    "en": "I answer questions about your business from your own records: customers, enquiries, quotes, orders, visits, calls and stock. I draft replies and quotes for you to approve, and I plan calls or messages to your customers, which start only after you say yes. Try asking: how many new enquiries came today?",
    "te": "మీ రికార్డుల నుంచి మీ వ్యాపారం గురించి చెప్పగలను: కస్టమర్లు, ఎంక్వైరీలు, కొటేషన్లు, ఆర్డర్లు, విజిట్లు, కాల్స్, స్టాక్. రిప్లైలు, కొటేషన్లు డ్రాఫ్ట్ చేస్తాను, మీరు ఓకే చెప్పాకే వెళ్తాయి. కస్టమర్లకు కాల్స్ లేదా మెసేజ్‌ల ప్లాన్ చేస్తాను, మీరు అవును అంటేనే మొదలవుతాయి. ఉదాహరణకు అడగండి: ఈ రోజు కొత్త ఎంక్వైరీలు ఎన్ని వచ్చాయి?",
    "hi": "मैं आपके अपने रिकॉर्ड से आपके बिज़नेस के सवालों के जवाब देता हूँ: ग्राहक, पूछताछ, कोटेशन, ऑर्डर, विज़िट, कॉल और स्टॉक। मैं जवाब और कोटेशन का ड्राफ़्ट बनाता हूँ, जो आपकी मंज़ूरी के बाद ही जाते हैं, और ग्राहकों को कॉल या मैसेज की योजना बनाता हूँ, जो आपके हाँ कहने पर ही शुरू होती है। जैसे पूछिए: आज कितनी नई पूछताछ आईं?",
    "kn": "ನಿಮ್ಮ ದಾಖಲೆಗಳಿಂದ ನಿಮ್ಮ ವ್ಯವಹಾರದ ಬಗ್ಗೆ ಹೇಳಬಲ್ಲೆ: ಗ್ರಾಹಕರು, ವಿಚಾರಣೆಗಳು, ಕೊಟೇಶನ್‌ಗಳು, ಆರ್ಡರ್‌ಗಳು, ಭೇಟಿಗಳು, ಕರೆಗಳು ಮತ್ತು ಸ್ಟಾಕ್. ಉತ್ತರಗಳು ಮತ್ತು ಕೊಟೇಶನ್‌ಗಳ ಡ್ರಾಫ್ಟ್ ಮಾಡುತ್ತೇನೆ, ನೀವು ಒಪ್ಪಿದ ಮೇಲೆಯೇ ಹೋಗುತ್ತವೆ. ಗ್ರಾಹಕರಿಗೆ ಕರೆ ಅಥವಾ ಸಂದೇಶಗಳ ಯೋಜನೆ ಮಾಡುತ್ತೇನೆ, ನೀವು ಹೌದು ಎಂದ ಮೇಲೆಯೇ ಶುರುವಾಗುತ್ತವೆ. ಉದಾಹರಣೆಗೆ ಕೇಳಿ: ಇಂದು ಎಷ್ಟು ಹೊಸ ವಿಚಾರಣೆಗಳು ಬಂದವು?",
    "ta": "என் பதில்கள் உங்கள் சொந்தப் பதிவுகளிலிருந்து வரும்: வாடிக்கையாளர்கள், விசாரணைகள், விலைப்புள்ளிகள், ஆர்டர்கள், வருகைகள், அழைப்புகள், இருப்பு. பதில்கள், விலைப்புள்ளிகளை வரைவாக எழுதுவேன், நீங்கள் ஒப்புக்கொண்ட பிறகே போகும். அழைப்புகள், செய்திகளைத் திட்டமிடுவேன், நீங்கள் ஆம் என்றால்தான் தொடங்கும். உதாரணம்: இன்று எத்தனை புதிய விசாரணைகள் வந்தன?",
    "ml": "നിങ്ങളുടെ സ്വന്തം രേഖകളിൽ നിന്ന് ബിസിനസിനെക്കുറിച്ച് ഞാൻ ഉത്തരം തരും: ഉപഭോക്താക്കൾ, അന്വേഷണങ്ങൾ, ക്വോട്ടേഷനുകൾ, ഓർഡറുകൾ, സന്ദർശനങ്ങൾ, കോളുകൾ, സ്റ്റോക്ക്. മറുപടികളും ക്വോട്ടേഷനുകളും ഡ്രാഫ്റ്റ് ചെയ്യും, നിങ്ങൾ അംഗീകരിച്ചാലേ പോകൂ. കോളുകളോ സന്ദേശങ്ങളോ പ്ലാൻ ചെയ്യും, നിങ്ങൾ അതെ എന്ന് പറഞ്ഞാലേ തുടങ്ങൂ. ഉദാഹരണം: ഇന്ന് എത്ര പുതിയ അന്വേഷണങ്ങൾ വന്നു?",
    "mr": "मी तुमच्या स्वतःच्या नोंदींवरून व्यवसायाबद्दल उत्तरं देतो: ग्राहक, चौकशा, कोटेशन, ऑर्डर, भेटी, कॉल आणि स्टॉक. उत्तरं आणि कोटेशनचा मसुदा करतो, तुम्ही मान्य केल्यावरच जातात. ग्राहकांना कॉल किंवा मेसेजचं नियोजन करतो, तुम्ही हो म्हटल्यावरच सुरू होतं. उदाहरणार्थ विचारा: आज किती नवीन चौकशा आल्या?",
}
