"""The fixed words of the conversational assistant (job EA): the sentence that goes with a plan, its short steps, and the failures of the action path. Not model output; a native reader of each
language should check them (they are drafts)."""

from __future__ import annotations

from app.assistant.language import Language

PEOPLE: dict[Language, str] = {
    "en": "{n} people", "te": "{n} మంది", "hi": "{n} लोग", "kn": "{n} ಜನ", "ta": "{n} பேர்", "ml": "{n} പേർ",
}
HOW: dict[Language, dict[str, str]] = {
    "en": {"call": "by phone call", "whatsapp": "by WhatsApp message", "both": "by phone call and WhatsApp message"},
    "te": {"call": "ఫోన్ కాల్ ద్వారా", "whatsapp": "వాట్సాప్ మెసేజ్ ద్వారా", "both": "ఫోన్ కాల్ మరియు వాట్సాప్ మెసేజ్ ద్వారా"},
    "hi": {"call": "फ़ोन कॉल से", "whatsapp": "व्हाट्सऐप मैसेज से", "both": "फ़ोन कॉल और व्हाट्सऐप मैसेज से"},
    "kn": {"call": "ಫೋನ್ ಕರೆ ಮೂಲಕ", "whatsapp": "ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ", "both": "ಫೋನ್ ಕರೆ ಮತ್ತು ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ"},
    "ta": {"call": "தொலைபேசி அழைப்பு மூலம்", "whatsapp": "வாட்ஸ்அப் செய்தி மூலம்", "both": "தொலைபேசி அழைப்பு மற்றும் வாட்ஸ்அப் செய்தி மூலம்"},
    "ml": {"call": "ഫോൺ കോൾ വഴി", "whatsapp": "വാട്സാപ്പ് സന്ദേശം വഴി", "both": "ഫോൺ കോളും വാട്സാപ്പ് സന്ദേശവും വഴി"},
}
# "{goal}" is the plan's goal sentence (written in the owner's language); nothing else about the plan is said in words the model chose
PLAN_SENTENCE: dict[Language, str] = {
    "en": "{goal} That is {people}, {how}. Shall I go ahead?",
    "te": "{goal} {people}కి, {how}. కొనసాగించమంటారా?",
    "hi": "{goal} {people} को, {how}। आगे बढ़ूँ?",
    "kn": "{goal} {people}ಗೆ, {how}. ಮುಂದುವರಿಯಲೇ?",
    "ta": "{goal} {people} பேருக்கு, {how}. தொடரலாமா?",
    "ml": "{goal} {people}ക്ക്, {how}. തുടരട്ടെ?",
}
STEP_WHO: dict[Language, str] = {"en": "Who: {people}", "te": "ఎవరికి: {people}", "hi": "किसे: {people}", "kn": "ಯಾರಿಗೆ: {people}", "ta": "யாருக்கு: {people}", "ml": "ആർക്ക്: {people}"}
STEP_HOW: dict[Language, str] = {"en": "How: {how}", "te": "ఎలా: {how}", "hi": "कैसे: {how}", "kn": "ಹೇಗೆ: {how}", "ta": "எப்படி: {how}", "ml": "എങ്ങനെ: {how}"}
STEP_WHEN: dict[Language, str] = {"en": "When: {when}", "te": "ఎప్పుడు: {when}", "hi": "कब: {when}", "kn": "ಯಾವಾಗ: {when}", "ta": "எப்போது: {when}", "ml": "എപ്പോൾ: {when}"}
DAY: dict[Language, dict[str, str]] = {
    "en": {"today": "today", "tomorrow": "tomorrow"}, "te": {"today": "ఈరోజు", "tomorrow": "రేపు"}, "hi": {"today": "आज", "tomorrow": "कल"}, "kn": {"today": "ಇಂದು", "tomorrow": "ನಾಳೆ"},
    "ta": {"today": "இன்று", "tomorrow": "நாளை"}, "ml": {"today": "ഇന്ന്", "tomorrow": "നാളെ"},
}
CANNOT_PLAN: dict[Language, str] = {
    "en": "I could not make a plan for that just now. Tell me who to reach and what to say, in one line, and I will try again.",
    "te": "ఇప్పుడు దీనికి ప్లాన్ చేయలేకపోయాను. ఎవరిని, ఏమి చెప్పాలో ఒక లైన్‌లో చెప్పండి, మళ్ళీ ప్రయత్నిస్తాను.",
    "hi": "अभी इसकी योजना नहीं बना पाया। किसे और क्या कहना है, एक लाइन में बताइए, मैं फिर कोशिश करता हूँ।",
    "kn": "ಈಗ ಇದಕ್ಕೆ ಯೋಜನೆ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ಯಾರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕು, ಏನು ಹೇಳಬೇಕು ಎಂದು ಒಂದು ಸಾಲಿನಲ್ಲಿ ಹೇಳಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತೇನೆ.",
    "ta": "இப்போது இதற்கு திட்டம் போட முடியவில்லை. யாரைத் தொடர்பு கொள்ள வேண்டும், என்ன சொல்ல வேண்டும் என்பதை ஒரு வரியில் சொல்லுங்கள், மீண்டும் முயல்கிறேன்.",
    "ml": "ഇപ്പോൾ ഇതിന് പദ്ധതി ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല. ആരെ ബന്ധപ്പെടണം, എന്ത് പറയണം എന്ന് ഒറ്റ വരിയിൽ പറയൂ, ഞാൻ വീണ്ടും ശ്രമിക്കാം.",
}
