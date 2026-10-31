"""Fetch the audio turn model into the API image at build time (docs/runbooks/live-turn-models.md): Indic Smart Turn base int8, BSD-2-Clause, one pinned revision, checked against its sha256.
A download that cannot be reached leaves the image without the model (the API then uses the text rules alone and says so at start); a file that does not match the checksum fails the build.
Usage: python fetch_audio_turn_model.py <directory>"""

import hashlib
import sys
import urllib.request
from pathlib import Path

REVISION = "d5878b3ce4d5287c9811943a0b362d3533f85dea"
NAME = "indic-smart-turn-base-int8.onnx"
SHA256 = "98ef8f8e2185ab337bb622cf60cf353c5235d9db91182dd5c56fe7fbda8dc172"
URL = f"https://huggingface.co/adimyth/indic-smart-turn/resolve/{REVISION}/{NAME}"


def main(directory: str) -> int:
    try:
        with urllib.request.urlopen(URL, timeout=120) as response:  # noqa: S310 - a fixed https URL
            data = response.read()
    except OSError as exc:
        print("audio turn model not downloaded:", type(exc).__name__)
        return 0
    if hashlib.sha256(data).hexdigest() != SHA256:
        print("audio turn model: checksum mismatch")
        return 1
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    (target / NAME).write_bytes(data)
    print("audio turn model:", NAME, len(data), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "/srv/models"))
