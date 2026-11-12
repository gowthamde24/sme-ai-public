"""What a task is estimated to cost (job DR B1). Money is computed HERE, from counts, with the rates below (an ESTIMATE: the real invoices of the phone line, the voice, the speech engine and the model decide): the model never calculates a price. Paise throughout."""

from __future__ import annotations

from typing import Any

CALL_MINUTES = 2
# What a call minute costs us, in paise: an ESTIMATE from the parts (11 Nov 2026; replaces the old fake Rs 1.50 a minute). Each rate is a number the owner can check against an invoice and change here.
PLIVO_PAISE_PER_MINUTE = 38              # Plivo India's list price: Rs 0.38 a minute in 30-second pulses, before GST
VOICE_CHARS_PER_MINUTE = 440             # measured on the 11 Nov test calls: 389 to 439 characters of speech a minute
VOICE_PAISE_PER_1000_CHARS = 550         # Cartesia overage: 65 dollars per million characters at about Rs 85 a dollar; the plan's included credits make the real cost lower
SPEECH_TO_TEXT_PAISE_PER_MINUTE = 50     # Sarvam: about Rs 30 an hour of audio
MODEL_PAISE_PER_MINUTE = 160             # the phone model: about 2,000 tokens in and 60 out a turn, about 8 turns a minute
CALL_PAISE_PER_MINUTE = PLIVO_PAISE_PER_MINUTE + VOICE_CHARS_PER_MINUTE * VOICE_PAISE_PER_1000_CHARS // 1000 + SPEECH_TO_TEXT_PAISE_PER_MINUTE + MODEL_PAISE_PER_MINUTE   # 490
MESSAGE_PAISE = 60                       # a WhatsApp message: the template price is NOT confirmed yet
CAP_MARGIN_NUMERATOR, CAP_MARGIN_DENOMINATOR = 12, 10   # the default cap is the estimate plus 20 percent
BASIS = (f"estimate: a call minute about Rs {CALL_PAISE_PER_MINUTE / 100:.2f} (phone line Rs {PLIVO_PAISE_PER_MINUTE / 100:.2f}, voice Rs {VOICE_CHARS_PER_MINUTE * VOICE_PAISE_PER_1000_CHARS / 100000:.2f}, "
         f"speech-to-text Rs {SPEECH_TO_TEXT_PAISE_PER_MINUTE / 100:.2f}, model Rs {MODEL_PAISE_PER_MINUTE / 100:.2f}), a WhatsApp message about Rs {MESSAGE_PAISE / 100:.2f} (not confirmed), before GST")


def estimate(contacts: int, channel: str, follow_up_kind: str) -> dict[str, Any]:
    calls = contacts if channel in ("call", "both") else 0
    messages = contacts if channel in ("whatsapp", "both") else 0
    if channel == "call" and follow_up_kind == "whatsapp_summary":
        messages = contacts
    minutes = calls * CALL_MINUTES
    cost = minutes * CALL_PAISE_PER_MINUTE + messages * MESSAGE_PAISE
    return {"contacts": contacts, "calls": calls, "messages": messages, "minutes": minutes, "cost_paise": cost, "basis": BASIS}


def default_cap(estimated_paise: int) -> int:
    return (estimated_paise * CAP_MARGIN_NUMERATOR + CAP_MARGIN_DENOMINATOR - 1) // CAP_MARGIN_DENOMINATOR
