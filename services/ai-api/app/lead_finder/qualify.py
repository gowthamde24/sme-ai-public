"""The qualifying call, SIMULATED (ADR 0119, job part C). Our assistant against a scripted retailer persona; nothing is dialled, no telephony provider is imported here, no model is called.

Our side is a deterministic script (the pack's `call` data): an honest opening that says it is the AI assistant of the business (in the first sentence), why it calls, then the questions one at a time (what
they sell, price range, monthly quantity, current supplier, timing, who decides), then a pitch of IN-STOCK items only, each with its catalogue price only when the Owner set one and its minimum order only when
the catalogue has one. It respects "not interested" / "do not call" (stops at once, suppressed for good), "call later" (ends, callback noted), "send it on WhatsApp" (only after an explicit yes to the question
"may we send it to this number on WhatsApp?"), and a hang-up. It never states a number that is not in the catalogue (prices are never computed or guessed: CLAUDE.md rule 4).

The result: a transcript (turns with seconds), the captured answers, a three-line summary, and the outcome the database takes (`prospect_call_finish`): qualified / contacted / not_interested / do_not_call.
A qualified call carries a QUOTE SUGGESTION (in-stock items and the quantities they named; prices only from the catalogue) for the Owner to OK: it is a draft, never sent."""

# ruff: noqa: E501

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.lead_finder.decide import StockLine
from app.lead_finder.packdata import PackLeadFinder
from app.opening.render import compose_opening, says_ai

Language = Literal["en", "te"]
Outcome = Literal["qualified", "contacted", "not_interested", "do_not_call"]
QUESTION_ORDER = ("sells", "price", "quantity", "supplier", "timing", "decision")
CHARS_PER_SECOND = 14.0   # a calm speaking pace, for the transcript's clock (Telugu and English alike, measured on the voice samples of job DS)
PERSONAS = ("interested", "price_shopper", "busy_call_later", "not_interested", "wants_whatsapp", "rude_hangs_up")

L: dict[str, dict[str, str]] = {
    "en": {
        "intro": "Hello, this is the AI assistant of {business}. {purpose} Is this a good time to talk for two minutes?",
        "ok": "Thank you.",
        "pitch_one": "{name}{price}{moq}",
        "pitch_open": "Right now we have in stock: {items}.",
        "price_for": " at {rupees} rupees per {unit}",
        "moq": ", minimum order {moq} {unit}",
        "no_price": "The owner will share the exact price with you.",
        "not_in_stock": "{name} is not in stock right now, so I won't offer it. I can tell you what we do have.",
        "offer_details": "Shall the owner call you back with a quote for these?",
        "whatsapp_ask": "May we send the details on WhatsApp to this same number?",
        "whatsapp_yes": "Thank you, the details will come on WhatsApp from {business}.",
        "whatsapp_no": "No problem, we will not message you.",
        "later": "Sure, we will call you later. Thank you!",
        "stop": "Understood, we will not call you again. Sorry to disturb you. Thank you!",
        "rude": "Sorry to disturb you. Thank you, goodbye.",
        "ai_yes": "Yes, I am an AI assistant calling for {business}. The owner reads everything you tell me.",
        "close_q": "Thank you, the owner will call you with a quote. Have a good day!",
        "close": "Thank you for your time. Have a good day!",
        "repeat": "Sorry, I did not catch that.",
    },
    "te": {
        "intro": "నమస్కారం అండీ, నేను {business} నుంచి AI assistant ని మాట్లాడుతున్నాను. {purpose} రెండు నిమిషాలు మాట్లాడొచ్చా?",
        "ok": "థాంక్యూ అండీ.",
        "pitch_one": "{name}{price}{moq}",
        "pitch_open": "ఇప్పుడు మా దగ్గర stock లో ఉన్నవి: {items}.",
        "price_for": ", ఒక {unit} {rupees} రూపాయలు",
        "moq": ", కనీసం {moq} {unit}",
        "no_price": "Exact rate owner గారు మీకు చెప్తారు.",
        "not_in_stock": "{name} ఇప్పుడు stock లో లేదండీ, అందుకే offer చేయను. మా దగ్గర ఉన్నవి చెప్తాను.",
        "offer_details": "వీటికి owner గారు quote తో మీకు call చేయమంటారా?",
        "whatsapp_ask": "Details ఇదే number కి WhatsApp లో పంపొచ్చా?",
        "whatsapp_yes": "థాంక్యూ అండీ, {business} నుంచి WhatsApp లో details వస్తాయి.",
        "whatsapp_no": "పర్లేదండీ, మేము message పెట్టం.",
        "later": "సరేనండీ, తర్వాత call చేస్తాం. థాంక్యూ!",
        "stop": "అర్థమైందండీ, మళ్ళీ కాల్ చేయం. disturb చేసినందుకు sorry. థాంక్యూ!",
        "rude": "disturb చేసినందుకు sorry అండీ. థాంక్యూ.",
        "ai_yes": "అవునండీ, నేను {business} కోసం call చేస్తున్న AI assistant ని. మీరు చెప్పింది అంతా owner గారు చదువుతారు.",
        "close_q": "థాంక్యూ అండీ, owner గారు quote తో మీకు call చేస్తారు. మంచి రోజు!",
        "close": "మీ time కి థాంక్యూ అండీ. మంచి రోజు!",
        "repeat": "Sorry అండీ, సరిగ్గా వినపడలేదు.",
    },
}

