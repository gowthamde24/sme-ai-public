#!/usr/bin/env python3
"""Live eval of the AI lead reader (owner decision, 31 Oct 2026). OPT-IN: it spends a model call per case; the key comes from the environment only and is never printed.

  ANTHROPIC_API_KEY=... python scripts/lead_reader_eval.py --model <light model> [--cases tests/evals/lead_reader/cases.jsonl] [--out ~/Desktop/stack19-jobs/casual-check/lead-reader.md]

Each case goes through the SAME reader and the SAME checks as the worker (AnthropicLeadReader, verified_fields); the result is compared with the case's `expect` (any listed substring in the value) and `forbid`
(fields that must stay empty). Only the ids, pass/fail and the fields that failed are written: the words stay in the cases file."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.lead_profile.reader import AnthropicLeadReader  # noqa: E402
from app.lead_profile.service import verified_fields  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def judge(case: dict, fields: dict[str, str]) -> list[str]:
    problems = []
    for key, needles in case.get("expect", {}).items():
        value = fields.get(key, "").lower()
        if not any(n.lower() in value for n in needles):
            problems.append(f"{key} missing ({'/'.join(needles)})")
    for key in case.get("forbid", []):
        if fields.get(key):
            problems.append(f"{key} should be empty")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--cases", default=str(ROOT / "tests" / "evals" / "lead_reader" / "cases.jsonl"))
    ap.add_argument("--out")
    args = ap.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("lead-reader-eval: set ANTHROPIC_API_KEY in the environment", file=sys.stderr)
        return 2
    reader = AnthropicLeadReader(key, args.model)
    cases = [json.loads(line) for line in Path(args.cases).read_text(encoding="utf-8").splitlines() if line.strip()]
    lines, passed = [], 0
    for case in cases:
        answer = reader.read(case["text"])
        fields = verified_fields(answer, case["text"]) if answer is not None else {}
        problems = judge(case, fields) if answer is not None else ["no answer from the model"]
        passed += not problems
        lines.append(f"| {case['id']} | {case['kind']} | {'PASS' if not problems else 'FAIL'} | {'; '.join(problems)} |")
        print(f"{case['id']:28s} {'ok  ' if not problems else 'FAIL'} {'; '.join(problems)}")
    report = f"# AI lead reader, live eval\n\nModel: {args.model}. {passed} of {len(cases)} cases pass.\n\n| case | kind | result | what failed |\n|---|---|---|---|\n" + "\n".join(lines) + "\n"
    if args.out:
        Path(args.out).expanduser().write_text(report, encoding="utf-8")
    print(f"{passed} of {len(cases)} pass")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
