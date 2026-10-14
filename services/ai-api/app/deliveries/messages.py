"""The words of a trip update to the site contact (job CN): FIXED templates, no model, no amounts. They are made to pass the outbox's content rules by themselves (no price, payment, commitment or complaint word
for the kinds that may go automatically); `delay` names a delay, which the outbox holds for a person, and that is on purpose. English is the reviewed text; the others are drafts for a native reader."""

from __future__ import annotations

TEMPLATES: dict[str, dict[str, str]] = {
    "left": {
        "en": "Truck {v} has left with your material and should reach the site around {eta}.",
        "te": "ట్రక్ {v} మీ సామగ్రితో బయలుదేరింది, సుమారు {eta} కి సైట్‌కు చేరుతుంది.",
        "hi": "ट्रक {v} आपका माल लेकर निकल चुका है और लगभग {eta} तक साइट पर पहुँचेगा।",
        "kn": "ಟ್ರಕ್ {v} ನಿಮ್ಮ ಸಾಮಗ್ರಿಯೊಂದಿಗೆ ಹೊರಟಿದೆ, ಸುಮಾರು {eta} ಕ್ಕೆ ಸೈಟ್‌ಗೆ ತಲುಪುತ್ತದೆ.",
        "ta": "லாரி {v} உங்கள் பொருட்களுடன் புறப்பட்டுவிட்டது, சுமார் {eta} மணிக்கு தளத்தை அடையும்.",
    },
    "left_no_eta": {
        "en": "Truck {v} has left with your material and is on its way to the site.",
        "te": "ట్రక్ {v} మీ సామగ్రితో బయలుదేరింది, సైట్‌కు వస్తోంది.",
        "hi": "ट्रक {v} आपका माल लेकर निकल चुका है और साइट की ओर आ रहा है।",
        "kn": "ಟ್ರಕ್ {v} ನಿಮ್ಮ ಸಾಮಗ್ರಿಯೊಂದಿಗೆ ಹೊರಟಿದೆ, ಸೈಟ್‌ಗೆ ಬರುತ್ತಿದೆ.",
        "ta": "லாரி {v} உங்கள் பொருட்களுடன் புறப்பட்டுவிட்டது, தளத்தை நோக்கி வருகிறது.",
    },
    "soon": {
        "en": "Truck {v} will reach the site shortly. Please be ready to receive the material.",
        "te": "ట్రక్ {v} త్వరలో సైట్‌కు చేరుతుంది. సామగ్రిని స్వీకరించడానికి సిద్ధంగా ఉండండి.",
        "hi": "ट्रक {v} थोड़ी देर में साइट पर पहुँचेगा। कृपया माल उतरवाने के लिए तैयार रहें।",
        "kn": "ಟ್ರಕ್ {v} ಶೀಘ್ರದಲ್ಲೇ ಸೈಟ್‌ಗೆ ತಲುಪುತ್ತದೆ. ಸಾಮಗ್ರಿ ಸ್ವೀಕರಿಸಲು ಸಿದ್ಧರಾಗಿರಿ.",
        "ta": "லாரி {v} விரைவில் தளத்தை அடையும். பொருட்களைப் பெற தயாராக இருங்கள்.",
    },
    "delivered": {
        "en": "Your material has been delivered to the site. Thank you.",
        "te": "మీ సామగ్రి సైట్‌కు అందజేయబడింది. ధన్యవాదాలు.",
        "hi": "आपका माल साइट पर पहुँचा दिया गया है। धन्यवाद।",
        "kn": "ನಿಮ್ಮ ಸಾಮಗ್ರಿ ಸೈಟ್‌ಗೆ ತಲುಪಿದೆ. ಧನ್ಯವಾದಗಳು.",
        "ta": "உங்கள் பொருட்கள் தளத்தில் சேர்க்கப்பட்டுவிட்டன. நன்றி.",
    },
    "delay": {
        "en": "Truck {v} is delayed. We will tell you as soon as it is on its way.",
        "te": "ట్రక్ {v} ఆలస్యమైంది. బయలుదేరిన వెంటనే మీకు తెలియజేస్తాము.",
        "hi": "ट्रक {v} में देरी हो रही है। निकलते ही हम आपको बता देंगे।",
        "kn": "ಟ್ರಕ್ {v} ವಿಳಂಬವಾಗಿದೆ. ಹೊರಟ ಕೂಡಲೇ ತಿಳಿಸುತ್ತೇವೆ.",
        "ta": "லாரி {v} தாமதமாகிறது. புறப்பட்டவுடன் தெரிவிக்கிறோம்.",
    },
}

def compose(kind: str, language: str, vehicle: str | None, eta: str | None) -> str:
    """The text of one update. The vehicle number is the trip's own; the time is what the person typed (digits, a colon, am or pm only)."""
    key = "left_no_eta" if kind == "left" and not eta else kind
    template = TEMPLATES[key][language]
    v = vehicle.strip() if vehicle else ""
    text = template.format(v=v, eta=eta or "")
    return " ".join(text.split())  # a missing vehicle number leaves no double space
