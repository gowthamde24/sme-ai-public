# ruff: noqa: E501
"""The off-topic eval of the automatic WhatsApp reply: a thin wrapper of app/autoreply/offtopic_eval.py (see there).

The owner never types the model key in a shell: run it as the Cloud Run job `sme-offtopic-eval` (key bound from Secret Manager)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.autoreply.offtopic_eval import main

if __name__ == "__main__":
    raise SystemExit(main())
