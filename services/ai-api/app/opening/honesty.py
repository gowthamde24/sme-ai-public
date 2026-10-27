"""The never-claim-to-be-human rule (job DT, ADR 0116). Whatever the Owner's opening line says and whether or not "mention that I'm an AI assistant" is on, the assistant must never say or imply it is a
person. Asked "are you a robot?", "are you a real person?" in any of the product's languages it answers honestly that it is an AI assistant, then carries on with the call.

Three parts: the rule as a prompt fragment (put into every call and voice-note prompt), a deterministic detector for the question, and the honest answer. The detector and the answer are the SAFETY NET: a
reply the model planned is replaced by the honest answer plus the planned reply when the customer's last turn asked the question (`guard_reply`), so the rule does not depend on a model's mood. The evals
(app/opening/data/honesty_eval.json: the question in every language, spoken and romanised, plus statements that must NOT trigger it) run in the unit tests; the live-model variant is the opt-in eval."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "honesty_eval.json"

HONESTY_RULE = (
    "You are an AI assistant, not a person. Never say or suggest that you are human, a real person, a staff member in the room or that you are 'not a robot'. "
    "If the customer asks whether you are a robot, an AI, a machine, a computer or a real person, answer truthfully and briefly that you are an AI assistant of the business, "
    "in the customer's language, then offer to continue or to connect them with a person. Do this even if your opening line did not say it. Never deny being an AI, even when asked twice."
)

# "I'm an AI assistant of {business}. Please tell me what you need and I'll help; or I can connect you to a person."
HONEST_ANSWER = {
    "en": "Yes, I'm an AI assistant of {business}, not a person. Tell me what you need and I'll help, or I can connect you to someone from the team.",
    "te": "అవునండీ, నేను {business} వాళ్ళ AI assistant ని, మనిషిని కాదు. మీకు ఏం కావాలో చెప్పండి, నేను help చేస్తాను. కావాలంటే team లో వాళ్ళకి కలుపుతాను.",
    "hi": "जी हाँ, मैं {business} की AI assistant हूँ, इंसान नहीं। बताइए आपको क्या चाहिए, मैं मदद करूँगी, या चाहें तो टीम के किसी व्यक्ति से जोड़ दूँगी।",
    "kn": "ಹೌದು ಸರ್, ನಾನು {business} ಅವರ AI assistant, ಮನುಷ್ಯ ಅಲ್ಲ. ನಿಮಗೇನು ಬೇಕು ಹೇಳಿ, ನಾನು help ಮಾಡ್ತೀನಿ, ಬೇಕಿದ್ದರೆ team ನವರಿಗೆ ಕನೆಕ್ಟ್ ಮಾಡ್ತೀನಿ.",
    "ta": "ஆமாம், நான் {business} இன் AI assistant, மனிதர் இல்லை. உங்களுக்கு என்ன வேண்டும் என்று சொல்லுங்கள், உதவுகிறேன், வேண்டுமானால் குழுவில் ஒருவரிடம் இணைக்கிறேன்.",
    "ml": "അതെ, ഞാൻ {business} ന്റെ AI assistant ആണ്, മനുഷ്യനല്ല. എന്താണ് വേണ്ടതെന്ന് പറയൂ, ഞാൻ സഹായിക്കാം, വേണമെങ്കിൽ ടീമിലെ ഒരാളുമായി ബന്ധിപ്പിക്കാം.",
    "mr": "हो, मी {business} ची AI assistant आहे, माणूस नाही. तुम्हाला काय हवे ते सांगा, मी मदत करते, किंवा हवे तर टीममधील कोणाशी जोडते.",
    "bn": "হ্যাঁ, আমি {business}-এর AI assistant, মানুষ নই। আপনার কী দরকার বলুন, আমি সাহায্য করব, চাইলে টিমের কারও সঙ্গে যুক্ত করে দেব।",
}

# the question, spoken or written: robot / AI / machine / real person / human, in the product's languages (native script and the romanised way people type or say it)
_QUESTION = re.compile(
    r"(are\s+you|r\s+u|you\s+are|you\s*re|is\s+this|is\s+it|am\s+i\s+talking\s+to|talking\s+to)\b[^.?!]{0,40}\b(robot|bot|ai|a\.i\.|artificial|machine|computer|automated|recorded|human|real\s+person|real\s+human|person|live\s+person|insaan|manishi|manushya)"
    r"|\b(robot|bot|machine|ai)\s+(aa|aah|a|ah|hai|ha|ho|haa|ka|ya|kya)\b|\b(robot|bot)\s*\?|\bkya\s+(aap|tum)\s+(robot|machine|insaan|ai)\b|\b(aap|tum)\s+(robot|machine|insaan|ai|asli)\b"
    r"|(మనిషివా|మనిషా|రోబోట|రోబో|మెషిన్|మెషీన్|ఏఐ|కంప్యూటర్|నిజమైన\s*మనిషి|నిజంగా\s*మనిషి)"
    r"|(रोबोट|रोबॉट|मशीन|इंसान|इन्सान|असली\s*इंसान|एआई|कंप्यूटर|मनुष्य|माणूस|खरी\s*व्यक्ती|खरंच\s*माणूस)"
    r"|(ರೋಬೋಟ್|ರೋಬೋ|ಯಂತ್ರ|ಮನುಷ್ಯ|ಎಐ|ಕಂಪ್ಯೂಟರ್|ನಿಜವಾದ\s*ವ್ಯಕ್ತಿ)"
    r"|(ரோபோ|இயந்திர|மனிதரா|மனிதர்|உண்மையான\s*நபர|கணினி|ஏஐ)"
    r"|(റോബോട്ട|യന്ത്ര|മനുഷ്യ|യഥാർത്ഥ\s*വ്യക്തി|എഐ)"
    r"|(রোবট|যন্ত্র|মানুষ|আসল\s*মানুষ|এআই|কম্পিউটার)",
    re.IGNORECASE,
)
# a plain statement about a robot or a human that is not a question to the assistant (kept out of the detector by the eval)
_NOT_ABOUT_YOU = re.compile(r"(my\s+(son|daughter|friend|brother|cousin)|human\s+resources|robotic\s+surgery|my\s+human)", re.IGNORECASE)


def _plain(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def is_identity_question(text: str) -> bool:
    """True when the customer's turn asks whether they are talking to a robot, an AI or a real person."""
    t = _plain(text)
    if _NOT_ABOUT_YOU.search(t):
        return False
    return bool(_QUESTION.search(t))


