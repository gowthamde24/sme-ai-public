"""The customer's quote as a message (job CN): a clear table of words and numbers made by FIXED templates from the stored figures. No model writes any of it, and no number is calculated here: every figure is read
from the stored quote (the calculator's, recomputed by the database). English is the reviewed text; Telugu, Hindi, Kannada, Tamil and Malayalam carry the same lines in words that a native reader has not yet reviewed
(`language_review: draft`). A quote is not an invoice: the GST is shown, the invoice is the owner's accounting system's."""

from __future__ import annotations

from datetime import date
from typing import Any

from app.today.service import format_rupees

LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml")

# label key -> {language: words}; {n}, {amount} ... are filled in below
WORDS: dict[str, dict[str, str]] = {
    "quote": {"en": "Quote", "te": "కొటేషన్", "hi": "कोटेशन", "kn": "ಕೊಟೇಶನ್", "ta": "விலைப்புள்ளி", "ml": "ക്വട്ടേഷൻ"},
    "valid": {"en": "Valid until", "te": "చెల్లుబాటు తేదీ", "hi": "मान्य तिथि", "kn": "ಮಾನ್ಯ ದಿನಾಂಕ", "ta": "செல்லுபடியாகும் தேதி", "ml": "സാധുത തീയതി"},
    "area": {"en": "Area", "te": "విస్తీర్ణం", "hi": "क्षेत्रफल", "kn": "ವಿಸ್ತೀರ್ಣ", "ta": "பரப்பளவு", "ml": "വിസ്തീർണം"},
    "pieces": {"en": "pieces", "te": "ముక్కలు", "hi": "पीस", "kn": "ತುಂಡುಗಳು", "ta": "துண்டுகள்", "ml": "എണ്ണം"},
    "pallets": {"en": "pallets", "te": "పాలెట్లు", "hi": "पैलेट", "kn": "ಪ್ಯಾಲೆಟ್‌ಗಳು", "ta": "பேலட்டுகள்", "ml": "പാലറ്റുകൾ"},
    "material": {"en": "Material", "te": "సామగ్రి", "hi": "सामग्री", "kn": "ಸಾಮಗ್ರಿ", "ta": "பொருட்கள்", "ml": "സാമഗ്രി"},
    "transport": {"en": "Transport", "te": "రవాణా", "hi": "परिवहन", "kn": "ಸಾಗಣೆ", "ta": "போக்குவரத்து", "ml": "ഗതാഗതം"},
    "trips": {"en": "trips", "te": "ట్రిప్పులు", "hi": "ट्रिप", "kn": "ಟ್ರಿಪ್‌ಗಳು", "ta": "பயணங்கள்", "ml": "ട്രിപ്പുകൾ"},
    "handling": {"en": "Loading and unloading", "te": "లోడింగ్, అన్‌లోడింగ్", "hi": "लोडिंग और अनलोडिंग", "kn": "ಲೋಡಿಂಗ್ ಮತ್ತು ಅನ್‌ಲೋಡಿಂಗ್", "ta": "ஏற்றுதல், இறக்குதல்", "ml": "ലോഡിംഗും അൺലോഡിംഗും"},
    "laying": {"en": "Laying", "te": "పరచడం", "hi": "बिछाई", "kn": "ಹಾಸುವುದು", "ta": "பதித்தல்", "ml": "പാകൽ"},
    "gst": {"en": "GST", "te": "జీఎస్టీ", "hi": "जीएसटी", "kn": "ಜಿಎಸ್ಟಿ", "ta": "ஜிஎஸ்டி", "ml": "ജിഎസ്ടി"},
    "total": {"en": "Total", "te": "మొత్తం", "hi": "कुल", "kn": "ಒಟ್ಟು", "ta": "மொத்தம்", "ml": "ആകെ"},
    "advance": {"en": "Advance before dispatch", "te": "డిస్పాచ్ ముందు అడ్వాన్స్", "hi": "डिस्पैच से पहले एडवांस", "kn": "ರವಾನೆಗೆ ಮುನ್ನ ಮುಂಗಡ", "ta": "அனுப்புவதற்கு முன் முன்பணம்", "ml": "അയക്കുന്നതിന് മുമ്പുള്ള മുൻകൂർ"},
    "balance_delivery": {"en": "Balance on delivery", "te": "డెలివరీ సమయంలో మిగిలినది", "hi": "डिलीवरी पर शेष", "kn": "ವಿತರಣೆಯಲ್ಲಿ ಬಾಕಿ", "ta": "டெலிவரியின் போது மீதி", "ml": "എത്തിക്കുമ്പോൾ ബാക്കി"},
    "balance_credit": {"en": "Balance due by", "te": "మిగిలినది చెల్లించవలసిన తేదీ", "hi": "शेष की देय तिथि", "kn": "ಬಾಕಿ ಪಾವತಿ ದಿನಾಂಕ", "ta": "மீதி செலுத்த வேண்டிய தேதி", "ml": "ബാക്കി അടയ്ക്കേണ്ട തീയതി"},
    "per": {"en": "per", "te": "చొప్పున", "hi": "प्रति", "kn": "ಪ್ರತಿ", "ta": "ஒன்றுக்கு", "ml": "ഒന്നിന്"},
    "note": {
        "en": "This is a quote, not an invoice. GST is shown separately.",
        "te": "ఇది కొటేషన్, ఇన్‌వాయిస్ కాదు. జీఎస్టీ విడిగా చూపబడింది.",
        "hi": "यह कोटेशन है, इनवॉइस नहीं। जीएसटी अलग से दिखाया गया है।",
        "kn": "ಇದು ಕೊಟೇಶನ್, ಇನ್‌ವಾಯ್ಸ್ ಅಲ್ಲ. ಜಿಎಸ್ಟಿಯನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗಿದೆ.",
        "ta": "இது விலைப்புள்ளி, விலைப்பட்டியல் அல்ல. ஜிஎஸ்டி தனியாகக் காட்டப்பட்டுள்ளது.",
        "ml": "ഇത് ക്വട്ടേഷനാണ്, ഇൻവോയ്സ് അല്ല. ജിഎസ്ടി പ്രത്യേകം കാണിച്ചിരിക്കുന്നു.",
    },
}
UNIT_WORDS: dict[str, dict[str, str]] = {
    "sq_ft": {"en": "sq ft", "te": "చ.అ.", "hi": "वर्ग फुट", "kn": "ಚ.ಅ.", "ta": "ச.அடி", "ml": "ച.അടി"},
    "sq_m": {"en": "sq m", "te": "చ.మీ.", "hi": "वर्ग मीटर", "kn": "ಚ.ಮೀ.", "ta": "ச.மீ", "ml": "ച.മീ"},
    "piece": {"en": "piece", "te": "ముక్క", "hi": "पीस", "kn": "ತುಂಡು", "ta": "துண்டு", "ml": "എണ്ണം"},
    "box": {"en": "box", "te": "బాక్స్", "hi": "बॉक्स", "kn": "ಬಾಕ್ಸ್", "ta": "பெட்டி", "ml": "പെട്ടി"},
    "bag": {"en": "bag", "te": "బస్తా", "hi": "बोरी", "kn": "ಚೀಲ", "ta": "மூட்டை", "ml": "ചാക്ക്"},
    "tonne": {"en": "tonne", "te": "టన్ను", "hi": "टन", "kn": "ಟನ್", "ta": "டன்", "ml": "ടൺ"},
    "cft": {"en": "cft", "te": "క్యూ.అ.", "hi": "सीएफटी", "kn": "ಸಿಎಫ್‌ಟಿ", "ta": "கன அடி", "ml": "ഘന അടി"},
    "truckload": {"en": "truckload", "te": "లారీ లోడ్", "hi": "ट्रक लोड", "kn": "ಟ್ರಕ್ ಲೋಡ್", "ta": "லாரி லோடு", "ml": "ലോറി ലോഡ്"},
}
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _w(key: str, language: str) -> str:
    return WORDS[key][language]