# what the other side meant (en + te + the common loanwords); checked in this order: stop beats everything
_STOP = re.compile(r"don'?t call|do not call|never call|stop calling|remove (my|this) number|call cheyy?akandi|call చేయకండి|కాల్ చేయకండి|మళ్ళీ చేయకండి|ఫోన్ చేయకండి", re.I)
_NOT_INTERESTED = re.compile(r"not interested|no need|we don'?t need|interest ledu|ఇంట్రెస్ట్ లేదు|interest లేదు|అవసరం లేదు|వద్దు", re.I)
_LATER = re.compile(r"call (me )?later|busy|call tomorrow|in a meeting|తర్వాత|రేపు|busy గా|బిజీ", re.I)
_WHATSAPP = re.compile(r"whats ?app|వాట్సాప్", re.I)
_HANGUP = re.compile(r"^\s*\[hangs up\]\s*$|^\s*\[call ended\]\s*$", re.I)
_RUDE = re.compile(r"waste|nonsense|stupid|get lost|bother(ing)? me|పనికిమాలిన|విసిగించకండి", re.I)
_YES = re.compile(r"\b(yes|yeah|ok|okay|sure|go ahead|tell me|please do|send it)\b|అవును|సరే|చెప్పండి|పంపండి|ok అండీ|ఓకే", re.I)
_NO = re.compile(r"^\s*(no|nope|don'?t|వద్దు|లేదు)\b", re.I)
_ASK_AI = re.compile(r"are you (a )?(robot|machine|ai|human|real)|is this (a )?(robot|recording)|మీరు robot|మనిషా|AI ఆ", re.I)
_ASK_PRICE = re.compile(r"\b(price|rate|cost|how much)\b|రేటు|ధర|rate ఎంత|ఎంత", re.I)
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def intent_of(text: str) -> str:
    if _HANGUP.search(text):
        return "hangup"
    if _STOP.search(text):
        return "stop"
    if _RUDE.search(text):
        return "rude"
    if _NOT_INTERESTED.search(text):
        return "not_interested"
    if _ASK_AI.search(text):
        return "ask_ai"
    if _LATER.search(text):
        return "later"
    if _WHATSAPP.search(text):
        return "whatsapp"
    if _NO.search(text):
        return "no"
    if _YES.search(text):
        return "yes"
    return "answer"


@dataclass
class Turn:
    who: Literal["assistant", "business"]
    text: str
    t: float
    kind: str = ""   # assistant turns: intro, question:<key>, pitch, not_in_stock, price, whatsapp_ask, stop, later, close ...


@dataclass
class CallResult:
    language: str
    persona: str
    outcome: Outcome
    end_reason: str
    turns: list[Turn]
    captured: dict[str, str] = field(default_factory=dict)
    whatsapp_ok: bool = False
    callback: bool = False
    pitched: list[str] = field(default_factory=list)
    quote_suggestion: list[dict[str, Any]] = field(default_factory=list)
    summary: str = ""

    def qualification(self) -> dict[str, Any]:
        """What the database keeps (`prospects.qualification`): the answers, the summary, the suggestion; never the transcript."""
        return {"summary": self.summary, "captured": self.captured, "language": self.language, "whatsapp_ok": self.whatsapp_ok, "callback": self.callback,
                "pitched": self.pitched, "quote_suggestion": self.quote_suggestion, "simulated": True}


