"""Job DJ: the converter that makes WhatsApp voice notes (ogg/opus mono) from a provider's WAV. With a fake runner (always) and with the REAL ffmpeg on a generated fixture (when ffmpeg is installed; CI and the
API image install it and set REQUIRE_FFMPEG=1 so that a missing ffmpeg FAILS there instead of skipping). No network."""

from __future__ import annotations

import os
import shutil
import subprocess
from types import SimpleNamespace
from typing import Any

import pytest

from app.voice import convert
from app.voice.audio import inspect_audio
from app.voice.convert import FfmpegConverter, ffmpeg_command, is_ogg_opus_mono
from app.voice.fake import tone
from app.voice.interface import VoiceError

OGG = b"OggS\x00\x02" + b"\x00" * 20 + b"OpusHead\x01\x01" + b"\x00" * 60   # an Ogg page, then OpusHead, version 1, ONE channel
STEREO = b"OggS\x00\x02" + b"\x00" * 20 + b"OpusHead\x01\x02" + b"\x00" * 60


def runner(returncode: int = 0, stdout: bytes = OGG, *, raises: Exception | None = None) -> Any:
    calls: list[dict[str, Any]] = []

    def run(command: list[str], **kwargs: Any) -> Any:
        calls.append({"command": command, **kwargs})
        if raises is not None:
            raise raises
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=b"")

    run.calls = calls  # type: ignore[attr-defined]
    return run


def test_the_command_is_fixed_pipes_the_audio_and_uses_no_shell() -> None:
    run = runner()
    out = FfmpegConverter("ffmpeg", runner=run).to_ogg_opus(b"RIFF....WAVE-bytes")
    assert out == OGG
    (call,) = run.calls
    assert call["command"] == ffmpeg_command("ffmpeg") and call["input"] == b"RIFF....WAVE-bytes" and call["shell"] is False and call["timeout"] > 0
    cmd = call["command"]
    assert cmd[cmd.index("-ac") + 1] == "1", "mono, as WhatsApp requires"
    assert cmd[cmd.index("-c:a") + 1] == "libopus" and cmd[cmd.index("-f") + 1] == "ogg"
    assert "pipe:0" in cmd and "pipe:1" in cmd, "stdin to stdout: no file is written"
    assert "-nostdin" in cmd and "-map_metadata" in cmd


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        (FileNotFoundError(), "ffmpeg_missing"),
        (subprocess.TimeoutExpired("ffmpeg", 20), "convert_timeout"),
        (PermissionError(), "convert_failed"),
    ],
)
def test_trouble_is_a_constant_code(kind: Exception, expected: str) -> None:
    with pytest.raises(VoiceError) as caught:
        FfmpegConverter(runner=runner(raises=kind)).to_ogg_opus(b"x" * 300)
    assert caught.value.code == expected


def test_a_failed_run_an_empty_input_and_a_wrong_output_are_refused_without_ffmpegs_words() -> None:
    with pytest.raises(VoiceError) as failed:
        FfmpegConverter(runner=runner(returncode=1)).to_ogg_opus(b"x" * 300)
    assert failed.value.code == "convert_failed" and "x" * 10 not in str(failed.value)
    with pytest.raises(VoiceError) as empty:
        FfmpegConverter(runner=runner()).to_ogg_opus(b"")
    assert empty.value.code == "bad_input"
    for bad in (b"RIFF" + b"\x00" * 100, STEREO, b"OggS" + b"\x00" * 100, b"", OGG + b"\x00" * (convert.MAX_OUTPUT_BYTES + 1)):
        with pytest.raises(VoiceError) as wrong:
            FfmpegConverter(runner=runner(stdout=bad)).to_ogg_opus(b"x" * 300)
        assert wrong.value.code == "bad_output"


def test_what_counts_as_ogg_opus_mono() -> None:
    assert is_ogg_opus_mono(OGG) and not is_ogg_opus_mono(STEREO) and not is_ogg_opus_mono(b"RIFF" + b"\x00" * 100) and not is_ogg_opus_mono(b"OggS")


def test_nothing_of_the_audio_is_in_the_repr_or_the_error() -> None:
    assert "x" * 5 not in repr(FfmpegConverter())
    assert convert.CONTENT_TYPE == "audio/ogg; codecs=opus"


# --------------------------------------------------------------------------------------------- the real ffmpeg
HAVE = shutil.which("ffmpeg") is not None
REQUIRED = os.environ.get("REQUIRE_FFMPEG") == "1"


def test_ffmpeg_is_there_where_it_is_required() -> None:
    if REQUIRED:
        assert HAVE, "REQUIRE_FFMPEG=1 but ffmpeg is not installed"


@pytest.mark.skipif(not HAVE and not REQUIRED, reason="ffmpeg is not installed here (CI and the API image have it)")
def test_a_real_wav_becomes_a_real_ogg_opus_mono_file() -> None:
    wav = tone(2.0)
    out = FfmpegConverter().to_ogg_opus(wav)
    assert is_ogg_opus_mono(out) and out[:4] == b"OggS"
    assert len(out) < len(wav) / 2, "coded, not copied"
    if shutil.which("ffprobe"):
        probe = subprocess.run(  # noqa: S603
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,channels:format=format_name,duration", "-of", "default=nw=1", "-i", "pipe:0"],  # noqa: S607
            input=out, capture_output=True, check=True,
        ).stdout.decode()
        assert "codec_name=opus" in probe and "channels=1" in probe and "format_name=ogg" in probe
        shown = next(line.split("=")[1] for line in probe.splitlines() if line.startswith("duration="))
        if shown != "N/A":   # an Ogg read from a pipe often has no duration to show
            assert 1.8 <= float(shown) <= 2.3
    assert inspect_audio(out).content_type == "audio/ogg"


@pytest.mark.skipif(not HAVE and not REQUIRED, reason="ffmpeg is not installed here")
def test_garbage_is_refused_by_the_real_ffmpeg() -> None:
    with pytest.raises(VoiceError) as caught:
        FfmpegConverter().to_ogg_opus(os.urandom(2000))
    assert caught.value.code == "convert_failed"


@pytest.mark.skipif(not HAVE and not REQUIRED, reason="ffmpeg is not installed here")
def test_the_self_test_of_the_image_smoke_test_passes() -> None:
    assert convert.main() == 0