def _unit(unit: str, language: str) -> str:
    return UNIT_WORDS[unit][language]


def _num(value: int) -> str:
    """A whole number with the Indian grouping (12,34,567)."""
    return format_rupees(value * 100).removeprefix("₹").rsplit(".", 1)[0]


def _area(x100: int) -> str:
    whole, hundredths = divmod(x100, 100)
    return _num(whole) + (f".{hundredths:02d}".rstrip("0") if hundredths else "")


def _date(value: str | date) -> str:
    d = value if isinstance(value, date) else date.fromisoformat(value)
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def render(quote: dict[str, Any], language: str) -> str:
    """The message for a stored quote (the database's json of it). Every number is the quote's."""
    if language not in LANGUAGES:
        raise ValueError("language")
    lines: list[str] = [f"{_w('quote', language)} #{quote['quote_no']}", f"{_w('valid', language)}: {_date(quote['valid_until'])}", ""]
    for ln in quote["lines"]:
        sold = _unit(ln["sold_per"], language)
        lines.append(str(ln["name"]))
        if ln["mode"] == "area" and ln.get("area_x100") is not None:
            area_unit = _unit(ln["area_unit"], language) if ln.get("area_unit") else ""
            covered = f"{_w('area', language)}: {_area(ln['area_x100'])} {area_unit}".rstrip()
            count = f"{_num(ln['pieces'])} {_w('pieces', language)}" if ln.get("pieces") is not None else ""
            pallets = f", {_num(ln['pallets'])} {_w('pallets', language)}" if ln.get("pallets") else ""
            lines.append(f"  {covered} = {count}{pallets}".rstrip())
        if ln["sold_per"] in ("sq_ft", "sq_m") and ln.get("delivered_area_x100") is not None:
            billed = ln["delivered_area_x100"] if ln["billed_quantity"] == ln["delivered_area_x100"] else ln["billed_quantity"]
            qty = f"{_area(billed)} {sold}"
        else:
            qty = f"{_num(int(ln['billed_quantity']))} {sold}"
        rate = f"{format_rupees(int(ln['unit_price_paise']))} {_w('per', language)} {sold}"
        lines.append(f"  {rate} x {qty} = {format_rupees(int(ln['material_paise']))}")
        lines.append("")
    lines.append(f"{_w('material', language)}: {format_rupees(int(quote['material_paise']))}")
    if quote["transport_paise"]:
        lines.append(f"{_w('transport', language)} ({quote['trips']} {_w('trips', language)}): {format_rupees(int(quote['transport_paise']))}")
    if quote["handling_paise"]:
        lines.append(f"{_w('handling', language)}: {format_rupees(int(quote['handling_paise']))}")
    if quote["laying_paise"]:
        lines.append(f"{_w('laying', language)}: {format_rupees(int(quote['laying_paise']))}")
    lines.append(f"{_w('gst', language)}: {format_rupees(int(quote['tax_paise']))}")
    lines.append(f"{_w('total', language)}: {format_rupees(int(quote['total_paise']))}")
    lines.append("")
    if int(quote["advance_paise"]):
        lines.append(f"{_w('advance', language)}: {format_rupees(int(quote['advance_paise']))}")
    if int(quote["balance_paise"]):
        if quote.get("due_date"):
            lines.append(f"{_w('balance_credit', language)} {_date(quote['due_date'])}: {format_rupees(int(quote['balance_paise']))}")
        else:
            lines.append(f"{_w('balance_delivery', language)}: {format_rupees(int(quote['balance_paise']))}")
    lines.append("")
    lines.append(_w("note", language))
    return "\n".join(lines)
