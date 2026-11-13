"""What each provider was used for in ONE phone call, from what the call measured (admin console usage ledger, 13 Nov 2026). Pure: counts in, lines out; the recording is `app.ops.usage`.

  * Plivo: the call's seconds as the phone server's clock measured them, rounded UP to Plivo's 30-second pulses (a carrier that is not Plivo, or a call of no length, records nothing)
  * Cartesia / Sarvam voice: the characters each voice engine was GIVEN to speak (`Usage.tts_chars`, counted at the voice; a greeting played from memory is not counted because no engine was asked)
  * Sarvam speech-to-text: the seconds of the caller's audio sent to the recogniser (`Usage.stt_seconds`), only when the recogniser really is Sarvam's
  * Claude: the input and output tokens the model REPORTED (the streaming adapter reads them from the provider's own events); none reported = nothing recorded, never a guess
Every line carries ref_kind `call` and the call's id, so recording a call twice changes nothing."""

# ruff: noqa: E501

from __future__ import annotations

import math
import uuid
from collections.abc import Mapping
from typing import Any

from app.ops.usage import UsageLine

PLIVO_PULSE_S = 30   # Plivo India bills a call in 30-second pulses (1 to 30 s = one pulse)
TTS_ENGINES = {"cartesia": "cartesia", "sarvam_v4": "sarvam"}   # the voice engine's name in `tts_chars` -> the provider of the ledger


def plivo_billed_seconds(duration_s: float, pulse_s: int = PLIVO_PULSE_S) -> int:
    """The seconds Plivo bills for a call of this length: whole pulses, rounded up; 0 for a call that had no length."""
    if duration_s <= 0 or pulse_s <= 0:
        return 0
    return math.ceil(duration_s / pulse_s) * pulse_s


def token_totals(*sources: Any) -> tuple[int, int]:
    """(input, output) tokens summed over the model clients of a call that REPORT them (`input_tokens`, `output_tokens` as whole numbers); a client that reports nothing adds nothing."""
    total_in = total_out = 0
    for src in sources:
        n_in, n_out = getattr(src, "input_tokens", None), getattr(src, "output_tokens", None)
        if isinstance(n_in, int) and not isinstance(n_in, bool) and n_in > 0:
            total_in += n_in
        if isinstance(n_out, int) and not isinstance(n_out, bool) and n_out > 0:
            total_out += n_out
    return total_in, total_out


def stt_is_sarvam(parts: Any, language: str) -> bool:
    """Is the recogniser of this call Sarvam's? (Only then are the caller's audio seconds Sarvam's seconds.) Anything unclear: no."""
    try:
        return type(parts.stt_for(language)).__name__.startswith("SarvamRealtime")
    except Exception:  # noqa: BLE001 - unclear means not recorded
        return False


def call_lines(
    call_id: uuid.UUID,
    *,
    carrier: str | None,
    duration_s: float,
    tts_chars: Mapping[str, int],
    stt_seconds: float,
    stt_is_sarvam_engine: bool,
    tokens_in: int,
    tokens_out: int,
) -> list[UsageLine]:
    ref = str(call_id)
    lines: list[UsageLine] = []
    if (carrier or "").lower() == "plivo":
        billed = plivo_billed_seconds(duration_s)
        if billed > 0:
            lines.append(UsageLine("plivo", "second", billed, "call", ref))
    for engine, provider in TTS_ENGINES.items():
        chars = int(tts_chars.get(engine, 0) or 0)
        if chars > 0:
            lines.append(UsageLine(provider, "character", chars, "call", ref))
    if stt_is_sarvam_engine and stt_seconds > 0:
        lines.append(UsageLine("sarvam", "second", round(stt_seconds, 3), "call", ref))
    if tokens_in > 0:
        lines.append(UsageLine("anthropic", "token_in", tokens_in, "call", ref))
    if tokens_out > 0:
        lines.append(UsageLine("anthropic", "token_out", tokens_out, "call", ref))
    return lines
