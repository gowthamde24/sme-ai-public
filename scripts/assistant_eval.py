#!/usr/bin/env python3
"""The assistant's acceptance eval (owner, 14 Nov 2026): 50 real owner commands, English and Telugu, run against STAGING on a demo workspace after every deploy (docs/plans/assistant-eval-50.md, source
docs/plans/assistant-eval-50.json). Each command is said in a fresh conversation (some after a short setup turn); what the assistant did is read from the turn's own events and compared with the expected
result. NOTHING IS APPROVED: the run stops at the card, so no call, no message and no write happens (the checks of "done end to end" live in the test suite and the per-slice staging checks).

  python3 scripts/assistant_eval.py                   run all, print the table, write the report under ~/Desktop/stack19-jobs/eval/
  python3 scripts/assistant_eval.py --only 3,14,25     run some
  python3 scripts/assistant_eval.py --write-doc        regenerate docs/plans/assistant-eval-50.md from the json

Result words: done_undo (a plan card already Done: the runner undoes it), setting_card (a plan card whose step is a settings write), plan_card, call_plan (a plan card with call_plan), message_card, choose_card, client_action (a browser action card),
file_preview (needs a file: skipped here), acted (the assistant carried out a call), clarify (ONE short question), answer (a plain answer from the records)."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "plans" / "assistant-eval-50.json"
DOC = ROOT / "docs" / "plans" / "assistant-eval-50.md"
API = "https://sme-api-620338396268.asia-south1.run.app"
SETTINGS_TOOLS = ("tasks.set_call_limit", "outbox.put_settings", "ai-assistant.put_opening", "workspace.patch_business", "visits.put_settings", "call-settings.put_settings", "lead-finder.put_settings")
SETUP = {16: ["do whatsapp message to 9110680588"], 23: ["Ask Babu Rao if he is interested in the 2BHK and wants a site visit"]}


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
    if done.get("kind") == "clarify" or any(n == "clarify" for n, _ in evs):
        return "clarify"
    if text.lower().startswith(("calling ", "కాల్ ", "కి ఇప్పుడే")) or "now. i will tell you" in text.lower():
        return "acted"
    return "answer" if text else "nothing"


def put_back(owner: object, evs: list[tuple[str, dict]]) -> None:
    """Undo what a command did (a plan that is done, a message still inside its 30 seconds), through the same Undo the card offers."""
    def post(path: str) -> None:
        req = urllib.request.Request(API + owner.t + path, data=b"{}", method="POST", headers={"Authorization": "Bearer " + owner.token, "Content-Type": "application/json"})   # type: ignore[attr-defined]
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except (urllib.error.URLError, TimeoutError):
            pass

    for n, d in evs:
        card = d.get("card") or {} if n == "work_card" else {}
        if card.get("kind") == "plan" and (card.get("plan") or {}).get("status") == "done":
            post(f"/assistant/plans/{card['plan']['plan_id']}/undo")
        if card.get("kind") == "message" and card.get("undo") and card.get("message_id"):
            post(f"/outbox/messages/{card['message_id']}/unsend")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--write-doc", action="store_true")
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
    want = {int(x) for x in a.only.split(",") if x.strip()} or None

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
        t0, conv = time.perf_counter(), None
        for prior in SETUP.get(c["id"], []):
            _, conv = say(prior, conv)
        evs, _ = say(c["say"], conv)
        got = classify(evs) if not any(n == "error" for n, _ in evs) else "error"
        put_back(owner, evs)   # what the command did is undone, so the next run starts from the same workspace
        results[c["id"]] = {"got": got, "ok": got == c["expect"], "secs": round(time.perf_counter() - t0, 1)}
        print(f"{c['id']:>2} {c['area']:<9} {'PASS' if results[c['id']]['ok'] else 'FAIL':<5} want {c['expect']:<13} got {got:<13} {results[c['id']]['secs']:>5}s  {c['say'][:50]}", flush=True)
    ran = [r for r in results.values() if r["ok"] is not None]
    passed = sum(1 for r in ran if r["ok"])
    print(f"\nPASS {passed} of {len(ran)} run ({len(results) - len(ran)} skipped)")
    out = Path.home() / "Desktop" / "stack19-jobs" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    write_doc(cases, results, out / f"eval-{stamp}.md", passed, len(ran))
    print(f"report: {out / f'eval-{stamp}.md'}")
    return 0 if passed == len(ran) else 1


def write_doc(cases: list[dict], results: dict[int, dict], path: Path = DOC, passed: int | None = None, ran: int | None = None) -> None:
    head = ["# The assistant's acceptance eval: 50 real owner commands (14 Nov 2026)", "",
            ("Owner: a slice is DONE only when its commands pass end to end. Run `python3 scripts/assistant_eval.py` after every staging deploy; the report goes to `~/Desktop/stack19-jobs/eval/`. "
            "The run stops at the card (nothing is approved, so no call, message or write happens); the end-to-end checks of each slice are in its tests and its own staging check. Source: `docs/plans/assistant-eval-50.json`."), "",
            ("Result words: `setting_card` a plan card whose step is a settings write; `plan_card`; `call_plan` (plan card with who, goal, opening line, questions); `message_card` (acted: Sending ... Undo); `done_undo` (a plan card that is already Done, with its Undo: the run undoes it again); `choose_card`; "
            "`client_action` (the browser does it: theme, language, navigation, filters, Talk live; C2's registry); `file_preview` (needs a file: skipped by the runner); `acted`; `clarify` (ONE short question); `answer` (from the records)."), ""]
    if passed is not None and ran is not None:
        head += [f"**Last run: {passed} of {ran} passed** ({datetime.now().strftime('%d %b %Y %H:%M')}).", ""]
    rows = ["| # | Area | Lang | The owner says | Expected | Last run |", "|---|---|---|---|---|---|"]
    for c in cases:
        r = results.get(c["id"])
        last = "" if r is None else ("skipped" if r["ok"] is None else ("PASS" if r["ok"] else f"FAIL (got {r['got']})"))
        rows.append(f"| {c['id']} | {c['area']} | {c['lang']} | {c['say'].replace('|', '/')} | `{c['expect']}`{' · ' + c['note'] if c.get('note') else ''} | {last} |")
    path.write_text("\n".join(head + rows) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
