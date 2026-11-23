"""The ten background sounds and their previews (docs/contracts/voice-styles.md section 2; docs/licences/background-sounds.md): every sound but Off has a bed and a 6 s mp3 preview, the public route serves only those, and
the two beds that were already in use did not change."""

# ruff: noqa: E501

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from app.telephony import ambience, background_samples
from tests.fakes import make_client

SOUNDS = [b for b in ambience.BACKGROUNDS if b != "off"]
SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def test_there_are_ten_sounds_in_the_contract_order_and_every_one_has_labels_in_seven_languages() -> None:
    assert ambience.BACKGROUNDS == ("off", "quiet_office", "busy_office", "call_centre", "shop", "market", "showroom", "clinic_reception", "home", "street")
    assert set(ambience.LABELS) == set(ambience.BACKGROUNDS) and all(set(v) == set(ambience.LANGUAGES) and all(v.values()) for v in ambience.LABELS.values())


@pytest.mark.parametrize("sound", SOUNDS)
def test_every_sound_has_a_bed_that_loads_and_a_six_second_mp3(sound: str) -> None:
    assert ambience.load_bed(sound) is not None
    data = (background_samples.PREVIEWS / f"{sound}.mp3").read_bytes()
    assert 10_000 < len(data) < 60_000 and (data[:3] == b"ID3" or data[0] == 0xFF), "an mp3 of a few seconds"


def test_the_beds_are_the_ones_the_script_writes_so_nobody_edits_a_file_by_hand() -> None:
    run = subprocess.run([sys.executable,  # noqa: S603 - our own script, fixed arguments
                          str(SCRIPTS / "make_ambience_placeholders.py"), "--check"], capture_output=True, text=True, check=False, cwd=Path(__file__).resolve().parents[1], env={"PYTHONPATH": str(Path(__file__).resolve().parents[1]), "PATH": ""})
    assert run.returncode == 0, run.stdout + run.stderr


def test_the_two_beds_already_in_use_keep_their_exact_bytes() -> None:
    import hashlib
    assert {n: hashlib.sha256(ambience.placeholder(n)).hexdigest()[:16] for n in ("quiet_office", "shop")} == {n: hashlib.sha256((ambience.DATA / f"{n}.pcm").read_bytes()).hexdigest()[:16] for n in ("quiet_office", "shop")}


def test_the_beds_differ_from_each_other() -> None:
    assert len({ambience.placeholder(n) for n in SOUNDS}) == len(SOUNDS)


def test_the_route_serves_a_sound_publicly_with_a_long_cache_and_nothing_else() -> None:
    client, _ = make_client()
    ok = client.get("/v1/background-samples/market.mp3")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg" and ok.headers["cache-control"] == "public, max-age=31536000, immutable" and ok.content == (background_samples.PREVIEWS / "market.mp3").read_bytes()
    for bad in ("off.mp3", "market", "market.wav", "../market.mp3", "..%2Fmarket.mp3", "stadium.mp3", "quiet_office.pcm", ".mp3"):
        assert client.get(f"/v1/background-samples/{bad}").status_code in (404, 400, 422), bad
    assert client.get("/v1/background-samples/off.mp3").json()["error"]["code"] == "no_sample"


def test_sample_url_is_null_for_off_and_for_an_unknown_word() -> None:
    assert background_samples.sample_url("off") is None and background_samples.sample_url("stadium") is None
    assert background_samples.sample_url("street") == "/v1/background-samples/street.mp3"