Persona = Callable[[str, int, Turn], str]


def _rupees(paise: int) -> str:
    r = paise // 100
    return f"{r:,}" if paise % 100 == 0 else f"{paise / 100:.2f}"


def pitch_line(item: StockLine, lang: str) -> str:
    w = L[lang]
    price = w["price_for"].format(rupees=_rupees(item.price_paise), unit=item.unit) if item.price_paise else ""
    moq = w["moq"].format(moq=item.moq, unit=item.unit) if item.moq else ""
    return w["pitch_one"].format(name=item.name, price=price, moq=moq)


class Qualifier:
    """Our side of the call. `step(reply)` -> the next thing we say (or None when the call is over)."""

    MAX_TURNS = 14

    def __init__(self, *, business: str, data: PackLeadFinder, stock: list[StockLine], language: Language, likely: tuple[str, ...] = ()) -> None:
        self.business = business
        self.data = data
        self.lang: Language = language if language in L else "en"
        # only what is IN STOCK is offered: "few left" is the Owner's to promise, made to order is not stock
        self.available = [s for s in stock if s.stock == "in_stock"]
        self.unavailable = [s for s in stock if s.stock != "in_stock"]
        self.likely = likely
        self.pending: list[str] = list(QUESTION_ORDER)
        self.asked: str | None = None
        self.captured: dict[str, str] = {}
        self.pitched: list[str] = []
        self.state = "intro"
        self.outcome: Outcome = "contacted"
        self.end_reason = "goodbye"
        self.whatsapp_ok = False
        self.callback = False
        self.done = False

    def _w(self, key: str, **kw: Any) -> str:
        return L[self.lang][key].format(business=self.business, **kw)

    def opening(self) -> tuple[str, str]:
        purpose = self.data.purpose.get(self.lang) or self.data.purpose.get("en", "")
        line = compose_opening(self.lang, owner_line=self._w("intro", purpose=purpose), mention_ai=True, assistant=None, business=self.business)
        return line, "intro"

    def _pitch_items(self) -> list[StockLine]:
        if not self.available:
            return []
        if self.likely:
            hits = [s for s in self.available if any(w in s.keywords.casefold() for w in self.likely)]
            if hits:
                return hits[:3]
        return self.available[:3]

    def _pitch(self) -> tuple[str, str]:
        items = self._pitch_items()
        self.pitched = [s.name for s in items]
        if not items:
            self.state = "closing"
            return self._w("close"), "close"
        text = self._w("pitch_open", items="; ".join(pitch_line(s, self.lang) for s in items))
        if any(s.price_paise is None for s in items):
            text += " " + self._w("no_price")
        self.state = "offer"
        return f"{text} {self._w('offer_details')}", "pitch"

    def _next_question(self) -> tuple[str, str]:
        if not self.pending:
            return self._pitch()
        key = self.pending.pop(0)
        self.asked = key
        q = self.data.questions[key].get(self.lang) or self.data.questions[key]["en"]
        return q, f"question:{key}"

    def _end(self, key: str, outcome: Outcome, reason: str) -> tuple[str, str]:
        self.outcome, self.end_reason, self.done = outcome, reason, True
        return self._w(key), key

    def _price_answer(self, reply: str) -> tuple[str, str] | None:
        """They asked a price: only a catalogue price, never a made-up one; an item we do not have is said to be out of stock (and not offered)."""
        low = reply.casefold()
        for s in self.unavailable:
            if s.name.casefold() in low or any(w and w in low for w in s.keywords.casefold().split() if len(w) > 4):
                return self._w("not_in_stock", name=s.name), "not_in_stock"
        items = self._pitch_items()
        priced = [s for s in items if s.price_paise]
        if priced:
            return " ".join(pitch_line(s, self.lang) + "." for s in priced[:2]), "price"
        return self._w("no_price"), "price"

    def step(self, reply: str) -> tuple[str, str] | None:
        if self.done:
            return None
        intent = intent_of(reply)
        if intent == "hangup":
            self.outcome, self.end_reason, self.done = "contacted", "caller_hung_up", True
            return None
        if intent == "stop":
            return self._end("stop", "do_not_call", "stopped")
        if intent == "not_interested":
            return self._end("stop", "not_interested", "stopped")
        if intent == "rude":
            return self._end("rude", "contacted", "we_hung_up")
        if intent == "ask_ai":
            return self._w("ai_yes"), "ai_yes"
        if intent == "later" and self.state in ("intro", "questions"):
            self.callback = True
            return self._end("later", "contacted", "goodbye")
        if self.state == "whatsapp":
            if intent == "yes":
                self.whatsapp_ok = True
                self.state = "closing"
                # the details they will get (after the Owner approves the message in the outbox) are the in-stock items only
                self.pitched = [x.name for x in self._pitch_items()]
                return self._end("whatsapp_yes", "qualified", "goodbye")
            self.state = "closing"
            return self._end("whatsapp_no", "qualified" if self.captured else "contacted", "goodbye")
        if intent == "whatsapp":
            # never a message without an explicit yes to the question itself
            self.state = "whatsapp"
            return self._w("whatsapp_ask"), "whatsapp_ask"
        if self.state == "intro":
            if intent in ("no",):
                self.callback = True
                return self._end("later", "contacted", "goodbye")
            self.state = "questions"
            return self._next_question()
        if self.state == "questions":
            if _ASK_PRICE.search(reply) and "?" in reply:
                said = self._price_answer(reply)
                if said:
                    return said
            if self.asked:
                self.captured[self.asked] = reply.strip()[:200]
            return self._next_question()
        if self.state == "offer":
            if _ASK_PRICE.search(reply) and "?" in reply:
                said = self._price_answer(reply)
                if said:
                    return said
            if intent in ("yes", "answer"):
                return self._end("close_q", "qualified", "goodbye")
            return self._end("close", "qualified" if self.captured else "contacted", "goodbye")
        return self._end("close", "contacted", "goodbye")


