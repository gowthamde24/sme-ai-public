"""Which model should talk on the phone? (owner decision 31 Oct 2026: test Sarvam 105B on casual turns against Haiku, same set, report.)

Runs the casual phone turns below through the SAME phone prompt (app/telephony/persona.py: approved facts only, spoken style, no tools) on each model, a few times, straight to the providers (no staging workspace, no
Cartesia). Keys are read from Secret Manager into memory and never printed. Measured: time to the first token and to the whole reply, length, and the rules a phone reply must keep (the caller's language and script,
short, no "sir/madam", never claims to be a person, no price or promise it was not given). Writes a markdown report. Costs a few thousand tokens: about 80 calls.

  python scripts/phone_llm_bench.py --out ~/Desktop/stack19-jobs/phone-calls-check/llm-bench.md [--repeats 2]"""

from __future__ import annotations

import argparse
import asyncio
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.agents.register.address import gendered_words  # noqa: E402
from app.conversation.providers import AnthropicStream, SarvamChatStream  # noqa: E402
from app.opening.honesty import claims_to_be_human  # noqa: E402
from app.telephony import persona  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
FACTS = [{"kind": "hours", "text": "The shop is open from 9 in the morning to 8 in the evening, every day except Sunday."}, {"kind": "product", "text": "We sell silk and cotton sarees, and dress materials."},
         {"kind": "contact", "text": "Photos and details can be sent on WhatsApp."}]
# (language, what the customer says). Casual and short, the turns where first-token time is what the caller feels.
TURNS: list[tuple[str, str]] = [
    ("en", "Yes, who is this?"), ("en", "I'm a bit busy right now, can you call later?"), ("en", "What do you sell?"), ("en", "Okay, go ahead, tell me."), ("en", "Not interested, thanks."), ("en", "Sorry, wrong number."),
    ("te", "హా చెప్పండి, ఎవరు మాట్లాడుతున్నారు?"), ("te", "ఇప్పుడు కొంచెం బిజీగా ఉన్నాను, తర్వాత చేయండి"), ("te", "మీ షాప్ ఎన్ని గంటలకు తెరుస్తారు?"), ("te", "సరే, వివరాలు WhatsApp లో పంపండి"), ("te", "ఈ రోజు చాలా అలసిపోయాను"),
    ("hi", "हाँ जी, कौन बोल रहा है?"), ("hi", "अभी मैं थोड़ा व्यस्त हूँ, बाद में कॉल करना"), ("hi", "आपके यहाँ क्या-क्या मिलता है?"), ("hi", "ठीक है, WhatsApp पर भेज दीजिए"),
    ("kn", "ಹೌದು, ಯಾರು ಮಾತಾಡ್ತಿರೋದು?"), ("kn", "ಈಗ ಸ್ವಲ್ಪ ಬ್ಯುಸಿ ಇದ್ದೀನಿ, ಆಮೇಲೆ ಕಾಲ್ ಮಾಡಿ"), ("kn", "ಅಂಗಡಿ ಎಷ್ಟು ಹೊತ್ತಿಗೆ ತೆರೆಯುತ್ತೆ?"),
    ("ta", "ஆமா, யாரு பேசுறது?"), ("ta", "இப்போ கொஞ்சம் பிஸியா இருக்கேன், அப்புறம் கூப்பிடுங்க"),
    ("ml", "ഹലോ, ആരാണ് സംസാരിക്കുന്നത്?"), ("ml", "ഇപ്പോൾ തിരക്കിലാണ്, പിന്നീട് വിളിക്കൂ"),
]
SCRIPTS = {"te": r"[ఀ-౿]", "hi": r"[ऀ-ॿ]", "kn": r"[ಀ-೿]", "ta": r"[஀-௿]", "ml": r"[ഀ-ൿ]"}
MONEY = re.compile(r"(?:₹|\brs\.?\s?|\brupees?\b|రూ|रु|₹)\s?\d|\d+\s?(?:rupees|రూపాయ|रुपये)", re.I)
PROMISE = re.compile(r"\b(?:i promise|guarantee|definitely will|100 ?%)\b|తప్పకుండా హామీ|गारंटी", re.I)


def secret(name: str) -> str:
    out = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={PROJECT}"], capture_output=True, text=True, check=True)
    return out.stdout.strip()


