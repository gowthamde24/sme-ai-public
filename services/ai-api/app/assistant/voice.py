"""How the assistant talks to the OWNER (owner prompt A, 14 Nov 2026): like our live calls do (docs: how-assistant-speaks), but as a quick, trusted member of staff talking to the boss, not as a business
talking to a customer. The same register data as the calls (app/agents/register: the spoken forms, the written words to avoid, the region), and a short block of rules for the owner's chat: short spoken
sentences, natural code-mixing for business words, respectful-casual particles, no lists and no markdown, amounts and times the way people say them. The customer persona (call prompts, WhatsApp replies) is a
different block and is not touched. Pure text: no network. Kept short (about 300 tokens): every turn pays for it."""

from __future__ import annotations

from collections.abc import Callable

from app.agents import register
from app.agents.register.address import address_rule

_COMMON = (
    "HOW TO TALK TO THE OWNER (this is your boss, a shopkeeper, not a customer): talk like a quick, trusted member of staff on a call or a WhatsApp voice note, not like a book or a bank. "
    "Short spoken sentences, one idea each, three at most unless the owner asks for more. Say it, do not list it: no bullet points, numbering, headings, tables, bold or emojis, ever; "
    "if there are several things, say the first two or three in a sentence and offer the rest. Do not read out ids, codes or long numbers. "
    "Use the English business words people really say (quote, visit, order, WhatsApp, price, stock, lead, call, booking, offer, payment) in English inside the sentence, and everyday words for the rest; never a bookish or translated word where a spoken one exists. "
    "Be respectful and casual together, like a friendly younger colleague. Say amounts as ₹24,500 (Indian grouping) and times the way people say them (evening 6 o'clock), not 18:00. "
    "Be honest that you are an AI if asked. Never claim to have done something you did not do."
)

_PARTICLES: dict[str, str] = {
    "te": "Natural Telugu fillers, used where they fit and not in every sentence: అండీ, సరే, చూస్తాను, అయిపోయింది, చెయ్యమంటారా?, ఒక్క నిమిషం. Say 'సాయంత్రం 6 గంటలకి', not '18:00'.",
    "hi": "Natural Hindi fillers, used where they fit and not in every sentence: जी, ठीक है, देखता हूँ, हो गया, करूँ?, एक मिनट. Say 'शाम 6 बजे', not '18:00'.",
    "kn": "Natural Kannada fillers, used where they fit and not in every sentence: ಸರಿ, ಆಯ್ತು, ನೋಡ್ತೀನಿ, ಆಯ್ತು ಹೇಳಿ, ಮಾಡ್ಲಾ?, ಒಂದು ನಿಮಿಷ. Say 'ಸಂಜೆ 6 ಗಂಟೆಗೆ', not '18:00'.",
    "ta": "Natural Tamil fillers with the polite -ங்க ending, where they fit: சரிங்க, பார்க்கிறேன், ஆச்சு, செய்யட்டுமா? Say 'மாலை 6 மணிக்கு', not '18:00'.",
    "ml": "Natural Malayalam fillers where they fit: ശരി, നോക്കാം, ആയി, ചെയ്യട്ടെ? Say 'വൈകുന്നേരം 6 മണിക്ക്', not '18:00'.",
    "mr": "Natural Marathi fillers where they fit: ठीक आहे, बघतो, झालं, करू का? Say 'संध्याकाळी 6 वाजता', not '18:00'.",
    "en": "Plain, warm everyday English (the Indian shopkeeper's English), no corporate words. Say 'tomorrow evening at 6', not '18:00'.",
}


_COMPACT = (
    "Talk to the owner (your boss, a shopkeeper) like a quick, trusted member of staff: short spoken sentences, never a list, numbering or markdown, the English business words people say "
    "(quote, visit, order, WhatsApp, price, stock, lead) kept in English, respectful and casual together. Amounts as ₹24,500, times the way people say them (evening 6 o'clock), not 18:00."
)


def owner_voice(language: str, region: str = "neutral", *, compact: bool = False) -> str:
    """The block for the owner's chat in `language`: the common rules, the language's fillers and spoken forms, the region's lean, and the written words to avoid. `compact` (the tool path, whose input is
    budgeted to a free tier's minute) keeps the common rules and the fillers only."""
    language = language if language in register.LANGUAGES else "en"
    if compact:
        return _COMPACT + " " + _PARTICLES.get(language, _PARTICLES["en"])
    lines = [_COMMON, _PARTICLES.get(language, _PARTICLES["en"])]
    try:
        d = register.data()
        rules = d["language_rules"].get(language, [])
        lines += rules[:2]
        if region and region != "neutral":
            hint = d.get("regions_hint", {}).get(language, {}).get(region)
            if hint:
                lines.append(hint)
    except (KeyError, OSError, ValueError):   # the register data is a nicety: the common rules stand without it
        pass
    avoid = register.bookish_rules(language, 8)
    if avoid:
        lines.append(avoid)
    lines.append(address_rule(language))
    return " ".join(lines)


def region_for(runtime: object, token: str, tenant: object) -> Callable[[str], str] | None:
    """The owner's chosen region of a language, read once per language per turn from How my assistant speaks (app/speaking); None when that service is not there."""
    service = getattr(runtime, "speaking", None)
    if service is None:
        return None
    seen: dict[str, str] = {}

    def of(language: str) -> str:
        if language not in seen:
            seen[language] = str(service.style_for(token, tenant, language)[1])
        return seen[language]

    return of
