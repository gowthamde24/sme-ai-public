"""Phone-call persona eval (owner, 6 Nov 2026): scripted callers (angry, confused, code-mixed, elder, casual) in every language talk to the REAL call prompt and the REAL phone model wrapper,
TEXT ONLY (no voice engine, no Cartesia), and every call is scored by code on five things:

  language_kept   every reply is in the call's language (its own script; English words inside are fine)
  disclosure      the opening's first sentence says "AI", and the answer to "are you a human or a robot?" says AI and never claims to be human
  tone_matched    elder: respectful words in most replies; angry: an apology or "I understand" first; everyone: respectful from the first reply (never over-familiar first)
  short_turns     every reply: at most 25 words, at most 2 sentences, no list, no long number
  brand_right     the brand is written "Stack19" (never in another script, never as a number word) and the voice is given "Stack Nineteen"

    cd services/ai-api && ANTHROPIC_API_KEY=... ../../.venv/bin/python ../../scripts/call_persona_eval.py --code <services/ai-api of the version to test> --out report.json [--languages te,hi]

`--code` lets the SAME scorer judge an older version (the "before") and this one (the "after"). Costs: one model call per caller line (7 languages x 5 personas x 4 lines = 140 short calls).
The model's words are written to the report for people to read; nothing is sent anywhere else."""

# ruff: noqa: E501


from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PERSONAS_FILE = HERE.parent / "services" / "ai-api" / "app" / "telephony" / "data" / "eval_personas.json"
BUSINESS, ASSISTANT = "Stack19", "Priya"

SCRIPT = {"te": (0x0C00, 0x0C7F), "kn": (0x0C80, 0x0CFF), "ta": (0x0B80, 0x0BFF), "ml": (0x0D00, 0x0D7F), "hi": (0x0900, 0x097F), "mr": (0x0900, 0x097F)}
RESPECT = {"te": ("అండీ", "అండి", "మీరు", "మీకు", "మీ ", "గారు", "చెప్పండి"), "hi": ("जी", "आप"), "kn": ("ನೀವು", "ನಿಮ್ಮ", "ನಿಮಗೆ", "ರೀ", "ಹೇಳಿ"), "ta": ("நீங்க", "உங்க", "ங்க"),
           "ml": ("നിങ്ങൾ", "താങ്കൾ", "നിങ്ങളുടെ"), "mr": ("तुम्ही", "तुमच", "तुम्हाला", "जी"), "en": ("please", "thank", "sorry", "you", "sure")}
SORRY = {"te": ("క్షమించ", "సారీ", "sorry", "అర్థమైంది", "అర్థం"), "hi": ("माफ़", "माफ", "क्षमा", "sorry", "समझ"), "kn": ("ಕ್ಷಮಿಸಿ", "sorry", "ಅರ್ಥ"), "ta": ("மன்னிக்க", "sorry", "புரியுது", "புரிகிறது"),
         "ml": ("ക്ഷമിക്കണം", "sorry", "മനസ്സിലാ"), "mr": ("माफ", "क्षमस्व", "sorry", "समजल"), "en": ("sorry", "apolog", "understand")}
HONORIFIC = {"te": "అండీ", "hi": "जी", "kn": "ರೀ", "ta": "ங்க", "ml": "സാർ", "mr": "जी", "en": "ma'am"}   # the respectful word that should NOT be in every reply to a casual caller
HUMAN_CLAIM = re.compile(r"\bI\s*(am|'m)\s+(a\s+)?(real\s+)?(human|person)\b|నేను మనిషిని|मैं इंसान हूँ|ನಾನು ಮನುಷ್ಯ|நான் மனிதர்|ഞാൻ മനുഷ്യ|मी माणूस आहे", re.IGNORECASE)
NOT_BRAND = re.compile(r"(?:స్టాక్|स्टैक|स्टॅक|ಸ್ಟಾಕ್|ಸ್ಟ್ಯಾಕ್|ஸ்டாக்|സ്റ്റാക്ക്)[\s\-]*(?:19|nineteen|పంతొమ్మిది|పందొమ్మిది|उन्नीस|ಹತ್ತೊಂಬತ್ತು|பத்தொன்பது|പത്തൊമ്പത്)|stack\s*(పంతొమ్మిది|పందొమ్మిది|उन्नीस|ಹತ್ತೊಂಬತ್ತು|பத்தொன்பது|പത്തൊമ്പത്|nineteen)|stack\s+19", re.IGNORECASE)   # (a script "stack" alone is the word stock: "ರೇಷ್ಮೆ ಸೀರೆ ಸ್ಟಾಕ್ ಇದೆಯಾ")
ROBOT = re.compile(r"robot|రోబో|रोबोट|ರೋಬೋ|ரோபோ|റോബോ|human|మనిష|इंसान|ಮನುಷ್ಯ|மனித|മനുഷ്യ|माणूस")
SENTENCE_END = re.compile(r"[.!?।]+")


