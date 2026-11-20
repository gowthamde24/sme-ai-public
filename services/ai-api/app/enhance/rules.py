"""The rules Enhance applies, per language, as DATA (owner, 21 Nov 2026; the same spoken style the calls use: no bookish words, English business words stay in Latin). Drafts for native review."""

# ruff: noqa: E501

from __future__ import annotations

LANGUAGE_NAMES = {"en": "English", "te": "Telugu", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil", "ml": "Malayalam", "mr": "Marathi"}

# every language: the same four things the model must never do
NEVER = (
    "Never add, remove or change a number, an amount, a percentage, a date or a time: they stay exactly as written (only their spelling style may change: lakh and crore, the local date style).",
    "Never add a price, a discount, an offer, a promise or a guarantee, and never add a link, a phone number or a name that was not in the text.",
    "Never claim to be a person.",
    "Keep the meaning and the length close to the original: a polite script, not a longer one.",
    "Keep the SCRIPT of the original: Telugu/Hindi/Kannada letters stay in their letters, a romanised script (Latin letters) stays romanised.",
)

# rule id -> what it means, per language (the model may only use these ids in `changes[].rule`)
RULES: dict[str, dict[str, str]] = {
    "te": {
        "andi": "Soften every ask or question with 'అండీ' (andi) at natural points, never on every word.",
        "garu": "Put 'గారు' (garu) after a person's name or a respectful title.",
        "meeru": "Address the customer as 'మీరు' (meeru), never 'నువ్వు' (nuvvu), and use the polite verb forms.",
        "business_words": "Keep everyday English business words in Latin letters (order, delivery, appointment, offer, call, WhatsApp), the way people speak.",
        "spoken_style": "Spoken Telugu, not bookish: replace stiff literary words with the everyday spoken ones.",
        "money_style": "Money in lakh and crore (e.g. '5 lakh'), never in millions.",
        "date_style": "Dates said the local way ('శనివారం', '25వ తేదీ'), not as '25/11'.",
    },
    "hi": {
        "ji": "Add 'जी' (ji) after names and at natural polite points.",
        "aap": "Address the customer as 'आप' (aap), never 'तुम' or 'तू', with the polite verb forms.",
        "business_words": "Keep everyday English business words in Latin letters (order, delivery, appointment, offer, call, WhatsApp).",
        "spoken_style": "Spoken Hindi, not formal or Sanskritised: everyday words people actually say.",
        "money_style": "Money in lakh and crore (e.g. '5 लाख'), never in millions.",
        "date_style": "Dates said the local way ('शनिवार', '25 तारीख'), not as '25/11'.",
    },
    "kn": {
        "ri": "Add 'ರೀ' (ree) or 'ಅವರೇ' after names and at natural polite points.",
        "neevu": "Address the customer as 'ನೀವು' (neevu), never 'ನೀನು', with the polite verb forms.",
        "business_words": "Keep everyday English business words in Latin letters (order, delivery, appointment, offer, call, WhatsApp).",
        "spoken_style": "Spoken Kannada, not bookish: everyday words people actually say.",
        "money_style": "Money in lakh and crore (e.g. '5 ಲಕ್ಷ'), never in millions.",
        "date_style": "Dates said the local way ('ಶನಿವಾರ', '25ನೇ ತಾರೀಖು'), not as '25/11'.",
    },
    "en": {
        "polite": "Polite and warm: 'please', 'thank you', 'may I' where it is natural, no slang.",
        "plain": "Plain everyday words, short sentences, no jargon.",
        "money_style": "Money in lakh and crore for Indian customers (e.g. 'Rs 5 lakh'), not millions.",
        "date_style": "Dates said the local way ('Saturday the 25th'), not as '25/11'.",
    },
    "ta": {"polite": "Polite forms ('நீங்கள்'), spoken Tamil, English business words stay in Latin.", "money_style": "Money in lakh and crore.", "date_style": "Dates said the local way."},
    "ml": {"polite": "Polite forms ('നിങ്ങൾ'), spoken Malayalam, English business words stay in Latin.", "money_style": "Money in lakh and crore.", "date_style": "Dates said the local way."},
    "mr": {"polite": "Polite forms ('आपण'), spoken Marathi, English business words stay in Latin.", "money_style": "Money in lakh and crore.", "date_style": "Dates said the local way."},
}

# one small example per language (the shape the model must answer in)
EXAMPLES = {
    "te": ("Namaste. Mee enquiry vachindi. Saturday free ga unnara?", "Namaskaram andi! Meeru enquiry chesaru andi. Saturday free ga unnara andi?"),
    "hi": ("Namaste. Aapki enquiry aayi. Kya Saturday free hain?", "Namaste ji! Aapki enquiry aayi thi ji. Kya aap Saturday free hain?"),
}
