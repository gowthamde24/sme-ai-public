#!/usr/bin/env python3
"""Claude (Haiku) versus Sarvam on the call and WhatsApp reply jobs (night 3, ADR 0102). OPT-IN: never part of make check, never run by CI.

  make model-compare                 runs the 40 synthetic conversations under both jobs on both models, scores them, writes ~/Desktop/stack19-jobs/model-compare/{results.md,side-by-side.html,raw.json,usage.json}
  python scripts/model_compare.py --dry-run     lists what would be sent; reads no key, opens no connection
  --limit N                          only the first N conversations (a pilot)

HARD CAPS, counted BEFORE each call and kept across runs in usage.json: 150,000 tokens to Sarvam (the call's worst case, input estimate plus the output limit, must fit), and Claude Haiku only (the script
refuses any other Claude model). A finished call is never repeated: results are cached in raw.json. Keys are read from Secret Manager into variables, never printed, logged or written. Synthetic text only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "ai-api"))

from app.agents import compare  # noqa: E402
from app.agents.compare import HAIKU_ONLY, JOBS, SARVAM_TOKEN_CAP, Result, TokenBudget  # noqa: E402
from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig  # noqa: E402
from app.agents.llm.interface import LlmClient, LlmError  # noqa: E402
from app.agents.llm.openai_compat import ChatCompletionsClient, sarvam_config  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
DEFAULT_OUT = Path.home() / "Desktop" / "stack19-jobs" / "model-compare"
CLAUDE_OUT, SARVAM_OUT = 900, 1500   # output limits per call
CLAUDE_OUT_RETRY, SARVAM_OUT_RETRY = 2400, 3500   # for a call that ran into the limit (--retry-truncated): Kannada on Claude and the reasoning of Sarvam 105B need more room
CLAUDE_PRICE = (9_000_000, 45_000_000)    # micro-rupees per million tokens: Haiku 5.5 at $0.10 in / $0.50 out, 90 rupees to the dollar (the staging prices)
SARVAM_PRICE = (15_000_000, 60_000_000)   # Rs 15 in, Rs 60 out per million tokens (sarvam.ai/api-pricing)


def secret(name: str, env: str) -> str:
    value = os.environ.get(env, "").strip()
    if value:
        return value
    done = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={PROJECT}"], capture_output=True, text=True, check=False)
    if done.returncode != 0 or not done.stdout.strip():
        raise SystemExit(f"cannot read the key {name} from Secret Manager (skipping the run)")
    return done.stdout.strip()


def build_clients(claude_model: str = HAIKU_ONLY) -> dict[str, LlmClient]:
    if claude_model != HAIKU_ONLY:
        raise SystemExit("only Claude Haiku may be called by this script")
    return {
        "claude": AnthropicClient(AnthropicConfig(secret("sme-anthropic-api-key", "ANTHROPIC_API_KEY"), claude_model, *CLAUDE_PRICE)),
        "sarvam": ChatCompletionsClient(sarvam_config(secret("sme-sarvam-api-key", "SARVAM_API_KEY"), "sarvam-105b", *SARVAM_PRICE)),
    }


def load(out: Path) -> tuple[dict[str, dict], dict]:
    raw = json.loads((out / "raw.json").read_text()) if (out / "raw.json").exists() else {}
    usage = json.loads((out / "usage.json").read_text()) if (out / "usage.json").exists() else {"sarvam_tokens_total": 0, "claude_tokens_total": 0, "runs": []}
    return raw, usage


def save(out: Path, raw: dict, usage: dict) -> None:
    (out / "raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=1))
    (out / "usage.json").write_text(json.dumps(usage, indent=1))


def run(out: Path, clients: dict[str, LlmClient] | None, *, limit: int | None, dry: bool, sleep: float = 0.3, retry_truncated: bool = False) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    raw, usage = load(out)
    budget = TokenBudget(SARVAM_TOKEN_CAP, usage["sarvam_tokens_total"])
    bigger: set[str] = set()
    if retry_truncated:   # the calls that stopped at their output limit are made again with more room (the first attempt's tokens stay in the totals)
        for key, item in list(raw.items()):
            first = SARVAM_OUT if item["model"] == "sarvam" else CLAUDE_OUT
            if item["error"] == "no_reply_tool_call" and item["output_tokens"] >= first * 0.95:
                bigger.add(key)   # the first attempt stays in raw.json until a retry replaces it (a retry the cap does not allow leaves it as it was)
    convs = compare.conversations()[:limit]
    todo = [(c, job, m) for c in convs for job in JOBS for m in ("claude", "sarvam") if f"{m}|{job}|{c.id}" not in raw or f"{m}|{job}|{c.id}" in bigger]
    print(f"{len(convs)} conversations x {len(JOBS)} jobs x 2 models; {len(todo)} calls to make; Sarvam tokens already spent: {budget.used} of {SARVAM_TOKEN_CAP}")
    if dry:
        return raw
    assert clients is not None
    this_run = {"claude": 0, "sarvam": 0, "calls": 0, "stopped_at_cap": False}
    todo.sort(key=lambda t: t[2] != "claude")   # the cheap model first, so the Sarvam cap is the only thing that can leave a call undone
    for conv, job, model in todo:
        key = f"{model}|{job}|{conv.id}"
        limit_out = (SARVAM_OUT_RETRY if model == "sarvam" else CLAUDE_OUT_RETRY) if key in bigger else (SARVAM_OUT if model == "sarvam" else CLAUDE_OUT)
        request = compare.build_request(conv, job, limit_out)
        if model == "sarvam" and not budget.allows(compare.estimate_input_tokens(request) + limit_out):
            this_run["stopped_at_cap"] = True
            continue   # a later (shorter) call may still fit; the cap itself is never passed
        started = time.monotonic()
        reply, error, tin, tout, cost = None, None, 0, 0, 0
        try:
            response = clients[model].complete(request)
            structured = response.structured or {}
            reply = structured.get("text") if isinstance(structured.get("text"), str) else None
            tin, tout, cost = response.usage.input_tokens, response.usage.output_tokens, response.usage.cost_micros
            if reply is None:
                error = "no_reply_tool_call"
        except LlmError as exc:
            error = exc.code
        latency = int((time.monotonic() - started) * 1000)
        result = Result(conv.id, job, model, reply, error, latency, tin, tout, cost)
        result.rules = compare.check(conv, job, reply)
        raw[key] = asdict(result)
        if model == "sarvam":
            budget.spend(tin + tout)
        this_run[model] += tin + tout
        this_run["calls"] += 1
        usage["sarvam_tokens_total"] = budget.used
        usage["claude_tokens_total"] += tin + tout if model == "claude" else 0
        save(out, raw, usage)
        time.sleep(sleep)
    usage["runs"].append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **this_run})
    save(out, raw, usage)
    print(f"done: {this_run['calls']} calls; Sarvam tokens this run {this_run['sarvam']} ({budget.used} of {SARVAM_TOKEN_CAP} in total); Claude tokens this run {this_run['claude']}; stopped at the cap: {this_run['stopped_at_cap']}")
    return raw


def results_from(raw: dict) -> dict[str, list[Result]]:
    """The stored replies, with the rules checked again from the reply (the rules are code and may be refined without calling a provider again)."""
    convs = {c.id: c for c in compare.conversations()}
    by: dict[str, list[Result]] = {"claude": [], "sarvam": []}
    for item in raw.values():
        r = Result(**item)
        r.rules = compare.check(convs[r.conv_id], r.job, r.reply)
        by[r.model].append(r)
    return by


def report(out: Path, raw: dict, usage: dict) -> None:
    convs = {c.id: c for c in compare.conversations()}
    by = results_from(raw)
    index = {(r.model, r.job, r.conv_id): r for rs in by.values() for r in rs}
    pairs = []
    for conv_id, conv in convs.items():
        for job in JOBS:
            c, s = index.get(("claude", job, conv_id)), index.get(("sarvam", job, conv_id))
            if c and s:
                pairs.append((conv, job, c, s))
    (out / "side-by-side.html").write_text(compare.side_by_side_html(pairs), encoding="utf-8")
    both = {(r.conv_id, r.job) for r in by["claude"]} & {(r.conv_id, r.job) for r in by["sarvam"]}
    paired = {m: [r for r in by[m] if (r.conv_id, r.job) in both] for m in by}
    lines = ["# Claude Haiku vs Sarvam 105B: call_turn and whatsapp_reply", "", f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}. Synthetic customer lines (drafts, not reviewed by a native speaker); rules checked by code.",
             f"Pairs compared (same conversation and job on both models): {len(both)}. Sarvam tokens spent in total: {usage['sarvam_tokens_total']} of {SARVAM_TOKEN_CAP}.", "",
             "## Scores (only the pairs both models answered)", "", "| | Claude Haiku | Sarvam 105B |", "|---|---|---|"]
    sc = {m: compare.score(paired[m]) for m in paired}
    for key, label in (("calls", "calls"), ("errors", "errors (no reply at all)"), ("rule_pass_rate", "rule pass rate"), ("all_rules_passed", "answers with every rule passed"), ("latency_p50_ms", "latency median (ms)"), ("latency_p95_ms", "latency 95th percentile (ms)"), ("input_tokens", "input tokens"), ("output_tokens", "output tokens"), ("rupees_per_1000_turns", "cost per 1,000 turns (Rs)")):
        fmt = (lambda v: f"{v:.1%}") if key == "rule_pass_rate" else str
        lines.append(f"| {label} | {fmt(sc['claude'][key])} | {fmt(sc['sarvam'][key])} |")
    lines += ["", "## Rule failures (count)", "", "| rule | Claude | Sarvam |", "|---|---|---|"]
    fc, fs = compare.rule_failures(paired["claude"]), compare.rule_failures(paired["sarvam"])
    lines += [f"| {rule} | {fc.get(rule, 0)} | {fs.get(rule, 0)} |" for rule in compare.RULES]
    lines += ["", "## By language (rule pass rate)", "", "| language | Claude | Sarvam | pairs |", "|---|---|---|---|"]
    for lang in compare.LANG_COUNTS:
        cells = []
        for m in ("claude", "sarvam"):
            rs = [r for r in paired[m] if r.conv_id.startswith(lang + "-")]
            cells.append(f"{compare.score(rs)['rule_pass_rate']:.1%}" if rs else "-")
        lines.append(f"| {lang} | {cells[0]} | {cells[1]} | {sum(1 for k in both if k[0].startswith(lang + '-'))} |")
    lines += ["", "## By job (rule pass rate)", "", "| job | Claude | Sarvam |", "|---|---|---|"]
    for job in JOBS:
        cells = [f"{compare.score([r for r in paired[m] if r.job == job])['rule_pass_rate']:.1%}" for m in ("claude", "sarvam")]
        lines.append(f"| {job} | {cells[0]} | {cells[1]} |")
    lines += ["", "## Each failure", ""]
    for m in ("claude", "sarvam"):
        for r in paired[m]:
            if r.failed_rules() or r.error:
                lines.append(f"- {m} {r.conv_id} {r.job}: {', '.join(r.failed_rules()) or r.error}")
    lines += ["", "## How to read this", "",
              "- A call that ran into its output limit (Kannada runs long on Claude's tokenizer; Sarvam 105B spends many tokens reasoning before it answers) was made again with a larger limit (Claude 2400, Sarvam 3500) when the cap allowed. Cost per 1,000 turns counts the final attempt only; every first attempt's tokens are in usage.json.",
              "- The rules read digits, scripts and a few fixed words. They cannot read number words (a reply that spells the price out is 'not decided' for the price rule), nor judge grammar, politeness or whether a native speaker would say it. That is what the side-by-side page is for.",
              "- Latency is the whole call from this laptop, one call at a time; a live call needs a first word within about a second or two, which neither model gives without streaming.", "",
              "Read side-by-side.html for the wording itself: the rules cannot judge naturalness, politeness or whether a native speaker would say it that way."]
    (out / "results.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:22]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retry-truncated", action="store_true", help="make again, with a larger output limit, the calls that stopped at their limit")
    args = ap.parse_args()
    clients = None if args.dry_run else build_clients()
    raw = run(args.out, clients, limit=args.limit, dry=args.dry_run, retry_truncated=args.retry_truncated)
    if not args.dry_run:
        report(args.out, raw, load(args.out)[1])


if __name__ == "__main__":
    main()