# ------------------------------------------------------------------------------------------------------------------------------------- personas
# Each persona answers our last turn. They are scripted so the evals are exact and free; the wording is everyday speech in each language.
_ANSWERS: dict[str, dict[str, dict[str, str]]] = {
    "textile": {
        "en": {"sells": "Mostly silk and soft silk sarees, some cotton.", "price": "Between three thousand and eight thousand sells best.", "quantity": "About forty pieces a month, more in the season.",
               "supplier": "We buy from a wholesaler in Chickpet.", "timing": "We stock up in September for the wedding season.", "decision": "I decide, I am the owner."},
        "te": {"sells": "ఎక్కువగా పట్టు, soft silk చీరలు, కొన్ని cotton.", "price": "మూడు వేల నుంచి ఎనిమిది వేల మధ్య ఎక్కువ అమ్ముడవుతాయి.", "quantity": "నెలకి సుమారు నలభై pieces, season లో ఎక్కువ.",
               "supplier": "Chickpet లో ఒక wholesaler దగ్గర తీసుకుంటాం.", "timing": "పెళ్ళిళ్ళ season కి September లో stock తీసుకుంటాం.", "decision": "నేనే decide చేస్తాను, నేనే owner ని."},
    },
    "materials": {
        "en": {"sells": "Two independent houses and one small apartment.", "price": "We get cement at around the market rate.", "quantity": "About two hundred bags of cement a month.",
               "supplier": "A dealer near the bus stand.", "timing": "The next project starts in two weeks.", "decision": "My partner and I decide together."},
        "te": {"sells": "రెండు independent houses, ఒక చిన్న apartment.", "price": "Cement market rate కి తీసుకుంటాం.", "quantity": "నెలకి సుమారు రెండు వందల bags cement.",
               "supplier": "Bus stand దగ్గర ఒక dealer.", "timing": "Next project రెండు వారాల్లో start అవుతుంది.", "decision": "నేను, నా partner కలిసి decide చేస్తాం."},
    },
}
_LINES: dict[str, dict[str, str]] = {
    "en": {"yes": "Yes, tell me.", "busy": "I am busy right now, call me later.", "stop": "Not interested. Please don't call this number again.", "wa": "Just send it on WhatsApp.",
           "wa_yes": "Yes, send it.", "rude": "This is a waste of my time, stop bothering me.", "hang": "[hangs up]", "price_q": "What is your price for {item}?", "oos_q": "Do you have {item}? What is the price?",
           "offer_yes": "Yes, ask the owner to call me.", "ai_q": "Wait, are you a robot?"},
    "te": {"yes": "చెప్పండి.", "busy": "ఇప్పుడు busy గా ఉన్నాను, తర్వాత call చేయండి.", "stop": "ఇంట్రెస్ట్ లేదు. ఈ number కి మళ్ళీ కాల్ చేయకండి.", "wa": "WhatsApp లో పంపండి చాలు.",
           "wa_yes": "అవును, పంపండి.", "rude": "పనికిమాలిన call, విసిగించకండి.", "hang": "[hangs up]", "price_q": "{item} rate ఎంత?", "oos_q": "{item} ఉందా? rate ఎంత?",
           "offer_yes": "సరే, owner గారిని call చేయమనండి.", "ai_q": "ఆగండి, మీరు robot ఆ?"},
}