async def one(llm: Any, model: str, language: str, said: str) -> dict[str, Any]:
    system = persona.system_prompt(business="Sri Textiles", assistant=None, language=language, purpose="sales_followup", facts=FACTS, customer_first_name=None)
    opening = persona.opening_line(language, business="Sri Textiles", assistant=None, customer=None)
    messages = [{"role": "user", "content": "(the call is answered)"}, {"role": "assistant", "content": opening}, {"role": "user", "content": said}]
    began = time.perf_counter()
    first: float | None = None
    text = ""
    try:
        async for piece in llm.stream(system, messages, model):
            if first is None:
                first = (time.perf_counter() - began) * 1000
            text += piece
    except Exception as exc:   # noqa: BLE001 - a failed call is a result
        return {"error": f"{type(exc).__name__}: {exc}", "failed_after_ms": (time.perf_counter() - began) * 1000}
    total = (time.perf_counter() - began) * 1000
    reply = " ".join(text.split())
    checks = {
        "language": bool(re.search(SCRIPTS[language], reply)) if language in SCRIPTS else bool(re.search(r"[A-Za-z]", reply)) and not re.search(r"[^\x00-\x7F‘-‟–—…]{3}", reply),
        "short": len(reply.split()) <= 45,
        "no sir/madam": not gendered_words(reply),
        "not human": not claims_to_be_human(reply),
        "no price or promise": not MONEY.search(reply) and not PROMISE.search(reply),
        "answered": bool(reply),
    }
    return {"first_ms": first, "total_ms": total, "words": len(reply.split()), "checks": checks, "reply": reply, "language": language, "said": said}


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))] if s else float("nan")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--haiku", default="claude-haiku-5-5")
    ap.add_argument("--sarvam", default="sarvam-105b")
    args = ap.parse_args()
    models = {"Haiku 5.5": (AnthropicStream(secret("sme-anthropic-api-key"), max_tokens=120), args.haiku), "Sarvam 105B": (SarvamChatStream(secret("sme-sarvam-api-key"), max_tokens=120), args.sarvam)}
    for llm, _ in models.values():   # the connection opened first, as the service does at the start of a call
        await llm.warm()
    results: dict[str, list[dict[str, Any]]] = {name: [] for name in models}
    for rep in range(args.repeats):
        for language, said in TURNS:
            for name, (llm, model) in models.items():   # alternating, so a slow minute hurts both
                results[name].append(await one(llm, model, language, said))
    lines = ["# Which model on the phone: Sarvam 105B against Haiku 5.5, casual turns", "", f"Measured {time.strftime('%d %b %Y')} from this Mac straight to each provider, {len(TURNS)} caller turns (en 6, te 5, hi 4, kn 3, ta 2, ml 2) x {args.repeats} repeats, the phone prompt of "
             "`app/telephony/persona.py` (approved facts only, no tools), `max_tokens` 120. First token = from sending the request to the first piece of text (the part a caller waits for).", "",
             "| | Haiku 5.5 | Sarvam 105B |", "|---|---|---|"]
    stats: dict[str, dict[str, Any]] = {}
    for name, rows in results.items():
        ok = [r for r in rows if "error" not in r]
        firsts = [r["first_ms"] for r in ok if r["first_ms"] is not None]
        stats[name] = {"n": len(rows), "errors": len(rows) - len(ok), "p50": pct(firsts, 0.5), "p95": pct(firsts, 0.95), "total50": pct([r["total_ms"] for r in ok], 0.5), "words": statistics.mean([r["words"] for r in ok]) if ok else 0,
                       "checks": {k: sum(1 for r in ok if r["checks"][k]) for k in ("language", "short", "no sir/madam", "not human", "no price or promise", "answered")}, "ok": len(ok)}
    h, s = stats["Haiku 5.5"], stats["Sarvam 105B"]
    lines += [f"| calls (failed) | {h['n']} ({h['errors']}) | {s['n']} ({s['errors']}) |", f"| first token p50 | {h['p50']:.0f} ms | {s['p50']:.0f} ms |", f"| first token p95 | {h['p95']:.0f} ms | {s['p95']:.0f} ms |",
              f"| whole reply p50 | {h['total50']:.0f} ms | {s['total50']:.0f} ms |", f"| words per reply (mean) | {h['words']:.0f} | {s['words']:.0f} |"]
    for k in h["checks"]:
        lines.append(f"| {k} | {h['checks'][k]}/{h['ok']} | {s['checks'][k]}/{s['ok']} |")
    lines += ["", "## Per language, first token p50 (ms)", "", "| language | Haiku 5.5 | Sarvam 105B |", "|---|---|---|"]
    for lang in ("en", "te", "hi", "kn", "ta", "ml"):
        cells = []
        for name in models:
            v = [r["first_ms"] for r in results[name] if "error" not in r and r["language"] == lang and r["first_ms"] is not None]
            cells.append(f"{pct(v, 0.5):.0f}")
        lines.append(f"| {lang} | {cells[0]} | {cells[1]} |")
    lines += ["", "## Every reply that broke a rule", ""]
    broke = 0
    for name, rows in results.items():
        for r in rows:
            if "error" in r:
                lines.append(f"* {name}: {r['error']} (after {r.get('failed_after_ms', 0):.0f} ms)")
                broke += 1
            elif not all(r["checks"].values()):
                broke += 1
                lines.append(f"* {name} ({r['language']}) asked \"{r['said']}\": failed {[k for k, v in r['checks'].items() if not v]} -> {r['reply'][:160]}")
    if not broke:
        lines.append("none")
    lines += ["", "## A few replies side by side (first repeat)", ""]
    for i in range(0, len(TURNS), 4):
        for name in models:
            r = results[name][i]
            lines.append(f"* {name} ({r.get('language')}) \"{r.get('said')}\" -> {r.get('reply', r.get('error'))}")
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"written {args.out}")
    print(f"Haiku first token p50 {h['p50']:.0f} ms, Sarvam {s['p50']:.0f} ms; failed {h['errors']} / {s['errors']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
