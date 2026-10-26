"""The fixed sentences the connectors put in a customer's mouth. Written once per language (never by a model); a native reader should check them. A payment request mentions the amount and the link, so
the outbox policy always holds it for a person's approval (a message with an amount waits)."""

from __future__ import annotations

PAY_REQUEST: dict[str, str] = {
    "en": "Please pay {amount} for your order {order} using this UPI link: {url}",
    "te": "మీ ఆర్డర్ {order} కోసం {amount} ఈ UPI లింక్ ద్వారా చెల్లించండి: {url}",
    "hi": "कृपया अपने ऑर्डर {order} के लिए {amount} इस UPI लिंक से चुकाएँ: {url}",
    "kn": "ನಿಮ್ಮ ಆರ್ಡರ್ {order} ಗಾಗಿ {amount} ಈ UPI ಲಿಂಕ್ ಮೂಲಕ ಪಾವತಿಸಿ: {url}",
    "ta": "உங்கள் ஆர்டர் {order}க்கு {amount} தொகையை இந்த UPI இணைப்பில் செலுத்துங்கள்: {url}",
    "ml": "നിങ്ങളുടെ ഓർഡർ {order} ന് {amount} ഈ UPI ലിങ്ക് വഴി അടയ്ക്കുക: {url}",
}
MISSED_CALL_REPLY: dict[str, str] = {
    "en": "Thank you for calling. We missed your call and will get back to you shortly.",
    "te": "కాల్ చేసినందుకు ధన్యవాదాలు. మీ కాల్ మిస్ అయ్యింది, త్వరలో మిమ్మల్ని సంప్రదిస్తాము.",
    "hi": "कॉल करने के लिए धन्यवाद। आपकी कॉल छूट गई थी, हम जल्दी ही आपसे संपर्क करेंगे।",
    "kn": "ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಕರೆ ತಪ್ಪಿಹೋಗಿತ್ತು, ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.",
    "ta": "அழைத்ததற்கு நன்றி. உங்கள் அழைப்பைத் தவறவிட்டோம், விரைவில் உங்களைத் தொடர்புகொள்வோம்.",
    "ml": "വിളിച്ചതിന് നന്ദി. നിങ്ങളുടെ കോൾ എടുക്കാൻ കഴിഞ്ഞില്ല, ഉടൻ തിരിച്ചു വിളിക്കാം.",
}
LANGUAGES = tuple(PAY_REQUEST)
