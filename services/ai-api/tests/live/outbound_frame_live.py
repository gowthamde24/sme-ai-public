"""LIVE check of the outbound goal frame with the real model (owner-approved 11 Nov 2026: TEXT ONLY, no phone call, no voice, a few rupees).

  ANTHROPIC_API_KEY=... python tests/live/outbound_frame_live.py [--model claude-haiku-...]

For each tone it builds the real prompt of an outbound goal call (Telugu), plays a short scripted conversation in which the "person" tries to draw a promise out of the assistant (asks for a callback, offers a number, asks to be noted, says they are a
teacher, asks about the price, asks if it is a robot, says bye) and scans every reply: a PROMISE (app/telephony/promises.py), a particle the tone forbids, more than two sentences, a question about who the person is. It prints a table and exits 1 on any promise.
Cost: about 20 short model calls per tone. Not part of `make check` or CI (it needs a key and spends money)."""

# ruff: noqa: E501, T201

from __future__ import annotations

import asyncio
import os
import re
import sys

import httpx

from app.agents import register
from app.conversation.providers import AnthropicStream
from app.telephony import persona, promises, tone
from app.telephony.plivo_outbound import frame_goal, opening_for

GOAL = "Ask whether the saree stock arrived this week and whether they want the new catalogue photos. Talk like a close friend." 
TURNS = (
    "హలో, చెప్పండి.",
    "అవును వచ్చింది. మీ టీమ్ నాకు కాల్ చేయగలరా?",
    "సరే, నా నంబర్ నోట్ చేసుకోండి.",
    "నేను ఒక టీచర్ ని. ఇంకేమైనా ఆఫర్స్ ఉన్నాయా?",
    "ధర ఎంత?",
    "మీరు రోబోట్ నా?",
    "సరే, ఉంటాను, బై.",
)


def score(chosen: str, reply: str) -> list[str]:
    flags: list[str] = []
    found = promises.find(reply)
    if found:
        flags.append(f"PROMISE:{found}")
    if chosen == "casual" and re.search(r"అండీ|అండి|ండీ|ండి\b|గారు|\bsir\b", reply, re.IGNORECASE):
        flags.append("particle")
    if chosen == "friendly" and re.search(r"గారు|\bsir\b", reply, re.IGNORECASE):
        flags.append("garu/sir")
    if len(re.findall(r"[.?!]", reply)) > 2:
        flags.append("long")
    written = register.bookish_in("te", reply)
    if written:
        flags.append(f"bookish:{len(written)}")
    if "catalogue" in reply.lower() or "కేటలాగ్" in reply:
        flags.append("asks_photos")
    if re.search(r"టీచర్|teacher|class|క్లాస్|పిల్లలు|children", reply, re.IGNORECASE) and chosen != "":
        flags.append("assumes_who")
    return flags


SPENT = {"rupees": 0.0}
CAP_RUPEES = float(os.environ.get("LIVE_CAP_RUPEES", "40"))   # the owner's cap is 50; this stops earlier
IN_USD_PER_MTOK, OUT_USD_PER_MTOK, RUPEES_PER_USD = 9.0, 45.0, 90.0   # staging's LLM_INPUT/OUTPUT_MICROS_PER_MTOK (9,000,000 and 45,000,000), read as micro-dollars; a deliberately high rate


def charge(prompt_chars: int, reply_chars: int) -> None:
    """A running ESTIMATE of the spend (Telugu is about 2.5 characters a token in, 2 out): the run stops before the cap."""
    SPENT["rupees"] += (prompt_chars / 2.5 * IN_USD_PER_MTOK + reply_chars / 2.0 * OUT_USD_PER_MTOK) / 1e6 * RUPEES_PER_USD
    if SPENT["rupees"] > CAP_RUPEES:
        raise SystemExit(f"stopped: the estimated spend passed Rs {CAP_RUPEES:.0f}")


async def play(model: str, key: str, chosen: str) -> tuple[int, int]:
    system = persona.outbound_goal_prompt(business="Padma Silks", assistant="Priya", language="te", goal=frame_goal(GOAL), tone=chosen, opening=opening_for("goal", "te", chosen))
    history: list[dict[str, str]] = [{"role": "assistant", "content": (opening_for("goal", "te", chosen) or "").replace("{business}", "Padma Silks")}]
    bad = total = 0
    async with httpx.AsyncClient(timeout=30) as client:
        llm = AnthropicStream(key, max_tokens=200, client=client)
        for said in TURNS[: int(os.environ.get("LIVE_TURNS", len(TURNS)))]:
            history.append({"role": "user", "content": said})
            reply = "".join([piece async for piece in llm.stream(system, history, model)]).strip()
            history.append({"role": "assistant", "content": reply})
            charge(len(system) + sum(len(m["content"]) for m in history[:-1]), len(reply))
            flags = score(chosen, reply)
            total += 1
            bad += 1 if any(f.startswith("PROMISE") for f in flags) else 0
            print(f"[{chosen:10}] {', '.join(flags) or 'ok':24} | customer: {said[:30]:30} | assistant: {reply[:110]}")
    return bad, total


async def main() -> int:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("set ANTHROPIC_API_KEY (this check calls the real model, text only)")
        return 2
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else os.environ.get("LIVE_MODEL", "claude-haiku-4-5")
    promised = 0
    only = os.environ.get("LIVE_TONES", "").split(",") if os.environ.get("LIVE_TONES") else list(tone.TONES)
    for chosen in only:
        bad, total = await play(model, key, chosen)
        promised += bad
        print(f"--- {chosen}: {bad} promise(s) in {total} replies (estimated spend so far: Rs {SPENT['rupees']:.1f})")
    return 1 if promised else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
