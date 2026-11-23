"""Run by `make eval-live` BEFORE anything else: refuses (exit 2) unless the real adapter's own configuration gates are satisfied.
Prints only a reason code, never a value from the environment."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import sys

import agent_eval

from app.config import Settings


def main() -> int:
    factory, why = agent_eval.live_gate(Settings())
    if factory is None:
        print(f"eval-live refused: {why}", file=sys.stderr)
        print(
            "It needs LLM_PROVIDER=anthropic, AGENTS_ENABLED=true, LLM_MODEL, ANTHROPIC_API_KEY, both price settings and "
            "LLM_SPEND_CAP_CONFIRMED=true (see docs/pre-pilot-checklist.md). Nothing was run.",
            file=sys.stderr,
        )
        return 2
    print("eval-live: the real adapter's gates are satisfied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
