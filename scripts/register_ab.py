#!/usr/bin/env python3
"""Does the register block make Claude talk like people? (job DS). OPT-IN: never part of make check, never run by CI. Claude Haiku ONLY (no Sarvam call, so no Sarvam credit is used).

  make register-ab                 the 40 synthetic conversations of model-compare under both jobs, each answered with the earlier prompt and with the register block (160 Haiku calls); writes ~/Desktop/stack19-jobs/model-compare/register-ab.{md,json}
  python scripts/register_ab.py --dry-run     lists what would be sent; reads no key, opens no connection

CAP: 600,000 Claude tokens in total, counted before each call and kept in register-ab.json. A finished call is never repeated. The key is read from Secret Manager into a variable; never printed, logged or written. Synthetic text only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "ai-api"))

from app.agents import compare  # noqa: E402
from app.agents.compare import HAIKU_ONLY, JOBS, Result  # noqa: E402
from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig  # noqa: E402
from app.agents.llm.interface import LlmError  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
DEFAULT_OUT = Path.home() / "Desktop" / "stack19-jobs" / "model-compare"
TOKEN_CAP = 600_000
OUT_TOKENS = 1200
OUT_TOKENS_RETRY = 2800   # a call that stopped at its output limit is made again with more room (Kannada needs it)
CLAUDE_PRICE = (9_000_000, 45_000_000)   # the staging prices of Haiku 5.5


def read_key() -> str:
    done = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret=sme-anthropic-api-key", f"--project={PROJECT}"], capture_output=True, text=True, check=False)
    if done.returncode != 0 or not done.stdout.strip():
        raise SystemExit("cannot read the Claude key from Secret Manager (skipping the run)")
    return done.stdout.strip()


def run(out: Path, dry: bool, client: Any = None) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    path = out / "register-ab.json"
    data: dict[str, Any] = json.loads(path.read_text()) if path.exists() else {"tokens": 0, "calls": {}}
    bigger = {k for k, v in data["calls"].items() if v["error"] == "no_reply_tool_call" and v["output_tokens"] >= OUT_TOKENS * 0.95}
    todo = [(c, job, arm) for c in compare.conversations() for job in JOBS for arm in ("before", "after") if f"{arm}|{job}|{c.id}" not in data["calls"] or f"{arm}|{job}|{c.id}" in bigger]
    print(f"{len(todo)} calls to make; Claude tokens already spent {data['tokens']} of {TOKEN_CAP}")
    if dry:
        return data
    claude = client or AnthropicClient(AnthropicConfig(read_key(), HAIKU_ONLY, *CLAUDE_PRICE))
    for conv, job, arm in todo:
        limit_out = OUT_TOKENS_RETRY if f"{arm}|{job}|{conv.id}" in bigger else OUT_TOKENS
        request = compare.build_request(conv, job, limit_out, spoken=arm == "after")
        if data["tokens"] + compare.estimate_input_tokens(request) + limit_out > TOKEN_CAP:
            print("STOPPED AT THE CAP")
            break
        started = time.monotonic()
        reply, error, tin, tout, cost = None, None, 0, 0, 0
        try:
            response = claude.complete(request)
            structured = response.structured or {}
            reply = structured.get("text") if isinstance(structured.get("text"), str) else None
            tin, tout, cost = response.usage.input_tokens, response.usage.output_tokens, response.usage.cost_micros
            error = None if reply else "no_reply_tool_call"
        except LlmError as exc:
            error = exc.code
        result = Result(conv.id, job, "claude", reply, error, int((time.monotonic() - started) * 1000), tin, tout, cost)
        result.rules = compare.check(conv, job, reply)
        data["calls"][f"{arm}|{job}|{conv.id}"] = asdict(result)
        data["tokens"] += tin + tout
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        time.sleep(0.2)
    report(out, data)
    return data


def report(out: Path, data: dict[str, Any]) -> None:
    results = {arm: [Result(**{k: v for k, v in item.items()}) for key, item in data["calls"].items() if key.startswith(arm + "|")] for arm in ("before", "after")}
    convs = {c.id: c for c in compare.conversations()}
    for arm_results in results.values():   # the rules are applied again with the code as it is now (a rule may have been refined since the call)
        for r in arm_results:
            r.rules = compare.check(convs[r.conv_id], r.job, r.reply)
    summary = compare.register_ab(results["before"], results["after"])
    lines = ["# Register block: before and after (Claude Haiku only)", "", "Same 40 synthetic conversations, both jobs. `before` = the earlier prompt; `after` = with the register block (how people really talk, the owner's example lines).", "",
             "| language | replies (before / after) | written forms (before / after) | other rules ok (before / after) | English words kept (before / after) |", "|---|---|---|---|---|"]
    for lang, row in summary.items():
        b, a = row["before"], row["after"]
        lines.append(f"| {lang} | {b['replies']} / {a['replies']} | {b['written_forms']} / {a['written_forms']} | {b['other_rules_ok']} / {a['other_rules_ok']} | {b['latin_words']} / {a['latin_words']} |")
    lines += ["", f"Claude tokens used in total: {data['tokens']} of {TOKEN_CAP}. The rules cannot judge wording: read the replies below with a native speaker.", "", "## Replies, three per language", ""]
    for lang in compare.LANG_COUNTS:
        mine = [c for c in compare.conversations() if c.lang == lang][:3]
        for conv in mine:
            lines.append(f"### {lang}: {conv.id} ({conv.scenario}, call_turn)")
            lines.append(f"Customer: {conv.text}")
            for arm in ("before", "after"):
                item = data["calls"].get(f"{arm}|call_turn|{conv.id}")
                lines.append(f"- {arm}: {(item or {}).get('reply')}")
            lines.append("")
    (out / "register-ab.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:14]))


def report_only(out: Path) -> None:
    report(out, json.loads((out / "register-ab.json").read_text()))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="write the report again from the saved answers, with the rules as they are now (no call)")
    args = ap.parse_args()
    report_only(args.out) if args.report_only else run(args.out, args.dry_run)


if __name__ == "__main__":
    main()
