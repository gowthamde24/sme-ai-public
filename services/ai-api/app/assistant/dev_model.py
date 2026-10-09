"""A scripted stand-in for the model, for LOCAL DEVELOPMENT ONLY (LLM_PROVIDER=fake, refused outside development like the other fake model). It needs no key and makes no
network call, so the chat can be tried end to end on a developer machine. It plays a careful, boring model: it picks one read tool from the words of the question, then
answers by listing what the tool returned, citing every handle. It is not a measure of any real model's quality (nothing is, until the real adapter has run)."""

from __future__ import annotations

import re

from app.agents.llm.interface import LlmRequest, LlmResponse, ToolCall, Usage

_QUESTION = re.compile(r"THE OWNER'S QUESTION: (.*)", re.DOTALL)
_HANDLE = re.compile(r"^(s\d+) \| ([a-z_]+) \| id [0-9a-f-]+ \| ([^|]*)", re.MULTILINE)
_LANG = re.compile(r"Reply in [A-Za-z]+ \(([a-z]{2})\)")

_INTRO = {
    "en": "Here is what I found:",
    "te": "నాకు కనిపించినవి ఇవి:",
    "hi": "मुझे यह मिला:",
    "kn": "ನನಗೆ ಸಿಕ್ಕಿದ್ದು ಇದು:",
    "ta": "எனக்குக் கிடைத்தவை:",
}
_NONE = {
    "en": "I found nothing for that in your records.",
    "te": "దీని గురించి మీ రికార్డుల్లో ఏమీ కనిపించలేదు.",
    "hi": "इसके बारे में आपके रिकॉर्ड में कुछ नहीं मिला।",
    "kn": "ಇದರ ಬಗ್ಗೆ ನಿಮ್ಮ ದಾಖಲೆಗಳಲ್ಲಿ ಏನೂ ಸಿಗಲಿಲ್ಲ.",
    "ta": "இதைப் பற்றி உங்கள் பதிவுகளில் எதுவும் இல்லை.",
}
_KEYWORDS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"price|rate|cost|ధర|कीमत|ದರ|விலை", re.I), "find_price"),
    (re.compile(r"follow|ఫాలో|फ़ॉलो|ಫಾಲೋ|ஃபாலோ", re.I), "list_followups"),
    (re.compile(r"order|money|paid|held|ఆర్డర్|ऑर्डर|ಆರ್ಡರ್|ஆர்டர்", re.I), "list_orders"),
    (re.compile(r"quote|కోట్|कोट|ಕೋಟ್|கோட்", re.I), "list_quotes"),
    (re.compile(r"enquir|ఎంక్వైరీ|पूछताछ|ವಿಚಾರಣೆ|விசாரணை", re.I), "list_enquiries"),
)


class DevAssistantModel:
    model_id = "fake-selftest"  # the one development model the migration prices

    def complete(self, request: LlmRequest) -> LlmResponse:
        text = "\n".join(b.text for b in request.blocks)
        question = (_QUESTION.search(text) or [None, ""])[1] or ""
        lang_match = _LANG.search(text)
        language = lang_match.group(1) if lang_match else "en"
        usage = Usage(120, 60, 0)
        handles = _HANDLE.findall(text)
        if "tool: " not in text:
            tool = next(
                (name for pattern, name in _KEYWORDS if pattern.search(question)), "get_today"
            )
            args = (
                {"query": " ".join(re.findall(r"\w{3,}", question)[:2]) or "silk"}
                if tool == "find_price"
                else {}
            )
            return LlmResponse(tool_calls=(ToolCall(tool, args),), structured=None, usage=usage)
        if not handles:
            return LlmResponse(
                tool_calls=(),
                structured={
                    "kind": "refusal",
                    "answer": _NONE.get(language, _NONE["en"]),
                    "language": language,
                    "sources": [],
                },
                usage=usage,
            )
        lines = [f"{label.strip()}" for _, _, label in handles[:6]]
        answer = _INTRO.get(language, _INTRO["en"]) + " " + "; ".join(lines)
        return LlmResponse(
            tool_calls=(),
            structured={
                "kind": "answer",
                "answer": answer,
                "language": language,
                "sources": [h for h, _, _ in handles[:6]],
            },
            usage=usage,
        )
