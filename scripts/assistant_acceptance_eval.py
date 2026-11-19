#!/usr/bin/env python3
"""The assistant's acceptance eval (owner, 14 Nov 2026): 50 real owner commands, English and Telugu, run against STAGING on a demo workspace after every deploy (docs/plans/assistant-eval-50.md, source
docs/plans/assistant-eval-50.json). Each command is said in a fresh conversation (some after a short setup turn); what the assistant did is read from the turn's own events and compared with the expected
result. NOTHING IS APPROVED: the run stops at the card, so no call, no message and no write happens (the checks of "done end to end" live in the test suite and the per-slice staging checks).

  python3 scripts/assistant_acceptance_eval.py                   run all, print the table, write the report under ~/Desktop/stack19-jobs/eval/
  python3 scripts/assistant_acceptance_eval.py --only 3,14,25     run some

Every command is one assistant run and a business may start only 30 runs an hour (agent_limits): the 54 commands do not fit in one hour. Run them in two parts an hour apart (--only 1-27, then --only 28-54), or
the second half fails with "run_limit_reached" / HTTP 429 and reads as failures that are not.
  python3 scripts/assistant_acceptance_eval.py --write-doc        regenerate docs/plans/assistant-eval-50.md from the json

Result words: done_undo (a plan card already Done: the runner undoes it), setting_card (a plan card whose step is a settings write), plan_card, call_plan (a plan card with call_plan), message_card, choose_card, client_action (a browser action card),
file_preview (needs a file: skipped here), acted (the assistant carried out a call), clarify (ONE short question), answer (a plain answer from the records)."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "plans" / "assistant-eval-50.json"
DOC = ROOT / "docs" / "plans" / "assistant-eval-50.md"
API = "https://sme-api-620338396268.asia-south1.run.app"
SETTINGS_TOOLS = ("tasks.set_call_limit", "outbox.put_settings", "ai-assistant.put_opening", "workspace.patch_business", "visits.put_settings", "call-settings.put_settings", "lead-finder.put_settings", "outreach.put_policy", "outreach.save_rule")
PROFILE_PHONE = {51: "+00 90003 00206", 52: "+00 90003 00206"}   # the demo owner's own number, put on their profile before "send me" is said: an EXISTING demo contact (Lakshmi Devi), because a gated demo workspace cannot save a new +00 number
SETUP = {16: ["do whatsapp message to 9110680588"], 23: ["Ask Anitha Hegde if she is interested in the new Kanchi pattu and wants a store visit"],
         32: ["Book Anitha Hegde for a visit on Saturday at 11"], 33: ["Book Anitha Hegde for a visit on Saturday at 11"],   # the demo visits of the seed are dated the day it ran: these two make their own
         53: ["Draft a WhatsApp for Kalyani: how are you", "yes do it"], 54: ["Draft a WhatsApp for Kalyani: how are you"]}   # 53 and 54: the owner's own thread of 14 Nov (23:05)
PROMISE = ("i'll ", "i will ", "let me ", "i can't see your", "i cannot see your", "i can't see kalyani", "i can't see her contact", "i can't see the contact", "can't access", "don't have access", "i have not looked", "చూస్తాను", "చేస్తాను")
# a finished answer that ends on a promise to look again ("... I will check again."): a deferred look-up is never allowed at the end of a turn (owner, 17 Nov). A conditional offer ("tell me his surname and I will look again") is not one.
DEFERRED = ("i will check again", "i'll check again", "i will look again", "i'll look again", "i will try again", "i'll try again", "i will check and", "i'll check and", "i will get back", "i'll get back", "i will let you know", "i'll let you know what")


def events_of(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = block.split("\n")
        if len(lines) >= 2 and lines[0].startswith("event:") and lines[1].startswith("data:"):
            try:
                out.append((lines[0][6:].strip(), json.loads(lines[1][5:])))
            except ValueError:
                pass
    return out


def classify(evs: list[tuple[str, dict]]) -> str:
    """What the assistant did, as one result word, from the events of its reply."""
    cards = [d.get("card") or {} for n, d in evs if n == "work_card"]
    kinds = [c.get("kind") for c in cards]
    for n, d in evs:
        if n == "confirm_action":
            return "call_plan" if d.get("call_plan") else "plan_card"
        if n == "lead_finder":
            return "plan_card"   # the Lead Finder's plan card (every plan has it; owner 18 Nov 2026)
    if "message" in kinds:
        return "message_card"
    if "choose" in kinds:
        return "choose_card"
    if "client_action" in kinds:
        return "client_action"
    if "file_preview" in kinds:
        return "file_preview"
    for c in cards:
        if c.get("kind") == "plan":
            if (c.get("plan") or {}).get("status") == "done":
                return "done_undo"   # acted at once: the card says Done, with its Undo
            steps = (c.get("plan") or {}).get("steps") or []
            return "setting_card" if steps and steps[0].get("tool") in SETTINGS_TOOLS else "plan_card"
    done = next((d for n, d in evs if n == "done"), {})
    text = "".join(d.get("delta", "") for n, d in evs if n == "text").strip()
    if "▸" in text:
        return "chain_step"   # the first step of a request with several steps was carried out or asked; the reply's last line carries the rest
    if done.get("kind") == "clarify" or any(n == "clarify" for n, _ in evs):
        return "clarify"
    if text.lower().startswith(("calling ", "కాల్ ", "కి ఇప్పుడే")) or "now. i will tell you" in text.lower():
        return "acted"
    if text and done.get("kind") == "answer" and not any(p in text.lower() for p in PROMISE) and (any(n == "source" for n, _ in evs) or "kalyani" in text.lower() or "looked" in text.lower()):
        return "records_answer"   # answered FROM the records in this very reply: no promise, no refusal
    if text and any(p in text.lower() for p in DEFERRED) and not any(c in text.lower() for c in ("tell me", "send me", "give me", "if you", "once you", "when you")):
        return "promise"   # the turn ended on a promise to do something later: never right
    return "answer" if text else "nothing"


def answered_from_records(evs: list[tuple[str, dict]]) -> bool:
    """A reply that ends with a question ("which one?") but that DID answer from the records: text, no promise, no refusal."""
    text = "".join(d.get("delta", "") for n, d in evs if n == "text").strip().lower()
    return bool(text) and not any(p in text for p in PROMISE) and ("kalyani" in text or any(n == "source" for n, _ in evs))


LIMIT_WORDS = ("asked a lot this hour", "ఈ గంటలో చాలా అడిగారు", "इस घंटे में आपने बहुत कुछ पूछ लिया", "ಈ ಗಂಟೆಯಲ್ಲಿ ತುಂಬಾ ಕೇಳಿದ್ದೀರಿ")


def limited(evs: list[tuple[str, dict]]) -> int | None:
    """The assistant's hourly run limit (30 runs a business an hour) was hit: None when it was not, else the seconds to wait before the door opens (the sentence names the India-time clock; else 5 minutes).
    A case that met the limit is NOT RUN, never FAIL (18 Nov 2026: a full run said 40 of 62 because the limit hit from case 35)."""
    said = " ".join(str(d.get("text") or d.get("delta") or d.get("message") or "") for n, d in evs if n in ("text", "error")) + " " + " ".join(str(d.get("code") or "") for n, d in evs if n == "error")
    if "run_limit_reached" not in said and not any(w in said for w in LIMIT_WORDS):
        return None
    m = re.search(r"(\d{2}):(\d{2}) \((?:India time|ఇండియా టైమ్|भारतीय समय|ಭಾರತೀಯ ಸಮಯ)\)|(\d{2}):(\d{2})", said)
    if not m:
        return 300
    hh, mm = int(m.group(1) or m.group(3)), int(m.group(2) or m.group(4))
    now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    at = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if at <= now:
        at += timedelta(days=1)
    return min(max(int((at - now).total_seconds()) + 30, 60), 3900)


def put_back(owner: object, evs: list[tuple[str, dict]]) -> None:
    """Undo what a command did (a plan that is done, a message still inside its 30 seconds), through the same Undo the card offers."""
    def post(path: str, body: dict | None = None) -> None:
        req = urllib.request.Request(API + owner.t + path, data=json.dumps(body or {}).encode(), method="POST", headers={"Authorization": "Bearer " + owner.token, "Content-Type": "application/json"})   # type: ignore[attr-defined]
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except (urllib.error.URLError, TimeoutError):
            pass

    for n, d in evs:
        if n == "confirm_action" and d.get("action_id"):
            post(f"/assistant/actions/{d['action_id']}/confirm", {"decision": "no"})   # a call plan the command proposed: the owner says no, so nothing stays planned
        card = d.get("card") or {} if n == "work_card" else {}
        if card.get("kind") == "plan" and (card.get("plan") or {}).get("status") == "done":
            post(f"/assistant/plans/{card['plan']['plan_id']}/undo")
        if card.get("kind") == "message" and card.get("undo") and card.get("message_id"):
            post(f"/outbox/messages/{card['message_id']}/unsend")


def cancel_planned_searches(owner: object) -> int:
    """The Lead Finder searches a command only PLANNED (state planned, nobody approved them) are cancelled: a planned search shows as a mark on the Office page and stays there until someone does (staging, 18 Nov:
    the eval's "find new customers" case left two in the demo and the Office page broke on them)."""
    headers = {"Authorization": "Bearer " + owner.token, "Content-Type": "application/json"}   # type: ignore[attr-defined]
    try:
        listed = json.loads(urllib.request.urlopen(urllib.request.Request(API + owner.t + "/lead-finder/searches?limit=100", headers=headers), timeout=60).read())   # type: ignore[attr-defined]
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0
    n = 0
    for item in listed.get("items") or []:
        if item.get("state") == "planned":
            try:
                urllib.request.urlopen(urllib.request.Request(API + owner.t + f"/lead-finder/searches/{item['id']}/cancel", data=b"{}", method="POST", headers=headers), timeout=60).read()   # type: ignore[attr-defined]
                n += 1
            except (urllib.error.URLError, TimeoutError):
                pass
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--write-doc", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="after a FAIL print what the assistant said (the text and any error)")
    a = ap.parse_args()
    cases = json.loads(SRC.read_text())
    if a.write_doc:
        write_doc(cases, {})
        print(f"wrote {DOC}")
        return 0
    sys.path.insert(0, str(ROOT / ".." / "c1wt-reseed-4" / "scripts"))
    import seed_staging as ss  # the same demo-workspace login the smoke checks use
    from staging_smoke_api import Owner

    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=True, project_ref="uiallwgywitryxatcqxf"))
    owner = Owner(ss.Seeder(API), "textiles")
    want: set[int] | None = set()
    for part in a.only.split(","):
        if "-" in part:
            lo, _, hi = part.partition("-")
            want.update(range(int(lo), int(hi) + 1))
        elif part.strip():
            want.add(int(part))
    want = want or None

    def say(text: str, conversation: str | None) -> tuple[list[tuple[str, dict]], str | None]:
        body = {"text": text, "message_id": str(uuid.uuid4()), "language": "auto", **({"conversation_id": conversation} if conversation else {})}
        req = urllib.request.Request(API + owner.t + "/assistant/turns", data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + owner.token, "Content-Type": "application/json", "Accept": "text/event-stream"})
        try:
            with urllib.request.urlopen(req, timeout=150) as r:
                evs = events_of(r.read().decode())
        except (urllib.error.URLError, TimeoutError) as exc:
            return [("error", {"message": str(exc)[:100]})], conversation
        conv = next((d.get("conversation_id") for _, d in evs if d.get("conversation_id")), conversation)
        return evs, conv

    results: dict[int, dict] = {}
    for c in cases:
        if want and c["id"] not in want:
            continue
        if c["expect"] == "file_preview":
            results[c["id"]] = {"got": "skipped (needs a file)", "ok": None, "secs": 0.0}
            continue
        t0 = time.perf_counter()
        for attempt in range(3):   # a case that meets the hourly run limit waits for the door and tries again (twice at most): it is then NOT RUN, never FAIL
            conv = None
            if c["id"] in PROFILE_PHONE:
                req = urllib.request.Request(API + owner.t + "/me/profile", data=json.dumps({"phone": PROFILE_PHONE[c["id"]]}).encode(), method="PATCH",
                                             headers={"Authorization": "Bearer " + owner.token, "Content-Type": "application/json"})
                try:
                    urllib.request.urlopen(req, timeout=60).read()
                except (urllib.error.URLError, TimeoutError) as exc:
                    print(f"     (could not put the test number on the profile: {str(exc)[:80]})", flush=True)
            held = None
            for prior in SETUP.get(c["id"], []):
                evs_p, conv = say(prior, conv)
                held = held or limited(evs_p)
            evs, _ = say(c["say"], conv)
            held = held or limited(evs)
            if held is None or attempt == 2:
                break
            print(f"     case {c['id']}: the hourly run limit; waiting {held // 60} min for the door", flush=True)
            put_back(owner, evs)
            cancel_planned_searches(owner)
            time.sleep(held)
        if held is not None:
            results[c["id"]] = {"got": "NOT RUN (limit)", "ok": None, "limit": True, "secs": round(time.perf_counter() - t0, 1)}
            print(f"{c['id']:>2} {c['area']:<9} NOT RUN (the hourly run limit)  {c['say'][:50]}", flush=True)
            put_back(owner, evs)
            cancel_planned_searches(owner)
            continue
        got = classify(evs) if not any(n == "error" for n, _ in evs) else "error"
        put_back(owner, evs)   # what the command did is undone, so the next run starts from the same workspace
        cancel_planned_searches(owner)   # ... including a Lead Finder search that was only planned
        said_all = "".join(str(d.get("text") or d.get("delta") or "") for n, d in evs if n == "text")
        missing = [w for w in c.get("contains", []) if w not in said_all]   # words the answer must say (19 Nov 2026: the identity answer names Stack19 and AI assistant)
        results[c["id"]] = {"got": got if not missing else f"{got} (missing: {', '.join(missing)})", "ok": not missing and (got == c["expect"] or (c["expect"] == "answer" and got == "records_answer") or (c["expect"] == "plan_card" and got == "call_plan") or (c["expect"] == "records_answer" and got == "clarify" and answered_from_records(evs))), "secs": round(time.perf_counter() - t0, 1)}
        print(f"{c['id']:>2} {c['area']:<9} {'PASS' if results[c['id']]['ok'] else 'FAIL':<5} want {c['expect']:<13} got {got:<13} {results[c['id']]['secs']:>5}s  {c['say'][:50]}", flush=True)
        if a.verbose and not results[c["id"]]["ok"]:
            said = "".join(str(d.get("text") or d.get("delta") or "") for n, d in evs if n == "text")
            errs = [d for n, d in evs if n == "error"]
            print("     said:", (said or "-")[:240].replace("\n", " "), "|", errs[0] if errs else "", flush=True)
    ran = [r for r in results.values() if r["ok"] is not None]
    passed = sum(1 for r in ran if r["ok"])
    unrun = [i for i, r in results.items() if r.get("limit")]
    print(f"\nPASS {passed} of {len(ran)} run ({len(results) - len(ran) - len(unrun)} skipped, {len(unrun)} NOT RUN because of the hourly run limit{': ' + ', '.join(map(str, unrun)) if unrun else ''})")
    out = Path.home() / "Desktop" / "stack19-jobs" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    write_doc(cases, results, out / f"eval-{stamp}.md", passed, len(ran))
    print(f"report: {out / f'eval-{stamp}.md'}")
    return 0 if passed == len(ran) else 1


