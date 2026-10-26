"""Which model serves which AI job (night 3, ADR 0102): one setting per job, `claude` (the default: the main model exactly as LLM_PROVIDER configures it today) or `sarvam`.

No behaviour changes by default: every job is `claude`. A job accepts `sarvam` only when it has a model path to switch AND the Claude-versus-Sarvam comparison (`make model-compare`) has been run for
it; otherwise the setting REFUSES `sarvam` at start with the reason below, and the job stays on Claude. Flipping a job to `sarvam_ok` after the owner has read the comparison is a one-line change here.
This module has no imports from the rest of the app (the settings and the wiring both read it)."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass

JOBS: tuple[str, ...] = ("ask", "research", "outcome_classify", "followup_plan", "call_turn", "whatsapp_reply")
PROVIDERS: tuple[str, ...] = ("claude", "sarvam")
DEFAULT_PROVIDER = "claude"


@dataclass(frozen=True)
class JobInfo:
    sarvam_ok: bool
    reason: str   # why `sarvam` is refused (or, when allowed, what it applies to)


JOB_INFO: dict[str, JobInfo] = {
    "ask": JobInfo(False, "the assistant's question loop runs many tools over several turns with closed schemas and citations; it has not been compared on Sarvam, so it stays on Claude"),
    "research": JobInfo(False, "the research agent has no live model path yet (it runs on fixtures only) and has not been compared, so it stays on Claude"),
    "outcome_classify": JobInfo(False, "outcomes are classified by a reviewed word list, not a model; there is nothing to switch"),
    "followup_plan": JobInfo(False, "follow-ups are planned by rules in code (no model call); there is nothing to switch"),
    "call_turn": JobInfo(True, "compared by make model-compare; the call pipeline (telephony) is not built yet, so this takes effect when it reads the setting"),
    "whatsapp_reply": JobInfo(True, "the lead message draft (one call, a structured reply, no tools) was compared by make model-compare"),
}
if tuple(JOB_INFO) != JOBS:   # a job added in one list and not the other
    raise RuntimeError("JOB_INFO must describe exactly JOBS")


def setting_name(job: str) -> str:
    return f"AI_JOB_{job.upper()}"


def check_choices(choices: dict[str, str]) -> list[str]:
    """The problems with a job-to-provider map, as sentences naming the environment variable (empty = fine). Nothing here reads a key."""
    problems: list[str] = []
    for job in JOBS:
        value = choices.get(job, DEFAULT_PROVIDER).strip().lower()
        if value not in PROVIDERS:
            problems.append(f"{setting_name(job)} must be one of {', '.join(PROVIDERS)}")
        elif value == "sarvam" and not JOB_INFO[job].sarvam_ok:
            problems.append(f"{setting_name(job)}=sarvam is refused: {JOB_INFO[job].reason}")
    return problems