def honest_answer(language: str, business: str) -> str:
    template = HONEST_ANSWER.get(language, HONEST_ANSWER["en"])
    return template.replace("{business}", business)


def guard_reply(customer_turn: str, planned_reply: str, language: str, business: str) -> str:
    """The reply to speak: when the customer just asked whether this is a robot or a person, the honest answer comes FIRST, then whatever was planned (the call goes on)."""
    if is_identity_question(customer_turn):
        return f"{honest_answer(language, business)} {planned_reply}".strip()
    return planned_reply


_CLAIMS_HUMAN = re.compile(r"\b(i\s*(am|'m)\s+(a\s+)?(real|human|person|not\s+a\s+(robot|bot|machine|ai))|i'?m\s+not\s+(an?\s+)?(ai|robot|bot|machine)|no,?\s+i\s*(am|'m)\s+(a\s+)?(human|real))\b", re.IGNORECASE)


def claims_to_be_human(reply: str) -> bool:
    """A last check on a planned English reply: it must not say it is human or deny being an AI (the model-side eval and the test double use it)."""
    return bool(_CLAIMS_HUMAN.search(reply))


@lru_cache(maxsize=1)
def eval_set() -> dict[str, list[str]]:
    loaded: dict[str, list[str]] = json.loads(DATA.read_text(encoding="utf-8"))
    return loaded
