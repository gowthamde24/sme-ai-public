# ruff: noqa: E501
"""What each speaking style does to the VOICE itself (docs/contracts/voice-styles.md; owner 24 Nov 2026: a style must SOUND different, not only read different).

Both providers document the controls (read 24 Nov 2026): Sarvam bulbul v4 flash `pace` 0.5-2.0, `pitch` -0.5..0.5, `loudness` 0.1-2.5, `temperature` 0.01-1.0 (expressiveness); Cartesia sonic-3.x `generation_config.speed` 0.6-1.5,
`volume` 0.5-2.0 and `emotion` (English only; guidance, small changes are hard to hear). `friendly` is the engine's own sound: it sends nothing extra, so a workspace on friendly (or with no style) speaks exactly as before.
The numbers are a first draft to be tuned by ear (the style previews are the listening test). Every value is clamped to its documented range before it is sent."""

from __future__ import annotations

from typing import Any

# Sarvam: pace is a FACTOR on the engine's own base pace and the workspace speed; pitch/loudness/temperature are absolute (None = the engine's default, not sent).
# Cartesia: speed is a FACTOR on the workspace speed; volume absolute (None = not sent); emotion only in English (None = not sent).
STYLE_VOICE: dict[str, dict[str, dict[str, Any]]] = {
    "friendly": {"sarvam": {}, "cartesia": {}},
    "respectful": {"sarvam": {"pace": 0.95, "pitch": -0.05, "temperature": 0.45}, "cartesia": {"speed": 0.95, "emotion": "calm"}},
    "quick": {"sarvam": {"pace": 1.15, "temperature": 0.5}, "cartesia": {"speed": 1.15}},
    "professional": {"sarvam": {"pitch": -0.05, "temperature": 0.35}, "cartesia": {"emotion": "neutral"}},
    "calm_caring": {"sarvam": {"pace": 0.88, "pitch": -0.08, "loudness": 0.9, "temperature": 0.55}, "cartesia": {"speed": 0.88, "volume": 0.9, "emotion": "sympathetic"}},
    "cheerful": {"sarvam": {"pace": 1.08, "pitch": 0.1, "temperature": 0.8}, "cartesia": {"speed": 1.08, "emotion": "happy"}},
    "confident": {"sarvam": {"pitch": -0.1, "loudness": 1.1, "temperature": 0.5}, "cartesia": {"volume": 1.1, "emotion": "confident"}},
}
RANGES = {"pace": (0.5, 2.0), "pitch": (-0.5, 0.5), "loudness": (0.1, 2.5), "temperature": (0.01, 1.0), "speed": (0.6, 1.5), "volume": (0.5, 2.0)}


def clamp(name: str, value: float) -> float:
    low, high = RANGES[name]
    return round(max(low, min(high, float(value))), 3)


def settings_for(style: str | None, engine: str) -> dict[str, Any]:
    """The settings of `style` for `engine` ("sarvam" | "cartesia"), clamped; empty for friendly, an unknown style or an unknown engine (nothing extra is sent)."""
    raw = STYLE_VOICE.get(style or "", {}).get(engine, {})
    return {k: (v if k == "emotion" else clamp(k, v)) for k, v in raw.items()}