def make_persona(name: str, lang: str, domain: str, *, priced_item: str | None, missing_item: str | None) -> Persona:
    answers = _ANSWERS[domain][lang]
    lines = _LINES[lang]

    memory = {"q": "sells"}

    def reply(_kind_unused: str, n: int, last: Turn) -> str:
        kind = last.kind
        if kind.startswith("question:"):
            memory["q"] = kind.split(":", 1)[1]
        if name == "rude_hangs_up":
            return lines["rude"] if n == 0 else lines["hang"]
        if name == "not_interested":
            return lines["stop"]
        if name == "busy_call_later":
            return lines["busy"]
        if kind == "whatsapp_ask":
            return lines["wa_yes"]
        if kind.startswith("question:"):
            key = kind.split(":", 1)[1]
            if name == "price_shopper" and key == "price" and missing_item:
                return lines["oos_q"].format(item=missing_item)
            if name == "price_shopper" and key == "quantity" and priced_item:
                return lines["price_q"].format(item=priced_item)
            if name == "wants_whatsapp" and key == "quantity":
                return lines["wa"]
            if name == "interested" and key == "supplier":
                return lines["ai_q"]
            return answers[key]
        if kind in ("ai_yes", "not_in_stock", "price"):
            return answers[memory["q"]]   # back to the question that was asked
        if kind == "pitch":
            return lines["offer_yes"]
        return lines["yes"]

    return reply


def simulate(*, business: str, data: PackLeadFinder, stock: list[StockLine], language: Language, persona: str, domain: str, likely: tuple[str, ...] = ()) -> CallResult:
    """One whole call, our script against one persona. Deterministic."""
    priced = next((s.name for s in stock if s.stock == "in_stock" and s.price_paise), None)
    missing = next((s.name for s in stock if s.stock in ("made_to_order", "out_of_stock")), None)
    other = make_persona(persona, language, domain, priced_item=priced, missing_item=missing)
    q = Qualifier(business=business, data=data, stock=stock, language=language, likely=likely)
    clock = 0.0
    turns: list[Turn] = []

    def say(who: Literal["assistant", "business"], text: str, kind: str = "") -> Turn:
        nonlocal clock
        turn = Turn(who=who, text=text, t=round(clock, 1), kind=kind)
        turns.append(turn)
        clock += max(1.0, len(text) / CHARS_PER_SECOND) + 0.6
        return turn

    text, kind = q.opening()
    last = say("assistant", text, kind)
    n = 0
    while not q.done and n < Qualifier.MAX_TURNS:
        answer = other(last.kind, n, last)
        say("business", answer)
        n += 1
        nxt = q.step(answer)
        if nxt is None:
            break
        last = say("assistant", nxt[0], nxt[1])
    result = CallResult(language=language, persona=persona, outcome=q.outcome, end_reason=q.end_reason, turns=turns, captured=dict(q.captured), whatsapp_ok=q.whatsapp_ok,
                        callback=q.callback, pitched=list(q.pitched))
    if result.outcome == "qualified":
        qty = q.captured.get("quantity", "")
        result.quote_suggestion = [{"item": s.name, "unit": s.unit, "price_paise": s.price_paise, "moq": s.moq, "quantity_said": qty[:120]} for s in stock if s.name in q.pitched]
    result.summary = summary(result)
    return result


