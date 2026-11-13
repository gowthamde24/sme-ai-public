"""The fixed words of the conversational assistant (job EA): the sentence that goes with a plan, its short steps, and the failures of the action path. Not model output; a native reader of each
language should check them (they are drafts)."""

from __future__ import annotations

from app.assistant.language import Language

PEOPLE: dict[Language, str] = {
    "en": "{n} people", "te": "{n} మంది", "hi": "{n} लोग", "kn": "{n} ಜನ", "ta": "{n} பேர்", "ml": "{n} പേർ", "mr": "{n} लोक",
}
HOW: dict[Language, dict[str, str]] = {
    "en": {"call": "by phone call", "whatsapp": "by WhatsApp message", "both": "by phone call and WhatsApp message"},
    "te": {"call": "ఫోన్ కాల్ ద్వారా", "whatsapp": "వాట్సాప్ మెసేజ్ ద్వారా", "both": "ఫోన్ కాల్ మరియు వాట్సాప్ మెసేజ్ ద్వారా"},
    "hi": {"call": "फ़ोन कॉल से", "whatsapp": "व्हाट्सऐप मैसेज से", "both": "फ़ोन कॉल और व्हाट्सऐप मैसेज से"},
    "kn": {"call": "ಫೋನ್ ಕರೆ ಮೂಲಕ", "whatsapp": "ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ", "both": "ಫೋನ್ ಕರೆ ಮತ್ತು ವಾಟ್ಸಾಪ್ ಸಂದೇಶದ ಮೂಲಕ"},
    "ta": {"call": "தொலைபேசி அழைப்பு மூலம்", "whatsapp": "வாட்ஸ்அப் செய்தி மூலம்", "both": "தொலைபேசி அழைப்பு மற்றும் வாட்ஸ்அப் செய்தி மூலம்"},
    "ml": {"call": "ഫോൺ കോൾ വഴി", "whatsapp": "വാട്സാപ്പ് സന്ദേശം വഴി", "both": "ഫോൺ കോളും വാട്സാപ്പ് സന്ദേശവും വഴി"},
    "mr": {"call": "फोन कॉलने", "whatsapp": "WhatsApp मेसेजने", "both": "फोन कॉल आणि WhatsApp मेसेजने"},
}
# "{goal}" is the plan's goal sentence (written in the owner's language); nothing else about the plan is said in words the model chose
PLAN_SENTENCE: dict[Language, str] = {
    "en": "{goal} That is {people}, {how}. Shall I go ahead?",
    "te": "{goal} {people}కి, {how}. కొనసాగించమంటారా?",
    "hi": "{goal} {people} को, {how}। आगे बढ़ूँ?",
    "kn": "{goal} {people}ಗೆ, {how}. ಮುಂದುವರಿಯಲೇ?",
    "ta": "{goal} {people} பேருக்கு, {how}. தொடரலாமா?",
    "ml": "{goal} {people}ക്ക്, {how}. തുടരട്ടെ?",
    "mr": "{goal} {people}ना, {how}. पुढे जाऊ का?",
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
