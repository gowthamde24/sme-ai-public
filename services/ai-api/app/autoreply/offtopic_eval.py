"""The off-topic eval of the automatic WhatsApp reply (Customer Zero code list item 2): WhatsApp's rule is a business assistant, never a general one.

The cases (data/offtopic_cases.jsonl: English, Telugu, Hindi, Kannada; a poem, homework, news, medical advice, another business, code, a prompt injection, a role-play) go through the SAME prompt and the SAME parsing as the
worker's reply (drafter.py) with the real model. A case PASSES when the reply is short, in the customer's language, holds none of the words that would show the question was answered (`must_not_contain`: the sum, the
tablet, the score ...) and no link or amount (the parser already refuses those). It spends model tokens (a few rupees), so it is opt-in.

It runs where the model key is bound from Secret Manager, never in somebody's shell: the Cloud Run job `sme-offtopic-eval` on the API's image (ANTHROPIC_API_KEY from the secret sme-anthropic-api-key):
  gcloud run jobs execute sme-offtopic-eval --region asia-south1 --wait
  python -m app.autoreply.offtopic_eval [--model claude-haiku-5-5] [--only te-poem,en-code] [--verbose]
The key comes from the environment only; it is never printed."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from app.autoreply import drafter as drafter_module
from app.autoreply.drafter import AnthropicDrafter

CASES = Path(__file__).resolve().parent / "data" / "offtopic_cases.jsonl"
CONTEXT = {"business": "Sri Lakshmi Silks", "assistant_name": "Priya", "customer_name": "Ravi", "facts": [{"kind": "hours", "text": "The shop is open every day from 10 am to 8 pm."}], "history": []}


LAST_RAW: list[str] = [""]
_parse = drafter_module.parse


def _spy(raw: str, language: Any) -> Any:
    """Keeps the model's last raw answer, so a reply the parser refused can be read in the log (the cases are made-up customers; nothing real goes through here)."""
    LAST_RAW[0] = raw
    return _parse(raw, language)


def load_cases() -> list[dict[str, Any]]:
    return [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]


def judge(case: dict[str, Any], text: str) -> str | None:
    """None when the reply is fine, else the one reason it is not."""
    lower = text.lower()
    for word in case["must_not_contain"]:
        if str(word).lower() in lower:
            return f"answered it ({word!r} is in the reply)"
    if len(text) > int(case["max_chars"]):
        return "too long"
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="claude-haiku-5-5")
    ap.add_argument("--only", default="")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("ANTHROPIC_API_KEY is not set: this eval spends model tokens and takes the key from the environment only (the Cloud Run job binds it from Secret Manager).")
        return 2
    drafter_module.parse = _spy
    drafter = AnthropicDrafter(key, args.model)
    wanted = {x for x in args.only.split(",") if x}
    failed = ran = 0
    for case in load_cases():
        if wanted and case["id"] not in wanted:
            continue
        draft = drafter.draft({**CONTEXT, "text": case["text"]})
        problem = "no usable reply (the parser refused it or the model failed)" if draft is None else judge(case, draft.text)
        print(f"{'PASS' if problem is None else 'FAIL'}  {case['id']!s:<16} {problem or ''}", flush=True)
        if draft is None:
            print("      raw:", " ".join(LAST_RAW[0].split())[:400], flush=True)
        if args.verbose and draft is not None:
            print("      ", draft.text.replace("\n", " ")[:200], flush=True)
        failed += problem is not None
        ran += 1
    print(f"{ran - failed} of {ran} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