def summary(r: CallResult) -> str:
    """Three short lines from the captured answers only (no model): what they sell, how much and when, the result."""
    c = r.captured
    first = f"Sells: {c['sells']}" if c.get("sells") else "Did not say what they sell."
    second = "; ".join(x for x in (c.get("quantity") and f"Quantity: {c['quantity']}", c.get("timing") and f"Timing: {c['timing']}", c.get("supplier") and f"Buys from: {c['supplier']}") if x) or "No quantity or timing given."
    third = {"qualified": "Interested: the owner should call with a quote.", "contacted": "Asked to be called later." if r.callback else "Call ended without interest.",
             "not_interested": "Not interested: will not be called again.", "do_not_call": "Asked not to be called again."}[r.outcome]
    if r.whatsapp_ok:
        third += " Agreed to details on WhatsApp."
    return f"{first}\n{second}\n{third}"[:1200]


# ------------------------------------------------------------------------------------------------------------------------------------- evals
@dataclass(frozen=True)
class EvalResult:
    name: str
    passed: bool
    detail: str = ""


def allowed_numbers(stock: list[StockLine]) -> set[str]:
    out: set[str] = set()
    for s in stock:
        if s.price_paise:
            out.add(_rupees(s.price_paise).replace(",", ""))
        if s.moq:
            out.add(str(s.moq))
    return out


def evaluate(r: CallResult, stock: list[StockLine]) -> list[EvalResult]:
    ours = [t for t in r.turns if t.who == "assistant"]
    first = ours[0] if ours else None
    unavailable = [s.name for s in stock if s.stock != "in_stock"]
    results: list[EvalResult] = []
    # 1. the AI disclosure, in the first sentence and inside the first 10 seconds of speech
    pos = -1
    if first is not None:
        m = re.search(r"\bAI\b", first.text)
        pos = m.start() if m else -1
    secs = pos / CHARS_PER_SECOND if pos >= 0 else 99.0
    results.append(EvalResult("disclosure_first_10s", bool(first and says_ai(first.text) and first.t == 0 and secs < 10), f"at {secs:.1f} s"))
    # 2. never pitches an out-of-stock item (it may only say that it is not in stock)
    bad = [t.text for t in ours if t.kind != "not_in_stock" and any(n.casefold() in t.text.casefold() for n in unavailable)]
    results.append(EvalResult("never_pitches_out_of_stock", not bad and all(n not in r.pitched for n in unavailable), "; ".join(bad)[:200]))
    # 3. never invents a price: every number we say is a catalogue price or minimum order
    allowed = allowed_numbers(stock)
    names = sorted((s.name for s in stock), key=len, reverse=True)   # "OPC 53 Cement", "TMT Steel 12mm": a number in our own item's name is not a price

    def strip_names(text: str) -> str:
        for n in names:
            text = text.replace(n, " ")
        return text

    said = {n.replace(",", "") for t in ours for n in _NUMBER.findall(strip_names(t.text))}
    results.append(EvalResult("never_invents_prices", said <= allowed, f"said {sorted(said - allowed)}"))
    # 4. stops on "don't call" / "not interested": the next thing we say is the goodbye, nothing after it
    for i, t in enumerate(r.turns):
        if t.who == "business" and intent_of(t.text) in ("stop", "not_interested"):
            after = [x for x in r.turns[i + 1:] if x.who == "assistant"]
            ok = len(after) == 1 and after[0].kind == "stop" and r.outcome in ("do_not_call", "not_interested")
            results.append(EvalResult("stops_on_dont_call", ok, f"{len(after)} turns after"))
            break
    # 5. the language of the call (Telugu script in a te call, none in an en call)
    te = re.compile(r"[ఀ-౿]")
    lang_ok = all(bool(te.search(t.text)) for t in ours) if r.language == "te" else not any(te.search(t.text) for t in ours)
    results.append(EvalResult("speaks_the_call_language", lang_ok))
    # 6. WhatsApp only with an explicit yes to the question
    if r.whatsapp_ok:
        asked = [i for i, t in enumerate(r.turns) if t.kind == "whatsapp_ask"]
        ok = bool(asked) and asked[-1] + 1 < len(r.turns) and intent_of(r.turns[asked[-1] + 1].text) == "yes"
        results.append(EvalResult("whatsapp_only_with_yes", ok))
    # 7. one question at a time
    results.append(EvalResult("one_question_per_turn", all(t.text.count("?") <= 1 for t in ours if t.kind.startswith("question:"))))
    return results


EXPECTED_OUTCOME = {"interested": "qualified", "price_shopper": "qualified", "busy_call_later": "contacted", "not_interested": "do_not_call", "wants_whatsapp": "qualified", "rude_hangs_up": "contacted"}
