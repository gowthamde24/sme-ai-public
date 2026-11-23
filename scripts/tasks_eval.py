#!/usr/bin/env python3
"""Does Claude plan the owner's instructions safely? (job DR B1, night 4). OPT-IN: never part of make check, never run by CI. Claude Haiku ONLY (no Sarvam call).

  make tasks-eval                 the 30 synthetic instructions (six languages, several business types) planned by the real planner against a synthetic workspace; writes ~/Desktop/stack19-jobs/model-compare/tasks-eval.{md,json}
  python scripts/tasks_eval.py --dry-run     lists what would be sent; reads no key, opens no connection

CAP: 500,000 Claude tokens in total, counted BEFORE each call (the request estimated generously plus its output limit) and kept in tasks-eval.json; a finished case is never repeated. The key is read from Secret Manager into a variable; never printed, logged or written. Synthetic text only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "ai-api"))

from app.agents.compare import HAIKU_ONLY, estimate_input_tokens  # noqa: E402
from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig  # noqa: E402
from app.agents.llm.interface import LlmError, LlmRequest, LlmResponse  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.tasks import evals  # noqa: E402
from app.tasks.models import ProvidedContact  # noqa: E402
from app.tasks.planner import Planner  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
DEFAULT_OUT = Path.home() / "Desktop" / "stack19-jobs" / "model-compare"
TOKEN_CAP = 500_000
CLAUDE_PRICE = (9_000_000, 45_000_000)


class CapReached(Exception):
    pass


class CountingClient:
    """Wraps the real client: refuses a call that could pass the cap, and counts what was used."""

    model_id = HAIKU_ONLY

    def __init__(self, inner: Any, used: int) -> None:
        self._inner, self.used, self.this_case = inner, used, 0

    def complete(self, request: LlmRequest) -> LlmResponse:
        if self.used + estimate_input_tokens(request) + request.max_output_tokens > TOKEN_CAP:
            raise CapReached
        response = self._inner.complete(request)
        spent = response.usage.input_tokens + response.usage.output_tokens
        self.used += spent
        self.this_case += spent
        return response


def read_key() -> str:
    done = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret=sme-anthropic-api-key", f"--project={PROJECT}"], capture_output=True, text=True, check=False)
    if done.returncode != 0 or not done.stdout.strip():
        raise SystemExit("cannot read the Claude key from Secret Manager (skipping the run)")
    return done.stdout.strip()


def plan_one(case: evals.Case, client: CountingClient) -> evals.Verdict:
    db = evals.SyntheticDb()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: client, llm_for=lambda job: (lambda: client), unavailable=None)
    planner = Planner(SimpleNamespace(agents=agents), None)   # type: ignore[arg-type]
    provided = [ProvidedContact(name=n, phone=p) for n, p in case.provided] or None
    client.this_case = 0
    planned, error = None, None
    try:
        planned = planner.plan(token="t", tenant_id=uuid.uuid4(), tenant_name="Demo Business", instruction=case.instruction, language=case.lang, provided=provided, answer=None, question=None,
                               school=case.pack in evals.SCHOOL, refusal=lambda exc: exc, now=evals.NOW)
    except ApiError as exc:
        error = exc.code
    except LlmError as exc:
        error = exc.code
    verdict = evals.judge(case, planned, error)
    verdict.tokens = client.this_case
    return verdict


def run(out: Path, dry: bool, client: Any = None) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    path = out / "tasks-eval.json"
    data: dict[str, Any] = json.loads(path.read_text()) if path.exists() else {"tokens": 0, "cases": {}}
    todo = [c for c in evals.CASES if c.id not in data["cases"]]
    print(f"{len(todo)} cases to plan; Claude tokens already spent {data['tokens']} of {TOKEN_CAP}")
    if dry:
        return data
    counting = CountingClient(client or AnthropicClient(AnthropicConfig(read_key(), HAIKU_ONLY, *CLAUDE_PRICE)), data["tokens"])
    for case in todo:
        try:
            verdict = plan_one(case, counting)
        except CapReached:
            print("STOPPED AT THE CAP")
            break
        data["cases"][case.id] = {"lang": verdict.lang, "checks": verdict.checks, "plan": verdict.plan, "question": verdict.question, "error": verdict.error, "tokens": verdict.tokens}
        data["tokens"] = counting.used
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    report(out, data)
    return data


def report(out: Path, data: dict[str, Any]) -> None:
    verdicts = [evals.Verdict(cid, item["lang"], item["checks"], item["plan"], item["question"], item["error"], item["tokens"]) for cid, item in data["cases"].items()]
    summary = evals.summary(verdicts)
    by_id = {c.id: c for c in evals.CASES}
    lines = ["# Task planning evaluation (Claude Haiku only)", "",
             f"{summary['cases']} synthetic instructions in six languages, planned by the real planner against a synthetic workspace of twelve invented leads. {summary['passed']} of {summary['checks']} checks passed ({summary['pass_rate']:.1%}); {summary['cases_clean']} of {summary['cases']} cases passed every check.", "",
             "| language | cases | clean |", "|---|---|---|"]
    lines += [f"| {lang} | {row['cases']} | {row['clean']} |" for lang, row in sorted(summary["by_language"].items())]
    lines += ["", "## Failed checks", ""]
    lines += [f"- `{name}`: {count}" for name, count in summary["failed_by_check"].items()] or ["- none"]
    lines += ["", f"Claude tokens used in total: {data['tokens']} of {TOKEN_CAP}. The checks cannot judge wording: read the plans below with a native speaker.", "", "## Cases", ""]
    for cid, item in data["cases"].items():
        case = by_id[cid]
        failed = [k for k, v in item["checks"].items() if v is False]
        lines.append(f"### {cid} ({case.lang}, {case.pack}) {'FAILED: ' + ', '.join(failed) if failed else 'ok'}")
        lines.append(f"Instruction: {case.instruction}")
        if item["error"]:
            lines.append(f"Error: {item['error']}")
        elif item["question"]:
            lines.append(f"Question asked: {item['question']}")
        elif item["plan"]:
            plan = item["plan"]
            lines.append(f"Plan: channel {plan['channel']}, goal: {plan['goal']}; questions: {' | '.join(q['text'] for q in plan['questions'])}; people {plan['contacts_total']}")
            if plan.get("message_text"):
                lines.append(f"WhatsApp text: {plan['message_text']}")
        lines.append("")
    (out / "tasks-eval.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:12]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()
    if args.report_only:
        report(args.out, json.loads((args.out / "tasks-eval.json").read_text()))
    else:
        run(args.out, args.dry_run)


if __name__ == "__main__":
    main()