def write_doc(cases: list[dict], results: dict[int, dict], path: Path = DOC, passed: int | None = None, ran: int | None = None) -> None:
    head = ["# The assistant's acceptance eval: 50 real owner commands (14 Nov 2026)", "",
            ("Owner: a slice is DONE only when its commands pass end to end. Run `python3 scripts/assistant_acceptance_eval.py` after every staging deploy; the report goes to `~/Desktop/stack19-jobs/eval/`. "
            "The run stops at the card (nothing is approved, so no call, message or write happens); the end-to-end checks of each slice are in its tests and its own staging check. Source: `docs/plans/assistant-eval-50.json`."), "",
            ("Result words: `setting_card` a plan card whose step is a settings write; `plan_card`; `call_plan` (plan card with who, goal, opening line, questions); `message_card` (acted: Sending ... Undo); `done_undo` (a plan card that is already Done, with its Undo: the run undoes it again); `choose_card`; "
            "`client_action` (the browser does it: theme, language, navigation, filters, Talk live; C2's registry); `file_preview` (needs a file: skipped by the runner); `acted`; `clarify` (ONE short question); `answer` (from the records)."), ""]
    if passed is not None and ran is not None:
        head += [f"**Last run: {passed} of {ran} passed** ({datetime.now().strftime('%d %b %Y %H:%M')}).", ""]
    rows = ["| # | Area | Lang | The owner says | Expected | Last run |", "|---|---|---|---|---|---|"]
    for c in cases:
        r = results.get(c["id"])
        last = "" if r is None else (("NOT RUN (limit)" if r.get("limit") else "skipped") if r["ok"] is None else ("PASS" if r["ok"] else f"FAIL (got {r['got']})"))
        rows.append(f"| {c['id']} | {c['area']} | {c['lang']} | {c['say'].replace('|', '/')} | `{c['expect']}`{' · ' + c['note'] if c.get('note') else ''} | {last} |")
    path.write_text("\n".join(head + rows) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
