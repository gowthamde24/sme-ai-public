# ruff: noqa: E501
"""Live eval of general questions on STAGING (13 Nov 2026): the cases of tests/evals/general/cases.jsonl (Telugu, Kannada, Hindi, English) asked in the written chat as one synthetic demo owner. Real providers: the "what can
you do?" cases are fixed words (no model call); the others are one light-model call, so the run costs a few rupees of the demo workspace's daily allowance.

  python scripts/eval_general_questions.py --pack textiles [--only about_assistant|general_help|greeting_or_feeling|records_word] [--max-first-text-ms 1000]

For every case it prints the time to the first event, the time to the first text and the whole turn, the kind the router chose, and whether the answer is the plain "could not answer" sentence (a failure). Exit 0 = no case failed
(a failed case: a plain "could not answer" sentence, an error event, or a "what can you do?" answer that is not the fixed words); the first-text budget is reported and fails the run only with --max-first-text-ms.
Run it with the project's Python. The password and second factor of the demo owner are read from Secret Manager into memory (scripts/seed_staging.py), never printed."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
import seed_staging as ss  # noqa: E402
from staging_smoke_api import Owner  # noqa: E402

from app.assistant.language import COULD_NOT_ANSWER  # noqa: E402
from app.turns.words import ABOUT_ASSISTANT  # noqa: E402

API = "https://sme-api-620338396268.asia-south1.run.app"
CASES = Path(__file__).resolve().parents[1] / "tests" / "evals" / "general" / "cases.jsonl"


def ask(owner: Owner, text: str, language: str) -> dict[str, object]:
    """One turn; a "too many requests" answer (the per-minute limit protects the workspace) waits for the time the API names, up to three times."""
    for attempt in range(4):
        try:
            return ask_once(owner, text, language)
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == 3:
                raise
            time.sleep(min(60.0, float(err.headers.get("Retry-After") or 20)))
    raise RuntimeError("unreachable")


def ask_once(owner: Owner, text: str, language: str) -> dict[str, object]:
    body = json.dumps({"text": text, "message_id": str(uuid.uuid4()), "language": language}).encode()
    req = urllib.request.Request(API + owner.t + "/assistant/turns", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + owner.token, "Content-Type": "application/json", "Accept": "text/event-stream"})
    t0 = time.perf_counter()
    first_event = first_text = None
    kind = None
    text: list[str] = []
    errors: list[str] = []
    event = ""
    with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
        for raw in r:
            line = raw.decode().strip()
            if line.startswith("event:"):
                event = line[6:].strip()
                first_event = first_event if first_event is not None else time.perf_counter() - t0
            elif line.startswith("data:"):
                data = json.loads(line[5:])
                if event == "intent":
                    kind = data.get("kind")
                elif event == "text":
                    first_text = first_text if first_text is not None else time.perf_counter() - t0
                    text.append(data.get("delta", ""))
                elif event == "error":
                    errors.append(str(data.get("code")))
    return {"first_event": first_event, "first_text": first_text, "total": time.perf_counter() - t0, "kind": kind, "text": "".join(text).strip(), "errors": errors}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default="textiles")
    ap.add_argument("--only", default=None)
    ap.add_argument("--max-first-text-ms", type=int, default=None)
    ap.add_argument("--pause", type=float, default=4.0, help="seconds between cases (the per-minute limit)")
    args = ap.parse_args()
    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=True, project_ref="uiallwgywitryxatcqxf"))
    owner = Owner(ss.Seeder(API), args.pack)
    cases = [json.loads(line) for line in CASES.read_text(encoding="utf8").splitlines() if line.strip()]
    cases = [c for c in cases if c["kind"] != "business" and (args.only is None or c["reason"] == args.only)]
    failed = 0
    firsts: dict[str, list[float]] = {}
    for c in cases:
        out = ask(owner, c["text"], c["language"])
        time.sleep(args.pause)
        said = str(out["text"])
        problems = []
        if said == COULD_NOT_ANSWER[c["language"]] or out["errors"] or not said:
            problems.append("failed answer")
        if c["reason"] == "about_assistant" and said != ABOUT_ASSISTANT[c["language"]]:
            problems.append("not the fixed words")
        if out["kind"] != c["kind"]:
            problems.append(f"kind {out['kind']}")
        ft = out["first_text"]
        firsts.setdefault(c["reason"], []).append(float(ft) if isinstance(ft, float) else float("inf"))
        if args.max_first_text_ms is not None and (not isinstance(ft, float) or ft * 1000 > args.max_first_text_ms) and c["reason"] == "about_assistant":
            problems.append("first text over budget")
        failed += bool(problems)
        print(f"{c['language']} {c['reason']:20s} first event {float(out['first_event'] or 0) * 1000:5.0f} ms, first text {float(ft or 0) * 1000:5.0f} ms, total {float(out['total']) * 1000:5.0f} ms  {'FAIL ' + ', '.join(problems) if problems else 'ok'}  | {c['text'][:48]}")
    for reason, values in firsts.items():
        print(f"{reason}: {len(values)} cases, first text p50 {statistics.median(values) * 1000:.0f} ms, max {max(values) * 1000:.0f} ms")
    print(f"{len(cases) - failed} of {len(cases)} ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
