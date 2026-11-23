"""Fetch the optional speech models into the API image at build time (docs/runbooks/live-turn-models.md, docs/runbooks/speaker-check.md): each one pinned to a repository revision and checked against its sha256.
  * Indic Smart Turn base int8 (BSD-2-Clause, 24 MB): the audio turn model.
  * CAM++ zh-en fp32 from 3D-Speaker (Apache-2.0, 28 MB): the speaker check (browser Live talk only).
A download that cannot be reached leaves the image without that model (the API then runs without it and says so at start); a file that does not match its checksum fails the build.
Usage: python fetch_audio_turn_model.py <directory>"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = (
    ("indic-smart-turn-base-int8.onnx", "https://huggingface.co/adimyth/indic-smart-turn/resolve/d5878b3ce4d5287c9811943a0b362d3533f85dea/indic-smart-turn-base-int8.onnx",
     "98ef8f8e2185ab337bb622cf60cf353c5235d9db91182dd5c56fe7fbda8dc172"),
    ("campplus_zh_en_fp32.onnx", "https://huggingface.co/Luigi/campplus-zh-en-onnx/resolve/aa79cf9b8628a46ca362bf9bf7cde226a470a282/campplus_zh_en_fp32.onnx",
     "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2"),
)


def main(directory: str) -> int:
    target = Path(directory)
    for name, url, sha256 in MODELS:
        try:
            with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 - a fixed https URL
                data = response.read()
        except OSError as exc:
            print(f"{name} not downloaded:", type(exc).__name__)
            continue
        if hashlib.sha256(data).hexdigest() != sha256:
            print(f"{name}: checksum mismatch")
            return 1
        target.mkdir(parents=True, exist_ok=True)
        (target / name).write_bytes(data)
        print(f"{name}:", len(data), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "/srv/models"))
