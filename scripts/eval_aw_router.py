"""A3 evals, LIVE (job assistant-does-the-work): 30 typed owner requests in English and Telugu, through the DEPLOYED staging API with the real model, in the textiles DEMO workspace. It scores whether
each request lands on the right common action with the right values (from the plan card's step and its code-made summary), is said to be screen-only, or is left to the normal assistant (not one of
the common actions). Every plan is CANCELLED at once: nothing changes, nobody is messaged. It spends real money, a few rupees at most, within the demo workspace's daily cap.

Run: python3 scripts/eval_aw_router.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> [--out report.md]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
import staging_smoke_api as sm  # noqa: E402

TOOLS = {"call-settings.put_settings": "calling_hours", "ai-assistant.put_auto_reply": "auto_reply", "lead-sources.pause_source": "pause_source", "lead-sources.resume_source": "resume_source",
         "lead-imports.import_leads": "add_lead", "example-data.example_remove": "remove_example_data"}

# (request, language, expected, a piece the card's summary or the sentence must hold, or "")
CASES: list[tuple[str, str, str, str]] = [
    ("change calling hours to 10 to 7", "en", "calling_hours", "10:00-19:00"),
    ("call customers only between 11 am and 6 pm", "en", "calling_hours", "11:00-18:00"),
    ("calls from 9:30 to 8 in the evening please", "en", "calling_hours", "09:30-20:00"),
    ("set calling hours 10 to 6, Monday to Friday", "en", "calling_hours", "Mon-Fri 10:00-18:00"),
    ("కాల్ సమయం ఉదయం 10 నుండి సాయంత్రం 7 వరకు పెట్టండి", "te", "calling_hours", "10:00-19:00"),
    ("కాల్స్ సమయం 11 నుండి 5 వరకు మార్చండి", "te", "calling_hours", "11:00-17:00"),
    ("turn off auto-reply", "en", "auto_reply", "-> off"),
    ("switch auto-reply on", "en", "auto_reply", "-> on"),
    ("stop the automatic replies to customers", "en", "auto_reply", "-> off"),
    ("ఆటో రిప్లై ఆపండి", "te", "auto_reply", "-> off"),
    ("pause IndiaMART", "en", "pause_source", "IndiaMART"),
    ("stop taking leads from the website form", "en", "pause_source", ""),
    ("resume IndiaMART", "en", "resume_source", "IndiaMART"),
    ("IndiaMART ని ఆపండి", "te", "pause_source", "IndiaMART"),
    ("add Ravi Kumar +00 00000 11111 as a lead", "en", "add_lead", ""),
    ("new lead: Anita, anita@example.test, Guntur", "en", "add_lead", ""),
    ("add Suresh +00 00000 22222 from Vizag as a customer", "en", "add_lead", ""),
    ("రమేష్ +00 00000 33333 ను లీడ్‌గా చేర్చండి", "te", "add_lead", ""),
    ("remove the example data", "en", "remove_example_data", ""),
    ("delete the demo data from my workspace", "en", "remove_example_data", ""),
    ("cancel my plan", "en", "screen_only", "/plans"),
    ("delete my workspace", "en", "screen_only", "/settings/data"),
    ("switch on real data", "en", "screen_only", "/settings/data"),
    ("నా ప్లాన్ రద్దు చేయండి", "te", "screen_only", "/plans"),
    ("నా వర్క్‌స్పేస్ డిలీట్ చేయండి", "te", "screen_only", "/settings/data"),
    ("how many leads came today?", "en", "not_mine", ""),
    ("call the new leads tomorrow morning", "en", "not_mine", ""),
    ("what does auto-reply do?", "en", "not_mine", ""),
    ("make a quote for Lakshmi, 40 sarees", "en", "not_mine", ""),
    ("ఈ రోజు ఎన్ని లీడ్స్ వచ్చాయి?", "te", "not_mine", ""),
]


def score(evs: list[tuple[str, dict]], expected: str, piece: str) -> tuple[bool, str]:
    cards = [d["card"] for n, d in evs if n == "work_card"]
    said = "".join(d.get("delta", "") for n, d in evs if n == "text").strip()
    if cards and cards[0]["kind"] == "cant_do":
        got, words = ("screen_only" if cards[0].get("reason") == "screen_only" else "cant_do"), (cards[0].get("screen") or {}).get("href", "")
    elif cards:
        steps = (cards[0].get("plan") or {}).get("steps") or []
        got, words = (TOOLS.get(steps[0]["tool"], steps[0]["tool"]) if steps else "card"), " ".join(s.get("summary") or "" for s in steps)
    elif "couldn't find a lead source" in said or "కనిపించలేదు" in said:
        got, words = "pause_source" if expected == "pause_source" else "resume_source" if expected == "resume_source" else "source?", said
    elif "already so" in said or "అలానే ఉంది" in said:
        got, words = expected, said   # the router got it; the workspace is already that way
    else:
        got, words = "not_mine|clarify", said
    ok = (got == expected or (expected == "not_mine" and got == "not_mine|clarify")) and (not piece or piece in words or piece in said)
    return ok, f"{got} :: {words[:120]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()
    api = args.api_url.rstrip("/")
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
        o = sm.Owner(ss.Seeder(args.api_url), "textiles")
    except ss.SeedError as e:
        print(f"eval-aw-router: {e}", file=sys.stderr)
        return 2
    lines, passed = ["| request | expected | got | ok |", "|---|---|---|---|"], 0
    for text, language, expected, piece in CASES:
        import json
        import urllib.request
        import uuid

        body = json.dumps({"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "language": language}).encode()
        req = urllib.request.Request(f"{api}{o.t}/assistant/turns", data=body, method="POST", headers={"Authorization": f"Bearer {o.token}", "Content-Type": "application/json", "Accept": "text/event-stream"})  # noqa: S310
        with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310
            raw = r.read().decode()
        evs = [(b.split("\n")[0][7:], json.loads(b.split("\n")[1][6:])) for b in raw.strip().split("\n\n") if b.startswith("event: ") and "\n" in b]
        for _, d in evs:
            plan = (d.get("card") or {}).get("plan") if isinstance(d, dict) else None
            if plan and plan.get("status") == "proposed":
                o.s.call(o.token, "POST", f"{o.t}/assistant/plans/{plan['plan_id']}/decide", {"decision": "cancel", "confirmed": False})
        ok, got = score(evs, expected, piece)
        passed += ok
        lines.append(f"| {text} | {expected} | {got.replace('|', '/')} | {'yes' if ok else 'NO'} |")
        print(("PASS " if ok else "FAIL ") + text + " :: " + got)
    lines.append(f"\n**{passed} / {len(CASES)}** right.")
    if args.out:
        Path(args.out).write_text("\n".join(lines) + "\n")
    print(f"{passed}/{len(CASES)} right")
    return 0 if passed >= 27 else 1


if __name__ == "__main__":
    raise SystemExit(main())