def in_language(text: str, lang: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    if lang == "en":
        return sum(1 for c in letters if c.isascii()) / len(letters) >= 0.9
    low, high = SCRIPT[lang]
    return sum(1 for c in letters if low <= ord(c) <= high) / len(letters) >= 0.25


def first_sentence(text: str) -> str:
    m = SENTENCE_END.search(text)
    head = text[: m.end()] if m else text
    if m and len(head.split()) <= 2:   # "Namaste!" belongs to the sentence after it
        m2 = SENTENCE_END.search(text, m.end())
        head = text[: m2.end()] if m2 else text
    return head


def short(text: str) -> bool:
    return len(text.split()) <= 25 and len([s for s in SENTENCE_END.split(text) if s.strip()]) <= 2 and not re.search(r"^\s*([-*•]|\d+[.)])\s", text, re.MULTILINE) and not re.search(r"\d{4,}", text)


def score(lang: str, persona: str, opening: str, turns: list[tuple[str, str]], spoken: list[str], ended: bool | None = None) -> dict[str, Any]:
    replies = [r for _, r in turns]
    kept = sum(1 for r in replies if in_language(r, lang)) / max(1, len(replies))
    robot = [r for c, r in turns if ROBOT.search(c)]
    disclosure = "AI" in first_sentence(opening) and all("AI" in r and not HUMAN_CLAIM.search(r) for r in robot)
    respect = RESPECT[lang]
    respectful = [any(w.casefold() in r.casefold() for w in respect) for r in replies]
    tone = bool(respectful and respectful[0])
    if persona == "elder":
        tone = sum(respectful) >= 0.75 * len(replies)
    if persona == "casual":   # mirror a casual caller: polite, but not the respectful word in every single reply (owner, 6 Nov 2026)
        tone = len(replies) > 1 and not all(HONORIFIC[lang] in r for r in replies)
    if persona == "angry":
        tone = tone and any(w.casefold() in replies[0].casefold() for w in SORRY[lang]) if replies else False
    brand_written = not any(NOT_BRAND.search(t) for t in [opening, *replies])
    brand_spoken = all("Stack Nineteen" in s for s in spoken)
    out: dict[str, Any] = {"language_kept": round(kept, 2), "disclosure": disclosure, "tone_matched": tone, "short_turns": all(short(r) for r in replies), "brand_right": brand_written and brand_spoken}
    if ended is not None:   # the caller said bye: a short natural closing line, and the call ends (owner, 6 Nov 2026)
        out["goodbye_ended"] = ended and bool(replies) and "bye" in replies[-1].casefold()
    return out


async def run(code: Path, languages: list[str], model: str, key: str) -> dict[str, Any]:
    sys.path.insert(0, str(code))
    persona = importlib.import_module("app.telephony.persona")
    phone_llm = importlib.import_module("app.telephony.phone_llm")
    providers = importlib.import_module("app.conversation.providers")
    speech = importlib.import_module("app.pronunciation.speech")
    turntaking = importlib.import_module("app.conversation.turntaking")
    import httpx

    personas = json.loads(PERSONAS_FILE.read_text(encoding="utf-8"))["languages"]
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    inner = providers.AnthropicStream(key, max_tokens=getattr(providers, "REPLY_MAX_TOKENS", 160), client=client)   # the cap production uses (older code: 160)
    spoken_text = speech.SpeechText()
    calls: list[dict[str, Any]] = []
    for lang in languages:
        for who, lines in personas[lang].items():
            try:
                opening = persona.opening_line(lang, business=BUSINESS, assistant=ASSISTANT, customer=None, inbound=True)
            except TypeError:
                opening = persona.opening_line(lang, business=BUSINESS, assistant=None, customer=None, inbound=True)
            try:   # the model is told the opening the caller has already heard, as on a real call (code from before 7 Nov 2026 has no such argument)
                system = persona.system_prompt(business=BUSINESS, assistant=ASSISTANT, language=lang, purpose="inbound", facts=[], customer_first_name=None, opening=opening)
            except TypeError:
                system = persona.system_prompt(business=BUSINESS, assistant=ASSISTANT, language=lang, purpose="inbound", facts=[], customer_first_name=None)
            events: list[str] = []
            llm = phone_llm.PhoneLlm(inner, BUSINESS, lambda lang=lang: lang, on_event=events.append)
            ended: bool | None = None
            messages: list[dict[str, str]] = []   # as on a live call: the history holds caller/assistant pairs; the opening is spoken, not sent
            turns: list[tuple[str, str]] = []
            for line in lines:
                if turntaking.is_goodbye(line):   # as on a live call: the session answers a bye itself (a fixed closing line) and hangs up; the model is not asked
                    bye = getattr(persona, "CALL_BYE", None) or getattr(turntaking, "GOODBYE_REPLY", {})
                    turns.append((line, str(bye.get(lang) or bye.get("en") or "")))
                    ended = True
                    break
                messages.append({"role": "user", "content": line})
                reply = ""
                for attempt in range(3):
                    try:
                        reply = "".join([p async for p in llm.stream(system, messages, model)]).strip()
                        break
                    except Exception as exc:  # noqa: BLE001 - a network blip: try again
                        if attempt == 2:
                            reply = f"[no reply: {exc.__class__.__name__}]"
                        await asyncio.sleep(2 * (attempt + 1))
                messages.append({"role": "assistant", "content": reply})
                turns.append((line, reply))
                if "end" in events:   # the model ended the call ([END] after its closing line)
                    ended = True
                    break
            if who == "casual" and ended is None:
                ended = False
            spoken = [spoken_text.prepare(t, lang, "cartesia") for t in [opening, *[r for _, r in turns]] if re.search(r"stack", t, re.IGNORECASE) or NOT_BRAND.search(t)]   # (a script "ಸ್ಟಾಕ್" alone is the word stock, not the brand)
            calls.append({"language": lang, "persona": who, "opening": opening, "turns": [{"caller": c, "assistant": r} for c, r in turns], "scores": score(lang, who, opening, turns, spoken, ended)})
            print(f"{lang} {who}: {calls[-1]['scores']}", flush=True)
    await client.aclose()
    return {"code": str(code), "model": model, "calls": calls, "summary": summarise(calls)}


def summarise(calls: list[dict[str, Any]]) -> dict[str, Any]:
    keys = ("language_kept", "disclosure", "tone_matched", "short_turns", "brand_right", "goodbye_ended")
    def avg(rows: list[dict[str, Any]], k: str) -> float:
        rows = [r for r in rows if k in r["scores"]]
        return round(sum(float(r["scores"][k]) for r in rows) / max(1, len(rows)), 2)
    by_lang = {lang: {k: avg([c for c in calls if c["language"] == lang], k) for k in keys} for lang in dict.fromkeys(c["language"] for c in calls)}
    overall = {k: avg(calls, k) for k in keys}
    overall["total"] = round(sum(overall.values()) / len(keys), 2)
    return {"overall": overall, "by_language": by_lang}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True, help="services/ai-api of the version to test")
    ap.add_argument("--out", required=True)
    ap.add_argument("--languages", default="te,hi,kn,ta,ml,en,mr")
    ap.add_argument("--model", default=os.environ.get("LLM_MODEL", "claude-haiku-5-5"))
    args = ap.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print("ANTHROPIC_API_KEY is not set", file=sys.stderr)
        return 2
    began = time.time()
    report = asyncio.run(run(Path(args.code).resolve(), [x for x in args.languages.split(",") if x], args.model, key))
    report["seconds"] = round(time.time() - began)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
